// Email мокаем, чтобы не ходить в сеть (Ethereal) во время тестов
jest.mock('../src/services/emailService', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));

const { resetDb, models } = require('./helpers');
const { checkUpcomingReminders } = require('../src/services/reminderService');

const { User, LawyerProfile, Consultation, Notification } = models;

beforeAll(async () => {
  await resetDb();
});

async function consultationInMinutes(mins, status = 'accepted') {
  const client = await User.create({ name: 'C', email: `c${mins}@t.uz`, password: 'p', role: 'client', isActive: true });
  const lawyer = await User.create({ name: 'L', email: `l${mins}@t.uz`, password: 'p', role: 'lawyer', isActive: true });
  await LawyerProfile.create({ userId: lawyer.id, specialization: 'Гражданское право', price: 100000 });
  const now = new Date();
  const when = new Date(now.getTime() + mins * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const c = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status, price: 100000, preferredDate: date, preferredTime: time, reminderSent: false });
  return { client, lawyer, c };
}

describe('reminderService.checkUpcomingReminders', () => {
  test('шлёт напоминание обоим за ~час до консультации и помечает reminderSent', async () => {
    const { client, lawyer, c } = await consultationInMinutes(30);
    const sent = await checkUpcomingReminders();
    expect(sent).toBeGreaterThanOrEqual(1);

    await c.reload();
    expect(c.reminderSent).toBe(true);

    const notifs = await Notification.findAll({ where: { type: 'consultation_reminder' } });
    const users = notifs.map((n) => n.userId);
    expect(users).toContain(client.id);
    expect(users).toContain(lawyer.id);
  });

  test('идемпотентность: повторный прогон не шлёт повторно', async () => {
    const before = await Notification.count({ where: { type: 'consultation_reminder' } });
    const sent = await checkUpcomingReminders();
    expect(sent).toBe(0);
    const after = await Notification.count({ where: { type: 'consultation_reminder' } });
    expect(after).toBe(before);
  });

  test('не шлёт, если до консультации больше часа', async () => {
    await consultationInMinutes(180); // через 3 часа
    const before = await Notification.count({ where: { type: 'consultation_reminder' } });
    await checkUpcomingReminders();
    const after = await Notification.count({ where: { type: 'consultation_reminder' } });
    expect(after).toBe(before);
  });
});
