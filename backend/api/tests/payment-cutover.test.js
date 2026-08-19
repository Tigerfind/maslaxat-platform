const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/server');
const logger = require('../src/config/logger');
const { signCanonicalArtifact, verifyCanonicalArtifact } = require('../src/services/paymentEvidenceManifest');
const {
  REQUIRED_SHADOW_METHODS,
  buildShadowComparison,
  getPaymentConfig,
  validateShadowEvidence,
} = require('../src/config/payment');
const {
  PaymentReconciliationError,
  reconcilePayments,
  runCli,
  buildProviderSnapshot,
  buildReconciliationSummary,
} = require('../src/scripts/reconcilePayments');
const {
  sequelize,
  resetDb,
  makeClient,
  makeLawyer,
  makePayment,
  models: {
    FinancialEntry,
    FinancialTransaction,
    LawyerProfile,
    Payment,
    Consultation,
    Subscription,
    Withdrawal,
    PromotionPackage,
    LawyerPromotion,
  },
} = require('./helpers');

jest.setTimeout(60000);

const originalPaymeKey = process.env.PAYME_KEY;
const originalPaymentV2Mode = process.env.PAYMENT_V2_MODE;
const originalEvidenceKey = process.env.PAYMENT_SHADOW_EVIDENCE_KEY;
const originalReleaseCommit = process.env.PAYMENT_RELEASE_COMMIT_SHA;
const EVIDENCE_KEY = 'task-5-test-evidence-key-32-bytes-minimum';
const RELEASE_COMMIT = 'a'.repeat(40);
const MIGRATIONS = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
  .filter((name) => name.endsWith('.js')).sort();
const MIGRATION_HEAD = MIGRATIONS.at(-1);

function reconciliationDatabaseEvidence() {
  return {
    migrationHead: MIGRATION_HEAD,
    databaseIdentityDigest: 'd'.repeat(64),
    snapshotIdentityDigest: 'e'.repeat(64),
    reconciledAt: '2026-08-19T00:00:00.000Z',
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signEvidence(evidence) {
  const unsigned = { ...evidence };
  delete unsigned.integrity;
  return crypto.createHmac('sha256', EVIDENCE_KEY).update(canonicalize(unsigned)).digest('hex');
}

function comparison(method, v2Accepted = true, v2ErrorCode = null, legacyOutcome = 'result', legacyErrorCode = null) {
  const outcome = v2Accepted ? 'result' : 'error';
  const payloadHash = crypto.createHash('sha256').update(`${method}:${outcome}:${v2ErrorCode ?? ''}`).digest('hex');
  return {
    scenarioId: `${method}:${outcome}${v2ErrorCode === null ? '' : `:${v2ErrorCode}`}`,
    method,
    v2Accepted,
    v2ErrorCode,
    legacyOutcome,
    legacyErrorCode,
    v2PayloadHash: payloadHash,
    legacyPayloadHash: payloadHash,
    comparisonMatched: outcome === legacyOutcome && v2ErrorCode === legacyErrorCode && legacyErrorCode !== -31003,
  };
}

function validShadowEvidence(overrides = {}) {
  const now = new Date();
  const evidence = {
    schemaVersion: 2,
    mode: 'shadow',
    source: 'staging-observation',
    environment: 'staging',
    commitSha: RELEASE_COMMIT,
    observedFrom: new Date(now.getTime() - (25 * 60 * 60 * 1000)).toISOString(),
    observedUntil: new Date(now.getTime() - 60000).toISOString(),
    sandboxScenarioSet: null,
    comparisons: REQUIRED_SHADOW_METHODS.map((method) => comparison(method)),
    ...overrides,
  };
  evidence.integrity = signEvidence(evidence);
  return evidence;
}

function localShadowEvidence(comparisons = REQUIRED_SHADOW_METHODS.map((method) => comparison(method))) {
  const now = new Date();
  return {
    schemaVersion: 2,
    mode: 'shadow',
    source: 'local-deterministic-test-scenarios',
    environment: 'local',
    commitSha: RELEASE_COMMIT,
    observedFrom: new Date(now.getTime() - 1000).toISOString(),
    observedUntil: now.toISOString(),
    sandboxScenarioSet: null,
    comparisons,
    integrity: null,
  };
}

async function makeConsultation({ clientId, lawyerId, status = 'pending', gross = 10000, net = 8500 }) {
  return Consultation.create({
    clientId,
    lawyerId,
    question: 'Cutover reconciliation',
    status,
    price: gross / 100,
    commissionRateBps: 1500,
    grossAmountTiyin: gross,
    lawyerNetAmountTiyin: net,
  });
}

async function postRawTransaction({ operationKey, paymentId = null, metadata = {}, debitAccount = 'asset:cash', creditAccount, amountTiyin = 10000, isPosted = true }) {
  const transaction = await FinancialTransaction.create({
    operationKey,
    paymentId,
    reason: 'cutover_test',
    currency: 'UZS',
    metadata,
    isPosted,
  });
  await FinancialEntry.bulkCreate([
    { financialTransactionId: transaction.id, account: debitAccount, direction: 'debit', amountTiyin },
    { financialTransactionId: transaction.id, account: creditAccount, direction: 'credit', amountTiyin },
  ]);
  return transaction;
}

async function postLegacyReleasedReceipt({ payment, lawyerNet, commission, metadata = {} }) {
  const transaction = await FinancialTransaction.create({
    operationKey: `legacy:opening:${payment.id}`,
    paymentId: payment.id,
    reason: 'legacy_opening_balance',
    currency: 'UZS',
    metadata,
    isPosted: true,
  });
  const entries = [
    { financialTransactionId: transaction.id, account: 'asset:cash', direction: 'debit', amountTiyin: Number(payment.amountTiyin) },
    { financialTransactionId: transaction.id, account: 'liability:lawyer_payable', direction: 'credit', amountTiyin: lawyerNet },
  ];
  if (commission > 0) entries.push({
    financialTransactionId: transaction.id,
    account: 'revenue:platform_commission',
    direction: 'credit',
    amountTiyin: commission,
  });
  await FinancialEntry.bulkCreate(entries);
  return transaction;
}

async function expectRefusal(category) {
  await expect(reconcilePayments({
    failOnMismatch: true,
    shadowEvidence: validShadowEvidence(),
  })).rejects.toMatchObject({
    name: 'PaymentReconciliationError',
    report: { mismatches: { [category]: expect.any(Array) } },
  });
}

beforeEach(async () => {
  process.env.PAYMENT_SHADOW_EVIDENCE_KEY = EVIDENCE_KEY;
  process.env.PAYMENT_RELEASE_COMMIT_SHA = RELEASE_COMMIT;
  await resetDb();
  await sequelize.query('CREATE TABLE IF NOT EXISTS "SequelizeMeta" (name varchar(255) NOT NULL PRIMARY KEY)');
  await sequelize.query('TRUNCATE TABLE "SequelizeMeta"');
  await sequelize.getQueryInterface().bulkInsert('SequelizeMeta', MIGRATIONS.map((name) => ({ name })));
});

afterEach(() => {
  if (originalPaymeKey === undefined) delete process.env.PAYME_KEY;
  else process.env.PAYME_KEY = originalPaymeKey;
  if (originalPaymentV2Mode === undefined) delete process.env.PAYMENT_V2_MODE;
  else process.env.PAYMENT_V2_MODE = originalPaymentV2Mode;
  if (originalEvidenceKey === undefined) delete process.env.PAYMENT_SHADOW_EVIDENCE_KEY;
  else process.env.PAYMENT_SHADOW_EVIDENCE_KEY = originalEvidenceKey;
  if (originalReleaseCommit === undefined) delete process.env.PAYMENT_RELEASE_COMMIT_SHA;
  else process.env.PAYMENT_RELEASE_COMMIT_SHA = originalReleaseCommit;
  jest.restoreAllMocks();
});

describe('payment mode cutover gate', () => {
  test('accepts shadow mode but refuses active mode even with local evidence', () => {
    expect(getPaymentConfig({ PAYMENT_V2_MODE: 'shadow' })).toEqual({
      mode: 'shadow',
      shadowEnabled: true,
      activeEnabled: false,
    });
    expect(() => getPaymentConfig({
      PAYMENT_V2_MODE: 'active',
      PAYMENT_V2_SHADOW_EVIDENCE: JSON.stringify(validShadowEvidence()),
    })).toThrow(/Task 6|explicit approval/i);
  });

  test('refuses invalid mode values instead of silently using the legacy handler', () => {
    expect(() => getPaymentConfig({ PAYMENT_V2_MODE: 'maybe' })).toThrow(/PAYMENT_V2_MODE/i);
  });

  test('rejects active webhook configuration without changing financial state', async () => {
    process.env.PAYME_KEY = 'real-test-key';
    process.env.PAYMENT_V2_MODE = 'active';
    const token = Buffer.from('Paycom:real-test-key').toString('base64');

    const response = await request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'CreateTransaction',
        params: {
          id: 'must-not-bind',
          time: 1700000000000,
          amount: 10000,
          account: { consultation_id: '11111111-1111-4111-8111-111111111111' },
        },
      });

    expect(response.status).toBe(503);
    expect(await Payment.count()).toBe(0);
    expect(await FinancialTransaction.count()).toBe(0);
  });
});

