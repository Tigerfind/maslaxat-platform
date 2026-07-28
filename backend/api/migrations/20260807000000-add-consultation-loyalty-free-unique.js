'use strict';

/**
 * Частичный УНИКАЛЬНЫЙ индекс: не более одной НЕ-отклонённой loyalty-бесплатной
 * консультации на клиента. Hard-гарантия против гонки #3 (double-spend бонуса
 * «первая консультация бесплатно») — держится даже вне кода бронирования.
 *
 * Предикат `status <> 'rejected'` совпадает с FREE_NOT_COUNTED=['rejected']:
 *   • reject уводит строку из индекса → слот освобождается (бонус не сгорает);
 *   • cancelled остаётся в индексе → слот занят (отмена = использовано).
 *
 * Идемпотентно (проверка существования индекса по имени). Если в таблице уже есть
 * конфликтующие дубли (гонка была эксплуатируема) — НЕ трогаем данные автоматически
 * (там могут быть платежи): бросаем понятную ошибку, чтобы разрешить вручную.
 * Имя совпадает с индексом, объявленным в модели Consultation (dev sync + миграция
 * идемпотентны по имени, дубля индекса не будет).
 */
const INDEX_NAME = 'consultations_loyalty_free_unique';

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // Уже создан (например, dev sync({alter}))? — идемпотентный выход.
    const [existing] = await sequelize.query(
      'SELECT 1 FROM pg_indexes WHERE indexname = :name',
      { replacements: { name: INDEX_NAME } }
    );
    if (existing.length > 0) return;

    // Конфликтующие дубли: клиент с >1 не-отклонённой loyalty-бронью.
    const [dups] = await sequelize.query(`
      SELECT client_id, COUNT(*) AS n
      FROM consultations
      WHERE free_source = 'loyalty' AND status <> 'rejected'
      GROUP BY client_id HAVING COUNT(*) > 1
    `);
    if (dups.length > 0) {
      throw new Error(
        `Cannot create ${INDEX_NAME}: ${dups.length} client(s) have >1 non-rejected ` +
        'loyalty-free consultation. Resolve these duplicates manually before migrating ' +
        '(do NOT auto-delete rows — they may have payments).'
      );
    }

    await sequelize.query(`
      CREATE UNIQUE INDEX ${INDEX_NAME}
      ON consultations (client_id)
      WHERE free_source = 'loyalty' AND status <> 'rejected'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
  },
};
