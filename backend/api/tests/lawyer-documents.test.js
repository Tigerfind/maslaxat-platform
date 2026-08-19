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
const {
  resetDb,
  tokenFor,
  makeClient,
  makeLawyer: makeLawyerFixture,
  makeAdmin: makeAdminFixture,
} = require('./helpers');
const { LawyerDocument, LawyerProfile } = require('../src/models');

const PDF = Buffer.from('%PDF-1.4\n%test verification doc\n');

beforeAll(async () => {
  await resetDb();
});

async function makeLawyer(email, profile) {
  const result = await makeLawyerFixture(email, profile);
  await result.user.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  return result;
}

async function makeAdmin(email) {
  const user = await makeAdminFixture(email);
  await user.update({ twoFactorEnabled: true });
  return user;
}

const lawyerAuth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}`, 'X-Maslaxat-Mode': 'lawyer' });
const adminAuth = (user) => ({ Authorization: `Bearer ${tokenFor(user, 'mfa')}`, 'X-Maslaxat-Mode': 'admin' });

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
    const headers = lawyerAuth(user);

    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(headers)
      .field('type', 'diploma')
      .attach('file', PDF, 'diploma.pdf');
    expect(up.status).toBe(201);
    expect(up.body.document.type).toBe('diploma');
    expect(up.body.document.name).toBe('diploma.pdf');
    // путь на диск клиенту не отдаём
    expect(up.body.document.path).toBeUndefined();
    expect(up.body.document.storageProvider).toBeUndefined();
    expect(up.body.document.storageKey).toBeUndefined();
    const docId = up.body.document.id;
    await expect(LawyerDocument.findByPk(docId)).resolves.toMatchObject({
      path: null,
      storageProvider: 'r2',
      storageKey: `lawyer-documents/${user.id}/${docId}`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const list = await request(app)
      .get('/api/lawyer/verification-documents')
      .set(headers);
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d) => d.id)).toContain(docId);

    const del = await request(app)
      .delete(`/api/lawyer/verification-documents/${docId}`)
      .set(headers);
    expect(del.status).toBe(200);

    const list2 = await request(app)
      .get('/api/lawyer/verification-documents')
      .set(headers);
    expect(list2.body.documents.map((d) => d.id)).not.toContain(docId);
  });

  test('неверный тип файла отклоняется', async () => {
    const { user } = await makeLawyer('doc-l2@test.uz');
    const res = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(lawyerAuth(user))
      .field('type', 'diploma')
      .attach('file', Buffer.from('MZ executable'), 'virus.exe');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('deleting approved evidence invalidates dependent profile provenance in the delete transaction', async () => {
    const { user, lp } = await makeLawyer('doc-provenance@test.uz', { verificationStatus: 'approved' });
    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(lawyerAuth(user))
      .field('type', 'diploma')
      .attach('file', PDF, 'evidence.pdf')
      .expect(201);
    const docId = up.body.document.id;
    await LawyerDocument.update({ verificationStatus: 'approved' }, { where: { id: docId } });
    await lp.update({
      profileSources: {
        education: { source: 'supporting_document', verificationLevel: 'document_checked', documentId: docId },
      },
      verifiedSnapshot: { education: [{ institution: 'TSUL' }] },
      verifiedAt: new Date(),
    });

    await request(app)
      .delete(`/api/lawyer/verification-documents/${docId}`)
      .set(lawyerAuth(user))
      .expect(200);

    const profile = await LawyerProfile.findOne({ where: { userId: user.id } });
    expect(profile.profileSources.education).toBeUndefined();
    expect(profile.verifiedSnapshot.education).toBeUndefined();
    expect(profile.verificationStatus).toBe('pending');
  });

  test('юрист может скачать/просмотреть свой документ', async () => {
    const { user } = await makeLawyer('doc-l1b@test.uz', { verificationStatus: 'pending' });
    const headers = lawyerAuth(user);
    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(headers)
      .field('type', 'diploma')
      .attach('file', PDF, 'own.pdf');
    const docId = up.body.document.id;

    const dl = await request(app)
      .get(`/api/lawyer/verification-documents/${docId}/download`)
      .set(headers);
    expect(dl.status).toBe(200);
    expect(dl.headers['cache-control']).toBe('private, no-store');
    expect(dl.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });

  test('чужой документ по own-download недоступен (404)', async () => {
    const a = await makeLawyer('doc-l1c@test.uz');
    const b = await makeLawyer('doc-l1d@test.uz');
    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(lawyerAuth(a.user))
      .field('type', 'diploma')
      .attach('file', PDF, 'a.pdf');
    const docId = up.body.document.id;

    const dl = await request(app)
      .get(`/api/lawyer/verification-documents/${docId}/download`)
      .set(lawyerAuth(b.user));
    expect(dl.status).toBe(404);
  });

  test('submit-for-review переводит статус в pending (профиль полный)', async () => {
    const { user, lp } = await makeLawyer('doc-l3@test.uz', { verificationStatus: 'rejected', rejectionReason: 'Нет диплома' });
    // Гейт полноты: нужен ≥1 документ (описание/расписание/цена/спец уже в makeLawyer).
    await request(app)
      .post('/api/lawyer/verification-documents')
      .set(lawyerAuth(user))
      .field('type', 'diploma').attach('file', PDF, 'd.pdf');

    const res = await request(app)
      .post('/api/lawyer/verification/submit')
      .set(lawyerAuth(user));
    expect(res.status).toBe(200);

    await lp.reload();
    expect(lp.verificationStatus).toBe('pending');
    expect(lp.rejectionReason).toBeNull();
  });

  test('гейт полноты: неполный профиль → submit 400 + missing', async () => {
    // Профиль без документа (описание/расписание есть по умолчанию) → не хватает documents.
    const { user } = await makeLawyer('doc-l3b@test.uz', { verificationStatus: 'pending' });
    const res = await request(app)
      .post('/api/lawyer/verification/submit')
      .set(lawyerAuth(user));
    expect(res.status).toBe(400);
    expect(res.body.missing).toContain('documents');
  });

  test('одобренного submit не трогает (400)', async () => {
    const { user } = await makeLawyer('doc-l4@test.uz', { verificationStatus: 'approved' });
    const res = await request(app)
      .post('/api/lawyer/verification/submit')
      .set(lawyerAuth(user));
    expect(res.status).toBe(400);
  });
});

describe('админ видит и скачивает документы', () => {
  test('list + download', async () => {
    const admin = await makeAdmin('doc-admin@test.uz');
    const { user: lawyer } = await makeLawyer('doc-l5@test.uz', { verificationStatus: 'pending' });

    const up = await request(app)
      .post('/api/lawyer/verification-documents')
      .set(lawyerAuth(lawyer))
      .field('type', 'license')
      .attach('file', PDF, 'license.pdf');
    const docId = up.body.document.id;

    const list = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents`)
      .set(adminAuth(admin));
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d) => d.id)).toContain(docId);

    const dl = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents/${docId}/download`)
      .set(adminAuth(admin));
    expect(dl.status).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');

    await request(app)
      .delete(`/api/admin/lawyers/${lawyer.id}/verification-documents/${docId}`)
      .set(adminAuth(admin))
      .expect(200);
    await expect(LawyerDocument.findByPk(docId)).resolves.toBeNull();
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

  test('lawyer and admin document routes reject invalid UUIDs before ORM lookup', async () => {
    const { user: lawyer } = await makeLawyer('doc-invalid-id-lawyer@test.uz');
    const admin = await makeAdmin('doc-invalid-id-admin@test.uz');
    const lookup = jest.spyOn(LawyerDocument, 'findOne');

    const owner = await request(app)
      .get('/api/lawyer/verification-documents/not-a-uuid/download')
      .set(lawyerAuth(lawyer))
      .expect(400);
    const adminResponse = await request(app)
      .get(`/api/admin/lawyers/${lawyer.id}/verification-documents/not-a-uuid/download`)
      .set(adminAuth(admin))
      .expect(400);

    expect(owner.body.code).toBe('INVALID_ID');
    expect(adminResponse.body.code).toBe('INVALID_ID');
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRestore();
  });
});
