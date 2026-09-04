'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TYPE "enum_consultations_cancellation_type" ADD VALUE IF NOT EXISTS 'provider_cancelled'; EXCEPTION WHEN undefined_object THEN NULL; END $$;`);
    const columns = await queryInterface.describeTable('consultations');
    if (!columns.promo_reserved_at) await queryInterface.addColumn('consultations', 'promo_reserved_at', { type: Sequelize.DATE });
  },

  async down() {
    throw new Error('Forward-only migration: add provider cancellation type');
  },
};
