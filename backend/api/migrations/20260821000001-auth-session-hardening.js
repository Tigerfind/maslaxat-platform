'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables
    .map((table) => typeof table === 'string' ? table : table.tableName)
    .includes(tableName);
}

async function hasIndex(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

async function hasConstraint(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_constraint WHERE conname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

async function hasPrimaryKey(sequelize, tableName, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1
    FROM pg_constraint
    WHERE contype = 'p' AND conrelid = :tableName::regclass
  `, { replacements: { tableName }, transaction });
  return rows.length > 0;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      const challengesExist = await tableExists(queryInterface, 'auth_challenges', transaction);
      let existingChallengeColumns = null;
      if (challengesExist) {
        existingChallengeColumns = await queryInterface.describeTable('auth_challenges', { transaction });
        const required = ['id', 'user_id', 'nonce_hash', 'expires_at', 'factor_version', 'password_state'];
        const missingRequired = required.filter((column) => !existingChallengeColumns[column]);
        if (missingRequired.length) {
          const [[count]] = await sequelize.query(
            'SELECT COUNT(*)::integer AS count FROM auth_challenges',
            { transaction }
          );
          if (count.count > 0) {
            throw new Error(
              `Cannot repair populated auth_challenges (${count.count} row(s)); missing required columns: ${missingRequired.join(', ')}`
            );
          }
        }
      }

      const users = await queryInterface.describeTable('users', { transaction });
      if (!users.two_factor_version) {
        await queryInterface.addColumn('users', 'two_factor_version', {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        }, { transaction });
      }

      if (!challengesExist) {
        await queryInterface.createTable('auth_challenges', {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          user_id: { type: Sequelize.UUID, allowNull: false },
          nonce_hash: { type: Sequelize.STRING(64), allowNull: false },
          source_hash: { type: Sequelize.STRING(64), allowNull: true },
          factor_version: { type: Sequelize.INTEGER, allowNull: false },
          password_state: { type: Sequelize.STRING(32), allowNull: false },
          expires_at: { type: Sequelize.DATE, allowNull: false },
          consumed_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      } else {
        const columns = existingChallengeColumns;
        const missing = {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          user_id: { type: Sequelize.UUID, allowNull: false },
          nonce_hash: { type: Sequelize.STRING(64), allowNull: false },
          source_hash: { type: Sequelize.STRING(64), allowNull: true },
          factor_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          password_state: { type: Sequelize.STRING(32), allowNull: false, defaultValue: '0' },
          expires_at: { type: Sequelize.DATE, allowNull: false },
          consumed_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        };
        for (const [name, definition] of Object.entries(missing)) {
          if (!columns[name]) await queryInterface.addColumn('auth_challenges', name, definition, { transaction });
        }
      }

      if (!(await hasPrimaryKey(sequelize, 'auth_challenges', transaction))) {
        await queryInterface.addConstraint('auth_challenges', {
          fields: ['id'],
          type: 'primary key',
          name: 'auth_challenges_pkey',
          transaction,
        });
      }

      if (!(await hasConstraint(sequelize, 'auth_challenges_user_fk', transaction))) {
        await queryInterface.addConstraint('auth_challenges', {
          fields: ['user_id'],
          type: 'foreign key',
          name: 'auth_challenges_user_fk',
          references: { table: 'users', field: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
          transaction,
        });
      }

      const indexes = [
        ['auth_challenges_nonce_unique', ['nonce_hash'], true, null],
        ['auth_challenges_source_unique', ['source_hash'], true, { source_hash: { [Sequelize.Op.ne]: null } }],
        ['auth_challenges_user_expiry_idx', ['user_id', 'expires_at'], false, null],
        ['auth_challenges_expires_at_idx', ['expires_at'], false, null],
        ['auth_challenges_consumed_at_idx', ['consumed_at'], false, null],
      ];
      for (const [name, fields, unique, where] of indexes) {
        if (!(await hasIndex(sequelize, name, transaction))) {
          await queryInterface.addIndex('auth_challenges', fields, {
            name,
            unique,
            ...(where ? { where } : {}),
            transaction,
          });
        }
      }
    });
  },

  // Session generations and consumed challenges are security history. Rollback
  // is intentionally monotonic so a deploy reversal cannot revive old tokens.
  async down() {},
};
