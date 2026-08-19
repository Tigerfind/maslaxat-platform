const request = require('supertest');
const express = require('express');
const app = require('../src/server');
const createUsersRouter = require('../src/routes/users');
const { errorHandler } = require('../src/middleware/errorHandler');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const { User, ObjectCleanupTask } = models;
const PNG_A = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('avatar-a'),
]);
const PNG_B = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('avatar-b'),
]);

let user;
let auth;

beforeEach(async () => {
  await resetDb();
  user = await makeClient('avatar-storage@test.uz');
  auth = { Authorization: `Bearer ${tokenFor(user)}` };
});

test('external social avatar remains external until a managed upload replaces it', async () => {
  await user.update({ avatar: 'https://images.example.test/social/avatar.png' });

  const response = await request(app).put('/api/users/profile').set(auth).send({ name: 'External Avatar' });

  expect(response.status).toBe(200);
  expect(response.body.user.avatar).toBe('https://images.example.test/social/avatar.png');
  expect(response.body.user).not.toHaveProperty('avatarStorageKey');
  await user.reload();
  expect(user.avatarStorageKey).toBeNull();
});

test('invalid public avatar UUID is rejected before user lookup', async () => {
  const lookup = jest.spyOn(User, 'findByPk');
  const response = await request(app).get('/api/users/not-a-uuid/avatar').expect(400);
  expect(response.body.code).toBe('INVALID_ID');
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockRestore();
});

test('managed avatar has a stable public URL, ETag revalidation, and no storage internals', async () => {
  const upload = await request(app)
    .put('/api/users/profile')
    .set(auth)
    .field('name', 'Managed Avatar')
    .attach('avatar', PNG_A, { filename: 'avatar.png', contentType: 'image/png' });

  expect(upload.status).toBe(200);
  expect(upload.body.user.avatar).toBe(`/api/users/${user.id}/avatar`);
  for (const field of ['avatarStorageProvider', 'avatarStorageKey', 'avatarMimeType', 'avatarSize', 'avatarSha256', 'avatarLocalPath']) {
    expect(upload.body.user).not.toHaveProperty(field);
  }
  await user.reload();
  expect(user.getDataValue('avatarStorageProvider')).toBe('r2');
  expect(user.getDataValue('avatarStorageKey')).toMatch(new RegExp(`^avatars/${user.id}/[0-9a-f-]{36}$`));
  expect(user.getDataValue('avatarMimeType')).toBe('image/png');
  expect(user.getDataValue('avatarSize')).toBe(PNG_A.length);

  const first = await request(app).get(`/api/users/${user.id}/avatar`).expect(200);
  expect(first.body).toEqual(PNG_A);
  expect(first.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect(first.headers['cache-control']).toBe('public, max-age=300');
  expect(first.headers['x-content-type-options']).toBe('nosniff');

  await request(app)
    .get(`/api/users/${user.id}/avatar`)
    .set('If-None-Match', first.headers.etag)
    .expect(304);
});

test('avatar replacement persists the new object before tombstoning the old key', async () => {
  await request(app).put('/api/users/profile').set(auth)
    .attach('avatar', PNG_A, { filename: 'first.png', contentType: 'image/png' }).expect(200);
  await user.reload();
  const oldKey = user.avatarStorageKey;

  const replacement = await request(app).put('/api/users/profile').set(auth)
    .attach('avatar', PNG_B, { filename: 'second.png', contentType: 'image/png' });
  expect(replacement.status).toBe(200);
  await user.reload();

  expect(user.avatarStorageKey).not.toBe(oldKey);
  await expect(ObjectCleanupTask.findOne({
    where: { storageKey: oldKey, preventsKeyReuse: true },
  })).resolves.toBeTruthy();
  const served = await request(app).get(`/api/users/${user.id}/avatar`).expect(200);
  expect(served.body).toEqual(PNG_B);
});

test('avatar upload rejects matching extension and MIME with invalid magic', async () => {
  await request(app).put('/api/users/profile').set(auth)
    .attach('avatar', Buffer.from('not png'), { filename: 'fake.png', contentType: 'image/png' })
    .expect(400);
  await user.reload();
  expect(user.avatarStorageKey).toBeNull();
});

test('avatar DB failure compensates the new object and preserves the previous external value', async () => {
  await user.update({ avatar: 'https://images.example.test/original.png' });
  const failure = jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('avatar DB unavailable'));
  const before = await ObjectCleanupTask.count();

  await request(app).put('/api/users/profile').set(auth)
    .attach('avatar', PNG_A, { filename: 'failed.png', contentType: 'image/png' })
    .expect(500);
  failure.mockRestore();

  await user.reload();
  expect(user.avatar).toBe('https://images.example.test/original.png');
  expect(user.getDataValue('avatarStorageKey')).toBeNull();
  expect(await ObjectCleanupTask.count()).toBe(before + 1);
  await expect(ObjectCleanupTask.findOne({ order: [['createdAt', 'DESC']] }))
    .resolves.toMatchObject({ status: 'completed' });
});

test('lawyer profile avatar upload uses the same managed stable endpoint', async () => {
  const { user: lawyer, lp } = await makeLawyer('lawyer-avatar-storage@test.uz');
  const response = await request(app)
    .put('/api/lawyer/profile')
    .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .field('profileRevision', String(lp.revision))
    .attach('avatar', PNG_A, { filename: 'lawyer.png', contentType: 'image/png' });

  expect(response.status).toBe(200);
  await lawyer.reload();
  expect(lawyer.avatar).toBe(`/api/users/${lawyer.id}/avatar`);
  expect(lawyer.getDataValue('avatarStorageKey')).toMatch(/^avatars\//);
  await request(app).get(`/api/users/${lawyer.id}/avatar`).expect(200);
});

test('dual avatar persists its local path and replacement schedules both old copies', async () => {
  const oldPath = '/safe/uploads/avatars/old';
  const newPath = '/safe/uploads/avatars/new';
  await user.update({
    avatar: `/api/users/${user.id}/avatar`,
    avatarStorageProvider: 'r2',
    avatarStorageKey: `avatars/${user.id}/11111111-1111-4111-8111-111111111111`,
    avatarMimeType: 'image/png',
    avatarSize: PNG_A.length,
    avatarSha256: 'a'.repeat(64),
    avatarLocalPath: oldPath,
  });
  const deleted = [];
  const isolatedStorage = {
    store: async ({ persist }) => models.sequelize.transaction((transaction) => persist({
      transaction,
      metadata: {
        storageProvider: 'r2',
        storageKey: `avatars/${user.id}/22222222-2222-4222-8222-222222222222`,
        mimeType: 'image/png',
        size: PNG_B.length,
        sha256: 'b'.repeat(64),
        path: newPath,
      },
    })),
    delete: async ({ record, destroy }) => {
      deleted.push(record);
      await destroy({ transaction: null });
      return { cleanupPending: false };
    },
    stream: async () => undefined,
  };
  const isolated = express();
  isolated.use(express.json());
  isolated.use(createUsersRouter({ fileStorageService: isolatedStorage }));
  isolated.use(errorHandler);

  await request(isolated)
    .put('/profile')
    .set(auth)
    .attach('avatar', PNG_B, { filename: 'replacement.png', contentType: 'image/png' })
    .expect(200);

  await user.reload();
  expect(user.getDataValue('avatarLocalPath')).toBe(newPath);
  expect(deleted).toEqual([expect.objectContaining({
    storageKey: `avatars/${user.id}/11111111-1111-4111-8111-111111111111`,
    path: oldPath,
  })]);
});
