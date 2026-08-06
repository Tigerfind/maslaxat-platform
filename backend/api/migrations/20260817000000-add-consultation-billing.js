'use strict';

/**
 * Биллинг «оплата через 5 минут звонка» (модель B). Добавляет на consultations:
 *   - call_started_at TIMESTAMPTZ  — когда ОБА участника оказались в звонке (старт 5 мин)
 *   - charged_at      TIMESTAMPTZ  — когда захватили оплату (5-я минута)
 *   - billing_status  ENUM(none/held/charged/released/failed) DEFAULT 'none'
 * Идемпотентно: колонки добавляются только если их ещё нет.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.call_started_at) {
      await queryInterface.addColumn('consultations', 'call_started_at', { type: Sequelize.DATE, allowNull: true });
    }
    if (!table.charged_at) {
      await queryInterface.addColumn('consultations', 'charged_at', { type: Sequelize.DATE, allowNull: true });
    }
    if (!table.billing_status) {
      await queryInterface.addColumn('consultations', 'billing_status', {
        type: Sequelize.ENUM('none', 'held', 'charged', 'released', 'failed'),
        allowNull: false,
        defaultValue: 'none',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.call_started_at) await queryInterface.removeColumn('consultations', 'call_started_at');
    if (table.charged_at) await queryInterface.removeColumn('consultations', 'charged_at');
    if (table.billing_status) await queryInterface.removeColumn('consultations', 'billing_status');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_consultations_billing_status"');
  },
};
