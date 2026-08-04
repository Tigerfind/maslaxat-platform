// Фаза B — верификационные документы юриста (диплом/лицензия/удостоверение).
// Юрист грузит/удаляет/отправляет на проверку; админ видит и скачивает; чужим — нельзя.
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, tokenFor, makeClient, makeLawyer, makeAdmin } = require('./helpers');

const PDF = Buffer.from('%PDF-1.4\n%test verification doc\n');

beforeAll(async () => {
  await resetDb();
});

// Чистим созданные на диске файлы verif-* после набора (по имени, без обращения к БД —
// соединение к этому моменту уже закрыто глобальным teardown).
afterAll(() => {
  const dir = process.env.UPLOAD_DIR || './uploads';
  try {
    fs.readdirSync(dir)
      .filter((f) => f.startsWith('verif-'))
      .forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* нет файла */ } });
  } catch (e) { /* нет папки */ }
});

describe('юрист управляет верификационными документами', () => {
  test('upload → list → delete', async () => {
    const { user } = await makeLawyer('doc-l1@test.uz', { verificationStatus: 'pending' });
    const token = tokenFor(user);

    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'diploma')
      .attach('file', PDF, 'diploma.pdf');
    expect(up.status).toBe(201);
    expect(up.body.document.type).toBe('diploma');
    expect(up.body.document.name).toBe('diploma.pdf');
    // путь на диск клиенту не отдаём
    expect(up.body.document.path).toBeUndefined();
    const docId = up.body.document.id;

    const list = await request(app)
      .get('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d) => d.id)).toContain(docId);

    const del = await request(app)
      .delete(`/api/lawyer/verification-documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list2 = await request(app)
      .get('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${token}`);
    expect(list2.body.documents.map((d) => d.id)).not.toContain(docId);
  });

  test('неверный тип файла отклоняется', async () => {
    const { user } = await makeLawyer('doc-l2@test.uz');
    const res = await request(app)
      .post('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('type', 'diploma')
      .attach('file', Buffer.from('MZ executable'), 'virus.exe');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('submit-for-review переводит статус в pending', async () => {
    const { user, lp } = await makeLawyer('doc-l3@test.uz', { verificationStatus: 'rejected', rejectionReason: 'Нет диплома' });
    const res = await request(app)
      .post('/api/lawyer/verification/submit')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);

    await lp.reload();
    expect(lp.verificationStatus).toBe('pending');
    expect(lp.rejectionReason).toBeNull();
  });

  test('одобренного submit не трогает (400)', async () => {
    const { user } = await makeLawyer('doc-l4@test.uz', { verificationStatus: 'approved' });
    const res = await request(app)
      .post('/api/lawyer/verification/submit')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('админ видит и скачивает документы', () => {
  test('list + download', async () => {
    const admin = await makeAdmin('doc-admin@test.uz');
    const { user: lawyer } = await makeLawyer('doc-l5@test.uz', { verificationStatus: 'pending' });

    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
      .field('type', 'license')
      .attach('file', PDF, 'license.pdf');
    const docId = up.body.document.id;

    const list = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d) => d.id)).toContain(docId);

    const dl = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents/${docId}/download`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(dl.status).toBe(200);
  });
});

describe('доступ', () => {
  test('клиент не может грузить верификационные документы (403)', async () => {
    const client = await makeClient('doc-client@test.uz');
    const res = await request(app)
      .post('/api/lawyer/verification-documents')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .field('type', 'diploma')
      .attach('file', PDF, 'x.pdf');
    expect(res.status).toBe(403);
  });

  test('клиент не может смотреть чужие документы через админку (403)', async () => {
    const client = await makeClient('doc-client2@test.uz');
    const { user: lawyer } = await makeLawyer('doc-l6@test.uz');
    const res = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(403);
  });
});
