const Sequelize = require('sequelize');
const migration = require('../migrations/20260820000004-harden-promotion-api');
const { resetDb, models, makeAdmin } = require('./helpers');

const { sequelize, PlatformSettingAudit } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(async () => {
  await resetDb();
});

test('00004 preserves old audits, expands storage, adds document approval, and reruns safely', async () => {
  const admin = await makeAdmin('promotion-audit-migration@test.uz');
  await queryInterface.changeColumn('platform_setting_audits', 'old_value', {
    type: Sequelize.STRING(255), allowNull: false,
  });
  await queryInterface.changeColumn('platform_setting_audits', 'new_value', {
    type: Sequelize.STRING(255), allowNull: false,
  });
  const documentColumns = await queryInterface.describeTable('lawyer_documents');
  for (const column of ['verification_status', 'approved_by_user_id', 'approved_at']) {
    if (documentColumns[column]) await queryInterface.removeColumn('lawyer_documents', column);
  }
  const oldAudit = await PlatformSettingAudit.create({
    key: 'legacy:audit',
    oldValue: '1500',
    newValue: '1200',
    changedByUserId: admin.id,
  });

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  await oldAudit.reload();
  expect(oldAudit.oldValue).toBe('1500');
  expect(oldAudit.newValue).toBe('1200');
  const auditColumns = await queryInterface.describeTable('platform_setting_audits');
  const updatedDocumentColumns = await queryInterface.describeTable('lawyer_documents');
  const paymentColumns = await queryInterface.describeTable('payments');
  const packageColumns = await queryInterface.describeTable('promotion_packages');
  expect(auditColumns.old_value.type).toBe('TEXT');
  expect(auditColumns.new_value.type).toBe('TEXT');
  expect(updatedDocumentColumns.verification_status).toBeTruthy();
  expect(updatedDocumentColumns.approved_by_user_id).toBeTruthy();
  expect(updatedDocumentColumns.approved_at).toBeTruthy();
  expect(paymentColumns.idempotency_key.type).toMatch(/(?:VARCHAR|CHARACTER VARYING)\(320\)/);
  expect(String(packageColumns.is_active.defaultValue)).toMatch(/false/i);

  const fullSnapshot = JSON.stringify({ name: { ru: 'Ю'.repeat(200), uz: 'U', en: 'E' } });
  await expect(PlatformSettingAudit.create({
    key: 'promotion_package:large',
    oldValue: fullSnapshot,
    newValue: fullSnapshot,
    changedByUserId: admin.id,
  })).resolves.toBeTruthy();
});

test('00004 down preserves irreversible-safe widened values and is down/up rerunnable', async () => {
  const admin = await makeAdmin('promotion-audit-down@test.uz');
  await migration.up(queryInterface, Sequelize);
  const longSnapshot = JSON.stringify({ name: { ru: 'Д'.repeat(400), uz: 'U', en: 'E' } });
  const audit = await PlatformSettingAudit.create({
    key: 'promotion_package:long-down',
    oldValue: longSnapshot,
    newValue: longSnapshot,
    changedByUserId: admin.id,
  });

  await migration.down(queryInterface, Sequelize);
  await migration.down(queryInterface, Sequelize);

  await audit.reload();
  expect(audit.oldValue).toBe(longSnapshot);
  expect(audit.newValue).toBe(longSnapshot);
  let auditColumns = await queryInterface.describeTable('platform_setting_audits');
  let paymentColumns = await queryInterface.describeTable('payments');
  let documentColumns = await queryInterface.describeTable('lawyer_documents');
  let packageColumns = await queryInterface.describeTable('promotion_packages');
  expect(auditColumns.old_value.type).toBe('TEXT');
  expect(auditColumns.new_value.type).toBe('TEXT');
  expect(paymentColumns.idempotency_key.type).toMatch(/(?:VARCHAR|CHARACTER VARYING)\(320\)/);
  expect(documentColumns.verification_status).toBeUndefined();
  expect(documentColumns.approved_by_user_id).toBeUndefined();
  expect(documentColumns.approved_at).toBeUndefined();
  expect(String(packageColumns.is_active.defaultValue)).toMatch(/true/i);

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);
  await audit.reload();
  auditColumns = await queryInterface.describeTable('platform_setting_audits');
  documentColumns = await queryInterface.describeTable('lawyer_documents');
  packageColumns = await queryInterface.describeTable('promotion_packages');
  expect(audit.oldValue).toBe(longSnapshot);
  expect(auditColumns.old_value.type).toBe('TEXT');
  expect(documentColumns.verification_status).toBeTruthy();
  expect(String(packageColumns.is_active.defaultValue)).toMatch(/false/i);
});
