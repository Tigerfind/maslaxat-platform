const TARGETS = [
  { table: 'users', column: 'email', canonical: 'users_email_key' },
  { table: 'specializations', column: 'name', canonical: 'specializations_name_key' },
  { table: 'phone_otps', column: 'phone', canonical: 'phone_otps_phone_key' },
  { table: 'promos', column: 'code', canonical: 'promos_code_key' },
  { table: 'push_subscriptions', column: 'endpoint', canonical: 'push_subscriptions_endpoint_key' },
  { table: 'financial_events', column: 'idempotency_key', canonical: 'financial_events_idempotency_unique' },
];

async function matchingIndexes(queryInterface, target, transaction) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT
      ci.relname AS index_name,
      con.conname AS constraint_name,
      i.indisvalid,
      i.indisready,
      i.indisprimary,
      i.indclass::text AS opclasses,
      i.indcollation::text AS collations,
      i.indnullsnotdistinct,
      i.indpred IS NULL AS non_partial,
      i.indexprs IS NULL AS non_expression,
      am.amname
    FROM pg_class t
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = :column
    JOIN pg_index i ON i.indrelid = t.oid
      AND i.indisunique AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indkey[0] = a.attnum
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ci.relam
    LEFT JOIN pg_constraint con ON con.conindid = ci.oid AND con.contype = 'u'
    WHERE ns.nspname = 'public' AND t.relname = :table
    ORDER BY ci.relname
  `, { replacements: target, transaction });
  return rows;
}

function validateCanonical(rows, target) {
  const canonical = rows.find((row) => row.index_name === target.canonical);
  if (!canonical || !canonical.indisvalid || !canonical.indisready || canonical.indisprimary
    || !canonical.non_partial || !canonical.non_expression || canonical.amname !== 'btree') {
    throw new Error(`Unsafe or missing canonical unique index ${target.canonical}`);
  }
}

module.exports = {
  async up(queryInterface) {
    // Полный preflight до первого DROP: при неожиданной схеме ничего не меняем.
    for (const target of TARGETS) {
      validateCanonical(await matchingIndexes(queryInterface, target), target);
    }

    for (const target of TARGETS) {
      await queryInterface.sequelize.transaction(async (transaction) => {
        await queryInterface.sequelize.query("SET LOCAL lock_timeout = '3s'", { transaction });
        await queryInterface.sequelize.query("SET LOCAL statement_timeout = '60s'", { transaction });
        const table = queryInterface.queryGenerator.quoteTable({ schema: 'public', tableName: target.table });
        await queryInterface.sequelize.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`, { transaction });

        const rows = await matchingIndexes(queryInterface, target, transaction);
        validateCanonical(rows, target);
        const canonical = rows.find((row) => row.index_name === target.canonical);
        const duplicates = rows.filter((row) => row.index_name !== target.canonical);
        if (duplicates.some((row) => row.opclasses !== canonical.opclasses
          || row.collations !== canonical.collations
          || row.indnullsnotdistinct !== canonical.indnullsnotdistinct
          || row.non_partial !== canonical.non_partial
          || row.non_expression !== canonical.non_expression
          || row.amname !== canonical.amname)) {
          throw new Error(`Duplicate unique index semantics differ for ${target.table}.${target.column}`);
        }
        const constraints = duplicates.filter((row) => row.constraint_name).map((row) => row.constraint_name);
        const standalone = duplicates.filter((row) => !row.constraint_name).map((row) => row.index_name);

        if (constraints.length) {
          const drops = constraints.map((name) => `DROP CONSTRAINT ${queryInterface.quoteIdentifier(name)}`).join(', ');
          await queryInterface.sequelize.query(`ALTER TABLE ${table} ${drops}`, { transaction });
        }
        for (const name of standalone) {
          const index = `${queryInterface.quoteIdentifier('public')}.${queryInterface.quoteIdentifier(name)}`;
          await queryInterface.sequelize.query(`DROP INDEX ${index}`, { transaction });
        }

        const remaining = await matchingIndexes(queryInterface, target, transaction);
        if (remaining.length !== 1 || remaining[0].index_name !== target.canonical) {
          throw new Error(`Unique index cleanup verification failed for ${target.table}.${target.column}`);
        }
      });
    }
  },

  async down() {
    throw new Error('Forward-only migration: redundant indexes must not be recreated');
  },
};
