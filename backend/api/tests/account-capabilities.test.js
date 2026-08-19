jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const crypto = require('crypto');
const Sequelize = require('sequelize');
const request = require('supertest');
const app = require('../src/server');
const migration = require('../migrations/20260821000000-add-account-capabilities');
const {
  resetDb,
  models,
  tokenFor,
  makeMember,
  makeApplicant,
  makeApprovedOperator,
  makeSuspendedOperator,
  makeAdmin,
} = require('./helpers');

const { sequelize, User, LawyerProfile } = models;
const queryInterface = sequelize.getQueryInterface();
const capabilityUserColumns = ['account_type', 'preferred_mode'];
const capabilityProfileColumns = [
  'operating_status',
  'headline',
  'work_experience',
  'profile_sources',
  'verified_snapshot',
  'verified_at',
  'linkedin_url',
];

async function prepareLegacySchema() {
  await resetDb();
  await sequelize.query('ALTER TABLE lawyer_profiles DROP CONSTRAINT IF EXISTS lawyer_profiles_user_id_key');
  await sequelize.query('DROP INDEX IF EXISTS lawyer_profiles_user_id_unique');

  let users = await queryInterface.describeTable('users');
  for (const column of capabilityUserColumns) {
    if (users[column]) await queryInterface.removeColumn('users', column);
  }

  let profiles = await queryInterface.describeTable('lawyer_profiles');
  for (const column of capabilityProfileColumns) {
    if (profiles[column]) await queryInterface.removeColumn('lawyer_profiles', column);
  }
  profiles = await queryInterface.describeTable('lawyer_profiles');
  if (profiles.specialization.allowNull) {
    await queryInterface.changeColumn('lawyer_profiles', 'specialization', {
      type: Sequelize.STRING,
      allowNull: false,
    });
  }
}

async function insertLegacyUser(role, email, isActive = true) {
  const id = crypto.randomUUID();
  await sequelize.query(`
    INSERT INTO users (id, email, password, name, role, is_active, is_verified, created_at, updated_at)
    VALUES (:id, :email, 'legacy-password', 'Legacy User', :role, :isActive, true, NOW(), NOW())
  `, { replacements: { id, email, role, isActive } });
  return id;
}

async function insertLegacyProfile(userId, specialization = 'Civil law', verificationStatus = 'approved') {
  const id = crypto.randomUUID();
  await sequelize.query(`
    INSERT INTO lawyer_profiles
      (id, user_id, specialization, specializations, is_available, verification_status, created_at, updated_at)
    VALUES (:id, :userId, :specialization, ARRAY[:specialization]::varchar(255)[], true, :verificationStatus, NOW(), NOW())
  `, { replacements: { id, userId, specialization, verificationStatus } });
  return id;
}

