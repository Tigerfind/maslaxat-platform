const SAFE_DATABASE_PATTERN = /(?:^|[_-])(test|e2e|staging)(?:$|[_-])/i;
const PRODUCTION_DATABASE_PATTERN = /(?:^|[_-])(prod|production|live)(?:$|[_-])/i;
const crypto = require('node:crypto');

const PASSWORD = 'E2e-pass-123!';
const BACKUP_CODE = 'TASK-7001';

function databaseIdentity(env = process.env) {
  if (env.DATABASE_URL) {
    try {
      return decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''));
    } catch {
      throw new Error('E2E database URL is invalid');
    }
  }
  return env.DB_NAME || '';
}

function assertSafeEnvironment(env = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('E2E seed refuses production');
  if (!['test', 'staging'].includes(env.NODE_ENV)) {
    throw new Error('E2E seed requires NODE_ENV test or staging');
  }
  const database = databaseIdentity(env);
  if (PRODUCTION_DATABASE_PATTERN.test(database)) {
    throw new Error('E2E seed refuses a production-like database name');
  }
  if (!database || !SAFE_DATABASE_PATTERN.test(database)) {
    throw new Error('E2E seed requires a test, e2e, or staging database name');
  }
  if (!env.E2E_CONFIRM_DATABASE || env.E2E_CONFIRM_DATABASE !== database) {
    throw new Error('E2E database confirmation must exactly match the configured database');
  }
  const runId = String(env.E2E_RUN_ID || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(runId)) {
    throw new Error('E2E_RUN_ID must be a safe 3-64 character identifier');
  }
  return { database, runId };
}

