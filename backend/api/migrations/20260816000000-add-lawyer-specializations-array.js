'use strict';

/**
 * Мультиспециализация юриста: lawyer_profiles.specializations (TEXT[]).
 * Источник истины для нескольких областей права; specialization (STRING) остаётся
 * как основная = specializations[0] (обратная совместимость каталога/карточки).
 *
 * Бэкофилл: existing.specializations = [specialization], иначе массив пуст и
 * юрист выпадет из фильтра по специализации и не покажет области на карточке.
 * Идемпотентно: колонка добавляется только если её нет; бэкофилл — только пустым.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('lawyer_profiles');
    if (!table.specializations) {
      await queryInterface.addColumn('lawyer_profiles', 'specializations', {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: false,
        defaultValue: [],
      });
    }
    // Бэкофилл: пустой массив → [specialization] (не трогаем уже заполненные).
    await queryInterface.sequelize.query(`
      UPDATE lawyer_profiles
      SET specializations = ARRAY[specialization]
      WHERE (specializations IS NULL OR array_length(specializations, 1) IS NULL)
        AND specialization IS NOT NULL AND specialization <> ''
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('lawyer_profiles');
    if (table.specializations) {
      await queryInterface.removeColumn('lawyer_profiles', 'specializations');
    }
  },
};
