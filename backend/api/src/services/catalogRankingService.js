const crypto = require('crypto');
const { toPublicLawyerDto } = require('./publicLawyerDto');
const { Op, literal } = require('sequelize');
const {
  User,
  LawyerProfile,
  LawyerDocument,
  LawyerPromotion,
  Payment,
} = require('../models');
const { getRedis } = require('../config/redis');
const { issuePromotionAttributionToken, recordPromotionEvent } = require('./promotionAnalyticsService');
const { getAuthorizationMode } = require('./authorizationRuntime');

const SESSION_SECONDS = 15 * 60;
const MAX_PAGE_SIZE = 50;
const MAX_SNAPSHOT_IDS = 500;
const LIVE_SCAN_CHUNK = 10;
const ROTATION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_NEXT_RANK_RETRIES = 10;
const VALID_SORTS = new Set(['rating', 'price_low', 'price_high', 'experience']);
const STRING_LIMITS = { specialization: 600, search: 100, location: 120, language: 30 };

function catalogError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeFilters(input = {}) {
  const normalized = {};
  for (const [name, max] of Object.entries(STRING_LIMITS)) {
    if (input[name] === undefined || input[name] === null || input[name] === '') continue;
    const value = String(input[name]).trim();
    if (!value || value.length > max) throw catalogError(`Invalid ${name}`, 400, 'CATALOG_FILTER_INVALID');
    normalized[name] = value;
  }
  if (normalized.specialization) {
    const specs = [...new Set(normalized.specialization.split(',').map((value) => value.trim()).filter(Boolean))];
    if (!specs.length || specs.length > 10 || specs.some((value) => value.length > 120)) {
      throw catalogError('Invalid specialization', 400, 'CATALOG_FILTER_INVALID');
    }
    normalized.specialization = specs.join(',');
  }
  for (const name of ['minRating', 'minPrice', 'maxPrice']) {
    if (input[name] === undefined || input[name] === '') continue;
    const value = Number(input[name]);
    if (!Number.isFinite(value) || value < 0) throw catalogError(`Invalid ${name}`, 400, 'CATALOG_FILTER_INVALID');
    if (name === 'minRating' && value === 0) continue;
    normalized[name] = value;
  }
  normalized.onlineOnly = input.onlineOnly === true || input.onlineOnly === 'true';
  normalized.sortBy = input.sortBy || 'rating';
  if (!VALID_SORTS.has(normalized.sortBy)) throw catalogError('Invalid sortBy', 400, 'CATALOG_FILTER_INVALID');
  return normalized;
}

function filterHash(filters) {
  return crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

function profileWhereFor(filters, authorizationMode = getAuthorizationMode()) {
  const where = { verificationStatus: 'approved' };
  if (authorizationMode === 'capability_only') where.operatingStatus = 'enabled';
  if (filters.specialization) where.specializations = { [Op.overlap]: filters.specialization.split(',') };
  if (filters.location) where.location = filters.location;
  if (filters.language) where.languages = { [Op.contains]: [filters.language] };
  if (filters.onlineOnly) where.isAvailable = true;
  if (filters.minRating !== undefined) {
    where.rating = { [Op.gte]: filters.minRating };
  }
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {};
    if (filters.minPrice !== undefined) where.price[Op.gte] = filters.minPrice;
    if (filters.maxPrice !== undefined) where.price[Op.lte] = filters.maxPrice;
  }
  return where;
}

function userWhereFor(filters, authorizationMode = getAuthorizationMode()) {
  const where = authorizationMode === 'capability_only'
    ? { accountType: 'member', isActive: true, twoFactorEnabled: true }
    : { role: 'lawyer', isActive: true };
  if (filters.search) where.name = { [Op.iLike]: `%${filters.search}%` };
  return where;
}

function orderFor(sortBy) {
  const onlineFirst = [{ model: LawyerProfile, as: 'profile' }, 'isAvailable', 'DESC'];
  const sort = {
    rating: [[{ model: LawyerProfile, as: 'profile' }, 'rating', 'DESC']],
    price_low: [[{ model: LawyerProfile, as: 'profile' }, 'price', 'ASC']],
    price_high: [[{ model: LawyerProfile, as: 'profile' }, 'price', 'DESC']],
    experience: [[{ model: LawyerProfile, as: 'profile' }, 'experience', 'DESC']],
  }[sortBy];
  return [onlineFirst, ...sort, ['id', 'ASC']];
}

function lawyerQuery(filters, extra = {}) {
  const { where: extraWhere = {}, ...options } = extra;
  return {
    where: { ...userWhereFor(filters), ...extraWhere },
    attributes: ['id', 'name', 'avatar', 'role', 'isVerified', 'createdAt'],
    include: [{ model: LawyerProfile, as: 'profile', where: profileWhereFor(filters), required: true }],
    order: orderFor(filters.sortBy),
    ...options,
  };
}

