'use strict';

/**
 * Удаляет мёртвый столбец consultations.video_room_url (нигде не пишется/не читается —
 * видео идёт через WebRTC P2P без хранимого URL). Идемпотентно.
 */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.video_room_url) await queryInterface.removeColumn('consultations', 'video_room_url');
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.video_room_url) {
      await queryInterface.addColumn('consultations', 'video_room_url', { type: Sequelize.STRING, allowNull: true });
    }
  },
};