describe('account capability migration', () => {
  test('backfills legacy roles, preserves profiles, and reruns safely', async () => {
    await prepareLegacySchema();
    const lawyerId = await insertLegacyUser('lawyer', 'legacy-lawyer@test.uz');
    const clientId = await insertLegacyUser('client', 'legacy-client@test.uz');
    const adminId = await insertLegacyUser('admin', 'legacy-admin@test.uz');
    await insertLegacyProfile(lawyerId);

    await migration.up(queryInterface, Sequelize);

    const [users] = await sequelize.query(`
      SELECT id, role, account_type, preferred_mode FROM users WHERE id IN (:lawyerId, :clientId, :adminId)
    `, { replacements: { lawyerId, clientId, adminId } });
    const byId = Object.fromEntries(users.map((user) => [user.id, user]));
    expect(byId[lawyerId]).toMatchObject({ role: 'lawyer', account_type: 'member', preferred_mode: 'lawyer' });
    expect(byId[clientId]).toMatchObject({ role: 'client', account_type: 'member', preferred_mode: 'client' });
    expect(byId[adminId]).toMatchObject({ role: 'admin', account_type: 'admin', preferred_mode: null });

    const [profiles] = await sequelize.query(`
      SELECT user_id, operating_status FROM lawyer_profiles WHERE user_id = :lawyerId
    `, { replacements: { lawyerId } });
    expect(profiles).toEqual([{ user_id: lawyerId, operating_status: 'enabled' }]);

    await sequelize.query(`
      UPDATE lawyer_profiles SET operating_status = 'suspended' WHERE user_id = :lawyerId;
      UPDATE users SET preferred_mode = NULL WHERE id = :clientId
    `, { replacements: { lawyerId, clientId } });
    await migration.up(queryInterface, Sequelize);
    const [rerunProfiles] = await sequelize.query(`
      SELECT operating_status FROM lawyer_profiles WHERE user_id = :lawyerId
    `, { replacements: { lawyerId } });
    const [rerunUsers] = await sequelize.query(`
      SELECT preferred_mode FROM users WHERE id = :clientId
    `, { replacements: { clientId } });
    expect(rerunProfiles[0].operating_status).toBe('suspended');
    expect(rerunUsers[0].preferred_mode).toBeNull();

    const profileColumns = await queryInterface.describeTable('lawyer_profiles');
    expect(profileColumns.specialization.allowNull).toBe(true);
    expect(profileColumns.linkedin_url).toBeTruthy();
    await expect(sequelize.query(`
      INSERT INTO lawyer_profiles
        (id, user_id, specialization, specializations, is_available, verification_status,
         operating_status, profile_sources, verified_snapshot, created_at, updated_at)
      VALUES (:id, :lawyerId, NULL, ARRAY[]::varchar(255)[], false, 'pending',
              'suspended', '{}'::jsonb, '{}'::jsonb, NOW(), NOW())
    `, { replacements: { id: crypto.randomUUID(), lawyerId } })).rejects.toThrow();
  });

  test('enables only approved active legacy lawyers and forces all others offline', async () => {
    await prepareLegacySchema();
    const approvedId = await insertLegacyUser('lawyer', 'approved-active@test.uz');
    const pendingId = await insertLegacyUser('lawyer', 'pending-active@test.uz');
    const rejectedId = await insertLegacyUser('lawyer', 'rejected-active@test.uz');
    const inactiveId = await insertLegacyUser('lawyer', 'approved-inactive@test.uz', false);
    await insertLegacyProfile(approvedId, 'Civil law', 'approved');
    await insertLegacyProfile(pendingId, 'Civil law', 'pending');
    await insertLegacyProfile(rejectedId, 'Civil law', 'rejected');
    await insertLegacyProfile(inactiveId, 'Civil law', 'approved');

    await migration.up(queryInterface, Sequelize);

    const [profiles] = await sequelize.query(`
      SELECT user_id, operating_status, is_available
      FROM lawyer_profiles
      WHERE user_id IN (:approvedId, :pendingId, :rejectedId, :inactiveId)
    `, { replacements: { approvedId, pendingId, rejectedId, inactiveId } });
    const byUser = Object.fromEntries(profiles.map((profile) => [profile.user_id, profile]));
    expect(byUser[approvedId]).toMatchObject({ operating_status: 'enabled', is_available: true });
    expect(byUser[pendingId]).toMatchObject({ operating_status: 'suspended', is_available: false });
    expect(byUser[rejectedId]).toMatchObject({ operating_status: 'suspended', is_available: false });
    expect(byUser[inactiveId]).toMatchObject({ operating_status: 'suspended', is_available: false });

    await sequelize.query(`
      UPDATE lawyer_profiles SET operating_status = 'suspended', is_available = false
      WHERE user_id = :approvedId
    `, { replacements: { approvedId } });
    await migration.up(queryInterface, Sequelize);
    const [rerun] = await sequelize.query(`
      SELECT operating_status, is_available FROM lawyer_profiles WHERE user_id = :approvedId
    `, { replacements: { approvedId } });
    expect(rerun[0]).toMatchObject({ operating_status: 'suspended', is_available: false });
  });

  test('aborts with a diagnostic when a legacy lawyer has no profile', async () => {
    await prepareLegacySchema();
    const lawyerId = await insertLegacyUser('lawyer', 'missing-profile@test.uz');

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/legacy lawyer profiles missing.*1/i);

    const users = await queryInterface.describeTable('users');
    expect(users.account_type).toBeUndefined();
    const [legacy] = await sequelize.query('SELECT role FROM users WHERE id = :lawyerId', { replacements: { lawyerId } });
    expect(legacy[0].role).toBe('lawyer');
  });

  test('aborts with a diagnostic when a legacy lawyer has duplicate profiles', async () => {
    await prepareLegacySchema();
    const lawyerId = await insertLegacyUser('lawyer', 'duplicate-profile@test.uz');
    await insertLegacyProfile(lawyerId, 'Civil law');
    await insertLegacyProfile(lawyerId, 'Family law');

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/duplicate lawyer profiles.*1/i);

    const profiles = await queryInterface.describeTable('lawyer_profiles');
    expect(profiles.operating_status).toBeUndefined();
  });

  test('aborts with IDs and profile counts for duplicate client and admin profiles', async () => {
    await prepareLegacySchema();
    const clientId = await insertLegacyUser('client', 'duplicate-client@test.uz');
    const adminId = await insertLegacyUser('admin', 'duplicate-admin@test.uz');
    await insertLegacyProfile(clientId, 'Civil law');
    await insertLegacyProfile(clientId, 'Family law');
    await insertLegacyProfile(adminId, 'Tax law');
    await insertLegacyProfile(adminId, 'Business law');

    let error;
    try {
      await migration.up(queryInterface, Sequelize);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/duplicate lawyer profiles.*2/i);
    expect(error.message).toContain(`${clientId} (2)`);
    expect(error.message).toContain(`${adminId} (2)`);

    const users = await queryInterface.describeTable('users');
    expect(users.account_type).toBeUndefined();
  });
});