function cursorSecret() {
  return process.env.CATALOG_CURSOR_SECRET || process.env.JWT_SECRET;
}

function encodeCursor(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', cursorSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 1000) throw catalogError('Invalid catalog cursor', 400, 'CATALOG_CURSOR_INVALID');
  const [body, signature, extra] = cursor.split('.');
  if (!body || !signature || extra) throw catalogError('Invalid catalog cursor', 400, 'CATALOG_CURSOR_INVALID');
  const expected = crypto.createHmac('sha256', cursorSecret()).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch (_error) { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw catalogError('Invalid catalog cursor', 400, 'CATALOG_CURSOR_INVALID');
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.s !== 'string' || payload.s.length > 80
      || !Number.isInteger(payload.o) || payload.o < 0 || payload.o > MAX_SNAPSHOT_IDS
      || typeof payload.h !== 'string' || payload.h.length !== 64
      || typeof payload.a !== 'string' || payload.a.length !== 43) throw new Error('invalid');
    return payload;
  } catch (_error) {
    throw catalogError('Invalid catalog cursor', 400, 'CATALOG_CURSOR_INVALID');
  }
}

async function organicPage(filters, pageSize, offset = 0) {
  const { count, rows } = await User.findAndCountAll(lawyerQuery(filters, {
    limit: pageSize,
    offset: Math.min(offset, MAX_SNAPSHOT_IDS),
    distinct: true,
  }));
  return {
    lawyers: rows.map(toPublicLawyerDto),
    cursor: null,
    total: count,
    totalPages: Math.ceil(count / pageSize),
  };
}

async function getCatalogEligibilityCandidates(input = {}) {
  const filters = normalizeFilters(input);
  const where = { isActive: true };
  if (filters.search) where.name = { [Op.iLike]: `%${filters.search}%` };
  return User.findAll({
    where,
    attributes: ['id', 'role', 'accountType', 'isActive', 'twoFactorEnabled'],
    include: [{
      model: LawyerProfile,
      as: 'profile',
      where: profileWhereFor(filters, 'compatibility'),
      required: true,
    }],
  });
}

function campaignMatchesScope(campaign, filters) {
  if (filters.specialization && !filters.specialization.split(',').includes(campaign.specialization)) return false;
  if (filters.location && campaign.location && campaign.location !== filters.location) return false;
  return true;
}

function profilePromotionEligible(profile, campaign, licensed) {
  return Boolean(profile && profile.promotionPilotEnabled && profile.isAvailable
    && String(profile.description || '').trim().length >= 50 && Number(profile.price) >= 50000
    && Array.isArray(profile.specializations) && profile.specializations.includes(campaign.specialization)
    && profile.schedule && Object.values(profile.schedule).some((day) => day?.enabled)
    && licensed);
}

function campaignWhere(now) {
  return {
    placement: 'catalog_top', status: 'active',
    startsAt: { [Op.lte]: now }, endsAt: { [Op.gt]: now },
  };
}

function scopedCampaignWhere(now, filters, position = null) {
  const where = campaignWhere(now);
  if (filters.specialization) where.specialization = { [Op.in]: filters.specialization.split(',') };
  if (filters.location) where[Op.or] = [{ location: null }, { location: filters.location }];
  if (position !== null) where.sponsoredPositions = { [Op.contains]: [position] };
  return where;
}

function validPositions(campaign, pageSize) {
  return [...new Set((campaign?.sponsoredPositions || []).filter((position) => Number.isInteger(position)
    && position >= 0 && position < pageSize && position < 20))].sort((a, b) => a - b).slice(0, 2);
}

function eligibleCampaignQuery(filters, position, now) {
  const profileWhere = {
    ...profileWhereFor(filters),
    isAvailable: true,
    promotionPilotEnabled: true,
    description: { [Op.ne]: null },
    price: {
      [Op.gte]: Math.max(50000, Number(filters.minPrice || 0)),
      ...(filters.maxPrice !== undefined ? { [Op.lte]: filters.maxPrice } : {}),
    },
  };
  return {
    where: {
      ...scopedCampaignWhere(now, filters, position),
      [Op.and]: [
        literal('char_length(trim("lawyer->profile"."description")) >= 50'),
        literal('"lawyer->profile"."specializations" @> ARRAY["LawyerPromotion"."specialization"]::varchar[]'),
        literal(`EXISTS (
          SELECT 1 FROM lawyer_documents AS approved_license
          WHERE approved_license.user_id = "lawyer"."id"
            AND approved_license.type = 'license'
            AND approved_license.verification_status = 'approved'
            AND approved_license.approved_by_user_id IS NOT NULL
            AND approved_license.approved_at IS NOT NULL
        )`),
        literal(`EXISTS (
          SELECT 1 FROM jsonb_each(COALESCE("lawyer->profile"."schedule", '{}'::jsonb)) AS schedule_day
          WHERE schedule_day.value->>'enabled' = 'true'
        )`),
      ],
    },
    include: [
      { model: Payment, as: 'payment', required: true, attributes: [], where: { status: 'paid' } },
      {
        model: User,
        as: 'lawyer',
        required: true,
        attributes: [],
        where: userWhereFor(filters),
        include: [
          { model: LawyerProfile, as: 'profile', required: true, attributes: [], where: profileWhere },
        ],
      },
    ],
    distinct: true,
    subQuery: false,
  };
}

