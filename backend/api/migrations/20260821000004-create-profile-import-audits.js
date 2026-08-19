'use strict';

const IMPORT_TABLE = 'lawyer_profile_imports';
const AUDIT_TABLE = 'profile_import_audits';
const EVENTS = [
  'admin_view',
  'admin_download',
  'owner_delete',
  'retention_cleanup',
  'profile_review_cleanup',
  'field_verified',
];

async function tableExists(sequelize, tableName, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT to_regclass(format('%I.%I', current_schema(), :tableName)) IS NOT NULL AS exists
  `, { replacements: { tableName }, transaction });
  return row.exists;
}

async function ensureImportColumn(queryInterface, transaction, Sequelize) {
  const columns = await queryInterface.describeTable(IMPORT_TABLE, { transaction });
  if (!columns.upload_idempotency_key) {
    await queryInterface.addColumn(IMPORT_TABLE, 'upload_idempotency_key', {
      type: Sequelize.STRING(128),
      allowNull: true,
    }, { transaction });
  }
  if (!columns.profile_revision) {
    await queryInterface.addColumn(IMPORT_TABLE, 'profile_revision', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    }, { transaction });
  }
}

async function ensureProfileRevision(queryInterface, transaction, Sequelize) {
  const columns = await queryInterface.describeTable('lawyer_profiles', { transaction });
  if (!columns.revision) {
    await queryInterface.addColumn('lawyer_profiles', 'revision', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    }, { transaction });
  }
}

async function ensureIndex(queryInterface, table, fields, options, transaction, matches) {
  const sequelize = queryInterface.sequelize;
  const [rows] = await sequelize.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = :table AND indexname = :name
  `, { replacements: { table, name: options.name }, transaction });
  if (rows[0] && matches(rows[0].indexdef)) return;
  if (rows[0]) await queryInterface.removeIndex(table, options.name, { transaction });
  await queryInterface.addIndex(table, fields, { ...options, transaction });
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/["\s]/g, '');
}

function normalizedCheck(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/::(?:character varying|text|interval)(?:\[\])?/g, '')
    .replace(/[()\s"]/g, '');
}

async function assertContentFreeAuditColumns(queryInterface, transaction) {
  const columns = await queryInterface.describeTable(AUDIT_TABLE, { transaction });
  const expected = new Set([
    'id', 'import_id', 'owner_user_id', 'actor_user_id', 'event', 'created_at', 'expires_at',
  ]);
  const unexpected = Object.keys(columns).filter((name) => !expected.has(name));
  if (unexpected.length) {
    throw new Error(`Unexpected ${AUDIT_TABLE} column(s): ${unexpected.sort().join(', ')}`);
  }
  const missing = [...expected].filter((name) => !columns[name]);
  if (missing.length) {
    throw new Error(`Missing ${AUDIT_TABLE} column(s): ${missing.sort().join(', ')}`);
  }
}

async function ensureAuditConstraints(queryInterface, sequelize, transaction) {
  const [foreignKeys] = await sequelize.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '${AUDIT_TABLE}'::regclass AND contype = 'f'
  `, { transaction });
  for (const foreignKey of foreignKeys) {
    await queryInterface.removeConstraint(AUDIT_TABLE, foreignKey.conname, { transaction });
  }
  const [rows] = await sequelize.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = '${AUDIT_TABLE}'::regclass
      AND conname IN ('profile_import_audits_event_valid', 'profile_import_audits_expiry_valid')
  `, { transaction });
  const actual = new Map(rows.map((row) => [row.conname, row.definition]));
  const eventDefinition = actual.get('profile_import_audits_event_valid');
  const expectedEventDefinition = normalizedCheck(
    `CHECK (event = ANY (ARRAY[${EVENTS.map((event) => `'${event}'`).join(',')}]))`
  );
  const eventMatches = normalizedCheck(eventDefinition) === expectedEventDefinition;
  if (!eventMatches && eventDefinition) {
    await queryInterface.removeConstraint(AUDIT_TABLE, 'profile_import_audits_event_valid', { transaction });
  }
  const expiryDefinition = actual.get('profile_import_audits_expiry_valid');
  const expectedExpiryDefinition = normalizedCheck(
    "CHECK (expires_at <= created_at + '90 days')"
  );
  const expiryMatches = normalizedCheck(expiryDefinition) === expectedExpiryDefinition;
  if (!expiryMatches && expiryDefinition) {
    await queryInterface.removeConstraint(AUDIT_TABLE, 'profile_import_audits_expiry_valid', { transaction });
  }

  const quotedEvents = EVENTS.map((event) => sequelize.escape(event)).join(',');
  if (!eventMatches) {
    await sequelize.query(`
      ALTER TABLE ${AUDIT_TABLE}
        ADD CONSTRAINT profile_import_audits_event_valid CHECK (event IN (${quotedEvents}))
    `, { transaction });
  }
  if (!expiryMatches) {
    await sequelize.query(`
      ALTER TABLE ${AUDIT_TABLE}
        ADD CONSTRAINT profile_import_audits_expiry_valid
        CHECK (expires_at <= created_at + interval '90 days')
    `, { transaction });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      await ensureImportColumn(queryInterface, transaction, Sequelize);
      await ensureProfileRevision(queryInterface, transaction, Sequelize);

      if (!(await tableExists(sequelize, AUDIT_TABLE, transaction))) {
        await queryInterface.createTable(AUDIT_TABLE, {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          import_id: { type: Sequelize.UUID, allowNull: true },
          owner_user_id: { type: Sequelize.UUID, allowNull: false },
          actor_user_id: { type: Sequelize.UUID, allowNull: true },
          event: { type: Sequelize.STRING(40), allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          expires_at: { type: Sequelize.DATE, allowNull: false },
        }, { transaction });
      }
      await assertContentFreeAuditColumns(queryInterface, transaction);
      await ensureAuditConstraints(queryInterface, sequelize, transaction);

      await ensureIndex(queryInterface, IMPORT_TABLE, ['user_id', 'upload_idempotency_key'], {
        name: 'lawyer_profile_imports_owner_idempotency_unique',
        unique: true,
        where: { upload_idempotency_key: { [Sequelize.Op.ne]: null } },
      }, transaction, (definition) => {
        const value = normalized(definition);
        return value.startsWith('createuniqueindex')
          && value.includes('(user_id,upload_idempotency_key)')
          && value.includes('where(upload_idempotency_keyisnotnull)');
      });
      await ensureIndex(queryInterface, IMPORT_TABLE, ['status', 'updated_at', 'created_at'], {
        name: 'lawyer_profile_imports_parse_queue_idx',
      }, transaction, (definition) => {
        const value = normalized(definition);
        return value.startsWith('createindex') && value.endsWith('(status,updated_at,created_at)');
      });
      await ensureIndex(queryInterface, IMPORT_TABLE, ['status', 'expires_at', 'confirmed_at'], {
        name: 'lawyer_profile_imports_retention_queue_idx',
      }, transaction, (definition) => {
        const value = normalized(definition);
        return value.startsWith('createindex') && value.endsWith('(status,expires_at,confirmed_at)');
      });
      await ensureIndex(queryInterface, AUDIT_TABLE, ['expires_at'], {
        name: 'profile_import_audits_expiry_idx',
      }, transaction, (definition) => {
        const value = normalized(definition);
        return value.startsWith('createindex') && value.endsWith('(expires_at)');
      });
    });
  },

  // Retention and idempotency records must not be silently dropped on rollback.
  async down() {},
};
