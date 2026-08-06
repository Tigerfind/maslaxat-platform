const jwt = require('jsonwebtoken');
const db = require('../src/models');
const { sequelize, User, LawyerProfile } = db;

// Пересоздаёт схему в тестовой БД (чистый старт для набора тестов)
async function resetDb() {
  await sequelize.sync({ force: true });
  // Частичный уникальный индекс (как в миграции 20260807000000): в модели не объявлен
  // из-за underscored-мапинга при sync, поэтому создаём вручную — чтобы тестовая БД
  // совпадала с прод-схемой (одна не-отклонённая loyalty-бесплатная бронь на клиента).
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS consultations_loyalty_free_unique
    ON consultations (client_id)
    WHERE free_source = 'loyalty' AND status <> 'rejected'
  `);
  // Уникальный индекс на отзыв-на-консультацию (как миграция 20260808000001) —
  // чтобы тестовая БД совпадала с прод-схемой (findOrCreate атомарен).
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_consultation_id_unique
    ON reviews (consultation_id)
  `);
  // Частичный уникальный индекс на телефон (как миграция 20260818000000) —
  // один номер = один аккаунт (несколько NULL допускаются).
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
    ON users (phone) WHERE phone IS NOT NULL
  `);
}

// JWT в формате, который ждёт middleware/auth (payload { id })
function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

// Быстрые фабрики тестовых записей
async function makeClient(email = 'client@test.uz', overrides = {}) {
  // isVerified:true по умолчанию — тестовый клиент «с подтверждённым контактом»
  // (гейт бронирования требует верификацию). Тест на гейт передаёт isVerified:false.
  return User.create({ name: 'Test Client', email, password: 'passw0rd', role: 'client', isActive: true, isVerified: true, ...overrides });
}
async function makeLawyer(email = 'lawyer@test.uz', profile = {}) {
  const user = await User.create({ name: 'Test Lawyer', email, password: 'passw0rd', role: 'lawyer', isActive: true, isVerified: true });
  // verificationStatus по умолчанию 'approved' — большинство тестов ждут, что юрист
  // сразу виден в каталоге и бронируется. Тест на модерацию передаёт своё значение.
  const lp = await LawyerProfile.create({
    userId: user.id, balance: 0, pendingBalance: 0, price: 100000,
    specialization: 'Гражданское право', specializations: ['Гражданское право'],
    // description + schedule заполнены по умолчанию, чтобы профиль был «полным» для
    // гейта отправки на проверку (не хватает лишь документа — его тест грузит сам).
    description: 'Опытный юрист с многолетней практикой в различных областях права и судов.',
    schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } },
    isAvailable: true, verificationStatus: 'approved', ...profile,
  });
  return { user, lp };
}
async function makeAdmin(email = 'admin@test.uz') {
  return User.create({ name: 'Test Admin', email, password: 'passw0rd', role: 'admin', isActive: true, isVerified: true });
}

module.exports = {
  sequelize,
  models: db, // все модели (User, Promo, Notification, Withdrawal, SupportTicket, …)
  resetDb,
  tokenFor,
  makeClient,
  makeLawyer,
  makeAdmin,
};
