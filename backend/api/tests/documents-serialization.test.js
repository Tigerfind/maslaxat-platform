const fs = require('fs/promises');
const express = require('express');
const request = require('supertest');
const app = require('../src/server');
const createDocumentsRouter = require('../src/routes/documents');
const { errorHandler } = require('../src/middleware/errorHandler');
const { resetDb, models, makeClient, tokenFor } = require('./helpers');

const { Document, ObjectCleanupTask } = models;
const PUBLIC_FIELDS = [
  'aiAnalysis', 'category', 'createdAt', 'id', 'name', 'size', 'status', 'type', 'updatedAt',
];

let client;
let token;
const createdPaths = [];

beforeEach(async () => {
  await resetDb();
  client = await makeClient('documents-serializer@test.uz');
  token = tokenFor(client);
});

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((filePath) => fs.rm(filePath, { force: true })));
});

test('document list returns an explicit allowlist without local or object-storage internals', async () => {
  await Document.create({
    userId: client.id,
    name: 'private.pdf',
    type: 'PDF',
    size: 7,
    path: '/private/local/path.pdf',
    storageProvider: 'r2',
    storageKey: `documents/${client.id}/private`,
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    status: 'pending',
    category: 'Договор',
  });

  const response = await request(app)
    .get('/api/documents')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(response.body).toHaveLength(1);
  expect(Object.keys(response.body[0]).sort()).toEqual(PUBLIC_FIELDS);
  expect(response.body[0]).not.toHaveProperty('path');
  expect(response.body[0]).not.toHaveProperty('storageProvider');
  expect(response.body[0]).not.toHaveProperty('storageKey');
  expect(response.body[0]).not.toHaveProperty('mimeType');
  expect(response.body[0]).not.toHaveProperty('sha256');
  expect(response.body[0]).not.toHaveProperty('userId');
});

test('document upload response uses the same allowlist and does not expose its disk path', async () => {
  const response = await request(app)
    .post('/api/documents/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('metadata', JSON.stringify({ category: 'Иск' }))
    .attach('file', Buffer.from('safe text'), { filename: 'claim.txt', contentType: 'text/plain' })
    .expect(201);

  expect(Object.keys(response.body).sort()).toEqual(PUBLIC_FIELDS);
  expect(response.body).not.toHaveProperty('path');
  expect(response.body).not.toHaveProperty('storageProvider');
  expect(response.body).not.toHaveProperty('storageKey');
  expect(response.body).not.toHaveProperty('sha256');
  expect(response.body).not.toHaveProperty('userId');

  const stored = await Document.findByPk(response.body.id);
  expect(stored).toMatchObject({
    path: null,
    storageProvider: 'r2',
    storageKey: `documents/${client.id}/${stored.id}`,
    mimeType: 'text/plain',
    size: 9,
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
});

test('document upload rejects extension and MIME that do not match file magic', async () => {
  await request(app)
    .post('/api/documents/upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('not a pdf'), { filename: 'claim.pdf', contentType: 'application/pdf' })
    .expect(400);
  await expect(Document.count({ where: { userId: client.id } })).resolves.toBe(0);
});

test('malformed document metadata JSON returns a controlled safe 400', async () => {
  const response = await request(app)
    .post('/api/documents/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('metadata', '{not-json')
    .attach('file', Buffer.from('safe text'), { filename: 'claim.txt', contentType: 'text/plain' })
    .expect(400);
  expect(response.body).toEqual({ error: 'Некорректные метаданные файла', code: 'INVALID_METADATA_JSON' });
});

test('invalid document UUID is rejected before ORM lookup', async () => {
  const lookup = jest.spyOn(Document, 'findOne');
  const response = await request(app)
    .get('/api/documents/not-a-uuid/download')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
  expect(response.body.code).toBe('INVALID_ID');
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockRestore();
});

test('document download and AI preparation read an R2-only record without exposing internals', async () => {
  const upload = await request(app)
    .post('/api/documents/upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('Lease agreement text'), { filename: 'lease.txt', contentType: 'text/plain' })
    .expect(201);
  const stored = await Document.findByPk(upload.body.id);
  expect(stored.path).toBeNull();

  const download = await request(app)
    .get(`/api/documents/${stored.id}/download`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(download.text).toBe('Lease agreement text');
  expect(download.headers['cache-control']).toBe('private, no-store');
  expect(download.headers['content-security-policy']).toMatch(/default-src 'none'/);

  const analysis = await request(app)
    .post(`/api/documents/${stored.id}/ai-check`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(analysis.body).toHaveProperty('score');
});

test('document DB persistence failure compensates the new object and leaves no business row', async () => {
  const failure = jest.spyOn(Document, 'create').mockRejectedValueOnce(new Error('document DB unavailable'));
  const before = await ObjectCleanupTask.count();

  await request(app)
    .post('/api/documents/upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('safe text'), { filename: 'failed.txt', contentType: 'text/plain' })
    .expect(500);

  failure.mockRestore();
  await expect(Document.count({ where: { userId: client.id } })).resolves.toBe(0);
  const intents = await ObjectCleanupTask.findAll({ order: [['createdAt', 'DESC']] });
  expect(intents).toHaveLength(before + 1);
  expect(intents[0]).toMatchObject({ status: 'completed', preventsKeyReuse: false });
});

test('injected storage failure creates no document row', async () => {
  const isolated = express();
  isolated.use(createDocumentsRouter({
    fileStorageService: {
      store: async () => { throw Object.assign(new Error('storage unavailable'), { code: 'STORAGE_DOWN' }); },
    },
  }));
  isolated.use(errorHandler);

  await request(isolated)
    .post('/upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('safe text'), { filename: 'failed.txt', contentType: 'text/plain' })
    .expect(500);
  await expect(Document.count({ where: { userId: client.id } })).resolves.toBe(0);
});
