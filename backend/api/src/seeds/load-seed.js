require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const { Op } = require('sequelize');
const {
  sequelize, User, LawyerProfile, Consultation, Message, Payment,
} = require('../models');

const LOAD_SEED_VERSION = 'p3-task8-v1';
const LOAD_DATASET = Object.freeze({ lawyers: 50, clients: 200, consultations: 1000 });
const LOAD_DOMAIN = 'load.test';
const PRODUCTION_HOSTS = 'maslaxat.uz,www.maslaxat.uz,app.maslaxat.uz,api.maslaxat.uz';

function hostSet(value) {
  return new Set(String(value || '').split(',').map(normalizeHost).filter(Boolean));
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

function isDeniedHost(host, deniedHosts) {
  return [...deniedHosts].some((denied) => host === denied || host.endsWith(`.${denied}`));
}

async function assertDatabaseIdentity(env = process.env, database = sequelize) {
  const nonce = String(env.LOAD_DB_ATTESTATION_NONCE || '');
  const secret = String(env.LOAD_DB_ATTESTATION_SECRET || '');
  const expectedFingerprint = String(env.LOAD_TARGET_DB_FINGERPRINT || '').toLowerCase();
  const expectedRole = String(env.LOAD_DATABASE_ROLE_CONFIRM || '');
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(nonce)) throw new Error('LOAD_DB_ATTESTATION_NONCE is required');
  if (secret.length < 16) throw new Error('LOAD_DB_ATTESTATION_SECRET must be at least 16 characters');
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('LOAD_TARGET_DB_FINGERPRINT is required');
  if (!expectedRole) throw new Error('LOAD_DATABASE_ROLE_CONFIRM is required');
  const [rows] = await database.query(`
    SELECT current_database() AS database,
           current_user AS role,
           COALESCE(inet_server_addr()::text, 'local') AS address,
           COALESCE(inet_server_port(), 0) AS port,
           r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);
  const identity = rows && rows[0];
  if (!identity || identity.role !== expectedRole) throw new Error('Connected database role does not match LOAD_DATABASE_ROLE_CONFIRM');
  const privileged = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']
    .filter((flag) => identity[flag]);
  if (privileged.length) throw new Error(`Load database role is privileged: ${privileged.join(', ')}`);
  const payload = ['e2e-db-v1', nonce, identity.database, identity.address, identity.port].join('\n');
  const fingerprint = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const denied = hostSet(env.LOAD_TEST_PRODUCTION_DB_FINGERPRINTS || env.PRODUCTION_DB_FINGERPRINTS);
  if (denied.has(fingerprint)) throw new Error('Connected database fingerprint is production-denied');
  if (fingerprint !== expectedFingerprint) throw new Error('Connected database does not match target-issued fingerprint');
  return { database: identity.database, role: identity.role, fingerprint };
}

function assertLoadSeedEnvironment(env = process.env, targetUrl = env.LOAD_TEST_TARGET_URL) {
  if (env.NODE_ENV === 'production') throw new Error('NODE_ENV=production is forbidden for load seed');
  if (env.APP_ENV !== 'staging') throw new Error('APP_ENV must be staging');
  if (env.LOAD_TEST_ENABLED !== 'true') throw new Error('LOAD_TEST_ENABLED must be true');
  if (env.K6_LOAD_APPROVED !== 'true') throw new Error('K6_LOAD_APPROVED must be true');
  if (env.PAYMENT_SANDBOX_ENABLED !== 'true') throw new Error('PAYMENT_SANDBOX_ENABLED must be true');

  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error('LOAD_TEST_TARGET_URL must be a valid HTTPS URL');
  }
  if (target.protocol !== 'https:') throw new Error('LOAD_TEST_TARGET_URL must use HTTPS');
  const allowed = hostSet(env.LOAD_TEST_ALLOWED_HOSTS);
  const production = new Set([
    ...hostSet(PRODUCTION_HOSTS),
    ...hostSet(env.LOAD_TEST_PRODUCTION_HOSTS),
  ]);
  const host = normalizeHost(target.hostname);
  if (!allowed.has(host)) throw new Error('Target host is not in LOAD_TEST_ALLOWED_HOSTS allowlist');
  if (isDeniedHost(host, production)) throw new Error('Target host is a production host');
  return target.origin;
}

function deterministicUuid(namespace, index) {
  const bytes = crypto.createHash('sha256').update(`${LOAD_SEED_VERSION}:${namespace}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildLoadRecords() {
  const lawyers = Array.from({ length: LOAD_DATASET.lawyers }, (_, index) => ({
    id: deterministicUuid('lawyer', index),
    email: `lawyer-${String(index).padStart(3, '0')}@${LOAD_DOMAIN}`,
    index,
  }));
  const clients = Array.from({ length: LOAD_DATASET.clients }, (_, index) => ({
    id: deterministicUuid('client', index),
    email: `client-${String(index).padStart(3, '0')}@${LOAD_DOMAIN}`,
    index,
  }));
  const statuses = ['payment_pending', 'pending', 'accepted', 'completed', 'cancelled'];
  const consultations = Array.from({ length: LOAD_DATASET.consultations }, (_, index) => {
    const client = clients[index % clients.length];
    const lawyer = lawyers[index % lawyers.length];
    return {
      id: deterministicUuid('consultation', index),
      clientId: client.id,
      lawyerId: lawyer.id,
      index,
      status: statuses[Math.floor(index / clients.length) % statuses.length],
    };
  });
  return { lawyers, clients, consultations };
}

function buildLoadManifest({ clients, lawyers, consultations }) {
  const clientEntries = clients.map((client) => {
    const owned = consultations.filter((consultation) => consultation.clientId === client.id);
    const checkout = owned.filter((consultation) => consultation.status === 'payment_pending');
    return {
      id: client.id,
      email: client.email,
      consultationIds: owned.map((consultation) => consultation.id),
      checkoutConsultationIds: checkout.map((consultation) => consultation.id),
    };
  });
  return {
    seedVersion: LOAD_SEED_VERSION,
    dataset: LOAD_DATASET,
    clients: clientEntries,
    lawyers: lawyers.map(({ id, email }) => ({ id, email })),
    consultations: consultations.map(({ id, clientId, lawyerId, status }) => ({
      id, clientId, lawyerId, status,
    })),
  };
}

async function cleanupLoadData(options = {}) {
  const transaction = options.transaction;
  const users = await User.findAll({
    where: { email: { [Op.like]: `%@${LOAD_DOMAIN}` } },
    attributes: ['id'],
    transaction,
    raw: true,
  });
  const userIds = users.map(({ id }) => id);
  if (!userIds.length) return { users: 0, consultations: 0 };

  const consultations = await Consultation.findAll({
    where: { [Op.or]: [{ clientId: { [Op.in]: userIds } }, { lawyerId: { [Op.in]: userIds } }] },
    attributes: ['id'], transaction, raw: true,
  });
  const consultationIds = consultations.map(({ id }) => id);
  if (consultationIds.length) {
    await Message.destroy({ where: { consultationId: { [Op.in]: consultationIds } }, transaction });
    await Payment.destroy({ where: { consultationId: { [Op.in]: consultationIds } }, transaction });
    await Consultation.destroy({ where: { id: { [Op.in]: consultationIds } }, transaction });
  }
  await LawyerProfile.destroy({ where: { userId: { [Op.in]: userIds } }, transaction });
  await User.destroy({ where: { id: { [Op.in]: userIds } }, transaction });
  return { users: userIds.length, consultations: consultationIds.length };
}

async function seedLoadData(env = process.env) {
  assertLoadSeedEnvironment(env);
  const password = String(env.LOAD_TEST_PASSWORD || '');
  if (password.length < 16) throw new Error('LOAD_TEST_PASSWORD must contain at least 16 characters');
  await sequelize.authenticate();
  await assertDatabaseIdentity(env);
  const passwordHash = await bcrypt.hash(password, 12);

  return sequelize.transaction(async (transaction) => {
    await cleanupLoadData({ transaction });
    const records = buildLoadRecords();
    const lawyers = [];
    const clients = [];
    const consultations = [];

    for (const record of records.lawyers) {
      const { email, id, index } = record;
      const [lawyer] = await User.findOrCreate({
        where: { email },
        defaults: {
          id, email, password: passwordHash,
          name: `Load Lawyer ${index}`, role: 'lawyer', accountType: 'member',
          preferredMode: 'lawyer', isVerified: true, isActive: true,
        },
        hooks: false,
        transaction,
      });
      await LawyerProfile.findOrCreate({
        where: { userId: lawyer.id },
        defaults: {
          userId: lawyer.id, specialization: 'Гражданское право',
          specializations: ['Гражданское право'], description: 'Synthetic staging load profile',
          experience: 5 + (index % 15), price: 200000 + ((index % 5) * 50000),
          rating: 4.5, reviewsCount: 20, completedCases: 50,
          location: 'Ташкент', languages: ['Русский', 'Узбекский'],
          isAvailable: true, verificationStatus: 'approved',
        },
        transaction,
      });
      lawyers.push({ id: lawyer.id, email: lawyer.email });
    }

    for (const record of records.clients) {
      const { email, id, index } = record;
      const [client] = await User.findOrCreate({
        where: { email },
        defaults: {
          id, email, password: passwordHash,
          name: `Load Client ${index}`, role: 'client', accountType: 'member',
          preferredMode: 'client', isVerified: true, isActive: true,
        },
        hooks: false,
        transaction,
      });
      clients.push({ id: client.id, email: client.email });
    }

    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const lawyersById = new Map(lawyers.map((lawyer) => [lawyer.id, lawyer]));
    for (const record of records.consultations) {
      const { id, index, status } = record;
      const client = clientsById.get(record.clientId);
      const lawyer = lawyersById.get(record.lawyerId);
      const [consultation] = await Consultation.findOrCreate({
        where: { id },
        defaults: {
          id, clientId: client.id, lawyerId: lawyer.id, type: index % 3 === 0 ? 'chat' : 'video',
          status, question: `Synthetic load consultation ${index}`,
          preferredDate: '2030-01-15', preferredTime: '10:00', duration: 60,
          price: 250000, billingStatus: 'none',
        },
        transaction,
      });
      await Message.findOrCreate({
        where: { id: deterministicUuid('message', index) },
        defaults: {
          id: deterministicUuid('message', index), consultationId: consultation.id,
          senderId: client.id, text: `Synthetic load message ${index}`, isRead: true,
        },
        transaction,
      });
      consultations.push({
        id: consultation.id, clientId: client.id, lawyerId: lawyer.id, status,
      });
    }

    return buildLoadManifest({ clients, lawyers, consultations });
  });
}

async function verifyLoadData(env = process.env) {
  assertLoadSeedEnvironment(env);
  await sequelize.authenticate();
  await assertDatabaseIdentity(env);
  const records = buildLoadRecords();
  const users = await User.findAll({
    where: { email: { [Op.like]: `%@${LOAD_DOMAIN}` } },
    attributes: ['id', 'email'],
    raw: true,
  });
  if (users.length !== LOAD_DATASET.lawyers + LOAD_DATASET.clients) {
    throw new Error('Load verification found an incorrect reserved user count');
  }
  const expectedEmails = new Set([...records.lawyers, ...records.clients].map(({ email }) => email));
  if (users.some(({ email }) => !expectedEmails.has(email))) throw new Error('Load verification found an unexpected reserved user');
  const consultationIds = records.consultations.map(({ id }) => id);
  const consultationCount = await Consultation.count({ where: { id: { [Op.in]: consultationIds } } });
  if (consultationCount !== LOAD_DATASET.consultations) throw new Error('Load verification found an incorrect consultation count');
  const duplicates = await Payment.findAll({
    where: { consultationId: { [Op.in]: consultationIds } },
    attributes: ['consultationId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['consultationId'],
    having: sequelize.where(sequelize.fn('COUNT', sequelize.col('id')), { [Op.gt]: 1 }),
    raw: true,
  });
  if (duplicates.length) throw new Error(`Load verification found duplicate checkout objects for ${duplicates.length} consultations`);
  return { ...LOAD_DATASET, duplicatePayments: 0 };
}

async function main() {
  const command = process.argv[2];
  if (!['seed', 'cleanup', 'verify'].includes(command)) throw new Error('Usage: node src/seeds/load-seed.js seed|cleanup|verify [manifest-path]');
  assertLoadSeedEnvironment(process.env);
  if (command === 'cleanup') {
    await sequelize.authenticate();
    await assertDatabaseIdentity(process.env);
    const result = await sequelize.transaction((transaction) => cleanupLoadData({ transaction }));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'verify') {
    process.stdout.write(`${JSON.stringify(await verifyLoadData(process.env))}\n`);
    return;
  }
  const manifest = await seedLoadData(process.env);
  const manifestPath = process.argv[3];
  if (manifestPath) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ seedVersion: manifest.seedVersion, dataset: manifest.dataset })}\n`);
}

module.exports = {
  LOAD_DATASET,
  LOAD_SEED_VERSION,
  assertLoadSeedEnvironment,
  buildLoadRecords,
  buildLoadManifest,
  cleanupLoadData,
  assertDatabaseIdentity,
  deterministicUuid,
  seedLoadData,
  verifyLoadData,
};

if (require.main === module) {
  main().then(() => sequelize.close()).catch(async (error) => {
    process.stderr.write(`Load seed failed: ${error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
}
