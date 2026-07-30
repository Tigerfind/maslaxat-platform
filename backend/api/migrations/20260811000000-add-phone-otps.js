'use strict';

/**
 * Таблица phone_otps — одноразовые коды для входа/регистрации по номеру телефона.
 * Один активный код на номер (phone UNIQUE), перезаписывается при повторном запросе.
 * Идемпотентно (проверка существования таблицы).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    let exists = true;
    try { await queryInterface.describeTable('phone_otps'); } catch (e) { exists = false; }
    if (exists) return;

    await queryInterface.createTable('phone_otps', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      phone: { type: Sequelize.STRING, allowNull: false, unique: true },
      code: { type: Sequelize.STRING, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('phone_otps');
  },
};
