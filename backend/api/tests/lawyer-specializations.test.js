// Мультиспециализация юриста: сохранение массива + фильтр каталога по любой из областей.
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeLawyer } = require('./helpers');

const { LawyerProfile } = models;

beforeAll(async () => {
  await resetDb();
});

describe('PUT /lawyer/profile сохраняет несколько специализаций', () => {
  test('массив сохраняется, дедуп, specialization = первая', async () => {
    const { user } = await makeLawyer('spec-a@test.uz');
    const res = await request(app)
      .put('/api/lawyer/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('specializations', JSON.stringify(['Семейное право', 'Налоговое право', 'Семейное право']));
    expect(res.status).toBe(200);

    const lp = await LawyerProfile.findOne({ where: { userId: user.id } });
    expect(lp.specializations).toEqual(['Семейное право', 'Налоговое право']); // дедуп
    expect(lp.specialization).toBe('Семейное право'); // основная = первая
  });

  test('legacy: одиночная specialization → массив из одного', async () => {
    const { user } = await makeLawyer('spec-b@test.uz');
    const res = await request(app)
      .put('/api/lawyer/profile')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('specialization', 'Уголовное право');
    expect(res.status).toBe(200);
    const lp = await LawyerProfile.findOne({ where: { userId: user.id } });
    expect(lp.specializations).toEqual(['Уголовное право']);
    expect(lp.specialization).toBe('Уголовное право');
  });
});

describe('каталог фильтрует по любой из специализаций юриста', () => {
  test('юрист с несколькими областями находится по каждой', async () => {
    await makeLawyer('spec-multi@test.uz', {
      specialization: 'Гражданское право',
      specializations: ['Гражданское право', 'Трудовое право'],
    });

    const byCivil = await request(app).get('/api/lawyers?specialization=' + encodeURIComponent('Гражданское право') + '&limit=50');
    const byLabor = await request(app).get('/api/lawyers?specialization=' + encodeURIComponent('Трудовое право') + '&limit=50');
    const byOther = await request(app).get('/api/lawyers?specialization=' + encodeURIComponent('Налоговое право') + '&limit=50');

    // Находится и по «Гражданскому», и по «Трудовому»
    expect(byCivil.body.lawyers.some((l) => l.email === 'spec-multi@test.uz' || (l.profile?.specializations || []).includes('Трудовое право'))).toBe(true);
    expect(byLabor.body.lawyers.some((l) => (l.profile?.specializations || []).includes('Трудовое право'))).toBe(true);
    // По «Налоговому» этого юриста нет (у него такой области нет)
    expect(byOther.body.lawyers.some((l) => (l.profile?.specializations || []).includes('Трудовое право'))).toBe(false);
  });

  test('мультифильтр (несколько областей через запятую) — совпадение по любой', async () => {
    await makeLawyer('mf-fam@test.uz', { specialization: 'Семейное право', specializations: ['Семейное право'] });
    await makeLawyer('mf-tax@test.uz', { specialization: 'Налоговое право', specializations: ['Налоговое право'] });

    const res = await request(app).get(
      '/api/lawyers?specialization=' + encodeURIComponent('Семейное право,Налоговое право') + '&limit=50',
    );
    expect(res.status).toBe(200);
    const emails = res.body.lawyers.map((l) => l.email).filter(Boolean);
    // оба найдены (OR-совпадение)
    const specs = res.body.lawyers.flatMap((l) => l.profile?.specializations || []);
    expect(specs).toContain('Семейное право');
    expect(specs).toContain('Налоговое право');
  });
});

describe('«Доступен сейчас» — фильтр и сортировка онлайн-первыми', () => {
  test('onlineOnly=true возвращает только онлайн; по умолчанию онлайн выше', async () => {
    const on = await makeLawyer('on-online@test.uz', { isAvailable: true, location: 'OnlineCity' });
    const off = await makeLawyer('on-offline@test.uz', { isAvailable: false, location: 'OnlineCity' });

    // Только онлайн
    const only = await request(app).get('/api/lawyers?onlineOnly=true&location=OnlineCity&limit=50');
    expect(only.status).toBe(200);
    const ids = only.body.lawyers.map((l) => l.id);
    expect(ids).toContain(on.user.id);
    expect(ids).not.toContain(off.user.id);

    // Без фильтра — оба, но онлайн выше офлайна
    const all = await request(app).get('/api/lawyers?location=OnlineCity&limit=50');
    const order = all.body.lawyers.map((l) => l.id);
    expect(order.indexOf(on.user.id)).toBeLessThan(order.indexOf(off.user.id));
  });
});
