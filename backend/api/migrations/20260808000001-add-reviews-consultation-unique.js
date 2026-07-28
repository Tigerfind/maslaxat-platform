'use strict';

/**
 * Уникальный индекс reviews(consultation_id): ОДИН отзыв на консультацию — hard-
 * гарантия против дублей (раньше findOrCreate без ограничения не был атомарным под
 * конкуренцией). После индекса findOrCreate атомарен; повторный отзыв ловится как
 * unique-violation и отдаётся клиенту как 409, а не 500.
 *
 * Идемпотентно (проверка по имени). Отказывается создаваться поверх существующих
 * дублей (throw) — их убирает дедуп-миграция 20260808000000; строки НЕ удаляем молча.
 */
const INDEX_NAME = 'reviews_consultation_id_unique';

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const [existing] = await sequelize.query(
      'SELECT 1 FROM pg_indexes WHERE indexname = :name',
      { replacements: { name: INDEX_NAME } }
    );
    if (existing.length > 0) return;

    const [dups] = await sequelize.query(`
      SELECT consultation_id, COUNT(*) AS n
      FROM reviews
      WHERE consultation_id IS NOT NULL
      GROUP BY consultation_id HAVING COUNT(*) > 1
    `);
    if (dups.length > 0) {
      throw new Error(
        `Cannot create ${INDEX_NAME}: ${dups.length} consultation(s) have duplicate reviews. ` +
        'Run the dedupe migration (20260808000000) first, or resolve manually (do NOT auto-delete here).'
      );
    }

    // NULL consultation_id (FK ON DELETE SET NULL) допускает несколько строк —
    // Postgres считает NULL различными в уникальном индексе. Это ок.
    await sequelize.query(`CREATE UNIQUE INDEX ${INDEX_NAME} ON reviews (consultation_id)`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
  },
};
