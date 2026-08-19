const Sequelize = require('sequelize');
const { resetDb, models, makeAdmin } = require('./helpers');

const { sequelize, User, AuthChallenge } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(resetDb);

test('models expose versioned factors and one-time auth challenges', async () => {
  const admin = await makeAdmin('auth-model@test.uz');

  expect(User.rawAttributes.twoFactorVersion).toBeTruthy();
  expect(AuthChallenge).toBeTruthy();
  const challenge = await AuthChallenge.create({
    userId: admin.id,
    nonceHash: 'a'.repeat(64),
    sourceHash: 'b'.repeat(64),
    factorVersion: 0,
    passwordState: '0',
    expiresAt: new Date(Date.now() + 60_000),
  });

  expect(admin.twoFactorVersion).toBe(0);
  expect(challenge).toMatchObject({ userId: admin.id, consumedAt: null });
});

test('auth-session migration aborts before DDL for a populated unsafe partial table', async () => {
  const migration = require('../migrations/20260821000001-auth-session-hardening');
  const userColumns = await queryInterface.describeTable('users');
  if (userColumns.two_factor_version) await queryInterface.removeColumn('users', 'two_factor_version');
  await queryInterface.dropTable('auth_challenges');
  await queryInterface.createTable('auth_challenges', {
    source_hash: { type: Sequelize.STRING(64), allowNull: true },
  });
  await sequelize.query(`INSERT INTO auth_challenges (source_hash) VALUES ('unsafe-partial')`);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    /cannot repair populated auth_challenges.*1 row.*id.*user_id.*nonce_hash.*expires_at.*factor_version.*password_state/i
  );

  const unchangedUsers = await queryInterface.describeTable('users');
  const unchangedChallenges = await queryInterface.describeTable('auth_challenges');
  expect(unchangedUsers.two_factor_version).toBeUndefined();
  expect(Object.keys(unchangedChallenges)).toEqual(['source_hash']);
});

test('auth-session migration fully repairs an empty partial table and reruns safely', async () => {
  const migration = require('../migrations/20260821000001-auth-session-hardening');
  const userColumns = await queryInterface.describeTable('users');
  if (userColumns.two_factor_version) await queryInterface.removeColumn('users', 'two_factor_version');
  await queryInterface.dropTable('auth_challenges');
  await queryInterface.createTable('auth_challenges', {
    source_hash: { type: Sequelize.STRING(64), allowNull: true },
  });

  await migration.up(queryInterface, Sequelize);
  await queryInterface.removeColumn('auth_challenges', 'consumed_at');
  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const repairedUsers = await queryInterface.describeTable('users');
  const challengeColumns = await queryInterface.describeTable('auth_challenges');
  expect(repairedUsers.two_factor_version).toBeTruthy();
  expect(challengeColumns).toEqual(expect.objectContaining({
    id: expect.objectContaining({ primaryKey: true }),
    nonce_hash: expect.any(Object),
    user_id: expect.any(Object),
    source_hash: expect.any(Object),
    factor_version: expect.any(Object),
    password_state: expect.any(Object),
    expires_at: expect.any(Object),
    consumed_at: expect.any(Object),
  }));

  const [indexes] = await sequelize.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'auth_challenges_nonce_unique',
        'auth_challenges_source_unique',
        'auth_challenges_user_expiry_idx',
        'auth_challenges_expires_at_idx',
        'auth_challenges_consumed_at_idx'
      )
  `);
  expect(new Set(indexes.map((row) => row.indexname))).toEqual(new Set([
    'auth_challenges_nonce_unique',
    'auth_challenges_source_unique',
    'auth_challenges_user_expiry_idx',
    'auth_challenges_expires_at_idx',
    'auth_challenges_consumed_at_idx',
  ]));
});
