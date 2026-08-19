jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/config/redis', () => {
  const values = new Map();
  const expirations = new Map();
  let unavailable = false;
  const client = {
    async get(key) {
      if (unavailable) throw new Error('redis unavailable');
      return values.get(key) ?? null;
    },
    async set(key, value, options = {}) {
      if (unavailable) throw new Error('redis unavailable');
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async incr(key) {
      if (unavailable) throw new Error('redis unavailable');
      const value = Number(values.get(key) || 0) + 1;
      values.set(key, String(value));
      return value;
    },
    async expire(key, seconds) {
      if (unavailable) throw new Error('redis unavailable');
      expirations.set(key, seconds);
      return 1;
    },
    reset() { values.clear(); expirations.clear(); unavailable = false; },
    clear() { values.clear(); },
    fail() { unavailable = true; },
    failGet() { client.get = async () => { throw new Error('redis unavailable'); }; },
    recover() { unavailable = false; },
    keys() { return [...values.keys()]; },
    ttlFor(key) { return expirations.get(key); },
  };
  return { getRedis: () => client, __client: client };
});

const request = require('supertest');
const app = require('../src/server');
const redis = require('../src/config/redis').__client;
const { resetDb, models, makeAdmin, makeClient, makeLawyer, tokenFor } = require('./helpers');

const {
  Consultation,
  AuthorizationEvidenceEvent,
  LawyerDocument,
  LawyerPromotion,
  Payment,
  PromotionPackage,
} = models;

const CIVIL = 'Гражданское право';
const FAMILY = 'Семейное право';

async function activePromotion(email, profile = {}, campaign = {}) {
  const { user, lp } = await makeLawyer(email, {
    promotionPilotEnabled: true,
    location: 'Ташкент',
    ...profile,
  });
  const approver = await makeAdmin(`admin-${email}`);
  await LawyerDocument.create({
    userId: user.id,
    name: 'license.pdf',
    path: '/tmp/license.pdf',
    type: 'license',
    verificationStatus: 'approved',
    approvedByUserId: approver.id,
    approvedAt: new Date(),
  });
  const promotionPackage = await PromotionPackage.create({
    code: `CATALOG_${email}`,
    name: { ru: 'TOP' },
    durationDays: 7,
    priceAmountTiyin: 7000000,
    maxActiveSlots: 2,
    sponsoredPositions: campaign.sponsoredPositions || [0, 3],
    isActive: true,
  });
  const promotion = await LawyerPromotion.create({
    lawyerId: user.id,
    packageId: promotionPackage.id,
    idempotencyKey: `campaign-${email}`,
    placement: 'catalog_top',
    specialization: campaign.specialization || CIVIL,
    location: campaign.location === undefined ? 'Ташкент' : campaign.location,
    durationDays: 7,
    priceAmountTiyin: 7000000,
    currency: 'UZS',
    maxActiveSlots: 2,
    sponsoredPositions: campaign.sponsoredPositions || [0, 3],
    status: 'active',
    paidAt: new Date(Date.now() - 60000),
    startsAt: new Date(Date.now() - 60000),
    activeSince: new Date(Date.now() - 60000),
    endsAt: new Date(Date.now() + 86400000),
  });
  const payment = await Payment.create({
    userId: user.id,
    lawyerPromotionId: promotion.id,
    purpose: 'lawyer_promotion',
    amount: 70000,
    amountTiyin: 7000000,
    currency: 'UZS',
    provider: 'payme',
    status: 'paid',
    paidAt: new Date(),
  });
  await promotion.update({ paymentId: payment.id });
  return { user, lp, promotion };
}

beforeEach(async () => {
  redis.reset();
  await resetDb();
}, 60000);

test('sponsored cards satisfy every filter and never duplicate organic lawyers', async () => {
  const eligible = await activePromotion('catalog-sponsored@test.uz', { price: 150000, languages: ['ru'], rating: 4.8 });
  await activePromotion('catalog-wrong-filter@test.uz', { price: 500000, languages: ['uz'] });
  await makeLawyer('catalog-organic@test.uz', { location: 'Ташкент', price: 170000, languages: ['ru'], rating: 4.2 });

  const response = await request(app).get('/api/lawyers').query({
    specialization: CIVIL,
    location: 'Ташкент',
    language: 'ru',
    minPrice: 100000,
    maxPrice: 200000,
    minRating: 0,
    onlineOnly: true,
    sortBy: 'price_low',
    limit: 10,
  });

  expect(response.status).toBe(200);
  const sponsored = response.body.lawyers.filter((lawyer) => lawyer.placement === 'sponsored');
  expect(sponsored).toHaveLength(1);
  expect(sponsored[0].id).toBe(eligible.user.id);
  expect(sponsored[0].promotionId).toBe(eligible.promotion.id);
  expect(new Set(response.body.lawyers.map((lawyer) => lawyer.id)).size).toBe(response.body.lawyers.length);
});

