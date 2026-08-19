'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createMemoryUpload } = require('../src/middleware/fileUpload');
const {
  createAITemporaryAttachmentService,
  parseAttachmentBuffers,
  validateDocxStructure,
} = require('../src/services/aiTemporaryAttachmentService');

function file(overrides = {}) {
  return {
    originalname: 'claim.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('contract text'),
    ...overrides,
  };
}

function harness({ putError, deleteError, markError } = {}) {
  const intents = [];
  const calls = [];
  const cleanupService = {
    async createObjectCleanupIntent(input) {
      const intent = { id: crypto.randomUUID(), ...input, status: 'reserved' };
      intents.push(intent);
      calls.push(['reserve', input]);
      return intent;
    },
    async armObjectCleanupIntent({ intentId, now }) {
      const intent = intents.find((entry) => entry.id === intentId);
      intent.status = 'pending';
      intent.nextAttemptAt = new Date(new Date(now).getTime() + 15 * 60 * 1000);
      calls.push(['arm', intentId]);
    },
    async resolveObjectCleanupIntent({ intentId }) {
      intents.find((entry) => entry.id === intentId).status = 'completed';
      calls.push(['resolve', intentId]);
    },
    async markObjectCleanupIntentDue({ intentId }) {
      if (markError) throw markError;
      intents.find((entry) => entry.id === intentId).status = 'pending';
      calls.push(['due', intentId]);
    },
  };
  const objectStorage = {
    async putPrivateObject(input) {
      calls.push(['put', input]);
      if (putError) throw putError;
      return { created: true };
    },
    async deletePrivateObjectIfOwned(key, token) {
      calls.push(['delete', key, token]);
      if (deleteError) throw deleteError;
      return { deleted: true };
    },
  };
  return {
    intents,
    calls,
    service: createAITemporaryAttachmentService({ objectStorage, cleanupService }),
  };
}

function uploadApp() {
  const app = express();
  const upload = createMemoryUpload({
    types: ['jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'txt'], maxBytes: 10 * 1024 * 1024,
  });
  app.post('/ai', upload.array('files', 5), (req, res) => res.json({ count: req.files.length }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  return app;
}

test('AI memory intake accepts at most five strict allowlisted files', async () => {
  let accepted = request(uploadApp()).post('/ai');
  for (let index = 0; index < 5; index += 1) {
    accepted = accepted.attach('files', Buffer.from(`text-${index}`), {
      filename: `file-${index}.txt`, contentType: 'text/plain',
    });
  }
  await accepted.expect(200, { count: 5 });

  let excessive = request(uploadApp()).post('/ai');
  for (let index = 0; index < 6; index += 1) {
    excessive = excessive.attach('files', Buffer.from(`text-${index}`), {
      filename: `file-${index}.txt`, contentType: 'text/plain',
    });
  }
  await excessive.expect(400, { code: 'INVALID_FILE_UPLOAD' });
});

test('AI memory intake rejects extension, MIME, and magic mismatches', async () => {
  await request(uploadApp()).post('/ai')
    .attach('files', Buffer.from('not a pdf'), { filename: 'claim.pdf', contentType: 'application/pdf' })
    .expect(400, { code: 'INVALID_FILE_UPLOAD' });
});

test('uploads opaque AI temp objects, processes original buffers, then resolves cleanup', async () => {
  const { service, intents, calls } = harness();
  const input = file();
  const seen = [];

  const result = await service.withAttachments({
    userId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    files: [input],
  }, async (attachments) => {
    seen.push(attachments[0].buffer);
    return 'ok';
  });

  expect(result).toBe('ok');
  expect(seen[0]).toBe(input.buffer);
  const put = calls.find(([name]) => name === 'put')[1];
  expect(put.key).toMatch(/^ai-temp\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]{36}$/);
  expect(put.body).toBe(input.buffer);
  expect(intents[0].status).toBe('completed');
  expect(calls.map(([name]) => name)).toEqual(['reserve', 'put', 'arm', 'delete', 'resolve']);
});

test('parses PDF, DOCX, text, and image attachments directly from buffers', async () => {
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const parsed = await parseAttachmentBuffers([
    file({ originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-x') }),
    file({ originalname: 'b.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxStructure(['[Content_Types].xml', 'word/document.xml']) }),
    file(),
    file({ originalname: 'scan.png', mimetype: 'image/png', buffer: image }),
  ], {
    pdfParse: async (buffer) => ({ text: `pdf:${buffer.toString()}` }),
    mammoth: { extractRawText: async ({ buffer }) => ({ value: `docx:${buffer.toString()}` }) },
  });

  expect(parsed[0].text).toContain('pdf:%PDF-x');
  expect(parsed[1].text).toContain('docx:');
  expect(parsed[2].text).toContain('contract text');
  expect(parsed[3]).toEqual({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') },
  });
});

test('provider upload failure leaves the durable intent due without invoking the operation', async () => {
  const { service, intents } = harness({ putError: new Error('provider unavailable') });
  const operation = jest.fn();
  await expect(service.withAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()],
  }, operation)).rejects.toThrow('provider unavailable');
  expect(operation).not.toHaveBeenCalled();
  expect(intents[0].status).toBe('pending');
});

test('request abort still removes an uploaded object and resolves its cleanup intent', async () => {
  const { service, calls, intents } = harness();
  const controller = new AbortController();
  await expect(service.withAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()], signal: controller.signal,
  }, async () => {
    controller.abort();
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  })).rejects.toThrow('aborted');
  expect(calls.some(([name]) => name === 'delete')).toBe(true);
  expect(intents[0].status).toBe('completed');
});

