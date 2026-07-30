'use strict';

/**
 * Добавляет consultations.problems (JSONB, default []) — список проблем клиента
 * в одной записи (мультизапрос). question остаётся кратким резюме (первая проблема)
 * для совместимости со списками/уведомлениями/напоминаниями. Идемпотентно.
 *
 * Backfill: у существующих консультаций problems = [question], чтобы юрист видел
 * старый единственный вопрос как один пункт списка.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.problems) {
      await queryInterface.addColumn('consultations', 'problems', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      });
      // Заполняем из существующего question (одна проблема → массив из одного пункта).
      await queryInterface.sequelize.query(`
        UPDATE consultations
        SET problems = to_jsonb(ARRAY[question])
        WHERE question IS NOT NULL AND (problems IS NULL OR problems = '[]'::jsonb)
      `);
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.problems) await queryInterface.removeColumn('consultations', 'problems');
  },
};