describe('Task 6 prepayment cutover readiness', () => {
  test('rejects unresolved five-minute holds and actionable unpaid consultations', async () => {
    const client = await makeClient('cutover-prepayment-client@test.uz');
    const { user: lawyer } = await makeLawyer('cutover-prepayment-lawyer@test.uz');
    const held = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Legacy held consultation',
      status: 'pending',
      price: 100000,
      billingStatus: 'held',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.ready).toBe(false);
    expect(report.mismatches.prepaymentFlow).toContainEqual(expect.objectContaining({
      consultationId: held.id,
      reason: 'legacy five-minute hold remains unresolved',
    }));
    await expectRefusal('prepaymentFlow');
  });

  test('rejects payment-pending consultations without an active base checkout', async () => {
    const client = await makeClient('cutover-orphan-client@test.uz');
    const { user: lawyer } = await makeLawyer('cutover-orphan-lawyer@test.uz');
    const orphan = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Orphan checkout',
      status: 'payment_pending',
      price: 100000,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.prepaymentFlow).toContainEqual(expect.objectContaining({
      consultationId: orphan.id,
      reason: 'payment-pending consultation has no active base checkout',
    }));
  });

  test('accepts Task 6 state shapes while external evidence remains an independent gate', async () => {
    const client = await makeClient('cutover-shapes-client@test.uz');
    const { user: lawyer } = await makeLawyer('cutover-shapes-lawyer@test.uz');
    const awaiting = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Awaiting payment',
      status: 'payment_pending',
      price: 100000,
    });
    await makePayment({
      userId: client.id,
      consultationId: awaiting.id,
      purpose: 'consultation',
      status: 'pending',
      idempotencyKey: 'cutover-shape-checkout',
    });

    const localReport = await reconcilePayments({ shadowEvidence: localShadowEvidence() });

    expect(localReport.mismatches.prepaymentFlow).toEqual([]);
    expect(localReport.ready).toBe(false);
    expect(localReport.mismatches.shadowEvidence).toContainEqual(expect.objectContaining({
      reason: expect.stringMatching(/staging shadow evidence/i),
    }));
    expect(() => getPaymentConfig({ PAYMENT_V2_MODE: 'active' })).toThrow(/explicit cutover approval/i);
  });
});

