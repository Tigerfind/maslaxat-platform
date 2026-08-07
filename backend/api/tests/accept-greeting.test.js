// Быстрое принятие с приветствием: сообщение юриста уходит клиенту в чат
// (не перезаписывает notes клиента).
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Message } = models;

beforeAll(async () => { await resetDb(); });

describe('принятие заявки с приветствием', () => {
  test('responseMessage → сообщение в чат, notes клиента не тронуты', async () => {
    const client = await makeClient('ag-c@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l@test.uz');
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'pending',
      question: 'Вопрос', notes: 'Заметка клиента',
    });

    const res = await request(app)
      .post(`/api/lawyer/consultation-requests/${c.id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
      .send({ responseMessage: 'Здравствуйте! Помогу с вашим вопросом.' });
    expect(res.status).toBe(200);

    await c.reload();
    expect(c.status).toBe('accepted');
    expect(c.notes).toBe('Заметка клиента'); // notes клиента сохранены

    const msg = await Message.findOne({ where: { consultationId: c.id, senderId: lawyer.id } });
    expect(msg).toBeTruthy();
    expect(msg.text).toMatch(/Помогу/);
  });

  test('repeatCount: список заявок показывает число прошлых консультаций клиента', async () => {
    const client = await makeClient('ag-repeat@test.uz');
    const { user: lawyer } = await makeLawyer('ag-lr@test.uz');
    // 2 завершённые в прошлом + 1 новая заявка (pending)
    await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'completed', question: 'q1' });
    await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'completed', question: 'q2' });
    await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'pending', question: 'q3' });

    const res = await request(app)
      .get('/api/lawyer/consultation-requests?status=pending')
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(200);
    const pending = res.body.find((r) => r.question === 'q3');
    expect(pending.repeatCount).toBe(2);
  });

  test('приватная заметка юриста: сохраняется и возвращается в списке', async () => {
    const client = await makeClient('note-c@test.uz');
    const { user: lawyer } = await makeLawyer('note-l@test.uz');
    const c = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'accepted', question: 'q' });

    const put = await request(app)
      .put(`/api/lawyer/consultations/${c.id}/note`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
      .send({ note: 'Подготовить договор аренды' });
    expect(put.status).toBe(200);
    expect(put.body.lawyerNote).toBe('Подготовить договор аренды');

    const list = await request(app)
      .get('/api/lawyer/consultation-requests?status=all')
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    const found = list.body.find((r) => r.id === c.id);
    expect(found.lawyerNote).toBe('Подготовить договор аренды');
  });

  test('чужую консультацию заметкой не тронуть (404)', async () => {
    const client = await makeClient('note-c2@test.uz');
    const a = await makeLawyer('note-la@test.uz');
    const b = await makeLawyer('note-lb@test.uz');
    const c = await Consultation.create({ clientId: client.id, lawyerId: a.user.id, type: 'video', status: 'accepted', question: 'q' });
    const put = await request(app)
      .put(`/api/lawyer/consultations/${c.id}/note`)
      .set('Authorization', `Bearer ${tokenFor(b.user)}`)
      .send({ note: 'хак' });
    expect(put.status).toBe(404);
  });

  test('принятие без сообщения — чат пустой', async () => {
    const client = await makeClient('ag-c2@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l2@test.uz');
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'pending', question: 'Q',
    });
    const res = await request(app)
      .post(`/api/lawyer/consultation-requests/${c.id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
      .send({});
    expect(res.status).toBe(200);
    const count = await Message.count({ where: { consultationId: c.id } });
    expect(count).toBe(0);
  });
});
