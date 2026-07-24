module.exports = {
  testEnvironment: 'node',
  // env.setup.js выполняется ДО импорта приложения/моделей — переключает на тестовую БД
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/afterEnv.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 20000,
  // Интеграционные тесты делят одну тестовую БД (sync({force}) в beforeAll),
  // поэтому файлы гоняем последовательно, чтобы не пересоздавать схему параллельно.
  maxWorkers: 1,
};