describe('canonical shadow payload comparison', () => {
  test.each([
    ['CheckPerformTransaction', { allow: true }, { allow: false }],
    ['CreateTransaction', { create_time: 10, transaction: 'payment-1', state: 1 }, { create_time: 10, transaction: 'payment-1', state: 2 }],
    ['PerformTransaction', { perform_time: 10, transaction: 'payment-1', state: 2 }, { perform_time: 10, transaction: 'payment-2', state: 2 }],
    ['CancelTransaction', { cancel_time: 10, transaction: 'payment-1', state: -1 }, { cancel_time: 10, transaction: 'payment-1', state: -2 }],
    ['CheckTransaction', { create_time: 1, perform_time: 2, cancel_time: 0, transaction: 'payment-1', state: 2, reason: null }, { create_time: 1, perform_time: 3, cancel_time: 0, transaction: 'payment-1', state: 2, reason: null }],
  ])('marks differing normalized %s result payloads as mismatches', (method, v2Payload, legacyPayload) => {
    const result = buildShadowComparison({
      method,
      v2Accepted: true,
      v2ErrorCode: null,
      v2Payload,
    }, 'result', null, legacyPayload);

    expect(result.comparisonMatched).toBe(false);
    expect(result.v2PayloadHash).not.toBe(result.legacyPayloadHash);
    expect(JSON.stringify(result)).not.toContain('payment-1');
  });

  test('GetStatement compares every canonical transaction field and preserves list order', () => {
    const first = {
      id: 'provider-1', time: 1, amount: 10000, account: { consultation_id: 'payment-1' },
      create_time: 1, perform_time: 2, cancel_time: 0, transaction: 'payment-1', state: 2, reason: null,
    };
    const second = {
      id: 'provider-2', time: 3, amount: 20000, account: { consultation_id: 'payment-2' },
      create_time: 3, perform_time: 4, cancel_time: 0, transaction: 'payment-2', state: 2, reason: null,
    };
    const matched = buildShadowComparison({
      method: 'GetStatement', v2Accepted: true, v2ErrorCode: null, v2Payload: { transactions: [first, second] },
    }, 'result', null, { transactions: [{ ...first }, { ...second }] });
    const reversed = buildShadowComparison({
      method: 'GetStatement', v2Accepted: true, v2ErrorCode: null, v2Payload: { transactions: [first, second] },
    }, 'result', null, { transactions: [second, first] });

    expect(matched.comparisonMatched).toBe(true);
    expect(reversed.comparisonMatched).toBe(false);
    expect(reversed.v2PayloadHash).not.toBe(reversed.legacyPayloadHash);
    expect(JSON.stringify(reversed)).not.toContain('provider-1');
    expect(JSON.stringify(reversed)).not.toContain('payment-1');
  });
});

