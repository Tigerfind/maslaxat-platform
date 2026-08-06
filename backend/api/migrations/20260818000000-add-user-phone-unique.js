'use strict';

/**
 * Дедуп по телефону: один номер — один аккаунт (иначе обход лимитов free-консультации/AI).
 * Частичный уникальный индекс на users.phone WHERE phone IS NOT NULL (несколько NULL — можно).
 *
 * ВАЖНО: перед созданием индекса обнуляем дубли (оставляем самый ранний аккаунт с номером),
 * иначе CREATE UNIQUE INDEX упадёт на существующих дублях. Идемпотентно.
 */
module.exports = {
  async up(queryInterface) {
    // 1) Обнулить дубли: у более поздних аккаунтов с тем же номером phone → NULL.
    await queryInterface.sequelize.query(`
      UPDATE users u
      SET phone = NULL
      WHERE phone IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM users e
          WHERE e.phone = u.phone AND e.created_at < u.created_at
        )
    `);
    // 2) Частичный уникальный индекс (идемпотентно).
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
      ON users (phone)
      WHERE phone IS NOT NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS users_phone_unique');
  },
};
