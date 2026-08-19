'use strict';

async function hasIndex(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

async function assertLegacyProfiles(sequelize, transaction) {
  const [missing] = await sequelize.query(`
    SELECT u.id
    FROM users u
    LEFT JOIN lawyer_profiles lp ON lp.user_id = u.id
    WHERE u.role = 'lawyer'
    GROUP BY u.id
    HAVING COUNT(lp.id) = 0
  `, { transaction });
  if (missing.length) {
    throw new Error(`Legacy lawyer profiles missing: ${missing.length}; user ids: ${missing.map((row) => row.id).join(', ')}`);
  }

  const [duplicates] = await sequelize.query(`
    SELECT lp.user_id AS id, COUNT(lp.id)::integer AS profile_count
    FROM lawyer_profiles lp
    GROUP BY lp.user_id
    HAVING COUNT(lp.id) > 1
  `, { transaction });
  if (duplicates.length) {
    const details = duplicates.map((row) => `${row.id} (${row.profile_count})`).join(', ');
    throw new Error(`Duplicate lawyer profiles: ${duplicates.length}; user ids and profile counts: ${details}`);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      await assertLegacyProfiles(sequelize, transaction);

      let users = await queryInterface.describeTable('users', { transaction });
      const addedAccountType = !users.account_type;
      const addedPreferredMode = !users.preferred_mode;
      if (!users.account_type) {
        await queryInterface.addColumn('users', 'account_type', {
          type: Sequelize.ENUM('member', 'admin'),
          allowNull: true,
        }, { transaction });
      }
      if (!users.preferred_mode) {
        await queryInterface.addColumn('users', 'preferred_mode', {
          type: Sequelize.ENUM('client', 'lawyer'),
          allowNull: true,
        }, { transaction });
      }

      if (addedAccountType) {
        await sequelize.query(`
          UPDATE users
          SET account_type = CASE
            WHEN role = 'admin' THEN 'admin'::enum_users_account_type
            ELSE 'member'::enum_users_account_type
          END
          WHERE account_type IS NULL
        `, { transaction });
      }
      if (addedPreferredMode) {
        await sequelize.query(`
          UPDATE users
          SET preferred_mode = CASE
            WHEN role = 'lawyer' THEN 'lawyer'::enum_users_preferred_mode
            WHEN role = 'client' THEN 'client'::enum_users_preferred_mode
            ELSE NULL
          END
          WHERE preferred_mode IS NULL
        `, { transaction });
      }
      await sequelize.query(`
        ALTER TABLE users ALTER COLUMN account_type SET DEFAULT 'member';
        ALTER TABLE users ALTER COLUMN account_type SET NOT NULL
      `, { transaction });

      let profiles = await queryInterface.describeTable('lawyer_profiles', { transaction });
      const addedOperatingStatus = !profiles.operating_status;
      if (!profiles.operating_status) {
        await queryInterface.addColumn('lawyer_profiles', 'operating_status', {
          type: Sequelize.ENUM('enabled', 'suspended'),
          allowNull: false,
          defaultValue: 'suspended',
        }, { transaction });
      }
      if (!profiles.headline) {
        await queryInterface.addColumn('lawyer_profiles', 'headline', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction });
      }
      if (!profiles.work_experience) {
        await queryInterface.addColumn('lawyer_profiles', 'work_experience', {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: [],
        }, { transaction });
      }
      if (!profiles.profile_sources) {
        await queryInterface.addColumn('lawyer_profiles', 'profile_sources', {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        }, { transaction });
      }
      if (!profiles.verified_snapshot) {
        await queryInterface.addColumn('lawyer_profiles', 'verified_snapshot', {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        }, { transaction });
      }
      if (!profiles.verified_at) {
        await queryInterface.addColumn('lawyer_profiles', 'verified_at', {
          type: Sequelize.DATE,
          allowNull: true,
        }, { transaction });
      }
      if (!profiles.linkedin_url) {
        await queryInterface.addColumn('lawyer_profiles', 'linkedin_url', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction });
      }

      if (addedOperatingStatus) {
        await sequelize.query(`
          UPDATE lawyer_profiles lp
          SET operating_status = CASE
                WHEN u.role = 'lawyer' AND u.is_active = true AND lp.verification_status = 'approved'
                  THEN 'enabled'::enum_lawyer_profiles_operating_status
                ELSE 'suspended'::enum_lawyer_profiles_operating_status
              END,
              is_available = CASE
                WHEN u.role = 'lawyer' AND u.is_active = true AND lp.verification_status = 'approved'
                  THEN lp.is_available
                ELSE false
              END
          FROM users u
          WHERE lp.user_id = u.id
        `, { transaction });
      }

      profiles = await queryInterface.describeTable('lawyer_profiles', { transaction });
      if (!profiles.specialization.allowNull) {
        await queryInterface.changeColumn('lawyer_profiles', 'specialization', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction });
      }

      if (!(await hasIndex(sequelize, 'lawyer_profiles_user_id_unique', transaction))) {
        await queryInterface.addIndex('lawyer_profiles', ['user_id'], {
          name: 'lawyer_profiles_user_id_unique',
          unique: true,
          transaction,
        });
      }
    });
  },

  // This expand migration is intentionally monotonic. Removing capability data or
  // restoring a required specialization would make rollback destructive.
  async down() {},
};