test('catalog persists the complete legacy/capability union before Redis and impression side effects', async () => {
  const promoted = await activePromotion('catalog-order-sponsored@test.uz');
  await promoted.user.update({ twoFactorEnabled: true });
  const legacyOnly = await makeLawyer('catalog-order-legacy@test.uz');
  const capabilityOnly = await makeLawyer('catalog-order-capability@test.uz');
  await capabilityOnly.user.update({ role: 'client', twoFactorEnabled: true });
  const evidenceSpy = jest.spyOn(AuthorizationEvidenceEvent, 'create');
  const setSpy = jest.spyOn(redis, 'set');
  const incrSpy = jest.spyOn(redis, 'incr');

  const response = await request(app).get('/api/lawyers').query({ specialization: CIVIL, limit: 10 });

  expect(response.status).toBe(200);
  const rows = await AuthorizationEvidenceEvent.findAll({
    where: { surface: 'CATALOG GET /api/lawyers' }, raw: true,
  });
  expect(rows.map(({ legacyAllowed, capabilityAllowed }) => [legacyAllowed, capabilityAllowed]))
    .toEqual(expect.arrayContaining([[true, true], [true, false], [false, true]]));
  const catalogEvidenceOrders = evidenceSpy.mock.calls.map((call, index) => (
    call[0]?.surface === 'CATALOG GET /api/lawyers' ? evidenceSpy.mock.invocationCallOrder[index] : null
  )).filter(Boolean);
  const lastEvidence = Math.max(...catalogEvidenceOrders);
  const firstRedisSideEffect = Math.min(...setSpy.mock.invocationCallOrder, ...incrSpy.mock.invocationCallOrder);
  expect(lastEvidence).toBeLessThan(firstRedisSideEffect);
  evidenceSpy.mockRestore();
  setSpy.mockRestore();
  incrSpy.mockRestore();
  expect(legacyOnly.user.id).not.toBe(capabilityOnly.user.id);
});

test('catalog telemetry failure occurs before session, rotation, or impression mutation', async () => {
  const { promotion } = await activePromotion('catalog-order-failure@test.uz');
  const evidenceSpy = jest.spyOn(AuthorizationEvidenceEvent, 'create')
    .mockRejectedValue(new Error('authorization evidence unavailable'));

  const response = await request(app).get('/api/lawyers').query({ specialization: CIVIL, limit: 10 });

  evidenceSpy.mockRestore();
  expect(response.status).toBe(500);
  expect(redis.keys()).toEqual([]);
  expect(Number((await promotion.reload()).impressions)).toBe(0);
});

test('minimum rating excludes lawyers below the requested threshold', async () => {
  const eligible = await makeLawyer('catalog-rating-eligible@test.uz', { rating: 4.8 });
  const belowMinimum = await makeLawyer('catalog-rating-below@test.uz', { rating: 4.2 });

  const response = await request(app).get('/api/lawyers').query({ minRating: 4.5, limit: 10 });

  expect(response.status).toBe(200);
  expect(response.body.lawyers.map((lawyer) => lawyer.id)).toContain(eligible.user.id);
  expect(response.body.lawyers.map((lawyer) => lawyer.id)).not.toContain(belowMinimum.user.id);
});