describe('read-only payment reconciliation', () => {
  test.each(['pending', 'processing'])(
    'refuses unresolved %s legacy payments',
    async (status) => {
      await makePayment({ purpose: null, amountTiyin: null, status });

      await expectRefusal('pendingLegacy');
      const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
      expect(report.mismatches.pendingLegacy).toEqual([
        expect.objectContaining({ status }),
      ]);
    }
  );

  test('refuses decimal and tiyin amount disagreement', async () => {
    const payment = await makePayment({ purpose: null, amount: 101, amountTiyin: 10000, status: 'failed' });

    await expectRefusal('amount');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.amount).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('refuses paid state without a corresponding ledger receipt', async () => {
    const payment = await makePayment({ purpose: null, status: 'paid' });

    await expectRefusal('state');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.state).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('refuses duplicate effective provider transaction IDs', async () => {
    await makePayment({ purpose: null, status: 'failed', transactionId: 'provider-duplicate' });
    await makePayment({ purpose: null, status: 'failed', transactionId: 'provider-duplicate' });

    await expectRefusal('providerDuplicates');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.providerDuplicates).toEqual([
      expect.objectContaining({ provider: 'payme', providerTransactionId: 'provider-duplicate', count: 2 }),
    ]);
  });

  test('refuses unbalanced financial transactions', async () => {
    const transaction = await FinancialTransaction.create({
      operationKey: 'test:unbalanced',
      reason: 'test',
      currency: 'UZS',
      isPosted: true,
    });
    await FinancialEntry.bulkCreate([
      { financialTransactionId: transaction.id, account: 'asset:cash', direction: 'debit', amountTiyin: 100 },
      { financialTransactionId: transaction.id, account: 'liability:lawyer_payable', direction: 'credit', amountTiyin: 90 },
    ]);

    await expectRefusal('ledgerTransactions');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.ledgerTransactions).toContainEqual(expect.objectContaining({ operationKey: 'test:unbalanced' }));
  });

  test('refuses an open financial transaction even when its current entries balance', async () => {
    const transaction = await FinancialTransaction.create({
      operationKey: 'test:open-balanced',
      reason: 'test',
      currency: 'UZS',
      isPosted: false,
    });
    await FinancialEntry.bulkCreate([
      { financialTransactionId: transaction.id, account: 'asset:cash', direction: 'debit', amountTiyin: 100 },
      { financialTransactionId: transaction.id, account: 'liability:lawyer_payable', direction: 'credit', amountTiyin: 100 },
    ]);

    await expectRefusal('ledgerTransactions');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.ledgerTransactions).toContainEqual(expect.objectContaining({
      operationKey: 'test:open-balanced',
      reason: 'financial transaction is not finalized',
    }));
  });

  test('refuses lawyer payable ledger and balance cache disagreement', async () => {
    const { user } = await makeLawyer();
    const transaction = await FinancialTransaction.create({
      operationKey: 'test:payable-cache',
      reason: 'test',
      currency: 'UZS',
      isPosted: true,
      metadata: { lawyerId: user.id },
    });
    await FinancialEntry.bulkCreate([
      { financialTransactionId: transaction.id, account: 'asset:cash', direction: 'debit', amountTiyin: 100 },
      { financialTransactionId: transaction.id, account: 'liability:lawyer_payable', direction: 'credit', amountTiyin: 100 },
    ]);

    await expectRefusal('ledgerCaches');
    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    expect(report.mismatches.ledgerCaches).toContainEqual(expect.objectContaining({
      cache: 'lawyer.balance',
      userId: user.id,
      ledgerTiyin: 100,
      cacheTiyin: 0,
    }));
  });

  test('reports an unreleased obligation when its lawyer profile is missing', async () => {
    const client = await makeClient();
    const { user: lawyer, lp } = await makeLawyer();
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: lawyer.id });
    const payment = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      transactionId: 'missing-profile-receipt',
      providerTransactionId: 'missing-profile-receipt',
    });
    await postRawTransaction({
      operationKey: 'payme:paid:missing-profile-receipt',
      paymentId: payment.id,
      creditAccount: 'liability:consultation_escrow',
    });
    await lp.destroy();

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ledgerCaches).toContainEqual(expect.objectContaining({
      cache: 'lawyer.pendingBalance',
      userId: lawyer.id,
      cacheMissing: true,
      ledgerTiyin: 8500,
    }));
  });

  test('detects offsetting payable drift independently for each lawyer', async () => {
    const first = await makeLawyer('payable-one@test.uz', { balance: 1.5 });
    const second = await makeLawyer('payable-two@test.uz', { balance: 0.5 });
    await postRawTransaction({
      operationKey: 'test:payable:first',
      metadata: { lawyerId: first.user.id },
      debitAccount: 'liability:consultation_escrow',
      creditAccount: 'liability:lawyer_payable',
      amountTiyin: 100,
    });
    await postRawTransaction({
      operationKey: 'test:payable:second',
      metadata: { lawyerId: second.user.id },
      debitAccount: 'liability:consultation_escrow',
      creditAccount: 'liability:lawyer_payable',
      amountTiyin: 100,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });
    const payable = report.mismatches.ledgerCaches.filter(({ cache }) => cache === 'lawyer.balance');

    expect(payable).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: first.user.id, ledgerTiyin: 100, cacheTiyin: 150 }),
      expect.objectContaining({ userId: second.user.id, ledgerTiyin: 100, cacheTiyin: 50 }),
    ]));
  });

  test('attributes withdrawal cache drift to the affected lawyer', async () => {
    const first = await makeLawyer('withdraw-one@test.uz', { balance: 50 });
    await makeLawyer('withdraw-two@test.uz', { balance: 0 });
    await postRawTransaction({
      operationKey: 'test:payable:withdrawal',
      metadata: { lawyerId: first.user.id },
      debitAccount: 'liability:consultation_escrow',
      creditAccount: 'liability:lawyer_payable',
      amountTiyin: 10000,
    });
    await Withdrawal.create({ lawyerId: first.user.id, amount: 50, status: 'pending' });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ledgerCaches).toContainEqual(expect.objectContaining({
      cache: 'lawyer.balance',
      userId: first.user.id,
      ledgerTiyin: 10000,
      cacheTiyin: 5000,
    }));
  });

  test('rejects conflicting lawyer attribution sources instead of prioritizing metadata', async () => {
    const client = await makeClient();
    const first = await makeLawyer('attribution-one@test.uz');
    const second = await makeLawyer('attribution-two@test.uz');
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: first.user.id, status: 'completed' });
    const payment = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      escrowReleased: true,
    });
    await postLegacyReleasedReceipt({
      payment,
      lawyerNet: 8500,
      commission: 1500,
      metadata: { lawyerId: second.user.id },
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ledgerAttribution).toContainEqual(expect.objectContaining({
      financialTransactionId: expect.any(String),
      reason: 'conflicting lawyer attribution sources',
      sources: expect.arrayContaining([first.user.id, second.user.id]),
    }));
  });

  test('rejects a lawyer-payable entry with no attribution source', async () => {
    await postRawTransaction({
      operationKey: 'test:payable:unattributed',
      debitAccount: 'liability:consultation_escrow',
      creditAccount: 'liability:lawyer_payable',
      amountTiyin: 100,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ledgerAttribution).toContainEqual(expect.objectContaining({
      reason: 'missing lawyer attribution source',
    }));
  });

  test('rejects duplicate active base consultation payments while allowing typed extensions', async () => {
    const client = await makeClient();
    const { user: lawyer } = await makeLawyer();
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: lawyer.id });
    await sequelize.query('DROP INDEX IF EXISTS payments_consultation_active_unique');
    await makePayment({ userId: client.id, consultationId: consultation.id, purpose: 'consultation', status: 'paid', providerTransactionId: 'base-one', transactionId: 'base-one' });
    await makePayment({ userId: client.id, consultationId: consultation.id, purpose: 'consultation', status: 'paid', providerTransactionId: 'base-two', transactionId: 'base-two' });
    const extension = await makePayment({ userId: client.id, consultationId: consultation.id, purpose: 'consultation_extension', status: 'paid', providerTransactionId: 'extension-one', transactionId: 'extension-one' });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ambiguousRows).toContainEqual(expect.objectContaining({
      consultationId: consultation.id,
      reason: 'duplicate active base consultation payments',
    }));
    expect(report.mismatches.ambiguousRows).not.toContainEqual(expect.objectContaining({ paymentId: extension.id }));
  });

  test('rejects overlapping paid subscription terms but allows clearly sequential terms', async () => {
    const client = await makeClient();
    const subscription = await Subscription.create({ userId: client.id, plan: 'pro', price: 299000 });
    const makeTerm = (providerTransactionId, termStart, termEnd) => makePayment({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      status: 'paid',
      providerTransactionId,
      transactionId: providerTransactionId,
      providerData: { subscriptionPlan: 'pro', termStart, termEnd },
    });
    const first = await makeTerm('term-one', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const overlapping = await makeTerm('term-overlap', '2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z');
    const sequential = await makeTerm('term-sequential', '2026-02-15T00:00:00.000Z', '2026-03-15T00:00:00.000Z');

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.ambiguousRows).toContainEqual(expect.objectContaining({
      paymentIds: expect.arrayContaining([first.id, overlapping.id]),
      reason: 'overlapping paid subscription terms',
    }));
    expect(report.mismatches.ambiguousRows).not.toContainEqual(expect.objectContaining({ paymentId: sequential.id }));
  });

  test('requires the exact finalized balanced receipt key, amount, and subject liability', async () => {
    const client = await makeClient();
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const payment = await makePayment({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      status: 'paid',
      providerTransactionId: 'strict-receipt',
      transactionId: 'strict-receipt',
      providerData: { subscriptionPlan: 'pro', termStart: '2026-01-01T00:00:00.000Z', termEnd: '2026-02-01T00:00:00.000Z' },
    });
    await postRawTransaction({
      operationKey: 'unrelated:strict-receipt',
      paymentId: payment.id,
      creditAccount: 'liability:subscription_deferred_revenue',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).toContainEqual(expect.objectContaining({
      paymentId: payment.id,
      reason: 'paid payment has no exact finalized balanced receipt',
    }));
  });

  test.each([
    ['wrong liability', 'liability:consultation_escrow', 10000, true],
    ['wrong amount', 'liability:subscription_deferred_revenue', 9999, true],
    ['not finalized', 'liability:subscription_deferred_revenue', 10000, false],
  ])('rejects paid receipt with %s', async (_label, creditAccount, amountTiyin, isPosted) => {
    const client = await makeClient();
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const providerTransactionId = `receipt-${amountTiyin}-${isPosted}-${creditAccount}`;
    const payment = await makePayment({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      status: 'paid',
      providerTransactionId,
      transactionId: providerTransactionId,
      providerData: { subscriptionPlan: 'pro', termStart: '2026-01-01T00:00:00.000Z', termEnd: '2026-02-01T00:00:00.000Z' },
    });
    await postRawTransaction({
      operationKey: `payme:paid:${providerTransactionId}`,
      paymentId: payment.id,
      creditAccount,
      amountTiyin,
      isPosted,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('rejects a Payme receipt operation for a non-Payme payment', async () => {
    const client = await makeClient();
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const payment = await makePayment({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      provider: 'click',
      status: 'paid',
      providerTransactionId: 'wrong-provider-receipt',
      transactionId: 'wrong-provider-receipt',
      providerData: { subscriptionPlan: 'pro', termStart: '2026-01-01T00:00:00.000Z', termEnd: '2026-02-01T00:00:00.000Z' },
    });
    await postRawTransaction({
      operationKey: 'payme:paid:wrong-provider-receipt',
      paymentId: payment.id,
      creditAccount: 'liability:subscription_deferred_revenue',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test.each([
    ['payme:paid:valid-receipt'],
    ['legacy:opening:PAYMENT_ID'],
  ])('accepts exact receipt operation %s', async (operationKeyTemplate) => {
    const client = await makeClient();
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const payment = await makePayment({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      status: 'paid',
      providerTransactionId: 'valid-receipt',
      transactionId: 'valid-receipt',
      providerData: { subscriptionPlan: 'pro', termStart: '2026-01-01T00:00:00.000Z', termEnd: '2026-02-01T00:00:00.000Z' },
    });
    await postRawTransaction({
      operationKey: operationKeyTemplate.replace('PAYMENT_ID', payment.id),
      paymentId: payment.id,
      creditAccount: 'liability:subscription_deferred_revenue',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).not.toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('rejects a released legacy opening whose payable/commission split differs from snapshots', async () => {
    const client = await makeClient();
    const { user: lawyer, lp } = await makeLawyer('legacy-split@test.uz', { balance: 90 });
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: lawyer.id, status: 'completed' });
    const payment = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      escrowReleased: true,
    });
    await postLegacyReleasedReceipt({ payment, lawyerNet: 9000, commission: 1000 });
    await lp.update({ balance: 90 });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('rejects a released legacy opening when consultation snapshots are missing', async () => {
    const client = await makeClient();
    const { user: lawyer } = await makeLawyer('legacy-missing-snapshot@test.uz', { balance: 85 });
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Missing snapshot',
      status: 'completed',
      price: 100,
    });
    const payment = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      escrowReleased: true,
    });
    await postLegacyReleasedReceipt({ payment, lawyerNet: 8500, commission: 1500 });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('accepts the exact released legacy opening snapshot split', async () => {
    const client = await makeClient();
    const { user: lawyer } = await makeLawyer('legacy-valid-split@test.uz', { balance: 85 });
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: lawyer.id, status: 'completed' });
    const payment = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      escrowReleased: true,
    });
    await postLegacyReleasedReceipt({ payment, lawyerNet: 8500, commission: 1500 });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).not.toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('accepts multiple released legacy openings whose aggregate equals the consultation snapshots', async () => {
    const client = await makeClient();
    const { user: lawyer } = await makeLawyer('legacy-aggregate-split@test.uz', { balance: 170 });
    const consultation = await makeConsultation({
      clientId: client.id,
      lawyerId: lawyer.id,
      status: 'completed',
      gross: 20000,
      net: 17000,
    });
    const first = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'paid',
      escrowReleased: true,
    });
    const second = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation_extension',
      status: 'paid',
      escrowReleased: true,
    });
    await postLegacyReleasedReceipt({ payment: first, lawyerNet: 8500, commission: 1500 });
    await postLegacyReleasedReceipt({ payment: second, lawyerNet: 8500, commission: 1500 });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.state).not.toContainEqual(expect.objectContaining({
      paymentId: expect.stringMatching(new RegExp(`${first.id}|${second.id}`)),
    }));
  });

  test('refuses missing or incomplete shadow evidence', async () => {
    await expect(reconcilePayments({ failOnMismatch: true })).rejects.toBeInstanceOf(PaymentReconciliationError);

    const evidence = validShadowEvidence();
    evidence.comparisons = evidence.comparisons.slice(1);
    evidence.integrity = signEvidence(evidence);
    expect(() => validateShadowEvidence(evidence)).toThrow(/missing shadow comparison/i);
  });

  test('refuses duplicate methods and non-sanitized shadow evidence fields', () => {
    const duplicate = validShadowEvidence();
    duplicate.comparisons.push({ ...duplicate.comparisons[0] });
    duplicate.integrity = signEvidence(duplicate);
    expect(() => validateShadowEvidence(duplicate)).toThrow(/duplicate shadow comparison/i);

    const sensitive = validShadowEvidence();
    sensitive.comparisons[0].paymentId = 'secret-payment-id';
    sensitive.integrity = signEvidence(sensitive);
    expect(() => validateShadowEvidence(sensitive)).toThrow(/sanitized shadow comparison/i);
  });

  test.each([
    ['v2Accepted', 'yes'],
    ['v2ErrorCode', 'invalid'],
    ['legacyOutcome', 'maybe'],
    ['legacyErrorCode', 1.5],
    ['v2PayloadHash', 'invalid'],
    ['legacyPayloadHash', null],
    ['comparisonMatched', 'yes'],
    ['scenarioId', ''],
  ])('type-checks required comparison field %s', (field, value) => {
    const evidence = validShadowEvidence();
    evidence.comparisons[0][field] = value;
    evidence.integrity = signEvidence(evidence);
    expect(() => validateShadowEvidence(evidence)).toThrow(/shadow comparison/i);
  });

  test('recomputes comparisonMatched instead of trusting the manifest value', () => {
    const evidence = validShadowEvidence();
    evidence.comparisons[0] = {
      ...evidence.comparisons[0],
      v2Accepted: false,
      v2ErrorCode: -31008,
      legacyOutcome: 'result',
      legacyErrorCode: null,
      comparisonMatched: true,
      scenarioId: 'CheckPerformTransaction:error:-31008',
    };
    evidence.integrity = signEvidence(evidence);
    expect(() => validateShadowEvidence(evidence)).toThrow(/compatibility mismatch/i);
  });

  test('local parser evidence validates structurally but can never make reconciliation ready', async () => {
    expect(validateShadowEvidence(localShadowEvidence())).toMatchObject({ valid: true, cutoverEligible: false });

    const report = await reconcilePayments({ shadowEvidence: localShadowEvidence() });

    expect(report.ready).toBe(false);
    expect(report.mismatches.shadowEvidence).toEqual([
      expect.objectContaining({ reason: expect.stringMatching(/staging/i) }),
    ]);
  });

  test('requires an untampered fresh staging manifest for the expected commit', async () => {
    const tampered = validShadowEvidence();
    tampered.source = 'tampered-after-signing';
    await expect(reconcilePayments({ shadowEvidence: tampered })).resolves.toMatchObject({ ready: false });

    const wrongCommit = validShadowEvidence({ commitSha: 'b'.repeat(40) });
    await expect(reconcilePayments({ shadowEvidence: wrongCommit })).resolves.toMatchObject({ ready: false });

    const stale = validShadowEvidence({
      observedFrom: '2025-01-01T00:00:00.000Z',
      observedUntil: '2025-01-02T00:00:00.000Z',
    });
    await expect(reconcilePayments({ shadowEvidence: stale })).resolves.toMatchObject({ ready: false });

    const now = new Date();
    const incompleteObservation = validShadowEvidence({
      observedFrom: new Date(now.getTime() - 60000).toISOString(),
      observedUntil: now.toISOString(),
      sandboxScenarioSet: null,
    });
    await expect(reconcilePayments({ shadowEvidence: incompleteObservation })).resolves.toMatchObject({ ready: false });
  });

  test('refuses obsolete schema-v2 staging evidence even with a signed complete marker', async () => {
    const now = new Date();
    const evidence = validShadowEvidence({
      observedFrom: new Date(now.getTime() - 60000).toISOString(),
      observedUntil: now.toISOString(),
      sandboxScenarioSet: { agreementId: 'payme-pilot-v1', complete: true },
    });

    const report = await reconcilePayments({ shadowEvidence: evidence });

    expect(report.ready).toBe(false);
    expect(report.mismatches.shadowEvidence).toContainEqual(expect.objectContaining({
      reason: expect.stringMatching(/schema v4/i),
    }));
  });

  test('does not mutate payment, ledger, or cache rows', async () => {
    const { lp } = await makeLawyer();
    const payment = await makePayment({ purpose: null, amountTiyin: null, status: 'pending' });
    const before = {
      payment: payment.toJSON(),
      profile: lp.toJSON(),
      transactions: await FinancialTransaction.count(),
      entries: await FinancialEntry.count(),
    };

    await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect((await Payment.findByPk(payment.id)).toJSON()).toEqual(before.payment);
    expect((await LawyerProfile.findByPk(lp.id)).toJSON()).toEqual(before.profile);
    expect(await FinancialTransaction.count()).toBe(before.transactions);
    expect(await FinancialEntry.count()).toBe(before.entries);
  });
});

