const { DateTime } = require('luxon');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

function nextWeekday(weekday, weeks = 1) {
  let date = DateTime.now().setZone('Asia/Tashkent').plus({ weeks }).startOf('day');
  while (date.weekday !== weekday) date = date.plus({ days: 1 });
  return date.toISODate();
}

async function setupLawyer(email = 'slots-lawyer@test.uz') {
  return makeLawyer(email, {
    timezone: 'Asia/Tashkent',
    schedule: { mon: { enabled: true, from: '09:00', to: '12:00' } },
    consultationFormats: ['webrtc', 'chat'], consultationDurations: [30, 60, 90],
    verificationStatus: 'approved', isAvailable: true,
  });
}

test('слоты учитывают длительность, расписание и занятые интервалы', async () => {
  const { user: lawyer } = await setupLawyer();
  const client = await makeClient('slots-client@test.uz');
  const date = nextWeekday(1);
  const start = DateTime.fromISO(`${date}T09:30`, { zone: 'Asia/Tashkent' });
  await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'accepted', question: 'busy', duration: 60,
    preferredDate: date, preferredTime: '09:30', scheduledStartAt: start.toUTC().toJSDate(), scheduledEndAt: start.plus({ minutes: 60 }).toUTC().toJSDate(), scheduleTimezone: 'Asia/Tashkent',
  });
  const response = await request(app).get(`/api/lawyers/${lawyer.id}/available-slots?from=${date}&days=1&duration=60`);
  expect(response.status).toBe(200);
  const times = response.body.dates[0].slots.map((slot) => slot.time);
  expect(times).not.toContain('09:00');
  expect(times).not.toContain('09:30');
  expect(times).not.toContain('10:00');
  expect(times).toContain('10:30');
  expect(times).toContain('11:00');
  expect(times).not.toContain('11:30');
});

test('две параллельные брони одного слота дают ровно один success', async () => {
  const { user: lawyer } = await setupLawyer('slots-race-lawyer@test.uz');
  const first = await makeClient('slots-first@test.uz');
  const second = await makeClient('slots-second@test.uz');
  const date = nextWeekday(1);
  const payload = {
    preferredDate: date, preferredTime: '10:00', duration: 60, consultationType: 'webrtc',
    problems: [{ text: 'Проверка слота', categories: ['civil'] }],
    acceptedTerms: true, legalVersion: '2026-08-13',
  };
  const results = await Promise.all([first, second].map((client) => request(app)
    .post(`/api/lawyers/${lawyer.id}/book`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send(payload)));
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(await models.Consultation.count({ where: { lawyerId: lawyer.id, preferredDate: date, preferredTime: '10:00' } })).toBe(1);
});

test('один клиент не может параллельно занять пересекающиеся слоты у разных юристов', async () => {
  const [{ user: firstLawyer }, { user: secondLawyer }] = await Promise.all([
    setupLawyer('slots-client-race-first@test.uz'),
    setupLawyer('slots-client-race-second@test.uz'),
  ]);
  const client = await makeClient('slots-client-race@test.uz');
  const date = nextWeekday(1);
  const payload = {
    preferredDate: date, preferredTime: '10:00', duration: 60, consultationType: 'webrtc',
    problems: [{ text: 'Параллельная проверка клиента', categories: ['civil'] }],
    acceptedTerms: true, legalVersion: '2026-08-13',
  };
  const results = await Promise.all([firstLawyer, secondLawyer].map((lawyer) => request(app)
    .post(`/api/lawyers/${lawyer.id}/book`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send(payload)));
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(await models.Consultation.count({ where: { clientId: client.id } })).toBe(1);
});

test('слот должен целиком помещаться в часы и быть минимум через 2 часа', async () => {
  const { user: lawyer } = await setupLawyer('slots-validation-lawyer@test.uz');
  const client = await makeClient('slots-validation-client@test.uz');
  const date = nextWeekday(1);
  const response = await request(app).post(`/api/lawyers/${lawyer.id}/book`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ preferredDate: date, preferredTime: '11:30', duration: 90, consultationType: 'webrtc', question: 'late', acceptedTerms: true, legalVersion: '2026-08-13' });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('INVALID_SLOT');
});

test('неоплаченная Zoom-бронь освобождает слот через 15 минут и больше не оплачивается', async () => {
  const { user: lawyer } = await setupLawyer('slots-expired-lawyer@test.uz');
  const client = await makeClient('slots-expired-client@test.uz');
  const date = nextWeekday(1);
  const start = DateTime.fromISO(`${date}T10:00`, { zone: 'Asia/Tashkent' });
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'payment_pending',
    question: 'Expired payment', duration: 60, price: 100000, preferredDate: date, preferredTime: '10:00',
    scheduledStartAt: start.toUTC().toJSDate(), scheduledEndAt: start.plus({ minutes: 60 }).toUTC().toJSDate(),
    scheduleTimezone: 'Asia/Tashkent', createdAt: new Date(Date.now() - 16 * 60000),
  });

  const slots = await request(app).get(`/api/lawyers/${lawyer.id}/available-slots?from=${date}&days=1&duration=60`);
  expect(slots.body.dates[0].slots.map((slot) => slot.time)).toContain('10:00');
  const payment = await request(app).post('/api/payments/simulate')
    .set('Authorization', `Bearer ${tokenFor(client)}`).send({ consultationId: consultation.id });
  expect(payment.status).toBe(410);
  await consultation.reload();
  expect(consultation.status).toBe('cancelled');
});