test('cursor pages are stable, fill blocked snapshot gaps, and expire with 410', async () => {
  const browser = request.agent(app);
  await activePromotion('catalog-gap-sponsored@test.uz');
  const organic = [];
  for (let index = 0; index < 5; index += 1) {
    organic.push(await makeLawyer(`catalog-gap-${index}@test.uz`, { location: 'Ташкент', rating: 5 - index / 10 }));
  }
  const first = await browser.get('/api/lawyers').query({ specialization: CIVIL, location: 'Ташкент', sortBy: 'rating', limit: 2 });
  expect(first.status).toBe(200);

  await organic[1].user.update({ isActive: false });
  const second = await browser.get('/api/lawyers').query({
    specialization: CIVIL,
    location: 'Ташкент',
    sortBy: 'rating',
    limit: 2,
    cursor: first.body.cursor,
  });

  expect(second.status).toBe(200);
  expect(second.body.lawyers).toHaveLength(2);
  expect(second.body.lawyers.map((lawyer) => lawyer.id)).not.toContain(organic[1].user.id);
  expect(second.body.lawyers.some((lawyer) => first.body.lawyers.some((seen) => seen.id === lawyer.id))).toBe(false);

  redis.clear();
  const expired = await browser.get('/api/lawyers').query({
    specialization: CIVIL,
    location: 'Ташкент',
    sortBy: 'rating',
    limit: 2,
    cursor: second.body.cursor,
  });
  expect(expired.status).toBe(410);
  expect(expired.body.code).toBe('CATALOG_SESSION_EXPIRED');
});

test('cursor is opaque, filter-bound, and catalog inputs are bounded', async () => {
  const browser = request.agent(app);
  await makeLawyer('catalog-bound@test.uz');
  await makeLawyer('catalog-bound-2@test.uz');
  await makeLawyer('catalog-bound-3@test.uz');
  const first = await browser.get('/api/lawyers?sortBy=rating&limit=2');
  expect(first.status).toBe(200);
  expect(first.body.cursor).not.toMatch(/^[0-9]+$/);

  const changed = await browser.get('/api/lawyers').query({ sortBy: 'experience', limit: 2, cursor: first.body.cursor });
  expect(changed.status).toBe(400);
  expect(changed.body.code).toBe('CATALOG_CURSOR_INVALID');

  const oversized = await request(app).get('/api/lawyers').query({ limit: 500, search: 'x'.repeat(200) });
  expect(oversized.status).toBe(400);
});

test('round robin gives active promotions at most one impression difference', async () => {
  const campaigns = [];
  for (let index = 0; index < 3; index += 1) {
    campaigns.push(await activePromotion(`catalog-fair-${index}@test.uz`, {}, { sponsoredPositions: [0] }));
  }

  for (let index = 0; index < 6; index += 1) {
    const response = await request(app).get('/api/lawyers').query({ specialization: CIVIL, location: 'Ташкент', limit: 1 });
    expect(response.status).toBe(200);
  }

  const impressions = await Promise.all(campaigns.map(async ({ promotion }) => Number((await promotion.reload()).impressions)));
  expect(Math.max(...impressions) - Math.min(...impressions)).toBeLessThanOrEqual(1);
  expect(impressions.reduce((sum, value) => sum + value, 0)).toBe(6);
});

test.each([50, 101])('persistent slot rank selects all %i fully eligible campaigns with max difference one', async (total) => {
  const { selectEligibleCampaignForSlot } = require('../src/services/catalogRankingService');
  const countSpy = jest.spyOn(LawyerPromotion, 'count').mockResolvedValue(total);
  const findSpy = jest.spyOn(LawyerPromotion, 'findOne').mockImplementation(async (options) => ({
    id: `campaign-${options.offset}`, lawyerId: `lawyer-${options.offset}`, sponsoredPositions: [0],
  }));
  const counts = new Map();
  for (let index = 0; index < total; index += 1) {
    const campaign = await selectEligibleCampaignForSlot({
      redis, filters: { sortBy: 'rating', onlineOnly: false }, filterHash: 'f'.repeat(64),
      position: 0, usedLawyers: new Set(), now: new Date(),
    });
    counts.set(campaign.id, (counts.get(campaign.id) || 0) + 1);
  }
  countSpy.mockRestore(); findSpy.mockRestore();
  expect(counts.size).toBe(total);
  expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
});