async function selectEligibleCampaignForSlot({ redis, filters, filterHash, position, usedLawyers, now }) {
  const query = eligibleCampaignQuery(filters, position, now);
  const total = await LawyerPromotion.count(query);
  if (!total) return null;
  const counterKey = `catalog:rotation:${filterHash}:slot:${position}`;
  const turn = await redis.incr(counterKey);
  await redis.expire(counterKey, ROTATION_TTL_SECONDS);
  const rank = (turn - 1) % total;
  const retries = Math.min(total, MAX_NEXT_RANK_RETRIES + 1);
  for (let retry = 0; retry < retries; retry += 1) {
    const campaign = await LawyerPromotion.findOne({
      ...query,
      distinct: undefined,
      order: [['id', 'ASC']],
      limit: 1,
      offset: (rank + retry) % total,
    });
    if (!campaign) return null;
    if (!usedLawyers.has(campaign.lawyerId)) return campaign;
  }
  return null;
}

async function createSnapshot(redis, filters, hash, pageSize, actorKey) {
  const organic = await User.findAndCountAll(lawyerQuery(filters, {
    attributes: ['id'],
    limit: MAX_SNAPSHOT_IDS,
    distinct: true,
  }));
  const selected = [];
  const positions = [];
  const usedLawyers = new Set();
  const now = new Date();
  for (let position = 0; position < Math.min(pageSize, 20) && selected.length < 2; position += 1) {
    const campaign = await selectEligibleCampaignForSlot({
      redis, filters, filterHash: hash, position, usedLawyers, now,
    });
    if (campaign) {
      selected.push(campaign);
      positions.push(position);
      usedLawyers.add(campaign.lawyerId);
    }
  }
  const sponsoredIds = new Set(selected.map((campaign) => campaign.lawyerId));
  const entries = organic.rows
    .filter((row) => !sponsoredIds.has(row.id))
    .map((row) => ({ id: row.id }));
  selected.forEach((campaign, index) => {
    entries.splice(Math.min(positions[index], entries.length), 0, {
      id: campaign.lawyerId,
      promotionId: campaign.id,
      placement: 'sponsored',
    });
  });
  const session = {
    v: 1,
    hash,
    pageSize,
    actorKey,
    total: Math.min(Number(organic.count), MAX_SNAPSHOT_IDS),
    entries: entries.slice(0, MAX_SNAPSHOT_IDS),
  };
  const sessionId = crypto.randomBytes(24).toString('base64url');
  await redis.set(`catalog:session:${sessionId}`, JSON.stringify(session), { EX: SESSION_SECONDS });
  return { session, sessionId };
}

async function liveEntryMap(entries, filters) {
  const ids = [...new Set(entries.map((entry) => entry.id))];
  if (!ids.length) return new Map();
  const lawyers = await User.findAll(lawyerQuery(filters, { where: { id: ids } }));
  const map = new Map(lawyers.map((lawyer) => [lawyer.id, lawyer]));
  const promotionIds = entries.map((entry) => entry.promotionId).filter(Boolean);
  if (!promotionIds.length) return map;
  const validPromotions = await LawyerPromotion.findAll({
    where: {
      id: promotionIds, placement: 'catalog_top', status: 'active',
      startsAt: { [Op.lte]: new Date() }, endsAt: { [Op.gt]: new Date() },
    },
    include: [{ model: Payment, as: 'payment', required: true, where: { status: 'paid' } }],
  });
  const promotedLawyerIds = [...new Set(validPromotions.map((campaign) => campaign.lawyerId))];
  const documents = promotedLawyerIds.length ? await LawyerDocument.findAll({
    where: {
      userId: promotedLawyerIds,
      type: 'license',
      verificationStatus: 'approved',
      approvedByUserId: { [Op.ne]: null },
      approvedAt: { [Op.ne]: null },
    },
    attributes: ['userId'],
  }) : [];
  const licensed = new Set(documents.map((document) => document.userId));
  const validById = new Map(validPromotions.filter((campaign) => campaignMatchesScope(campaign, filters))
    .filter((campaign) => profilePromotionEligible(map.get(campaign.lawyerId)?.profile, campaign, licensed.has(campaign.lawyerId)))
    .map((campaign) => [campaign.id, campaign]));
  for (const entry of entries) {
    if (entry.promotionId && !validById.has(entry.promotionId)) map.delete(entry.id);
  }
  return map;
}