function deterministicUuid(runId, label) {
  const hex = crypto.createHash('sha256').update(`${runId}:${label}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function dataset(runId) {
  const actors = {
    client: { role: 'client', preferredMode: 'client', name: 'E2E Client' },
    otherClient: { role: 'client', preferredMode: 'client', name: 'E2E Other Client' },
    lawyer: { role: 'lawyer', preferredMode: 'lawyer', name: 'E2E Lawyer', profile: 'approved', mfa: true },
    otherLawyer: { role: 'lawyer', preferredMode: 'lawyer', name: 'E2E Other Lawyer', profile: 'approved', mfa: true },
    applicant: { role: 'lawyer', preferredMode: 'lawyer', name: 'E2E Applicant', profile: 'pending' },
    importer: { role: 'lawyer', preferredMode: 'lawyer', name: 'E2E Importer', profile: 'pending' },
    dualMember: { role: 'lawyer', preferredMode: 'client', name: 'E2E Dual Member', profile: 'approved', mfa: true },
    mfaLawyer: { role: 'lawyer', preferredMode: 'lawyer', name: 'E2E MFA Lawyer', profile: 'approved', mfa: true },
    admin: { role: 'admin', accountType: 'admin', preferredMode: null, name: 'E2E Admin', mfa: true },
  };
  for (const [key, actor] of Object.entries(actors)) {
    actor.id = deterministicUuid(runId, `actor:${key}`);
    actor.email = `${runId}.${key.toLowerCase()}@e2e.maslaxat.invalid`;
    actor.password = PASSWORD;
    if (actor.mfa) {
      actor.backupCode = BACKUP_CODE;
      actor.totpSecret = 'JBSWY3DPEHPK3PXP';
    }
  }
  return {
    runId,
    actors,
    resources: {
      consultationId: deterministicUuid(runId, 'consultation:owned'),
      otherConsultationId: deterministicUuid(runId, 'consultation:other'),
      promotionId: deterministicUuid(runId, 'promotion'),
      refundPromotionId: deterministicUuid(runId, 'promotion:refund'),
      refundPaymentId: deterministicUuid(runId, 'payment:refund'),
      importId: deterministicUuid(runId, 'import'),
      documentId: deterministicUuid(runId, 'document'),
      applicantDocumentId: deterministicUuid(runId, 'document:applicant'),
      packageId: deterministicUuid(runId, 'promotion-package'),
    },
  };
}

async function loadModels() {
  return require('../models');
}

async function cleanup({ env = process.env, models } = {}) {
  const { runId } = assertSafeEnvironment(env);
  const state = dataset(runId);
  const db = models || await loadModels();
  const actorIds = Object.values(state.actors).map(({ id }) => id);
  const { Op } = require('sequelize');
  const registrationPattern = `${runId}.registration.%@e2e.maslaxat.invalid`;
  const existing = await db.User.findAll({ where: { [Op.or]: [{ id: actorIds }, { email: { [Op.like]: registrationPattern } }] } });
  for (const user of existing) {
    const seeded = actorIds.includes(user.id) && user.settings?.e2eRunId === runId;
    const registered = user.email.startsWith(`${runId}.registration.`) && user.email.endsWith('@e2e.maslaxat.invalid');
    if (!user.email.endsWith('@e2e.maslaxat.invalid') || (!seeded && !registered)) {
      throw new Error(`E2E cleanup refused untagged user collision ${user.id}`);
    }
  }
  if (typeof db.PromotionPackage.findByPk === 'function') {
    const promotionPackage = await db.PromotionPackage.findByPk(state.resources.packageId);
    if (promotionPackage && promotionPackage.code !== `E2E-${runId}`) {
      throw new Error(`E2E cleanup refused resource collision ${promotionPackage.id}`);
    }
  }
  const ownedUserIds = [...new Set([...actorIds, ...existing.map(({ id }) => id)])];
  if (typeof db.LawyerProfileImport.findAll === 'function') {
    const imports = await db.LawyerProfileImport.findAll({ where: { userId: ownedUserIds } });
    const unsafeImport = imports.find((record) => record.storageKey
      && !(record.id === state.resources.importId && record.storageKey === `e2e/${runId}/linkedin.pdf`));
    if (unsafeImport) throw new Error('E2E private imports require application cleanup before database cleanup');
  }
  if (typeof db.Document.findAll === 'function') {
    const documents = await db.Document.findAll({ where: { userId: ownedUserIds } });
    if (documents.some((record) => record.storageKey)) {
      throw new Error('E2E private documents require application cleanup before database cleanup');
    }
  }

  await db.sequelize.transaction(async (transaction) => {
    const options = { transaction };
    if (db.PlatformSettingAudit) {
      await db.PlatformSettingAudit.destroy({ where: { changedByUserId: ownedUserIds }, ...options });
    }
    await db.ProfileImportAudit.destroy({ where: { ownerUserId: ownedUserIds }, ...options });
    await db.LawyerProfileImport.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.Message.destroy({ where: { consultationId: [state.resources.consultationId, state.resources.otherConsultationId] }, ...options });
    await db.Document.destroy({ where: { userId: ownedUserIds }, ...options });
    if (typeof db.LawyerPromotion.update === 'function') {
      await db.LawyerPromotion.update({ paymentId: null }, { where: { lawyerId: ownedUserIds }, ...options });
    }
    await db.Payment.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.LawyerPromotion.destroy({ where: { lawyerId: ownedUserIds }, ...options });
    await db.Consultation.destroy({ where: { id: [state.resources.consultationId, state.resources.otherConsultationId] }, ...options });
    await db.AuthChallenge.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.Notification.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.Subscription.destroy({ where: { userId: ownedUserIds }, ...options });
    if (db.LawyerDocument) await db.LawyerDocument.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.LawyerProfile.destroy({ where: { userId: ownedUserIds }, ...options });
    await db.User.destroy({ where: { id: ownedUserIds }, ...options });
    await db.PromotionPackage.destroy({ where: { id: state.resources.packageId, code: `E2E-${runId}` }, ...options });
  });
  return { cleaned: true, runId };
}

async function seed({ env = process.env, models } = {}) {
  const { runId } = assertSafeEnvironment(env);
  const db = models || await loadModels();
  await cleanup({ env, models: db });
  const state = dataset(runId);
  const tag = { e2eRunId: runId, synthetic: true };

  await db.sequelize.transaction(async (transaction) => {
    for (const actor of Object.values(state.actors)) {
      await db.User.create({
        id: actor.id,
        email: actor.email,
        password: actor.password,
        name: actor.name,
        role: actor.role,
        accountType: actor.accountType || 'member',
        preferredMode: actor.preferredMode,
        isVerified: true,
        isActive: true,
        settings: tag,
        twoFactorEnabled: Boolean(actor.mfa),
        twoFactorSecret: actor.mfa ? 'JBSWY3DPEHPK3PXP' : null,
        twoFactorBackupCodes: actor.mfa
          ? [crypto.createHash('sha256').update(BACKUP_CODE).digest('hex')]
          : [],
      }, { transaction });
      if (actor.profile) {
        const approved = actor.profile === 'approved';
        await db.LawyerProfile.create({
          userId: actor.id,
          specialization: 'Гражданское право',
          specializations: ['Гражданское право'],
          description: `${actor.name} synthetic profile`,
          headline: 'E2E legal professional',
          experience: 7,
          price: 200000,
          location: 'Ташкент',
          isAvailable: approved,
          verificationStatus: approved ? 'approved' : 'pending',
          operatingStatus: approved ? 'enabled' : 'suspended',
          promotionPilotEnabled: approved,
          profileSources: approved ? { headline: { source: 'linkedin_pdf', verificationLevel: 'self_reported' } } : {},
        }, { transaction });
      }
    }

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const preferredDate = tomorrow.toISOString().slice(0, 10);
    await db.Consultation.bulkCreate([
      {
        id: state.resources.consultationId,
        clientId: state.actors.client.id,
        lawyerId: state.actors.lawyer.id,
        type: 'video', status: 'accepted', question: 'E2E consultation',
        preferredDate, preferredTime: '12:00', duration: 60, price: 200000,
      },
      {
        id: state.resources.otherConsultationId,
        clientId: state.actors.otherClient.id,
        lawyerId: state.actors.otherLawyer.id,
        type: 'chat', status: 'accepted', question: 'E2E private consultation',
        preferredDate, preferredTime: '13:00', duration: 60, price: 200000,
      },
    ], { transaction });
    await db.Message.create({
      consultationId: state.resources.consultationId,
      senderId: state.actors.lawyer.id,
      text: 'E2E seeded message',
    }, { transaction });
    await db.Document.create({
      id: state.resources.documentId,
      userId: state.actors.otherClient.id,
      name: 'private-e2e.txt', type: 'text/plain', mimeType: 'text/plain', size: 12,
      status: 'verified', category: 'Другое',
    }, { transaction });
    await db.LawyerProfileImport.create({
      id: state.resources.importId,
      userId: state.actors.applicant.id,
      status: 'draft',
      storageKey: `e2e/${runId}/linkedin.pdf`,
      uploadIdempotencyKey: `e2e-${runId}`,
      originalName: 'linkedin-profile.pdf',
      mimeType: 'application/pdf', size: 128,
      sha256: crypto.createHash('sha256').update(runId).digest('hex'),
      parsedData: {
        headline: 'Imported E2E lawyer', summary: 'Synthetic LinkedIn draft',
        positions: [], education: [], languages: ['ru', 'uz'], certificates: [],
        specializations: ['Гражданское право'],
      },
      parserVersion: 'e2e-seed', profileRevision: 1, version: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, { transaction });
    await db.PromotionPackage.create({
      id: state.resources.packageId,
      code: `E2E-${runId}`,
      name: { ru: 'E2E TOP', uz: 'E2E TOP', en: 'E2E TOP' },
      placement: 'catalog_top', durationDays: 7, priceAmountTiyin: 10000000,
      currency: 'UZS', maxActiveSlots: 2, sponsoredPositions: [0, 3], isActive: true,
    }, { transaction });
    for (const actorName of ['lawyer', 'otherLawyer', 'dualMember', 'mfaLawyer']) {
      await db.LawyerDocument.create({
        userId: state.actors[actorName].id,
        name: `${actorName}-license.pdf`, path: `/e2e/${runId}/${actorName}-license.pdf`,
        type: 'license', verificationStatus: 'approved',
        approvedByUserId: state.actors.admin.id, approvedAt: new Date(),
      }, { transaction });
    }
    await db.LawyerDocument.create({
      id: state.resources.applicantDocumentId,
      userId: state.actors.applicant.id,
      name: 'applicant-diploma.pdf', path: `/e2e/${runId}/applicant-diploma.pdf`,
      type: 'diploma', verificationStatus: 'approved',
      approvedByUserId: state.actors.admin.id, approvedAt: new Date(),
    }, { transaction });
    await db.LawyerPromotion.create({
      id: state.resources.promotionId,
      lawyerId: state.actors.lawyer.id,
      packageId: state.resources.packageId,
      idempotencyKey: `e2e-active-${runId}`,
      placement: 'catalog_top', specialization: 'Гражданское право', location: 'Ташкент',
      durationDays: 7, priceAmountTiyin: 10000000, currency: 'UZS',
      maxActiveSlots: 2, sponsoredPositions: [0, 3], status: 'active',
      paidAt: new Date(), startsAt: new Date(), activeSince: new Date(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      impressions: 3, profileViews: 2, bookingStarts: 1, bookings: 1,
    }, { transaction });
    const refundPaidAt = new Date();
    await db.LawyerPromotion.create({
      id: state.resources.refundPromotionId,
      lawyerId: state.actors.lawyer.id,
      packageId: state.resources.packageId,
      idempotencyKey: `e2e-refund-${runId}`,
      placement: 'catalog_top', specialization: 'E2E Refund Isolation', location: null,
      durationDays: 7, priceAmountTiyin: 10000000, currency: 'UZS',
      maxActiveSlots: 2, sponsoredPositions: [0, 3], status: 'paused',
      paidAt: refundPaidAt, pausedAt: refundPaidAt, remainingSeconds: 7 * 24 * 60 * 60,
    }, { transaction });
    await db.Payment.create({
      id: state.resources.refundPaymentId,
      userId: state.actors.lawyer.id,
      lawyerPromotionId: state.resources.refundPromotionId,
      purpose: 'lawyer_promotion', amount: 100000, amountTiyin: 10000000,
      currency: 'UZS', provider: 'payme', status: 'paid',
      idempotencyKey: `e2e-refund-${runId}`,
      providerTransactionId: `e2e-refund-${runId}`,
      paidAt: refundPaidAt,
      providerData: { sandbox: true, e2eRunId: runId },
    }, { transaction });
  });

  return state;
}

async function main() {
  const command = process.argv[2];
  const safe = assertSafeEnvironment(process.env);
  if (command === 'verify') {
    process.stdout.write(`${JSON.stringify({ safe: true, ...safe })}\n`);
    return;
  }
  if (command === 'describe') {
    process.stdout.write(`${JSON.stringify(dataset(safe.runId))}\n`);
    return;
  }
  if (!['seed', 'cleanup'].includes(command)) throw new Error('Usage: e2e-seed.js verify|describe|seed|cleanup');
  const result = command === 'seed'
    ? await seed({ env: process.env })
    : await cleanup({ env: process.env });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertSafeEnvironment, cleanup, databaseIdentity, dataset, deterministicUuid, main, seed };
