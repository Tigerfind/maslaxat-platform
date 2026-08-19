const crypto = require('crypto');
const express = require('express');
const { Op } = require('sequelize');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const {
  sequelize, User, Consultation, Message, Payment,
} = require('../models');

const DEFAULT_PRODUCTION_HOSTS = 'maslaxat.uz,www.maslaxat.uz,app.maslaxat.uz,api.maslaxat.uz';
const clientAccess = authorizeCompat({ legacyRoles: ['client', 'lawyer'], capability: 'client', telemetryName: 'http.client' });
const LOAD_PROFILES = Object.freeze({
  smoke: { maxRps: 1, durationSeconds: 60, maxVUs: 1 },
  baseline: { maxRps: 20, durationSeconds: 17 * 60, maxVUs: 25 },
  spike: { maxRps: 50, durationSeconds: 2 * 60, maxVUs: 60 },
});

function hostSet(value) {
  return new Set(String(value || '').split(',').map(normalizeHost).filter(Boolean));
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

function isDeniedHost(host, deniedHosts) {
  return [...deniedHosts].some((denied) => host === denied || host.endsWith(`.${denied}`));
}

function assertLoadTestEnvironment(env = process.env, requestHost) {
  if (env.NODE_ENV === 'production') throw new Error('NODE_ENV=production is forbidden for load routes');
  if (env.APP_ENV !== 'staging') throw new Error('APP_ENV must be staging');
  if (env.LOAD_TEST_ENABLED !== 'true') throw new Error('LOAD_TEST_ENABLED must be true');
  if (env.K6_LOAD_APPROVED !== 'true') throw new Error('K6_LOAD_APPROVED must be true');
  if (env.PAYMENT_SANDBOX_ENABLED !== 'true') throw new Error('PAYMENT_SANDBOX_ENABLED must be true');
  const host = normalizeHost(requestHost);
  const allowed = hostSet(env.LOAD_TEST_ALLOWED_HOSTS);
  const production = new Set([
    ...hostSet(DEFAULT_PRODUCTION_HOSTS),
    ...hostSet(env.LOAD_TEST_PRODUCTION_HOSTS),
  ]);
  if (!host || !allowed.has(host)) throw new Error('Request host is not in LOAD_TEST_ALLOWED_HOSTS allowlist');
  if (isDeniedHost(host, production)) throw new Error('Request host is a production host');
  return true;
}

function validRunId(runId) {
  const normalized = String(runId || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{5,39}$/.test(normalized)) {
    throw new Error('Valid load-test runId is required');
  }
  return normalized;
}

function effectivePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildLoadCapacity(env = process.env, requestedProfile) {
  const profile = String(requestedProfile || '');
  const shape = LOAD_PROFILES[profile];
  if (!shape) throw new Error('Valid load-test profile is required');

  const globalWindowMs = effectivePositiveInteger(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  const globalMax = effectivePositiveInteger(env.RATE_LIMIT_MAX, 1000);
  const authMax = effectivePositiveInteger(env.AUTH_RATE_LIMIT_MAX, 20);
  const requestsInWindow = Math.ceil(
    shape.maxRps * Math.min(shape.durationSeconds, globalWindowMs / 1000),
  );
  const required = {
    globalMax: requestsInWindow + shape.maxVUs + 2,
    authMax: shape.maxVUs,
  };
  const effective = {
    globalMax,
    authMax,
    globalWindowMs,
    globalLimiterEnabled: env.NODE_ENV !== 'development',
    authSkipsSuccessfulRequests: true,
  };
  const reasons = [];
  if (!effective.globalLimiterEnabled) reasons.push('Global API rate limiter must remain enabled');
  if (globalMax < required.globalMax) reasons.push('RATE_LIMIT_MAX is below the safe profile capacity');
  if (authMax < required.authMax) reasons.push('AUTH_RATE_LIMIT_MAX is below the safe VU login capacity');
  return {
    profile, safe: reasons.length === 0, shape, required, effective, reasons,
  };
}

async function verifyCheckoutBusinessObjects(PaymentModel, requestedRunId) {
  const runId = validRunId(requestedRunId);
  const rows = await PaymentModel.findAll({
    where: { idempotencyKey: { [Op.like]: `load:${runId}:checkout:%` } },
    attributes: ['id', 'userId', 'idempotencyKey'],
    raw: true,
  });
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.userId}:${row.idempotencyKey}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicateCounts = [...counts.values()].filter((count) => count > 1);
  return {
    runId,
    checkoutBusinessObjects: rows.length,
    duplicateBusinessObjects: duplicateCounts.reduce((total, count) => total + count - 1, 0),
    duplicateKeys: duplicateCounts.length,
  };
}

function runIdFromKey(key, kind) {
  const match = String(key || '').match(new RegExp(`^load:([A-Za-z0-9][A-Za-z0-9.-]{5,39}):${kind}:`));
  if (!match) throw new Error(`Idempotency-Key must be owned by a load ${kind} run`);
  return validRunId(match[1]);
}

function runConsultationMarker(runId) {
  return `Synthetic k6 consultation run=${validRunId(runId)}`;
}

async function cleanupRunObjects(models, requestedRunId) {
  const runId = validRunId(requestedRunId);
  return models.sequelize.transaction(async (transaction) => {
    const payments = await models.Payment.findAll({
      where: { idempotencyKey: { [Op.like]: `load:${runId}:checkout:%` } },
      attributes: ['id', 'status', 'providerData'],
      transaction,
      raw: true,
    });
    if (payments.some((payment) => (
      payment.status !== 'pending'
      || payment.providerData?.sandbox !== true
      || payment.providerData?.loadTest !== true
    ))) {
      throw new Error('Run cleanup refused an unsafe payment row');
    }

    const consultations = await models.Consultation.findAll({
      where: { question: runConsultationMarker(runId) },
      attributes: ['id', 'status'],
      transaction,
      raw: true,
    });
    if (consultations.some((consultation) => consultation.status !== 'payment_pending')) {
      throw new Error('Run cleanup refused an unsafe consultation row');
    }

    const paymentIds = payments.map(({ id }) => id);
    const consultationIds = consultations.map(({ id }) => id);
    const paymentsDeleted = paymentIds.length
      ? await models.Payment.destroy({ where: { id: { [Op.in]: paymentIds } }, transaction })
      : 0;
    const messagesDeleted = consultationIds.length
      ? await models.Message.destroy({ where: { consultationId: { [Op.in]: consultationIds } }, transaction })
      : 0;
    const consultationsDeleted = consultationIds.length
      ? await models.Consultation.destroy({ where: { id: { [Op.in]: consultationIds } }, transaction })
      : 0;
    return {
      runId, paymentsDeleted, messagesDeleted, consultationsDeleted,
    };
  });
}

function idFromKey(namespace, userId, key) {
  const bytes = crypto.createHash('sha256').update(`${namespace}:${userId}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function idempotencyKey(req, res) {
  const key = String(req.get('Idempotency-Key') || '');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    res.status(400).json({ error: 'Valid Idempotency-Key is required' });
    return null;
  }
  return key;
}

function isSyntheticLoadUser(user) {
  return /^[^@]+@load\.test$/i.test(String(user?.email || ''));
}

function createLoadTestRouter(dependencies = {}) {
  const models = dependencies.models || {
    sequelize, User, Consultation, Message, Payment,
  };
  const router = express.Router();

  router.use((req, res, next) => {
    try {
      assertLoadTestEnvironment(process.env, req.hostname || req.get('host'));
      next();
    } catch (error) {
      res.status(403).json({ error: error.message });
    }
  });
  router.use(authenticate, clientAccess);
  router.use((req, res, next) => {
    if (!isSyntheticLoadUser(req.user)) {
      return res.status(403).json({ error: 'Synthetic load user is required' });
    }
    return next();
  });

  router.get('/preflight', (req, res) => {
    try {
      const capacity = buildLoadCapacity(process.env, req.query.profile);
      return res.status(capacity.safe ? 200 : 409).json(capacity);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/consultations', async (req, res, next) => {
    try {
      const key = idempotencyKey(req, res);
      if (!key) return;
      const runId = runIdFromKey(key, 'consultation');
      const lawyer = await models.User.findOne({
        where: { id: req.body.lawyerId, email: { [Op.like]: '%@load.test' }, role: 'lawyer' },
        attributes: ['id'],
      });
      if (!lawyer) return res.status(400).json({ error: 'Synthetic lawyer is required' });
      const id = idFromKey('consultation', req.userId, key);
      const [consultation, created] = await models.Consultation.findOrCreate({
        where: { id },
        defaults: {
          id, clientId: req.userId, lawyerId: lawyer.id, type: 'chat', status: 'payment_pending',
          question: runConsultationMarker(runId), preferredDate: '2030-01-15', preferredTime: '10:00',
          duration: 60, price: 250000, billingStatus: 'none',
        },
      });
      return res.status(created ? 201 : 200).json({ consultationId: consultation.id, created });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/checkouts', async (req, res, next) => {
    try {
      const key = idempotencyKey(req, res);
      if (!key) return;
      runIdFromKey(key, 'checkout');
      const consultation = await models.Consultation.findOne({
        where: { id: req.body.consultationId, clientId: req.userId, status: 'payment_pending' },
      });
      if (!consultation) return res.status(404).json({ error: 'Synthetic checkout consultation not found' });

      const where = { userId: req.userId, idempotencyKey: key };
      let payment;
      let created;
      try {
        [payment, created] = await models.Payment.findOrCreate({
          where,
          defaults: {
            consultationId: consultation.id, userId: req.userId, idempotencyKey: key,
            purpose: 'consultation', amount: consultation.price, amountTiyin: consultation.price * 100,
            currency: 'UZS', provider: 'payme', status: 'pending',
            providerData: { sandbox: true, loadTest: true },
          },
        });
      } catch (error) {
        if (error.name !== 'SequelizeUniqueConstraintError') throw error;
        payment = await models.Payment.findOne({ where });
        created = false;
      }
      const businessObjectCount = await models.Payment.count({ where });
      return res.status(created ? 201 : 200).json({
        paymentId: payment.id,
        created,
        businessObjectCount,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/verify', async (req, res, next) => {
    try {
      const result = await verifyCheckoutBusinessObjects(models.Payment, req.query.runId);
      return res.json(result);
    } catch (error) {
      if (/runId/.test(error.message)) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.delete('/runs/:runId', async (req, res, next) => {
    try {
      return res.json(await cleanupRunObjects(models, req.params.runId));
    } catch (error) {
      if (/runId|cleanup refused/i.test(error.message)) {
        return res.status(409).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = createLoadTestRouter();
module.exports.assertLoadTestEnvironment = assertLoadTestEnvironment;
module.exports.buildLoadCapacity = buildLoadCapacity;
module.exports.cleanupRunObjects = cleanupRunObjects;
module.exports.createLoadTestRouter = createLoadTestRouter;
module.exports.idFromKey = idFromKey;
module.exports.isSyntheticLoadUser = isSyntheticLoadUser;
module.exports.verifyCheckoutBusinessObjects = verifyCheckoutBusinessObjects;