test('persistent slot counter continues across epochs and reaches later ids before call 26', async () => {
  const { selectEligibleCampaignForSlot } = require('../src/services/catalogRankingService');
  const countSpy = jest.spyOn(LawyerPromotion, 'count').mockResolvedValue(50);
  const offsets = [];
  const findSpy = jest.spyOn(LawyerPromotion, 'findOne').mockImplementation(async (options) => {
    offsets.push(options.offset);
    return { id: `campaign-${options.offset}`, lawyerId: `lawyer-${options.offset}`, sponsoredPositions: [0] };
  });
  for (let call = 0; call < 26; call += 1) {
    await selectEligibleCampaignForSlot({
      redis, filters: { sortBy: 'rating', onlineOnly: false }, filterHash: 'e'.repeat(64),
      position: 0, usedLawyers: new Set(), now: new Date(Date.now() + call * 16 * 60 * 1000),
    });
  }
  countSpy.mockRestore(); findSpy.mockRestore();
  expect(offsets).toEqual(Array.from({ length: 26 }, (_, index) => index));
  const key = redis.keys().find((candidate) => candidate.includes(`${'e'.repeat(64)}:slot:0`));
  expect(key).toBeTruthy();
  expect(redis.ttlFor(key)).toBe(30 * 24 * 60 * 60);
});

test('fully eligible slot query excludes partial rows before ranking and fetches limit one', async () => {
  const { selectEligibleCampaignForSlot } = require('../src/services/catalogRankingService');
  const countSpy = jest.spyOn(LawyerPromotion, 'count').mockImplementation(async (options) => {
    expect(options.include).toEqual(expect.arrayContaining([
      expect.objectContaining({ as: 'payment', required: true }),
      expect.objectContaining({ as: 'lawyer', required: true }),
    ]));
    return 1;
  });
  const findSpy = jest.spyOn(LawyerPromotion, 'findOne').mockImplementation(async (options) => {
    expect(options.limit).toBe(1);
    expect(options.offset).toBe(0);
    return { id: 'only-eligible', lawyerId: 'eligible-lawyer', sponsoredPositions: [0] };
  });
  const selected = [];
  for (let turn = 0; turn < 3; turn += 1) {
    selected.push(await selectEligibleCampaignForSlot({
      redis, filters: { sortBy: 'rating', onlineOnly: false }, filterHash: 'q'.repeat(64),
      position: 0, usedLawyers: new Set(), now: new Date(),
    }));
  }
  const findCalls = findSpy.mock.calls.length;
  countSpy.mockRestore(); findSpy.mockRestore();
  expect(selected.map((campaign) => campaign.id)).toEqual(['only-eligible', 'only-eligible', 'only-eligible']);
  expect(findCalls).toBe(3);
});

test('separate sponsored slots use independent persistent counters and own positions', async () => {
  const { selectEligibleCampaignForSlot } = require('../src/services/catalogRankingService');
  const countSpy = jest.spyOn(LawyerPromotion, 'count').mockResolvedValue(2);
  const queriedPositions = [];
  const findSpy = jest.spyOn(LawyerPromotion, 'findOne').mockImplementation(async (options) => {
    queriedPositions.push(Reflect.ownKeys(options.where.sponsoredPositions).map((key) => options.where.sponsoredPositions[key])[0][0]);
    return { id: `candidate-${options.offset}`, lawyerId: `lawyer-${options.offset}`, sponsoredPositions: [0, 3] };
  });
  const base = { redis, filters: { sortBy: 'rating', onlineOnly: false }, filterHash: 's'.repeat(64), now: new Date(), usedLawyers: new Set() };
  await selectEligibleCampaignForSlot({ ...base, position: 0 });
  await selectEligibleCampaignForSlot({ ...base, position: 3 });
  await selectEligibleCampaignForSlot({ ...base, position: 0 });
  countSpy.mockRestore(); findSpy.mockRestore();
  const slot0 = redis.keys().find((key) => key.endsWith(':slot:0'));
  const slot3 = redis.keys().find((key) => key.endsWith(':slot:3'));
  expect(await redis.get(slot0)).toBe('2');
  expect(await redis.get(slot3)).toBe('1');
  expect(queriedPositions).toEqual([0, 3, 0]);
});

