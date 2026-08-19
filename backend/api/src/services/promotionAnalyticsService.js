const crypto = require('crypto');
const { Op } = require('sequelize');
const { LawyerPromotion, Payment, Consultation } = require('../models');
const { getRedis } = require('../config/redis');
const { lawyerEligibility } = require('./promotionService');

const EVENT_FIELDS = Object.freeze({
  impression: 'impressions',
  profile_view: 'profileViews',
  booking_start: 'bookingStarts',
  booking: 'bookings',
});

function bounded(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 180) {
    const error = new Error(`${name} is invalid`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function tokenSecret() {
  return process.env.CATALOG_ATTRIBUTION_SECRET || process.env.CATALOG_CURSOR_SECRET || process.env.JWT_SECRET;
}

function issuePromotionAttributionToken({ promotionId, lawyerId, actorKey, sessionId, nonce, filterHash, now = new Date() }) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const body = Buffer.from(JSON.stringify({
    v: 1, p: promotionId, l: lawyerId, a: actorKey, s: sessionId, n: nonce, h: filterHash,
    iat: issuedAt, exp: issuedAt + 15 * 60, placement: 'sponsored',
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeAttributionToken(token, now = new Date()) {
  if (typeof token !== 'string' || token.length > 1500) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const current = Math.floor(now.getTime() / 1000);
    if (payload.v !== 1 || payload.placement !== 'sponsored' || !payload.p || !payload.l || !payload.a
      || !payload.s || !payload.n || typeof payload.h !== 'string' || payload.h.length !== 64
      || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
      || payload.iat > current + 30 || payload.exp < current || payload.exp - payload.iat > 15 * 60) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

async function validatePromotionAttribution({ attributionToken, actorKey, expectedLawyerId, now = new Date() }) {
  const payload = decodeAttributionToken(attributionToken, now);
  if (!payload || payload.a !== actorKey || payload.l !== expectedLawyerId) return null;
  const redis = getRedis();
  if (!redis) return null;
  let stored;
  try { stored = await redis.get(`catalog:session:${payload.s}`); } catch (_error) { return null; }
  if (!stored) return null;
  let session;
  try { session = JSON.parse(stored); } catch (_error) { return null; }
  const nonce = Number(payload.n);
  const entry = Number.isInteger(nonce) && nonce >= 0 ? session.entries?.[nonce] : null;
  if (session.actorKey !== actorKey || session.hash !== payload.h || !entry
    || entry.id !== expectedLawyerId || entry.promotionId !== payload.p || entry.placement !== 'sponsored') return null;
  const promotion = await LawyerPromotion.findOne({
    where: {
      id: payload.p,
      lawyerId: expectedLawyerId,
      placement: 'catalog_top',
      status: 'active',
      startsAt: { [Op.lte]: now },
      endsAt: { [Op.gt]: now },
    },
    include: [{ model: Payment, as: 'payment', required: true, where: { status: 'paid' } }],
  });
  if (!promotion) return null;
  const eligibility = await lawyerEligibility(expectedLawyerId, promotion, null);
  return eligibility.eligible ? { payload, promotion } : null;
}

async function recordPromotionEvent({ attributionToken, event, actorKey, requestId, expectedLawyerId, consultationId = null }) {
  const field = EVENT_FIELDS[event];
  if (!field) {
    const error = new Error('Unsupported promotion event');
    error.status = 400;
    throw error;
  }
  const cleanActorKey = bounded(actorKey, 'actorKey');
  const cleanRequestId = bounded(requestId, 'requestId');
  const validated = await validatePromotionAttribution({ attributionToken, actorKey: cleanActorKey, expectedLawyerId });
  if (!validated) return { recorded: false, reason: 'invalid_attribution' };
  const cleanPromotionId = validated.payload.p;
  if (event === 'booking') {
    if (!consultationId) return { recorded: false, reason: 'invalid_consultation' };
    const consultation = await Consultation.findOne({ where: { id: consultationId, lawyerId: expectedLawyerId } });
    if (!consultation) return { recorded: false, reason: 'invalid_consultation' };
  }
  const redis = getRedis();
  if (!redis) return { recorded: false, reason: 'redis_unavailable' };

  const digest = crypto.createHash('sha256')
    .update(`${validated.payload.s}\0${validated.payload.n}\0${event}\0${cleanPromotionId}\0${cleanActorKey}`)
    .digest('hex');
  let acquired;
  try {
    acquired = await redis.set(`promotion:event:${digest}`, '1', { NX: true, EX: 7 * 24 * 60 * 60 });
  } catch (_error) {
    return { recorded: false, reason: 'redis_unavailable' };
  }
  if (!acquired) return { recorded: false, reason: 'duplicate' };

  const where = { id: cleanPromotionId, lawyerId: expectedLawyerId };
  const [updated] = await LawyerPromotion.increment(field, { by: 1, where });
  return { recorded: Number(updated) > 0, reason: Number(updated) > 0 ? null : 'not_found' };
}

module.exports = {
  EVENT_FIELDS,
  issuePromotionAttributionToken,
  decodeAttributionToken,
  validatePromotionAttribution,
  recordPromotionEvent,
};
