// Фаза C — рабочие документы по делу (консультации). Видны обоим участникам
// (клиент + юрист); удаляет только автор загрузки; посторонний — 403.
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation } = models;
const PDF = Buffer.from('%PDF-1.4\n%case doc\n');

let client, lawyerUser, outsider, consultation;
let clientTok, lawyerTok, outsiderTok;

beforeAll(async () => {
  await resetDb();
  client = await makeClient('cd-client@test.uz');
  const l = await makeLawyer('cd-lawyer@test.uz');
  lawyerUser = l.user;
  outsider = await makeClient('cd-outsider@test.uz');
  consultation = await Consultation.create({
    clientId: client.id, lawyerId: lawyerUser.id,
    type: 'video', status: 'accepted', question: 'Вопрос по делу',
  });
  clientTok = tokenFor(client);
  lawyerTok = tokenFor(lawyerUser);
  outsiderTok = tokenFor(outsider);
});

afterAll(() => {
  const dir = process.env.UPLOAD_DIR || './uploads';
  try {
    fs.readdirSync(dir).filter((f) => f.startsWith('case-'))
      .forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* нет файла */ } });
  } catch (e) { /* нет папки */ }
});

const url = (suffix = '') => `/api/consultations/${consultation.id}/documents${suffix}`;

describe('участники видят общую папку по делу', () => {
  let docId;

  test('клиент загружает документ', async () => {
    const res = await request(app)
      .post(url())
      .set('Authorization', `Bearer ${clientTok}`)
      .attach('file', PDF, 'contract.pdf');
    expect(res.status).toBe(201);
    expect(res.body.document.name).toBe('contract.pdf');
    expect(res.body.document.path).toBeUndefined();
    docId = res.body.document.id;
  });

  test('юрист (другая сторона) видит документ клиента и может скачать', async () => {
    const list = await request(app).get(url()).set('Authorization', `Bearer ${lawyerTok}`);
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d) => d.id)).toContain(docId);

    const dl = await request(app)
      .get(url(`/${docId}/download`))
      .set('Authorization', `Bearer ${lawyerTok}`);
    expect(dl.status).toBe(200);
  });

  test('юрист НЕ может удалить документ клиента (403)', async () => {
    const res = await request(app)
      .delete(url(`/${docId}`))
      .set('Authorization', `Bearer ${lawyerTok}`);
    expect(res.status).toBe(403);
  });

  test('автор (клиент) удаляет свой документ', async () => {
    const res = await request(app)
      .delete(url(`/${docId}`))
      .set('Authorization', `Bearer ${clientTok}`);
    expect(res.status).toBe(200);

    const list = await request(app).get(url()).set('Authorization', `Bearer ${clientTok}`);
    expect(list.body.documents.map((d) => d.id)).not.toContain(docId);
  });
});

describe('посторонний не имеет доступа', () => {
  test('чужой клиент → 403 на список', async () => {
    const res = await request(app).get(url()).set('Authorization', `Bearer ${outsiderTok}`);
    expect(res.status).toBe(403);
  });

  test('чужой клиент → 403 на загрузку', async () => {
    const res = await request(app)
      .post(url())
      .set('Authorization', `Bearer ${outsiderTok}`)
      .attach('file', PDF, 'x.pdf');
    expect(res.status).toBe(403);
  });

  test('без токена → 401', async () => {
    const res = await request(app).get(url());
    expect(res.status).toBe(401);
  });
});