test('promotion events are deduplicated atomically and skipped when Redis fails', async () => {
  const { issuePromotionAttributionToken, recordPromotionEvent } = require('../src/services/promotionAnalyticsService');
  const { user, promotion } = await activePromotion('catalog-events@test.uz');
  const actorKey = 'client:1';
  const hash = 'a'.repeat(64);
  const attributionToken = issuePromotionAttributionToken({
    promotionId: promotion.id, lawyerId: user.id, actorKey, sessionId: 'test-session', nonce: '0', filterHash: hash,
  });
  await redis.set('catalog:session:test-session', JSON.stringify({
    actorKey, hash, entries: [{ id: user.id, promotionId: promotion.id, placement: 'sponsored' }],
  }));
  await Promise.all(Array.from({ length: 5 }, () => recordPromotionEvent({
    attributionToken,
    event: 'profile_view',
    actorKey,
    requestId: 'profile-request-1',
    expectedLawyerId: user.id,
  })));
  expect(Number((await promotion.reload()).profileViews)).toBe(1);

  redis.fail();
  await recordPromotionEvent({
    attributionToken,
    event: 'booking_start',
    actorKey,
    requestId: 'booking-start-request-1',
    expectedLawyerId: user.id,
  });
  expect(Number((await promotion.reload()).bookingStarts)).toBe(0);
});

test.each([
  ['rating', 'rating', [4.9, 4.1]],
  ['price_low', 'price', [100000, 200000]],
  ['price_high', 'price', [200000, 100000]],
  ['experience', 'experience', [9, 2]],
])('sortBy=%s uses the supported contract', async (sortBy, field, expected) => {
  await makeLawyer(`catalog-sort-a-${sortBy}@test.uz`, { isAvailable: false, rating: 4.1, price: 200000, experience: 2 });
  await makeLawyer(`catalog-sort-b-${sortBy}@test.uz`, { isAvailable: false, rating: 4.9, price: 100000, experience: 9 });
  const response = await request(app).get('/api/lawyers').query({ sortBy, limit: 2 });
  expect(response.status).toBe(200);
  expect(response.body.lawyers.map((lawyer) => Number(lawyer.profile[field]))).toEqual(expected);
});

test('impression, profile view, booking start, and created booking increment exact boundaries', async () => {
  const client = await makeClient('catalog-boundaries-client@test.uz');
  const { user, promotion } = await activePromotion('catalog-boundaries-lawyer@test.uz');
  const browser = request.agent(app);
  const auth = `Bearer ${tokenFor(client)}`;
  const catalog = await browser.get('/api/lawyers').set('Authorization', auth)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);
  expect(card.placement).toBe('sponsored');
  expect(card.promotionAttributionToken).toEqual(expect.any(String));

  await browser
    .get(`/api/lawyers/${user.id}`)
    .set('Authorization', auth)
    .query({ attributionToken: card.promotionAttributionToken })
    .set('X-Promotion-Request-Id', 'profile-open-1');
  await browser
    .post(`/api/lawyers/${user.id}/promotion/booking-start`)
    .set('Authorization', auth)
    .send({ attributionToken: card.promotionAttributionToken, requestId: 'booking-modal-1' });
  await browser
    .post(`/api/lawyers/${user.id}/book`)
    .set('Authorization', auth)
    .set('Idempotency-Key', 'catalog-promoted-booking')
    .send({
      question: 'Нужна консультация',
      promotionAttributionToken: card.promotionAttributionToken,
      promotionRequestId: 'booking-created-1',
    });

  const reloaded = await promotion.reload();
  expect(Number(reloaded.impressions)).toBe(1);
  expect(Number(reloaded.profileViews)).toBe(1);
  expect(Number(reloaded.bookingStarts)).toBe(1);
  expect(Number(reloaded.bookings)).toBe(1);
});

test('self-forged promotion ids and another actor token never increment events', async () => {
  const owner = await makeClient('catalog-token-owner@test.uz');
  const attacker = await makeClient('catalog-token-attacker@test.uz');
  const { user, promotion } = await activePromotion('catalog-token-lawyer@test.uz');
  const ownerBrowser = request.agent(app);
  const catalog = await ownerBrowser.get('/api/lawyers')
    .set('Authorization', `Bearer ${tokenFor(owner)}`)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);

  await request(app).get(`/api/lawyers/${user.id}`)
    .query({ promotionId: promotion.id })
    .set('X-Promotion-Request-Id', 'forged-profile');
  const stolen = await request(app).post(`/api/lawyers/${user.id}/promotion/booking-start`)
    .set('Authorization', `Bearer ${tokenFor(attacker)}`)
    .send({ attributionToken: card.promotionAttributionToken, requestId: 'stolen-token' });

  expect(stolen.status).toBe(403);
  const reloaded = await promotion.reload();
  expect(Number(reloaded.profileViews)).toBe(0);
  expect(Number(reloaded.bookingStarts)).toBe(0);
});

