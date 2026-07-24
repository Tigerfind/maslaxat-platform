'use strict';

/**
 * Удаляет мёртвые столбцы consultations.rating и consultations.review.
 * Оценка консультации живёт ТОЛЬКО в таблице reviews (Consultation.hasOne(Review)).
 * Эти столбцы всегда были NULL и создавали второй источник правды.
 *
 * Идемпотентно: проверяем наличие столбца перед изменением, чтобы миграция
 * безопасно отрабатывала и на существующей БД (столбцы есть), и на свежей (их нет).
 */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.rating) await queryInterface.removeColumn('consultations', 'rating');
    if (table.review) await queryInterface.removeColumn('consultations', 'review');
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.rating) {
      await queryInterface.addColumn('consultations', 'rating', { type: Sequelize.INTEGER, allowNull: true });
    }
    if (!table.review) {
      await queryInterface.addColumn('consultations', 'review', { type: Sequelize.TEXT, allowNull: true });
    }
  },
};