describe('account capability models and factories', () => {
  beforeEach(resetDb);

  test('factories expose member, applicant, operator, suspended, and admin states', async () => {
    const member = await makeMember('member-state@test.uz');
    const applicant = await makeApplicant('applicant-state@test.uz');
    const operator = await makeApprovedOperator('operator-state@test.uz');
    const suspended = await makeSuspendedOperator('suspended-state@test.uz');
    const admin = await makeAdmin('admin-state@test.uz');

    expect(member).toMatchObject({ accountType: 'member', role: 'client', preferredMode: 'client' });
    expect(await LawyerProfile.count({ where: { userId: member.id } })).toBe(0);
    expect(applicant.user).toMatchObject({ accountType: 'member', role: 'lawyer', preferredMode: 'lawyer' });
    expect(applicant.lp).toMatchObject({ verificationStatus: 'pending', operatingStatus: 'suspended', isAvailable: false, specialization: null });
    expect(operator.lp).toMatchObject({ verificationStatus: 'approved', operatingStatus: 'enabled' });
    expect(suspended.lp).toMatchObject({ verificationStatus: 'approved', operatingStatus: 'suspended' });
    expect(admin).toMatchObject({ accountType: 'admin', role: 'admin', preferredMode: null });
  });

  test('normalizes only HTTPS LinkedIn member profile URLs without fetching them', async () => {
    const member = await makeMember('linkedin-model@test.uz');
    const profile = await LawyerProfile.create({
      userId: member.id,
      linkedinUrl: 'https://WWW.LinkedIn.com/in/example-lawyer/?trk=public#about',
      isAvailable: false,
    });
    expect(profile.linkedinUrl).toBe('https://www.linkedin.com/in/example-lawyer/');

    for (const linkedinUrl of [
      'http://www.linkedin.com/in/example-lawyer',
      'https://uk.linkedin.com/in/example-lawyer',
      'https://www.linkedin.com/company/example-lawyer',
      'https://www.linkedin.com.evil.test/in/example-lawyer',
      'https://user@www.linkedin.com/in/example-lawyer',
      'https://www.linkedin.com:444/in/example-lawyer',
    ]) {
      await expect(profile.update({ linkedinUrl })).rejects.toThrow(/LinkedIn/i);
    }
  });
});

describe('POST /api/account/lawyer-profile', () => {
  beforeEach(resetDb);

  test('creates one suspended draft, mirrors legacy role, and returns it on retry', async () => {
    const member = await makeMember('apply@test.uz');
    const auth = { Authorization: `Bearer ${tokenFor(member)}` };

    const first = await request(app).post('/api/account/lawyer-profile').set(auth);
    const retry = await request(app).post('/api/account/lawyer-profile').set(auth);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.profile.id).toBe(first.body.profile.id);
    expect(first.body.profile).toMatchObject({
      specialization: null,
      specializations: [],
      verificationStatus: 'pending',
      operatingStatus: 'suspended',
      isAvailable: false,
    });
    expect(await LawyerProfile.count({ where: { userId: member.id } })).toBe(1);
    await member.reload();
    expect(member).toMatchObject({ role: 'lawyer', accountType: 'member', preferredMode: 'lawyer' });
  });

  test('serializes concurrent retries into one profile', async () => {
    const member = await makeMember('concurrent-apply@test.uz');
    const token = tokenFor(member);
    const responses = await Promise.all([
      request(app).post('/api/account/lawyer-profile').set('Authorization', `Bearer ${token}`),
      request(app).post('/api/account/lawyer-profile').set('Authorization', `Bearer ${token}`),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(new Set(responses.map((response) => response.body.profile.id)).size).toBe(1);
    expect(await LawyerProfile.count({ where: { userId: member.id } })).toBe(1);
  });

  test('forbids admin accounts', async () => {
    const admin = await makeAdmin('apply-admin@test.uz');
    const response = await request(app)
      .post('/api/account/lawyer-profile')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(response.status).toBe(403);
    expect(await LawyerProfile.count({ where: { userId: admin.id } })).toBe(0);
  });
});

describe('account compatibility writes', () => {
  beforeEach(resetDb);

  test('persists only valid preferred modes through the existing user profile route', async () => {
    const member = await makeMember('preferred-mode@test.uz');
    const auth = { Authorization: `Bearer ${tokenFor(member)}` };

    const valid = await request(app).put('/api/users/profile').set(auth).send({ preferredMode: 'lawyer' });
    const invalid = await request(app).put('/api/users/profile').set(auth).send({ preferredMode: 'admin' });

    expect(valid.status).toBe(200);
    expect(valid.body.user.preferredMode).toBe('lawyer');
    expect(invalid.status).toBe(400);
  });

  test('legacy lawyer registration mirrors account state without inventing a specialization', async () => {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Draft Lawyer',
      email: 'draft-registration@test.uz',
      password: 'passw0rd',
      role: 'lawyer',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      role: 'lawyer',
      accountType: 'member',
      preferredMode: 'lawyer',
    });
    const profile = await LawyerProfile.findOne({ where: { userId: response.body.user.id } });
    expect(profile).toMatchObject({
      specialization: null,
      specializations: [],
      verificationStatus: 'pending',
      operatingStatus: 'suspended',
      isAvailable: false,
    });
  });
});