test('attribution token is short-lived and carries signed placement authority', async () => {
  const { issuePromotionAttributionToken, decodeAttributionToken } = require('../src/services/promotionAnalyticsService');
  const issuedAt = new Date('2026-08-15T10:00:00.000Z');
  const token = issuePromotionAttributionToken({
    promotionId: 'promotion-id', lawyerId: 'lawyer-id', actorKey: 'actor-key',
    sessionId: 'session-id', nonce: '0', filterHash: 'b'.repeat(64), now: issuedAt,
  });
  const payload = decodeAttributionToken(token, new Date(issuedAt.getTime() + 14 * 60 * 1000));
  expect(payload).toMatchObject({ p: 'promotion-id', l: 'lawyer-id', a: 'actor-key', placement: 'sponsored' });
  expect(decodeAttributionToken(token, new Date(issuedAt.getTime() + 16 * 60 * 1000))).toBeNull();
  expect(decodeAttributionToken(`${token}tampered`, issuedAt)).toBeNull();
});

test('attribution remains valid across reloads but stops when placement or eligibility changes', async () => {
  const client = await makeClient('catalog-reload-client@test.uz');
  const { user, promotion } = await activePromotion('catalog-reload-lawyer@test.uz');
  const browser = request.agent(app);
  const auth = `Bearer ${tokenFor(client)}`;
  const catalog = await browser.get('/api/lawyers').set('Authorization', auth)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);

  for (const requestId of ['reload-1', 'reload-2']) {
    await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
      .query({ attributionToken: card.promotionAttributionToken })
      .set('X-Promotion-Request-Id', requestId);
  }
  expect(Number((await promotion.reload()).profileViews)).toBe(1);

  await promotion.update({ placement: 'not_catalog' });
  await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
    .query({ attributionToken: card.promotionAttributionToken })
    .set('X-Promotion-Request-Id', 'reload-invalid-placement');
  expect(Number((await promotion.reload()).profileViews)).toBe(1);

  await promotion.update({ placement: 'catalog_top', startsAt: new Date(Date.now() + 60000) });
  await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
    .query({ attributionToken: card.promotionAttributionToken })
    .set('X-Promotion-Request-Id', 'reload-future-start');
  expect(Number((await promotion.reload()).profileViews)).toBe(1);
});

test('signed token requires its live Redis session and exact sponsored nonce entry', async () => {
  const { decodeAttributionToken, issuePromotionAttributionToken } = require('../src/services/promotionAnalyticsService');
  const client = await makeClient('catalog-session-authority@test.uz');
  const { user, promotion } = await activePromotion('catalog-session-authority-lawyer@test.uz');
  const browser = request.agent(app);
  const auth = `Bearer ${tokenFor(client)}`;
  const catalog = await browser.get('/api/lawyers').set('Authorization', auth)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);
  const claims = decodeAttributionToken(card.promotionAttributionToken);
  const wrongNonceToken = issuePromotionAttributionToken({
    promotionId: promotion.id, lawyerId: user.id, actorKey: claims.a,
    sessionId: claims.s, nonce: '499', filterHash: claims.h,
  });

  await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
    .query({ attributionToken: wrongNonceToken })
    .set('X-Promotion-Request-Id', 'wrong-nonce');
  expect(Number((await promotion.reload()).profileViews)).toBe(0);

  redis.clear();
  await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
    .query({ attributionToken: card.promotionAttributionToken })
    .set('X-Promotion-Request-Id', 'missing-session');
  expect(Number((await promotion.reload()).profileViews)).toBe(0);
});

test('token nonce permits each client event only once regardless of fresh request IDs', async () => {
  const client = await makeClient('catalog-once-client@test.uz');
  const { user, promotion } = await activePromotion('catalog-once-lawyer@test.uz');
  const browser = request.agent(app);
  const auth = `Bearer ${tokenFor(client)}`;
  const catalog = await browser.get('/api/lawyers').set('Authorization', auth)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);

  for (const requestId of ['profile-fresh-a', 'profile-fresh-b']) {
    await browser.get(`/api/lawyers/${user.id}`).set('Authorization', auth)
      .query({ attributionToken: card.promotionAttributionToken })
      .set('X-Promotion-Request-Id', requestId);
  }
  for (const requestId of ['start-fresh-a', 'start-fresh-b']) {
    await browser.post(`/api/lawyers/${user.id}/promotion/booking-start`).set('Authorization', auth)
      .send({ attributionToken: card.promotionAttributionToken, requestId });
  }
  const reloaded = await promotion.reload();
  expect(Number(reloaded.impressions)).toBe(1);
  expect(Number(reloaded.profileViews)).toBe(1);
  expect(Number(reloaded.bookingStarts)).toBe(1);
});

