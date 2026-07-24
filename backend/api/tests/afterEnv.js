// Закрываем соединение с БД после всех тестов в файле, чтобы jest не висел.
const { sequelize } = require('../src/models');

afterAll(async () => {
  await sequelize.close();
});
