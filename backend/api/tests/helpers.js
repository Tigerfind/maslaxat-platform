const jwt = require('jsonwebtoken');
const { sequelize, User, LawyerProfile, Consultation, Payment, AIConversation } = require('../src/models');

// Пересоздаёт схему в тестовой БД (чистый старт для набора тестов)
async function resetDb() {
  await sequelize.sync({ force: true });
}

// JWT в формате, который ждёт middleware/auth (payload { id })
function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

// Быстрые фабрики тестовых записей
async function makeClient(email = 'client@test.uz') {
  return User.create({ name: 'Test Client', email, password: 'passw0rd', role: 'client', isActive: true });
}
async function makeLawyer(email = 'lawyer@test.uz', profile = {}) {
  const user = await User.create({ name: 'Test Lawyer', email, password: 'passw0rd', role: 'lawyer', isActive: true });
  const lp = await LawyerProfile.create({ userId: user.id, balance: 0, pendingBalance: 0, price: 100000, specialization: 'Гражданское право', ...profile });
  return { user, lp };
}

module.exports = {
  sequelize,
  models: { User, LawyerProfile, Consultation, Payment, AIConversation },
  resetDb,
  tokenFor,
  makeClient,
  makeLawyer,
};