test('booking attribution requires an exact committed consultation and consumes once', async () => {
  const { decodeAttributionToken, recordPromotionEvent } = require('../src/services/promotionAnalyticsService');
  const client = await makeClient('catalog-booking-authority-client@test.uz');
  const { user, promotion } = await activePromotion('catalog-booking-authority-lawyer@test.uz');
  const browser = request.agent(app);
  const auth = `Bearer ${tokenFor(client)}`;
  const catalog = await browser.get('/api/lawyers').set('Authorization', auth)
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 5 });
  const card = catalog.body.lawyers.find((lawyer) => lawyer.id === user.id);
  const claims = decodeAttributionToken(card.promotionAttributionToken);

  await recordPromotionEvent({
    attributionToken: card.promotionAttributionToken, event: 'booking', actorKey: claims.a,
    requestId: 'booking-without-consultation', expectedLawyerId: user.id,
    consultationId: '00000000-0000-4000-8000-000000000000',
  });
  expect(Number((await promotion.reload()).bookings)).toBe(0);

  const consultation = await Consultation.create({
    clientId: client.id, lawyerId: user.id, type: 'video', question: 'Question',
    problems: [{ text: 'Question', categories: [] }], status: 'pending', price: 0,
  });
  for (const requestId of ['booking-committed-a', 'booking-committed-b']) {
    await recordPromotionEvent({
      attributionToken: card.promotionAttributionToken, event: 'booking', actorKey: claims.a,
      requestId, expectedLawyerId: user.id, consultationId: consultation.id,
    });
  }
  expect(Number((await promotion.reload()).bookings)).toBe(1);
});

test('catalog cursor is bound to the random actor cookie and tampered cookies rotate', async () => {
  await makeLawyer('catalog-cookie-a@test.uz');
  await makeLawyer('catalog-cookie-b@test.uz');
  await makeLawyer('catalog-cookie-c@test.uz');
  const owner = request.agent(app);
  const first = await owner.get('/api/lawyers?limit=1');
  const cookie = first.headers['set-cookie']?.find((value) => value.startsWith('catalog_actor='));
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);

  const otherActor = await request(app).get('/api/lawyers').query({ limit: 1, cursor: first.body.cursor });
  expect(otherActor.status).toBe(400);
  expect(otherActor.body.code).toBe('CATALOG_CURSOR_INVALID');

  const tampered = await request(app).get('/api/lawyers?limit=1').set('Cookie', 'catalog_actor=tampered');
  expect(tampered.headers['set-cookie']?.join(';')).toMatch(/catalog_actor=/);
  const repeatedTamper = await request(app).get('/api/lawyers')
    .set('Cookie', 'catalog_actor=tampered')
    .query({ limit: 1, cursor: tampered.body.cursor });
  expect(repeatedTamper.status).toBe(400);
});

test('catalog actor cookie is Secure in production and never derives from forwarded IP', () => {
  const { resolveCatalogActor } = require('../src/services/catalogActorService');
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const cookie = jest.fn();
  const req = { userId: null, get: jest.fn((name) => name === 'cookie' ? '' : null) };
  const first = resolveCatalogActor(req, { cookie });
  const second = resolveCatalogActor({ ...req, get: jest.fn((name) => name === 'x-forwarded-for' ? 'attacker' : null) }, { cookie: jest.fn() });
  process.env.NODE_ENV = previous;
  expect(cookie).toHaveBeenCalledWith('catalog_actor', expect.any(String), expect.objectContaining({
    httpOnly: true, sameSite: 'lax', secure: true,
  }));
  expect(first).not.toBe(second);
});

test('malformed percent-encoded actor cookie rotates instead of throwing', async () => {
  await makeLawyer('catalog-malformed-cookie@test.uz');
  const response = await request(app).get('/api/lawyers').set('Cookie', 'catalog_actor=%E0%A4%A');
  expect(response.status).toBe(200);
  expect(response.headers['set-cookie']?.join(';')).toMatch(/catalog_actor=/);
});

