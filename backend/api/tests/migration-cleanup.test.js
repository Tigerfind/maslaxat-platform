const { resetDb, sequelize } = require('./helpers');
const cleanupUnique = require('../migrations/20260824000001-cleanup-duplicate-unique-indexes');
const cleanupLegal = require('../migrations/20260824000003-cleanup-duplicate-legal-indexes');

beforeAll(async () => {
  await resetDb();
});

test('cleanup сохраняет canonical indexes и удаляет эквивалентные дубли', async () => {
  await sequelize.query('ALTER TABLE users ADD CONSTRAINT users_email_key9999 UNIQUE (email)');
  await sequelize.query('CREATE UNIQUE INDEX legal_documents_source_url_version ON legal_documents (source_url, version)');

  await cleanupUnique.up(sequelize.getQueryInterface());
  await cleanupLegal.up(sequelize.getQueryInterface());

  const [rows] = await sequelize.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'users_email_key', 'users_email_key9999',
        'legal_documents_source_version_unique', 'legal_documents_source_url_version'
      )
    ORDER BY indexname
  `);
  expect(rows.map((row) => row.indexname)).toEqual([
    'legal_documents_source_version_unique',
    'users_email_key',
  ]);
});
