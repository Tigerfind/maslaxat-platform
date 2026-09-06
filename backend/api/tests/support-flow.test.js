const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeAdmin } = require('./helpers');

beforeAll(async () => {
  await resetDb();
});

describe('поддержка: сквозной цикл обращения', () => {
  test('новое обращение уведомляет всех админов', async () => {
    const admin1 = await makeAdmin('sfadmin1@test.uz');
    const admin2 = await makeAdmin('sfadmin2@test.uz');
    const client = await makeClient('sfclient1@test.uz');

    const created = await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ subject: 'Не приходит письмо', message: 'Помогите со сбросом пароля' });
    expect(created.status).toBe(201);
    const ticketId = created.body.ticket.id;

    // Раньше обращение не сигналило никому — админ узнавал о нём случайно.
    for (const admin of [admin1, admin2]) {
      const notes = await models.Notification.findAll({ where: { userId: admin.id, type: 'support_ticket' } });
      expect(notes.length).toBe(1);
      expect(notes[0].metadata.ticketId).toBe(ticketId);
    }
  });

  test('клиент видит свои обращения и ПОЛНЫЙ текст ответа', async () => {
    const admin = await makeAdmin('sfadmin3@test.uz');
    const client = await makeClient('sfclient2@test.uz');

    const created = await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ subject: 'Вопрос по оплате', message: 'Как вернуть деньги?' });
    const ticketId = created.body.ticket.id;

    // Ответ длиннее 140 символов: в уведомление он не влезает, поэтому раньше
    // клиент физически не мог его дочитать.
    // .trim() на бэкенде срезает краевые пробелы — сравниваем с тем же видом.
    const longReply = 'Возврат оформляется через раздел «Платежи». '.repeat(8).trim();
    const replied = await request(app).patch(`/api/admin/support/${ticketId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ response: longReply });
    expect(replied.status).toBe(200);
    expect(longReply.length).toBeGreaterThan(140);

    const mine = await request(app).get('/api/support/my')
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(mine.status).toBe(200);
    const tk = mine.body.tickets.find((x) => x.id === ticketId);
    expect(tk.response).toBe(longReply); // текст целиком, без обрезки
    expect(tk.respondedAt).toBeTruthy();
    expect(tk.status).toBe('closed');

    // Уведомление клиенту существует и ведёт на тикет
    const note = await models.Notification.findOne({ where: { userId: client.id, type: 'support_reply' } });
    expect(note).toBeTruthy();
    expect(note.metadata.ticketId).toBe(ticketId);
  });

  test('клиент видит только свои обращения', async () => {
    const clientA = await makeClient('sfclientA@test.uz');
    const clientB = await makeClient('sfclientB@test.uz');

    await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(clientA)}`).send({ message: 'Только моё' });

    const mine = await request(app).get('/api/support/my')
      .set('Authorization', `Bearer ${tokenFor(clientB)}`);
    expect(mine.status).toBe(200);
    expect(mine.body.tickets.length).toBe(0);
  });

  test('пустое сообщение → 400, админов не будим', async () => {
    const admin = await makeAdmin('sfadmin4@test.uz');
    const client = await makeClient('sfclient4@test.uz');

    const res = await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(client)}`).send({ message: '   ' });
    expect(res.status).toBe(400);

    const notes = await models.Notification.count({ where: { userId: admin.id, type: 'support_ticket' } });
    expect(notes).toBe(0);
  });
});
