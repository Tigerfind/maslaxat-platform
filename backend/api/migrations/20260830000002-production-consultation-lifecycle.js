'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = queryInterface.sequelize;
    await sql.query(`DO $$ BEGIN ALTER TYPE "enum_consultations_status" ADD VALUE IF NOT EXISTS 'payment_expired'; EXCEPTION WHEN undefined_object THEN NULL; END $$;`);
    await sql.query(`DO $$ BEGIN CREATE TYPE "enum_consultations_cancelled_by" AS ENUM ('client', 'lawyer', 'admin', 'system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await sql.query(`DO $$ BEGIN CREATE TYPE "enum_consultations_cancellation_type" AS ENUM ('client_cancelled', 'lawyer_cancelled', 'admin_cancelled', 'lawyer_rejected', 'payment_expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

    const columns = await queryInterface.describeTable('consultations');
    if (!columns.payment_expires_at) await queryInterface.addColumn('consultations', 'payment_expires_at', { type: Sequelize.DATE });
    if (!columns.archived_at) await queryInterface.addColumn('consultations', 'archived_at', { type: Sequelize.DATE });
    if (!columns.cancelled_at) await queryInterface.addColumn('consultations', 'cancelled_at', { type: Sequelize.DATE });
    if (!columns.cancelled_by) await sql.query('ALTER TABLE consultations ADD COLUMN cancelled_by "enum_consultations_cancelled_by"');
    if (!columns.cancellation_type) await sql.query('ALTER TABLE consultations ADD COLUMN cancellation_type "enum_consultations_cancellation_type"');
    if (!columns.cancellation_reason) await queryInterface.addColumn('consultations', 'cancellation_reason', { type: Sequelize.TEXT });

    await sql.query(`UPDATE consultations SET payment_expires_at = created_at + INTERVAL '15 minutes' WHERE status = 'payment_pending' AND payment_expires_at IS NULL`);
    await sql.query(`CREATE INDEX IF NOT EXISTS consultations_payment_expires_at_idx ON consultations (payment_expires_at) WHERE status = 'payment_pending'`);
    await sql.query(`CREATE INDEX IF NOT EXISTS consultations_client_archive_status_idx ON consultations (client_id, archived_at, status)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS consultations_lawyer_archive_status_idx ON consultations (lawyer_id, archived_at, status)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS consultations_client_scheduled_idx ON consultations (client_id, scheduled_start_at, id)`);
  },

  async down() {
    throw new Error('Forward-only migration: production consultation lifecycle');
  },
};
