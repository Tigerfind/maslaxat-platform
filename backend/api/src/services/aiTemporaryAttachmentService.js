'use strict';

const crypto = require('crypto');

const MAX_TEXT_CHARS = 5000;

function attachmentLabel(file, text) {
  return {
    type: 'text',
    text: `[Прикреплённый файл: ${file.originalname}]\n${String(text || '').slice(0, MAX_TEXT_CHARS)}`,
  };
}

function validateDocxStructure(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 26 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  const minimum = Math.max(0, buffer.length - 65557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) return false;
  const entries = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (!entries || directoryOffset + directorySize > endOffset) return false;
  const names = new Set();
  let offset = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > endOffset) return false;
    names.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = next;
  }
  return offset === directoryOffset + directorySize
    && names.has('[Content_Types].xml') && names.has('word/document.xml');
}

function invalidAttachment(reason) {
  return Object.assign(new Error('AI attachment structure is invalid'), {
    status: 400, code: 'INVALID_ATTACHMENT', reason,
  });
}

function validateAttachmentStructure(file) {
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    && !validateDocxStructure(file.buffer)) throw invalidAttachment('INVALID_DOCX_STRUCTURE');
  if (file.mimetype === 'application/msword') throw invalidAttachment('UNSUPPORTED_LEGACY_DOC');
  return true;
}

async function parseAttachmentBuffers(files, dependencies = {}) {
  const content = [];
  for (const file of files) {
    validateAttachmentStructure(file);
    if (file.mimetype?.startsWith('image/')) {
      content.push({
        type: 'image',
        source: {
          type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64'),
        },
      });
    } else if (file.mimetype === 'application/pdf') {
      const pdfParse = dependencies.pdfParse || require('pdf-parse');
      const parsed = await pdfParse(file.buffer);
      content.push(attachmentLabel(file, parsed.text));
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = dependencies.mammoth || require('mammoth');
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      content.push(attachmentLabel(file, parsed.value));
    } else if (file.mimetype === 'application/msword') {
      throw invalidAttachment('UNSUPPORTED_LEGACY_DOC');
    } else {
      content.push(attachmentLabel(file, file.buffer.toString('utf8')));
    }
  }
  return content;
}

function validateScope(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) {
    throw new TypeError(`${name} must be a UUID`);
  }
}

function createAITemporaryAttachmentService({ objectStorage, cleanupService }) {
  if (!objectStorage || !cleanupService) throw new TypeError('Object storage and cleanup service are required');

  function attachFailure(error, code) {
    if (!error) return;
    try {
      if (!Array.isArray(error.cleanupFailures)) error.cleanupFailures = [];
      if (!error.cleanupFailures.includes(code)) error.cleanupFailures.push(code);
    } catch (_telemetryError) {
      // Cleanup telemetry is best-effort and must never replace the primary failure.
    }
  }

  async function cleanup(staged, { dueOnFailure = true, primaryError } = {}) {
    const failures = [];
    for (const attachment of staged) {
      try {
        const result = await objectStorage.deletePrivateObjectIfOwned(attachment.storageKey, attachment.intentId);
        if (result.ownershipMismatch) throw Object.assign(new Error('Ownership mismatch'), { code: 'OWNERSHIP_MISMATCH' });
        await cleanupService.resolveObjectCleanupIntent({ intentId: attachment.intentId });
      } catch (error) {
        failures.push('OBJECT_CLEANUP_FAILED');
        if (dueOnFailure) {
          try {
            await cleanupService.markObjectCleanupIntentDue({ intentId: attachment.intentId, error });
          } catch (_markError) {
            failures.push('OBJECT_CLEANUP_DUE_FAILED');
          }
        }
      }
    }
    for (const failure of failures) attachFailure(primaryError, failure);
    return failures;
  }

  async function stageAttachments({ userId, requestId, files = [], now = new Date(), signal } = {}) {
    validateScope(userId, 'userId');
    validateScope(requestId, 'requestId');
    const staged = [];
    for (const file of files) {
      if (signal?.aborted) throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
      const storageKey = `ai-temp/${userId}/${requestId}/${crypto.randomUUID()}`;
      const intent = await cleanupService.createObjectCleanupIntent({
        storageKey, provider: 'r2', reserveCleanup: true, reclaimReserved: true, now,
      });
      const attachment = { ...file, storageKey, intentId: intent.id };
      try {
        await objectStorage.putPrivateObject({
          key: storageKey,
          body: file.buffer,
          contentType: file.mimetype,
          checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
          ownershipToken: intent.id,
          signal,
        });
        await cleanupService.armObjectCleanupIntent({ intentId: intent.id, now });
        staged.push(attachment);
      } catch (error) {
        try {
          await cleanupService.markObjectCleanupIntentDue({ intentId: intent.id, error, now });
        } catch (_markError) {
          attachFailure(error, 'OBJECT_CLEANUP_DUE_FAILED');
        }
        await cleanup(staged, { primaryError: error });
        throw error;
      }
    }
    return staged;
  }

  async function withAttachments(options, operation) {
    if (typeof operation !== 'function') throw new TypeError('Attachment operation is required');
    const staged = await stageAttachments(options);
    let result;
    let primaryError;
    try {
      result = await operation(staged.map(({ storageKey, intentId, ...file }) => file));
    } catch (error) {
      primaryError = error;
    }
    await cleanup(staged, { primaryError });
    if (primaryError) throw primaryError;
    return result;
  }

  return { stageAttachments, withAttachments };
}

module.exports = {
  createAITemporaryAttachmentService, parseAttachmentBuffers,
  validateDocxStructure, validateAttachmentStructure,
};