async function pageFromSnapshot(session, sessionId, start, filters, pageSize) {
  const lawyers = [];
  let offset = start;
  while (offset < session.entries.length && lawyers.length < pageSize) {
    const chunkStart = offset;
    const chunk = session.entries.slice(chunkStart, chunkStart + LIVE_SCAN_CHUNK);
    const live = await liveEntryMap(chunk, filters);
    for (let index = 0; index < chunk.length && lawyers.length < pageSize; index += 1) {
      const entry = chunk[index];
      const row = live.get(entry.id);
      if (row) {
        const plain = toPublicLawyerDto(row);
        if (entry.placement === 'sponsored') {
          plain.placement = 'sponsored';
          plain.promotionId = entry.promotionId;
          plain.promotionAttributionToken = issuePromotionAttributionToken({
            promotionId: entry.promotionId,
            lawyerId: entry.id,
            actorKey: session.actorKey,
            sessionId,
            nonce: `${chunkStart + index}`,
            filterHash: session.hash,
          });
        }
        lawyers.push(plain);
      }
      offset += 1;
    }
  }
  for (const lawyer of lawyers.filter((row) => row.placement === 'sponsored')) {
    await recordPromotionEvent({
      attributionToken: lawyer.promotionAttributionToken,
      event: 'impression',
      actorKey: session.actorKey,
      requestId: `catalog:${sessionId}:${lawyer.id}`,
      expectedLawyerId: lawyer.id,
    });
  }
  return {
    lawyers,
    cursor: offset < session.entries.length ? encodeCursor({ s: sessionId, o: offset, h: session.hash, a: session.actorKey }) : null,
    total: session.total,
    totalPages: Math.ceil(session.total / pageSize),
  };
}

async function getCatalogPage({ filters: rawFilters, cursor = null, pageSize = 20, actorKey = 'anonymous:unknown' }) {
  const parsedPageSize = Number(pageSize);
  if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > MAX_PAGE_SIZE) {
    throw catalogError('Invalid catalog page size', 400, 'CATALOG_FILTER_INVALID');
  }
  const filters = normalizeFilters(rawFilters);
  const hash = filterHash(filters);
  const redis = getRedis();
  let decoded = null;
  if (cursor) {
    decoded = decodeCursor(cursor);
    if (decoded.h !== hash || decoded.a !== actorKey) throw catalogError('Catalog cursor does not match request', 400, 'CATALOG_CURSOR_INVALID');
  }
  if (!redis) {
    if (decoded) throw catalogError('Catalog session temporarily unavailable', 503, 'CATALOG_SESSION_UNAVAILABLE');
    return organicPage(filters, parsedPageSize, 0);
  }

  try {
    let session;
    let sessionId;
    let start = 0;
    if (decoded) {
      sessionId = decoded.s;
      start = decoded.o;
      const stored = await redis.get(`catalog:session:${sessionId}`);
      if (!stored) throw catalogError('Catalog session expired; restart from the first page', 410, 'CATALOG_SESSION_EXPIRED');
      session = JSON.parse(stored);
      if (session.hash !== hash || session.actorKey !== actorKey || session.pageSize !== parsedPageSize || !Array.isArray(session.entries)
        || session.entries.length > MAX_SNAPSHOT_IDS) {
        throw catalogError('Invalid catalog session', 400, 'CATALOG_CURSOR_INVALID');
      }
    } else {
      ({ session, sessionId } = await createSnapshot(redis, filters, hash, parsedPageSize, actorKey));
    }
    return pageFromSnapshot(session, sessionId, start, filters, parsedPageSize);
  } catch (error) {
    if (error.status) throw error;
    if (decoded) throw catalogError('Catalog session temporarily unavailable', 503, 'CATALOG_SESSION_UNAVAILABLE');
    return organicPage(filters, parsedPageSize, 0);
  }
}

module.exports = {
  SESSION_SECONDS,
  MAX_PAGE_SIZE,
  MAX_SNAPSHOT_IDS,
  ROTATION_TTL_SECONDS,
  eligibleCampaignQuery,
  selectEligibleCampaignForSlot,
  normalizeFilters,
  getCatalogPage,
  getCatalogEligibilityCandidates,
  profileWhereFor,
  userWhereFor,
};
