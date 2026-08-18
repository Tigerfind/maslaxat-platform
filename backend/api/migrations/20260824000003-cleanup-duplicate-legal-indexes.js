const TARGETS = [
  {
    table: 'legal_documents',
    canonical: 'legal_documents_source_version_unique',
    duplicate: 'legal_documents_source_url_version',
  },
  {
    table: 'legal_chunks',
    canonical: 'legal_chunks_document_ordinal_unique',
    duplicate: 'legal_chunks_document_id_ordinal',
  },
];

module.exports = {
  async up(queryInterface) {
    for (const target of TARGETS) {
      await queryInterface.sequelize.transaction(async (transaction) => {
        const [indexes] = await queryInterface.sequelize.query(`
          SELECT ci.relname AS name, i.indisunique, i.indisvalid, i.indisready,
            i.indkey::text AS keys, i.indclass::text AS opclasses,
            i.indcollation::text AS collations, i.indnullsnotdistinct,
            i.indpred IS NULL AS non_partial, i.indexprs IS NULL AS non_expression,
            am.amname
          FROM pg_class t
          JOIN pg_namespace ns ON ns.oid = t.relnamespace
          JOIN pg_index i ON i.indrelid = t.oid
          JOIN pg_class ci ON ci.oid = i.indexrelid
          JOIN pg_am am ON am.oid = ci.relam
          WHERE ns.nspname = 'public' AND t.relname = :table
            AND ci.relname IN (:canonical, :duplicate)
        `, { replacements: target, transaction });
        const canonical = indexes.find((index) => index.name === target.canonical);
        const duplicate = indexes.find((index) => index.name === target.duplicate);
        if (!canonical || !canonical.indisunique || !canonical.indisvalid || !canonical.indisready) {
          throw new Error(`Unsafe or missing canonical legal index ${target.canonical}`);
        }
        if (!duplicate) return;
        if (!duplicate.indisunique || duplicate.keys !== canonical.keys
          || duplicate.opclasses !== canonical.opclasses
          || duplicate.collations !== canonical.collations
          || duplicate.indnullsnotdistinct !== canonical.indnullsnotdistinct
          || duplicate.non_partial !== canonical.non_partial
          || duplicate.non_expression !== canonical.non_expression
          || duplicate.amname !== canonical.amname) {
          throw new Error(`Legal index ${target.duplicate} is not equivalent to ${target.canonical}`);
        }
        await queryInterface.sequelize.query("SET LOCAL lock_timeout = '3s'", { transaction });
        await queryInterface.sequelize.query("SET LOCAL statement_timeout = '60s'", { transaction });
        const name = `${queryInterface.quoteIdentifier('public')}.${queryInterface.quoteIdentifier(target.duplicate)}`;
        await queryInterface.sequelize.query(`DROP INDEX ${name}`, { transaction });
      });
    }
  },

  async down() {
    throw new Error('Forward-only migration: duplicate legal indexes must not be recreated');
  },
};
