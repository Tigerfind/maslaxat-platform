'use strict';

/**
 * Добавляет payments.escrow_released (BOOLEAN, NOT NULL, default false).
 *
 * Зачем: высвобождение эскроу больше НЕ привязано к изменяемому статусу
 * консультации. Выплата помечает платёж escrow_released=true, и такой платёж
 * при повторных завершениях НЕ пересчитывается — даже если статус консультации
 * откатили и снова завершили. Это делает высвобождение «ровно один раз»
 * привязанным к неоткатываемому признаку на самом платеже.
 *
 * Идемпотентно (describeTable-гейт).
 *
 * Backfill: paid-платежи уже ЗАВЕРШЁННЫХ консультаций помечаем released=true —
 * они исторически уже выплачены юристу; повторно считать/выплачивать их нельзя.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('payments');
    if (!table.escrow_released) {
      await queryInterface.addColumn('payments', 'escrow_released', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    // Историческая выплата: paid-платежи завершённых консультаций уже высвобождены.
    // Без этого откат+повторное завершение старой консультации заплатил бы дважды.
    await queryInterface.sequelize.query(`
      UPDATE payments p SET escrow_released = true
      FROM consultations c
      WHERE p.consultation_id = c.id
        AND p.status = 'paid'
        AND c.status = 'completed'
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('payments');
    if (table.escrow_released) {
      await queryInterface.removeColumn('payments', 'escrow_released');
    }
  },
};