describe('deterministic local shadow evidence', () => {
  test('compares exact dry-run and legacy outcomes against real payment fixtures without mutations', async () => {
    process.env.PAYME_KEY = 'real-test-key';
    process.env.PAYMENT_V2_MODE = 'shadow';
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const token = Buffer.from('Paycom:real-test-key').toString('base64');
    const checkPayment = await makePayment({ purpose: null, status: 'pending' });
    const createPayment = await makePayment({ purpose: null, status: 'paid' });
    const performPayment = await makePayment({ purpose: null, status: 'failed', transactionId: 'provider-perform', providerTransactionId: 'provider-perform' });
    const cancelPayment = await makePayment({ purpose: null, status: 'failed', transactionId: 'provider-cancel', providerTransactionId: 'provider-cancel' });
    const checkTransactionPayment = await makePayment({ purpose: null, status: 'paid', transactionId: 'provider-check', providerTransactionId: 'provider-check' });
    const before = (await Payment.findAll({ order: [['id', 'ASC']] })).map((payment) => payment.toJSON());
    const statementTo = Date.now() + 60000;
    const scenarios = [
      ['CheckPerformTransaction', { amount: 10000, account: { consultation_id: checkPayment.id } }],
      ['CreateTransaction', { id: 'provider-create', time: 1700000000000, amount: 10000, account: { consultation_id: createPayment.id } }],
      ['PerformTransaction', { id: 'provider-perform' }],
      ['CancelTransaction', { id: 'provider-cancel', reason: 5 }],
      ['CheckTransaction', { id: 'provider-check' }],
      ['GetStatement', { from: 0, to: statementTo }],
    ];

    for (const [method, params] of scenarios) {
      await request(app)
        .post('/api/payments/webhook')
        .set('Authorization', `Basic ${token}`)
        .send({ jsonrpc: '2.0', id: `secret-${method}`, method, params });
    }

    const comparisons = info.mock.calls
      .filter(([event]) => event === 'payment_v2_shadow')
      .map(([, comparison]) => comparison);
    expect(comparisons).toHaveLength(6);
    const expected = [
      comparison('CheckPerformTransaction'),
      comparison('CreateTransaction', false, -31060, 'error', -31060),
      comparison('PerformTransaction', false, -31008, 'error', -31008),
      comparison('CancelTransaction'),
      comparison('CheckTransaction'),
      comparison('GetStatement'),
    ];
    const outcomeFields = ({ v2PayloadHash, legacyPayloadHash, ...fields }) => fields;
    expect(comparisons.map(outcomeFields)).toEqual(expected.map(outcomeFields));
    for (const observed of comparisons) {
      expect(observed.v2PayloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(observed.legacyPayloadHash).toBe(observed.v2PayloadHash);
    }
    expect(validateShadowEvidence(localShadowEvidence(comparisons))).toMatchObject({ valid: true, cutoverEligible: false });
    expect(JSON.stringify(comparisons)).not.toContain('secret-');
    expect(JSON.stringify(comparisons)).not.toContain('provider-');
    for (const payment of [checkPayment, createPayment, performPayment, cancelPayment, checkTransactionPayment]) {
      expect(JSON.stringify(comparisons)).not.toContain(payment.id);
    }
    expect((await Payment.findAll({ order: [['id', 'ASC']] })).map((payment) => payment.toJSON())).toEqual(before);
    expect(await Payment.count()).toBe(5);
    expect(await FinancialTransaction.count()).toBe(0);
  });
});

describe('reconciliation metadata recording', () => {
  test('requires both explicit recording flag and destination before writing metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-reconcile-'));
    const output = path.join(directory, 'report.json');
    const reconcile = jest.fn().mockResolvedValue({
      ready: false,
      mismatchCount: 1,
      mismatches: { amount: [{ paymentId: 'secret-payment-id' }] },
    });

    await expect(runCli(['--metadata-file', output], { reconcile })).rejects.toThrow(/--record-metadata/i);
    expect(fs.existsSync(output)).toBe(false);

    await runCli(['--record-metadata', '--metadata-file', output], { reconcile });
    const recorded = fs.readFileSync(output, 'utf8');
    expect(JSON.parse(recorded)).toEqual({
      ready: false,
      mismatchCount: 1,
      mismatchCounts: { amount: 1 },
    });
    expect(recorded).not.toContain('secret-payment-id');

    const bindingsFile = path.join(directory, 'bindings.json');
    const sourceFile = path.join(directory, 'source.json');
    const summaryFile = path.join(directory, 'summary.json');
    fs.writeFileSync(bindingsFile, JSON.stringify({
      environment: 'local',
      providerSnapshotDigest: 'c'.repeat(64), generatedAt: '2026-08-19T00:00:00.000Z',
    }));
    fs.writeFileSync(sourceFile, JSON.stringify({
      commitSha: 'a'.repeat(40), deploymentId: 'local-a3', serviceId: 'api',
      configDigest: 'b'.repeat(64), migrationHead: MIGRATION_HEAD,
    }));
    reconcile.mockResolvedValueOnce({
      ready: false,
      mismatchCount: 1,
      mismatches: { amount: [{ paymentId: 'secret-payment-id' }] },
      databaseEvidence: {
        migrationHead: MIGRATION_HEAD,
        databaseIdentityDigest: 'd'.repeat(64),
        snapshotIdentityDigest: 'e'.repeat(64),
        reconciledAt: '2026-08-19T00:00:00.000Z',
      },
    });
    await runCli([
      '--source-attestation', sourceFile,
      '--summary-bindings', bindingsFile,
      '--summary-file', summaryFile,
    ], { reconcile });
    expect(JSON.parse(fs.readFileSync(summaryFile, 'utf8'))).toEqual(expect.objectContaining({
      kind: 'payment-reconciliation-summary', mismatchCount: 1,
      summaryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
});

describe('A3 final-gate reconciliation coverage', () => {
  test('refuses a promotion payment whose campaign does not bind back to the same payment', async () => {
    const { user: lawyer } = await makeLawyer('a3-promotion-subject@test.uz');
    const promotionPackage = await PromotionPackage.create({
      code: 'A3_PROMO', name: { ru: 'A3' }, durationDays: 7, priceAmountTiyin: 10000,
      maxActiveSlots: 1, sponsoredPositions: [0], isActive: true,
    });
    const campaign = await LawyerPromotion.create({
      lawyerId: lawyer.id, packageId: promotionPackage.id, idempotencyKey: 'a3-promo',
      placement: 'catalog_top', specialization: 'civil', location: null, durationDays: 7,
      priceAmountTiyin: 10000, currency: 'UZS', maxActiveSlots: 1, sponsoredPositions: [0],
    });
    const payment = await makePayment({
      purpose: 'lawyer_promotion', lawyerPromotionId: campaign.id, userId: lawyer.id,
      status: 'pending', idempotencyKey: 'a3-promo-payment',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.promotionSubjects).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('refuses provider-confirmed refund state without exact refund posting and confirmation fields', async () => {
    const client = await makeClient('a3-refund-client@test.uz');
    const { user: lawyer } = await makeLawyer('a3-refund-lawyer@test.uz');
    const consultation = await makeConsultation({ clientId: client.id, lawyerId: lawyer.id, status: 'cancelled' });
    const payment = await makePayment({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', status: 'refunded',
      refundedAmountTiyin: 10000, refundedAt: new Date(), providerTransactionId: 'a3-refund-provider',
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence() });

    expect(report.mismatches.refunds).toContainEqual(expect.objectContaining({ paymentId: payment.id }));
  });

  test('refuses unresolved refund_pending and status/amount contradictions', async () => {
    const client = await makeClient('a3-refund-status-client@test.uz');
    const { user: lawyer } = await makeLawyer('a3-refund-status-lawyer@test.uz');
    const consultations = await Promise.all(['pending', 'full', 'partial'].map((label) => makeConsultation({
      clientId: client.id, lawyerId: lawyer.id, status: 'cancelled', gross: 10000, net: 8500,
    }).then((consultation) => ({ label, consultation }))));
    const pending = await makePayment({
      userId: client.id, consultationId: consultations[0].consultation.id, purpose: 'consultation',
      status: 'refund_pending', refundedAmountTiyin: 0, idempotencyKey: 'a3-refund-pending',
    });
    const partialFull = await makePayment({
      userId: client.id, consultationId: consultations[1].consultation.id, purpose: 'consultation',
      status: 'partially_refunded', refundedAmountTiyin: 10000, refundedAt: new Date(),
      providerTransactionId: 'a3-partial-full', idempotencyKey: 'a3-partial-full',
      providerData: { cancelTime: Date.now(), refundProviderTransactionId: 'a3-partial-full' },
    });
    const refundedPartial = await makePayment({
      userId: client.id, consultationId: consultations[2].consultation.id, purpose: 'consultation',
      status: 'refunded', refundedAmountTiyin: 5000, refundedAt: new Date(),
      providerTransactionId: 'a3-refunded-partial', idempotencyKey: 'a3-refunded-partial',
      providerData: { cancelTime: Date.now(), refundProviderTransactionId: 'a3-refunded-partial' },
    });

    const report = await reconcilePayments({
      shadowEvidence: validShadowEvidence(), now: new Date('2026-08-19T01:00:00.000Z'),
    });

    expect(report.mismatches.refunds).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentId: pending.id }),
      expect.objectContaining({ paymentId: partialFull.id }),
      expect.objectContaining({ paymentId: refundedPartial.id }),
    ]));
  });

  test('refuses missing subscription recognition due from exact term progress', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const client = await makeClient('a3-recognition-client@test.uz');
    const subscription = await Subscription.create({
      userId: client.id, plan: 'basic', price: 100, expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
    const payment = await makePayment({
      userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', status: 'paid',
      idempotencyKey: 'a3-recognition', providerTransactionId: 'a3-recognition-provider',
      providerData: {
        termStart: '2026-08-17T00:00:00.000Z', termEnd: '2026-08-27T00:00:00.000Z',
      },
    });
    await postRawTransaction({
      operationKey: `payme:paid:${payment.providerTransactionId}`, paymentId: payment.id,
      creditAccount: 'liability:subscription_deferred_revenue', amountTiyin: 10000,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence(), now });

    expect(report.mismatches.deferredRevenue).toContainEqual(expect.objectContaining({
      paymentId: payment.id,
      expectedRecognizedTiyin: '2000',
      ledgerRecognizedTiyin: '0',
    }));
  });

  test('refuses missing promotion recognition due from completed service days', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const { user: lawyer } = await makeLawyer('a3-promotion-recognition@test.uz');
    const promotionPackage = await PromotionPackage.create({
      code: 'A3_RECOGNITION', name: { ru: 'A3' }, durationDays: 7, priceAmountTiyin: 10000,
      maxActiveSlots: 1, sponsoredPositions: [0], isActive: true,
    });
    const campaign = await LawyerPromotion.create({
      lawyerId: lawyer.id, packageId: promotionPackage.id, idempotencyKey: 'a3-promo-recognition',
      placement: 'catalog_top', specialization: 'civil', durationDays: 7, priceAmountTiyin: 10000,
      currency: 'UZS', maxActiveSlots: 1, sponsoredPositions: [0], status: 'active',
      paidAt: new Date('2026-08-16T00:00:00.000Z'), startsAt: new Date('2026-08-16T00:00:00.000Z'),
      activeSince: new Date('2026-08-16T00:00:00.000Z'), endsAt: new Date('2026-08-23T00:00:00.000Z'),
      remainingSeconds: 7 * 24 * 60 * 60,
    });
    const payment = await makePayment({
      userId: lawyer.id, lawyerPromotionId: campaign.id, purpose: 'lawyer_promotion', status: 'paid',
      idempotencyKey: 'a3-promo-recognition-payment', providerTransactionId: 'a3-promo-recognition-provider',
    });
    await campaign.update({ paymentId: payment.id });
    await postRawTransaction({
      operationKey: `payme:paid:${payment.providerTransactionId}`, paymentId: payment.id,
      creditAccount: 'liability:promotion_deferred_revenue', amountTiyin: 10000,
    });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence(), now });

    expect(report.mismatches.deferredRevenue).toContainEqual(expect.objectContaining({
      paymentId: payment.id,
      expectedRecognizedTiyin: '4284',
      ledgerRecognizedTiyin: '0',
    }));
  });

  test('provider totals snapshot is bound to injected reconciliation time and refuses stale or future capture', async () => {
    const now = new Date('2026-08-19T01:00:00.000Z');
    const stale = buildProviderSnapshot({ paidTiyin: 0, refundedTiyin: 0, transactionCount: 0 }, '2026-08-17T00:00:00.000Z');
    const future = buildProviderSnapshot({ paidTiyin: 0, refundedTiyin: 0, transactionCount: 0 }, '2026-08-19T01:10:00.000Z');

    const staleReport = await reconcilePayments({ shadowEvidence: validShadowEvidence(), providerSnapshot: stale, now });
    const futureReport = await reconcilePayments({ shadowEvidence: validShadowEvidence(), providerSnapshot: future, now });

    expect(staleReport.mismatches.providerTotals[0].reason).toMatch(/stale/i);
    expect(futureReport.mismatches.providerTotals[0].reason).toMatch(/future/i);
  });

  test('refuses deferred revenue drift and a mismatching sanitized provider totals snapshot', async () => {
    const client = await makeClient('a3-deferred-client@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'basic', price: 100, expiresAt: new Date(Date.now() + 86400000) });
    const payment = await makePayment({
      userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', status: 'paid',
      idempotencyKey: 'a3-subscription', providerTransactionId: 'a3-subscription-provider',
      providerData: { termStart: new Date().toISOString(), termEnd: new Date(Date.now() + 86400000).toISOString() },
    });
    await postRawTransaction({
      operationKey: `payme:paid:${payment.providerTransactionId}`, paymentId: payment.id,
      creditAccount: 'liability:subscription_deferred_revenue', amountTiyin: 10000,
    });
    await postRawTransaction({
      operationKey: 'a3-wrong-recognition', paymentId: payment.id,
      creditAccount: 'revenue:subscription', amountTiyin: 1000,
    });
    const snapshot = buildProviderSnapshot({ paidTiyin: 1, refundedTiyin: 0, transactionCount: 1 });

    const report = await reconcilePayments({ shadowEvidence: validShadowEvidence(), providerSnapshot: snapshot });

    expect(report.mismatches.deferredRevenue.length).toBeGreaterThan(0);
    expect(report.mismatches.providerTotals.length).toBeGreaterThan(0);
  });

  test('artifact-safe reconciliation summary contains counts and bindings but no row identifiers', () => {
    const summary = buildReconciliationSummary({
      ready: false,
      mismatchCount: 1,
      mismatches: { refunds: [{ paymentId: 'secret-payment', reason: 'missing' }], shadowEvidence: [] },
      databaseEvidence: reconciliationDatabaseEvidence(),
    }, {
      environment: 'local', commitSha: 'a'.repeat(40), deploymentId: 'local-a3',
      serviceId: 'api', configDigest: 'b'.repeat(64), expectedMigrationHead: MIGRATION_HEAD,
      providerSnapshotDigest: 'c'.repeat(64),
      providerSnapshotCapturedAt: '2026-08-18T23:59:00.000Z',
    });

    expect(summary.mismatchCounts).toEqual({ refunds: 1, shadowEvidence: 0 });
    expect(summary.summaryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(summary)).not.toContain('secret-payment');

    const pair = crypto.generateKeyPairSync('ed25519');
    const signed = signCanonicalArtifact(summary, { privateKey: pair.privateKey, keyId: 'a3-reconciliation' });
    expect(verifyCanonicalArtifact(signed, {
      publicKey: pair.publicKey,
      keyId: 'a3-reconciliation',
      kind: 'payment-reconciliation-summary',
      digestField: 'summaryDigest',
    })).toEqual(summary);

    const externalOnly = buildReconciliationSummary({
      ready: false, mismatchCount: 1,
      mismatches: { refunds: [], shadowEvidence: [{ reason: 'staging required' }], evidenceArtifacts: [] },
      databaseEvidence: reconciliationDatabaseEvidence(),
    }, {
      environment: 'local', commitSha: 'a'.repeat(40), deploymentId: 'local-a3', serviceId: 'api',
      configDigest: 'b'.repeat(64), expectedMigrationHead: MIGRATION_HEAD,
      providerSnapshotDigest: 'c'.repeat(64),
    });
    expect(externalOnly).toEqual(expect.objectContaining({ ready: true, mismatchCount: 0 }));
  });
});