test('a crash after staging leaves an ownership-proved cleanup intent due in 15 minutes', async () => {
  const { service, intents, calls } = harness();
  const now = new Date('2026-08-18T12:00:00.000Z');
  await service.stageAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()], now,
  });
  expect(intents[0].status).toBe('pending');
  expect(intents[0].nextAttemptAt.toISOString()).toBe('2026-08-18T12:15:00.000Z');
  expect(calls.some(([name]) => name === 'delete')).toBe(false);
});

test('failed final deletion leaves cleanup due for the worker', async () => {
  const { service, intents, calls } = harness({ deleteError: new Error('delete failed') });
  await service.withAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()],
  }, async () => 'answer');
  expect(intents[0].status).toBe('pending');
  expect(calls.some(([name]) => name === 'due')).toBe(true);
});

function zipDirectoryEntry(name) {
  const nameBuffer = Buffer.from(name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(nameBuffer.length, 28);
  return Buffer.concat([header, nameBuffer]);
}

function docxStructure(names) {
  const prefix = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const directory = Buffer.concat(names.map(zipDirectoryEntry));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(prefix.length, 16);
  return Buffer.concat([prefix, directory, end]);
}

test('DOCX parsing requires both structural ZIP entries before Mammoth', async () => {
  const valid = docxStructure(['[Content_Types].xml', 'word/document.xml']);
  expect(validateDocxStructure(valid)).toBe(true);
  const mammoth = { extractRawText: jest.fn(async () => ({ value: 'safe docx' })) };
  await expect(parseAttachmentBuffers([
    file({ originalname: 'safe.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: valid }),
  ], { mammoth, pdfParse: jest.fn() })).resolves.toEqual([
    expect.objectContaining({ text: expect.stringContaining('safe docx') }),
  ]);
  expect(mammoth.extractRawText).toHaveBeenCalledTimes(1);
});

test('arbitrary ZIP and legacy OLE DOC are rejected before Mammoth', async () => {
  const mammoth = { extractRawText: jest.fn() };
  const arbitraryZip = docxStructure(['payload.bin']);
  await expect(parseAttachmentBuffers([
    file({ originalname: 'fake.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: arbitraryZip }),
  ], { mammoth, pdfParse: jest.fn() })).rejects.toMatchObject({
    status: 400, code: 'INVALID_ATTACHMENT', reason: 'INVALID_DOCX_STRUCTURE',
  });
  await expect(parseAttachmentBuffers([
    file({ originalname: 'legacy.doc', mimetype: 'application/msword', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }),
  ], { mammoth, pdfParse: jest.fn() })).rejects.toMatchObject({
    status: 400, code: 'INVALID_ATTACHMENT', reason: 'UNSUPPORTED_LEGACY_DOC',
  });
  expect(mammoth.extractRawText).not.toHaveBeenCalled();
});

test('AI response generation rethrows classified invalid attachments instead of fallback', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = `sk-ant-${'a'.repeat(24)}`;
  try {
    const aiRouter = require('../src/routes/ai');
    await expect(aiRouter.generateAIResponse('analyze', [
      file({
        originalname: 'fake.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxStructure(['payload.bin']),
      }),
    ])).rejects.toMatchObject({ status: 400, code: 'INVALID_ATTACHMENT' });
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test('cleanup failures never replace the original parser error', async () => {
  const parserError = Object.assign(new Error('parser failed with private detail'), { code: 'PARSER_FAILED' });
  const { service } = harness({ deleteError: new Error('delete private'), markError: new Error('db private') });
  let caught;
  try {
    await service.withAttachments({
      userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()],
    }, async () => { throw parserError; });
  } catch (error) { caught = error; }
  expect(caught).toBe(parserError);
  expect(caught.cleanupFailures).toEqual(['OBJECT_CLEANUP_FAILED', 'OBJECT_CLEANUP_DUE_FAILED']);
  expect(JSON.stringify(caught.cleanupFailures)).not.toContain('private');
});

test('mark-due failure never replaces the original provider upload error', async () => {
  const providerError = Object.assign(new Error('provider primary'), { code: 'PROVIDER_FAILED' });
  const { service } = harness({ putError: providerError, markError: new Error('db secondary') });
  await expect(service.withAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()],
  }, async () => 'unused')).rejects.toBe(providerError);
  expect(providerError.cleanupFailures).toEqual(['OBJECT_CLEANUP_DUE_FAILED']);
});

test('a non-extensible primary error is still preserved when telemetry cannot attach', async () => {
  const providerError = Object.freeze(new Error('frozen provider error'));
  const { service } = harness({ putError: providerError, markError: new Error('secondary') });
  await expect(service.withAttachments({
    userId: crypto.randomUUID(), requestId: crypto.randomUUID(), files: [file()],
  }, async () => 'unused')).rejects.toBe(providerError);
});