test('actor cookie supports validated Lax and cross-site None modes and CORS credentials', async () => {
  const previousMode = process.env.CATALOG_COOKIE_CROSS_SITE;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.CATALOG_COOKIE_CROSS_SITE;
  process.env.NODE_ENV = 'test';
  const lax = await request(app).get('/api/lawyers');
  expect(lax.headers['set-cookie']?.join(';')).toMatch(/SameSite=Lax/i);

  process.env.CATALOG_COOKIE_CROSS_SITE = '1';
  const crossSite = await request(app).get('/api/lawyers');
  const crossCookie = crossSite.headers['set-cookie']?.join(';') || '';
  expect(crossCookie).toMatch(/SameSite=None/i);
  expect(crossCookie).toMatch(/Secure/i);
  const cors = await request(app).options('/api/lawyers').set('Origin', 'http://localhost:3000');
  expect(cors.headers['access-control-allow-credentials']).toBe('true');
  process.env.CATALOG_COOKIE_CROSS_SITE = previousMode;
  process.env.NODE_ENV = previousNodeEnv;
});

test('each sponsored slot uses only campaigns configured for that exact position', async () => {
  const atZero = await activePromotion('catalog-slot-zero@test.uz', {}, { sponsoredPositions: [0] });
  const atThree = await activePromotion('catalog-slot-three@test.uz', {}, { sponsoredPositions: [3] });
  await makeLawyer('catalog-slot-organic-a@test.uz', { location: 'Ташкент' });
  await makeLawyer('catalog-slot-organic-b@test.uz', { location: 'Ташкент' });
  const result = await request.agent(app).get('/api/lawyers')
    .query({ specialization: CIVIL, location: 'Ташкент', limit: 4 });
  expect(result.body.lawyers).toHaveLength(4);
  expect(result.body.lawyers[0].id).toBe(atZero.user.id);
  expect(result.body.lawyers[0].placement).toBe('sponsored');
  expect(result.body.lawyers[3].id).toBe(atThree.user.id);
  expect(result.body.lawyers[3].placement).toBe('sponsored');
  expect(Number((await atZero.promotion.reload()).impressions)).toBe(1);
  expect(Number((await atThree.promotion.reload()).impressions)).toBe(1);
});

test('continuation Redis transport failure is retryable and never reinterprets mixed offset', async () => {
  const browser = request.agent(app);
  await activePromotion('catalog-continuation-redis@test.uz');
  for (let index = 0; index < 3; index += 1) await makeLawyer(`catalog-continuation-${index}@test.uz`);
  const first = await browser.get('/api/lawyers').query({ specialization: CIVIL, limit: 2 });
  redis.fail();
  const second = await browser.get('/api/lawyers').query({ specialization: CIVIL, limit: 2, cursor: first.body.cursor });
  expect(second.status).toBe(503);
  expect(second.body.code).toBe('CATALOG_SESSION_UNAVAILABLE');
});

test('later pages revalidate bounded chunks instead of all remaining snapshot rows', async () => {
  const browser = request.agent(app);
  for (let index = 0; index < 25; index += 1) await makeLawyer(`catalog-chunk-${index}@test.uz`);
  const first = await browser.get('/api/lawyers?limit=2');
  const original = models.User.findAll.bind(models.User);
  const sizes = [];
  const spy = jest.spyOn(models.User, 'findAll').mockImplementation((options) => {
    const ids = options?.where?.id;
    if (Array.isArray(ids)) sizes.push(ids.length);
    return original(options);
  });
  const second = await browser.get('/api/lawyers').query({ limit: 2, cursor: first.body.cursor });
  spy.mockRestore();
  expect(second.status).toBe(200);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(10);
}, 30000);

test('Redis failure returns a safe organic page without sponsorship or metrics', async () => {
  const { promotion } = await activePromotion('catalog-redis-fallback@test.uz');
  redis.fail();
  const response = await request(app).get('/api/lawyers').query({ specialization: CIVIL, limit: 5 });
  expect(response.status).toBe(200);
  expect(response.body.lawyers.every((lawyer) => !lawyer.placement && !lawyer.promotionId)).toBe(true);
  expect(response.body.cursor).toBeNull();
  expect(Number((await promotion.reload()).impressions)).toBe(0);
});
