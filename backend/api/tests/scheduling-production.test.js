const { DateTime } = require('luxon');
const request = require('supertest');
const app = require('../src/server');
const availability = require('../src/services/availabilityService');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

const nextDay = (weekday, zone = 'Asia/Tashkent') => {
  let date = DateTime.now().setZone(zone).plus({ weeks: 2 }).startOf('day');
  while (date.weekday !== weekday) date = date.plus({ days: 1 });
  return date;
};

test.each([30, 60, 90])('длительность %i хранится числом и целиком входит в расписание', async (duration) => {
  const { user: lawyer } = await makeLawyer(`duration-${duration}@test.uz`, { timezone: 'Asia/Tashkent', schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } } });
  const client = await makeClient(`duration-client-${duration}@test.uz`);
  const date = nextDay(1);
  const response = await request(app).post(`/api/lawyers/${lawyer.id}/book`).set('Authorization', `Bearer ${tokenFor(client)}`).set('Idempotency-Key', `schedule-duration-${duration}`).send({
    question: 'Duration', consultationType: 'video', duration, preferredDate: date.toISODate(), preferredTime: '09:00', acceptedTerms: true, legalVersion: '2026-08-13',
  });
  expect(response.status).toBe(201);
  expect(response.body.consultation.duration).toBe(duration);
  expect(new Date(response.body.consultation.scheduledEndAt) - new Date(response.body.consultation.scheduledStartAt)).toBe(duration * 60000);
});

test('90 минут перед закрытием расписания отклоняются', async () => {
  const { user: lawyer } = await makeLawyer('duration-close@test.uz', { timezone: 'Asia/Tashkent', schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } } });
  const client = await makeClient('duration-close-client@test.uz');
  const response = await request(app).post(`/api/lawyers/${lawyer.id}/book`).set('Authorization', `Bearer ${tokenFor(client)}`).set('Idempotency-Key', 'schedule-invalid-window').send({ question: 'Late', consultationType: 'video', duration: 90, preferredDate: nextDay(1).toISODate(), preferredTime: '17:00', acceptedTerms: true, legalVersion: '2026-08-13' });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('INVALID_SLOT');
});

test('IANA timezone корректно даёт UTC и дату клиента через границу суток', async () => {
  const { user: lawyer } = await makeLawyer('timezone-lawyer@test.uz', { timezone: 'Pacific/Auckland', schedule: { mon: { enabled: true, from: '09:00', to: '12:00' } } });
  const date = nextDay(1, 'Pacific/Auckland').toISODate();
  const response = await request(app).get(`/api/lawyers/${lawyer.id}/available-slots?from=${date}&days=1&duration=60&clientTimezone=America/Los_Angeles`);
  expect(response.status).toBe(200);
  const slot = response.body.dates[0].slots[0];
  expect(slot.startsAt.endsWith('Z')).toBe(true);
  expect(slot.clientDate).not.toBe(date);
  expect(response.body.timezone).toBe('Pacific/Auckland');
});

test('несуществующее DST-время не нормализуется молча', async () => {
  const profile = { timezone: 'America/New_York', consultationDurations: [30], schedule: { sun: { enabled: true, from: '00:00', to: '05:00' } } };
  expect(() => availability.validateWindow(profile, '2027-03-14', '02:30', 30, DateTime.fromISO('2027-03-01T00:00:00Z'))).toThrow(/несуществующее/);
});

test('reschedule повторно проверяет статус под row lock', async () => {
  const { user: lawyer } = await makeLawyer('reschedule-lock-lawyer@test.uz', { timezone: 'Asia/Tashkent', schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } } });
  const client = await makeClient('reschedule-lock-client@test.uz');
  const start = nextDay(1).set({ hour: 9 });
  const consultation = await models.Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Move', type: 'video', status: 'accepted', duration: 60, scheduledStartAt: start.toUTC().toJSDate(), scheduledEndAt: start.plus({ hours: 1 }).toUTC().toJSDate(), scheduleTimezone: 'Asia/Tashkent' });
  const [cancel, move] = await Promise.all([
    request(app).post(`/api/consultations/${consultation.id}/cancel`).set('Authorization', `Bearer ${tokenFor(client)}`).set('X-Maslaxat-Mode', 'client').send({ reason: 'cancel' }),
    request(app).patch(`/api/consultations/${consultation.id}/reschedule`).set('Authorization', `Bearer ${tokenFor(client)}`).set('X-Maslaxat-Mode', 'client').send({ preferredDate: start.toISODate(), preferredTime: '11:00' }),
  ]);
  expect([cancel.status, move.status].filter((status) => status === 200)).toHaveLength(1);
  await consultation.reload();
  expect(['cancelled', 'accepted']).toContain(consultation.status);
});
