const request = require('supertest');
const app = require('../src/server');
const { resetDb, makeClient, tokenFor, models } = require('./helpers');

beforeEach(resetDb);

test('переименованный executable не принимается как PDF', async () => {
  const client = await makeClient('upload-signature@test.uz');
  const response = await request(app).post('/api/documents/upload')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .attach('file', Buffer.from('MZ executable payload'), { filename: 'contract.pdf', contentType: 'application/pdf' });
  expect(response.status).toBe(400);
  expect(await models.Document.count({ where: { userId: client.id } })).toBe(0);
});

test('PDF не принимается как PNG-аватар', async () => {
  const client = await makeClient('avatar-signature@test.uz');
  const response = await request(app).put('/api/users/profile')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .attach('avatar', Buffer.from('%PDF-1.4\n'), { filename: 'avatar.png', contentType: 'image/png' });
  expect(response.status).toBe(400);
  await client.reload();
  expect(client.avatar).toBeFalsy();
});

test('несовпадающие MIME и расширение отклоняются до записи', async () => {
  const client = await makeClient('upload-mime@test.uz');
  const response = await request(app).post('/api/documents/upload')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .attach('file', Buffer.from('%PDF-1.4\n'), { filename: 'contract.pdf', contentType: 'image/png' });
  expect(response.status).toBe(400);
  expect(await models.Document.count({ where: { userId: client.id } })).toBe(0);
});
