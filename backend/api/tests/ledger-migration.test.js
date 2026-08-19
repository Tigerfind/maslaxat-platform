const Sequelize = require('sequelize');
const migration = require('../migrations/20260820000001-create-financial-ledger');
const { resetDb, models } = require('./helpers');
const { postTransaction, ACCOUNTS } = require('../src/services/ledgerService');

const { sequelize, FinancialEntry } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(async () => {
  await resetDb();
});

test('migration repairs partial state and uses posted-header immutability without transaction-id comparison', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query('DROP TRIGGER IF EXISTS financial_entries_insertable ON financial_entries');
  await sequelize.query('ALTER TABLE financial_entries DROP CONSTRAINT IF EXISTS financial_entries_amount_positive');
  await sequelize.query('DROP INDEX IF EXISTS financial_entries_transaction_idx');
  await sequelize.query('DROP TABLE platform_setting_audits CASCADE');

  await migration.up(queryInterface, Sequelize);

  const transactionColumns = await queryInterface.describeTable('financial_transactions');
  const entryColumns = await queryInterface.describeTable('financial_entries');
  expect(transactionColumns.is_posted).toBeTruthy();
  expect(transactionColumns.posting_token).toBeTruthy();
  expect(entryColumns.posting_token).toBeTruthy();
  await expect(queryInterface.describeTable('platform_setting_audits')).resolves.toBeTruthy();

  const [constraints] = await sequelize.query(`
    SELECT conname FROM pg_constraint
    WHERE conname = 'financial_entries_amount_positive'
  `);
  const [indexes] = await sequelize.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN ('financial_entries_transaction_idx', 'financial_transactions_operation_key_unique')
  `);
  const [triggers] = await sequelize.query(`
    SELECT tgname FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN ('financial_entries_insertable', 'financial_entries_immutable', 'financial_transactions_immutable')
  `);
  const [functions] = await sequelize.query(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'assert_financial_entry_insertable'
  `);
  expect(constraints).toHaveLength(1);
  expect(new Set(indexes.map((row) => row.indexname))).toEqual(new Set([
    'financial_entries_transaction_idx',
    'financial_transactions_operation_key_unique',
  ]));
  expect(new Set(triggers.map((row) => row.tgname))).toEqual(new Set([
    'financial_entries_insertable',
    'financial_entries_immutable',
    'financial_transactions_immutable',
  ]));
  expect(functions[0].definition).not.toMatch(/xmin|txid_current/i);

  const posted = await postTransaction({
    operationKey: 'migration:posting-state',
    reason: 'migration_test',
    currency: 'UZS',
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 100 },
      { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 100 },
    ],
  });
  await expect(sequelize.transaction((tx) => FinancialEntry.bulkCreate([
    { financialTransactionId: posted.id, account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 1 },
    { financialTransactionId: posted.id, account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 1 },
  ], { transaction: tx }))).rejects.toThrow(/immutable/i);
});
