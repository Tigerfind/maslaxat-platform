const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { validateShadowEvidence } = require('../config/payment');
const { digest } = require('../services/paymentShadowEvidence');
const { assertMigrationState } = require('../db/assertMigrationState');

const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

class PaymentReconciliationError extends Error {
  constructor(report) {
    super(`Payment reconciliation found ${report.mismatchCount} mismatch(es)`);
    this.name = 'PaymentReconciliationError';
    this.report = report;
  }
}

async function rows(sql, transaction, replacements) {
  return sequelize.query(sql, { type: QueryTypes.SELECT, transaction, replacements });
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function expectedReceiptAccount(purpose) {
  if (['consultation', 'consultation_extension'].includes(purpose)) return 'liability:consultation_escrow';
  if (purpose === 'subscription') return 'liability:subscription_deferred_revenue';
  if (purpose === 'lawyer_promotion') return 'liability:promotion_deferred_revenue';
  return null;
}

function balanced(entries) {
  const debits = entries.filter(({ direction }) => direction === 'debit')
    .reduce((sum, entry) => sum + integer(entry.amountTiyin), 0);
  const credits = entries.filter(({ direction }) => direction === 'credit')
    .reduce((sum, entry) => sum + integer(entry.amountTiyin), 0);
  return debits === credits;
}

function validPaidReceipt(payment, transaction) {
  if (!transaction.isPosted || !balanced(transaction.entries)) return false;
  const amount = integer(payment.amountTiyin);
  const cashDebits = transaction.entries.filter((entry) => entry.account === 'asset:cash' && entry.direction === 'debit');
  if (cashDebits.length !== 1 || integer(cashDebits[0].amountTiyin) !== amount) return false;
  const credits = transaction.entries.filter((entry) => entry.direction === 'credit');
  const creditTotal = credits.reduce((sum, entry) => sum + integer(entry.amountTiyin), 0);
  if (creditTotal !== amount || transaction.entries.some((entry) => entry.direction === 'debit' && entry !== cashDebits[0])) return false;

  const providerKey = payment.providerTransactionId && `payme:paid:${payment.providerTransactionId}`;
  if (payment.provider === 'payme' && providerKey && transaction.operationKey === providerKey) {
    const expectedAccount = expectedReceiptAccount(payment.purpose);
    return transaction.entries.length === 2 && credits.length === 1
      && credits[0].account === expectedAccount && integer(credits[0].amountTiyin) === amount;
  }
  if (transaction.operationKey !== `legacy:opening:${payment.paymentId}`) return false;
  if (payment.purpose === 'subscription') {
    return credits.every(({ account }) => ['liability:subscription_deferred_revenue', 'revenue:subscription'].includes(account));
  }
  if (['consultation', 'consultation_extension'].includes(payment.purpose)) {
    const released = payment.escrowReleased || payment.consultationStatus === 'completed' || payment.billingStatus === 'released';
    if (!released) {
      return transaction.entries.length === 2 && credits.length === 1
        && credits[0].account === 'liability:consultation_escrow'
        && integer(credits[0].amountTiyin) === amount;
    }
    const snapshotGross = integer(payment.grossAmountTiyin);
    const snapshotNet = integer(payment.lawyerNetAmountTiyin);
    if (snapshotGross !== amount || snapshotNet === null || snapshotNet < 0 || snapshotNet > snapshotGross) return false;
    const expectedCommission = snapshotGross - snapshotNet;
    const payableCredits = credits.filter(({ account }) => account === 'liability:lawyer_payable');
    const commissionCredits = credits.filter(({ account }) => account === 'revenue:platform_commission');
    const expectedEntryCount = expectedCommission > 0 ? 3 : 2;
    return transaction.entries.length === expectedEntryCount
      && payableCredits.length === 1
      && integer(payableCredits[0].amountTiyin) === snapshotNet
      && (expectedCommission === 0
        ? commissionCredits.length === 0
        : commissionCredits.length === 1 && integer(commissionCredits[0].amountTiyin) === expectedCommission);
  }
  return false;
}

function legacyReleasedParts(payment, transaction) {
  if (transaction.operationKey !== `legacy:opening:${payment.paymentId}`
    || !transaction.isPosted || !balanced(transaction.entries)) return null;
  const amount = integer(payment.amountTiyin);
  const cashDebits = transaction.entries.filter(({ account, direction }) => account === 'asset:cash' && direction === 'debit');
  const credits = transaction.entries.filter(({ direction }) => direction === 'credit');
  if (cashDebits.length !== 1 || integer(cashDebits[0].amountTiyin) !== amount
    || transaction.entries.filter(({ direction }) => direction === 'debit').length !== 1
    || credits.some(({ account }) => !['liability:lawyer_payable', 'revenue:platform_commission'].includes(account))) return null;
  const payable = credits.filter(({ account }) => account === 'liability:lawyer_payable')
    .reduce((sum, entry) => sum + integer(entry.amountTiyin), 0);
  const commission = credits.filter(({ account }) => account === 'revenue:platform_commission')
    .reduce((sum, entry) => sum + integer(entry.amountTiyin), 0);
  return payable + commission === amount ? { cash: amount, payable, commission } : null;
}

function buildProviderSnapshot(totals, capturedAt = new Date().toISOString()) {
  const normalized = {
    schemaVersion: 1,
    provider: 'payme',
    currency: 'UZS',
    capturedAt,
    totals: {
      paidTiyin: integer(totals?.paidTiyin),
      refundedTiyin: integer(totals?.refundedTiyin),
      transactionCount: integer(totals?.transactionCount),
    },
  };
  const captureTime = Date.parse(capturedAt);
  if (Object.values(normalized.totals).some((value) => value === null || value < 0)
    || !Number.isFinite(captureTime) || new Date(captureTime).toISOString() !== capturedAt) {
    throw new Error('Valid sanitized Payme provider totals are required');
  }
  return { ...normalized, snapshotDigest: digest(normalized) };
}

function buildReconciliationSummary(report, bindings) {
  const databaseEvidence = report.databaseEvidence;
  if (!databaseEvidence || databaseEvidence.migrationHead !== bindings.expectedMigrationHead) {
    throw new Error('Reconciliation database migration head does not match the source attestation');
  }
  const mismatchCounts = Object.fromEntries(Object.entries(report.mismatches || {})
    .map(([category, values]) => [category, Array.isArray(values) ? values.length : 0]));
  const financialMismatchCount = Object.entries(mismatchCounts)
    .filter(([category]) => !['shadowEvidence', 'evidenceArtifacts'].includes(category))
    .reduce((sum, [, count]) => sum + count, 0);
  const summary = {
    schemaVersion: 2,
    kind: 'payment-reconciliation-summary',
    generatedAt: databaseEvidence.reconciledAt,
    environment: bindings.environment,
    release: {
      commitSha: bindings.commitSha,
      deploymentId: bindings.deploymentId,
      serviceId: bindings.serviceId,
      configDigest: bindings.configDigest,
      migrationHead: databaseEvidence.migrationHead,
    },
    databaseIdentityDigest: databaseEvidence.databaseIdentityDigest,
    snapshotIdentityDigest: databaseEvidence.snapshotIdentityDigest,
    reconciledAt: databaseEvidence.reconciledAt,
    providerSnapshotDigest: bindings.providerSnapshotDigest,
    providerSnapshotCapturedAt: bindings.providerSnapshotCapturedAt,
    ready: financialMismatchCount === 0,
    mismatchCount: financialMismatchCount,
    mismatchCounts,
  };
  return { ...summary, summaryDigest: digest(summary) };
}

function releaseFromSourceAttestation(source) {
  const release = {
    commitSha: source?.commitSha,
    deploymentId: source?.deploymentId,
    serviceId: source?.serviceId,
    configDigest: source?.configDigest,
    migrationHead: source?.migrationHead,
  };
  if (!/^[a-f0-9]{40}$/i.test(release.commitSha || '')
    || !release.deploymentId || !release.serviceId
    || !/^[a-f0-9]{64}$/.test(release.configDigest || '')
    || !/^[0-9]{14}-[a-z0-9-]+\.js$/.test(release.migrationHead || '')) {
    throw new Error('Verified source attestation release identity is invalid');
  }
  return release;
}

async function assertReconciliationDatabase({
  sequelize: database = sequelize,
  transaction,
  expectedMigrationHead = null,
  reconciledAt = new Date(),
  migrationsPath = migrationsDir,
  assertState = assertMigrationState,
}) {
  const reconciliationTime = reconciledAt instanceof Date ? reconciledAt : new Date(reconciledAt);
  if (!Number.isFinite(reconciliationTime.getTime())) throw new Error('Valid reconciliation time is required');
  const migrationState = await assertState({
    sequelize: database,
    migrationsDir: migrationsPath,
    transaction,
  });
  if (expectedMigrationHead && migrationState.migrationHead !== expectedMigrationHead) {
    throw Object.assign(new Error('Reconciliation database migration head differs from source attestation'), {
      code: 'RECONCILIATION_MIGRATION_HEAD_MISMATCH',
      expectedMigrationHead,
      actualMigrationHead: migrationState.migrationHead,
    });
  }
  const [identityRows] = await database.query(`
    SELECT current_database()::text AS "databaseName",
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
      current_setting('server_version_num') AS "serverVersion",
      txid_current_snapshot()::text AS snapshot
  `, { transaction });
  const identity = identityRows[0];
  if (!identity?.databaseName || !identity.databaseOid || !identity.serverVersion || !identity.snapshot) {
    throw new Error('Reconciliation database identity is unavailable');
  }
  const databaseIdentityDigest = digest({
    databaseName: identity.databaseName,
    databaseOid: identity.databaseOid,
    serverVersion: identity.serverVersion,
  });
  return {
    migrationHead: migrationState.migrationHead,
    databaseIdentityDigest,
    snapshotIdentityDigest: digest({ databaseIdentityDigest, snapshot: identity.snapshot }),
    reconciledAt: reconciliationTime.toISOString(),
  };
}

async function collectReconciliation(shadowEvidence, transaction, providerSnapshot = null, now = new Date()) {
  const reconciliationTime = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(reconciliationTime.getTime())) throw new Error('Valid reconciliation time is required');
  const mismatches = {
    ambiguousRows: await rows(`
      SELECT id AS "paymentId", purpose, status,
        'payment type, amount, or subject is ambiguous' AS reason
      FROM payments
      WHERE purpose IS NULL
         OR amount_tiyin IS NULL
         OR amount_tiyin <= 0
         OR (purpose IN ('consultation', 'consultation_extension')
             AND (consultation_id IS NULL OR subscription_id IS NOT NULL))
         OR (purpose = 'subscription'
             AND (subscription_id IS NULL OR consultation_id IS NOT NULL))
         OR (provider_transaction_id IS NOT NULL AND transaction_id IS NOT NULL
             AND provider_transaction_id <> transaction_id)
      ORDER BY id
    `, transaction),
    pendingLegacy: await rows(`
      SELECT id AS "paymentId", status
      FROM payments
      WHERE status IN ('pending', 'processing')
      ORDER BY id
    `, transaction),
    amount: await rows(`
      SELECT id AS "paymentId", amount::text AS "amountSum", amount_tiyin::text AS "amountTiyin"
      FROM payments
      WHERE amount_tiyin IS NULL
         OR amount_tiyin <> ROUND(amount * 100)::bigint
      ORDER BY id
    `, transaction),
    prepaymentFlow: await rows(`
      SELECT c.id AS "consultationId", c.status, c.billing_status AS "billingStatus",
        CASE
          WHEN c.billing_status = 'held' THEN 'legacy five-minute hold remains unresolved'
          WHEN c.status = 'payment_pending' THEN 'payment-pending consultation has no active base checkout'
          ELSE 'actionable paid consultation has no paid base payment'
        END AS reason
      FROM consultations c
      LEFT JOIN payments p
        ON p.consultation_id = c.id
       AND p.purpose = 'consultation'
      WHERE c.is_free = false
        AND c.price > 0
      GROUP BY c.id, c.status, c.billing_status
      HAVING c.billing_status = 'held'
         OR (c.status = 'payment_pending'
             AND COUNT(p.id) FILTER (WHERE p.status IN ('pending', 'processing')) = 0)
         OR (c.status IN ('pending', 'accepted', 'in_progress')
             AND COUNT(p.id) FILTER (WHERE p.status = 'paid') = 0)
      ORDER BY c.id
    `, transaction),
    state: [],
    providerDuplicates: await rows(`
      SELECT provider,
        COALESCE(NULLIF(provider_transaction_id, ''), NULLIF(transaction_id, '')) AS "providerTransactionId",
        COUNT(*)::int AS count
      FROM payments
      WHERE COALESCE(NULLIF(provider_transaction_id, ''), NULLIF(transaction_id, '')) IS NOT NULL
      GROUP BY provider, COALESCE(NULLIF(provider_transaction_id, ''), NULLIF(transaction_id, ''))
      HAVING COUNT(*) > 1
      ORDER BY provider, COALESCE(NULLIF(provider_transaction_id, ''), NULLIF(transaction_id, ''))
    `, transaction),
    ledgerTransactions: await rows(`
      SELECT ft.id AS "financialTransactionId", ft.operation_key AS "operationKey",
        COALESCE(SUM(CASE WHEN fe.direction = 'debit' THEN fe.amount_tiyin ELSE 0 END), 0)::text AS debits,
        COALESCE(SUM(CASE WHEN fe.direction = 'credit' THEN fe.amount_tiyin ELSE 0 END), 0)::text AS credits,
        CASE WHEN ft.is_posted = false THEN 'financial transaction is not finalized'
             ELSE 'financial transaction is unbalanced' END AS reason
      FROM financial_transactions ft
      LEFT JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
      GROUP BY ft.id, ft.operation_key, ft.is_posted
      HAVING ft.is_posted = false
         OR COALESCE(SUM(CASE WHEN fe.direction = 'debit' THEN fe.amount_tiyin ELSE 0 END), 0)
          <> COALESCE(SUM(CASE WHEN fe.direction = 'credit' THEN fe.amount_tiyin ELSE 0 END), 0)
      ORDER BY ft.operation_key
    `, transaction),
    ledgerAttribution: [],
    ledgerCaches: [],
    shadowEvidence: [],
    promotionSubjects: [],
    refunds: [],
    deferredRevenue: [],
    providerTotals: [],
    evidenceArtifacts: [],
  };

  mismatches.promotionSubjects.push(...await rows(`
    SELECT p.id AS "paymentId", p.lawyer_promotion_id AS "promotionId",
      'promotion payment and campaign binding or snapshot is inconsistent' AS reason
    FROM payments p
    LEFT JOIN lawyer_promotions lp ON lp.id = p.lawyer_promotion_id
    WHERE p.purpose = 'lawyer_promotion'
      AND (p.lawyer_promotion_id IS NULL OR p.consultation_id IS NOT NULL OR p.subscription_id IS NOT NULL
        OR lp.id IS NULL OR lp.payment_id IS DISTINCT FROM p.id
        OR lp.price_amount_tiyin IS DISTINCT FROM p.amount_tiyin OR lp.currency IS DISTINCT FROM p.currency)
    UNION ALL
    SELECT lp.payment_id AS "paymentId", lp.id AS "promotionId",
      'campaign payment does not bind to its exact promotion subject' AS reason
    FROM lawyer_promotions lp
    LEFT JOIN payments p ON p.id = lp.payment_id
    WHERE lp.payment_id IS NOT NULL
      AND (p.id IS NULL OR p.purpose IS DISTINCT FROM 'lawyer_promotion' OR p.lawyer_promotion_id IS DISTINCT FROM lp.id)
    ORDER BY "promotionId"
  `, transaction));

  mismatches.refunds.push(...await rows(`
    SELECT p.id AS "paymentId", p.status,
      CASE WHEN p.status = 'refund_pending' THEN 'provider refund remains unresolved'
        ELSE 'provider-confirmed refund lacks exact status amount, confirmation, or balanced reversal' END AS reason
    FROM payments p
    WHERE p.status = 'refund_pending'
       OR (p.status IN ('partially_refunded', 'refunded') AND (
        p.refunded_amount_tiyin IS NULL OR p.refunded_amount_tiyin <= 0
        OR p.refunded_amount_tiyin > p.amount_tiyin OR p.refunded_at IS NULL
        OR (p.status = 'partially_refunded' AND p.refunded_amount_tiyin >= p.amount_tiyin)
        OR (p.status = 'refunded' AND p.refunded_amount_tiyin <> p.amount_tiyin)
        OR NULLIF(p.provider_data->>'refundProviderTransactionId', '') IS NULL
        OR COALESCE((p.provider_data->>'cancelTime') ~ '^[1-9][0-9]*$', false) = false
        OR NOT EXISTS (
          SELECT 1
          FROM financial_transactions ft
          JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
          WHERE ft.payment_id = p.id AND ft.is_posted = true
            AND ft.operation_key = CASE p.purpose
              WHEN 'consultation' THEN 'consultation:refund:' || p.id::text
              WHEN 'consultation_extension' THEN 'consultation:extension:refund:' || p.id::text
              WHEN 'subscription' THEN 'subscription:refund:' || p.id::text
              WHEN 'lawyer_promotion' THEN 'promotion:refund:' || p.id::text
            END
          GROUP BY ft.id
          HAVING SUM(CASE WHEN fe.direction = 'debit' AND fe.account = CASE
                    WHEN p.purpose IN ('consultation', 'consultation_extension') THEN 'liability:consultation_escrow'
                    WHEN p.purpose = 'subscription' THEN 'liability:subscription_deferred_revenue'
                    WHEN p.purpose = 'lawyer_promotion' THEN 'liability:promotion_deferred_revenue'
                  END THEN fe.amount_tiyin ELSE 0 END) = p.refunded_amount_tiyin
             AND SUM(CASE WHEN fe.direction = 'credit' AND fe.account = 'asset:cash' THEN fe.amount_tiyin ELSE 0 END) = p.refunded_amount_tiyin
             AND SUM(CASE WHEN fe.direction = 'debit' THEN fe.amount_tiyin ELSE -fe.amount_tiyin END) = 0
             AND COUNT(*) = 2
        )
      ))
    ORDER BY p.id
  `, transaction));

  mismatches.deferredRevenue.push(...await rows(`
    WITH deferred AS (
      SELECT p.id AS payment_id, p.purpose, p.amount_tiyin,
        COALESCE(p.refunded_amount_tiyin, 0) AS refunded,
        COALESCE(SUM(CASE WHEN fe.direction = 'credit' AND fe.account = CASE p.purpose
          WHEN 'subscription' THEN 'liability:subscription_deferred_revenue'
          WHEN 'lawyer_promotion' THEN 'liability:promotion_deferred_revenue' END THEN fe.amount_tiyin ELSE 0 END), 0) AS deferred_credits,
        COALESCE(SUM(CASE WHEN fe.direction = 'debit' AND fe.account = CASE p.purpose
          WHEN 'subscription' THEN 'liability:subscription_deferred_revenue'
          WHEN 'lawyer_promotion' THEN 'liability:promotion_deferred_revenue' END THEN fe.amount_tiyin ELSE 0 END), 0) AS deferred_debits,
        COALESCE(SUM(CASE WHEN fe.direction = 'credit' AND fe.account = CASE p.purpose
          WHEN 'subscription' THEN 'revenue:subscription'
          WHEN 'lawyer_promotion' THEN 'revenue:promotion' END THEN fe.amount_tiyin ELSE 0 END), 0) AS recognized
      FROM payments p
      LEFT JOIN financial_transactions ft ON ft.payment_id = p.id AND ft.is_posted = true
      LEFT JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
      WHERE p.purpose IN ('subscription', 'lawyer_promotion')
        AND p.status IN ('paid', 'refund_pending', 'partially_refunded', 'refunded')
      GROUP BY p.id, p.purpose, p.amount_tiyin, p.refunded_amount_tiyin
    )
    SELECT payment_id AS "paymentId", purpose,
      (amount_tiyin - refunded - recognized)::text AS "expectedDeferredTiyin",
      (deferred_credits - deferred_debits)::text AS "ledgerDeferredTiyin",
      'deferred revenue obligation does not match posted ledger entries' AS reason
    FROM deferred
    WHERE amount_tiyin - refunded - recognized <> deferred_credits - deferred_debits
       OR amount_tiyin - refunded - recognized < 0
    ORDER BY payment_id
  `, transaction));

  const subscriptionRecognition = await rows(`
    SELECT p.id AS "paymentId", p.amount_tiyin AS "amountTiyin", p.refunded_at AS "refundedAt",
      p.provider_data->>'termStart' AS "termStart", p.provider_data->>'termEnd' AS "termEnd",
      COALESCE(SUM(CASE WHEN fe.account = 'revenue:subscription' AND fe.direction = 'credit'
        THEN fe.amount_tiyin ELSE 0 END), 0)::text AS "recognizedTiyin"
    FROM payments p
    LEFT JOIN financial_transactions ft ON ft.payment_id = p.id AND ft.is_posted = true
    LEFT JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
    WHERE p.purpose = 'subscription'
      AND p.status IN ('paid', 'refund_pending', 'partially_refunded', 'refunded')
    GROUP BY p.id, p.amount_tiyin, p.refunded_at, p.provider_data
    ORDER BY p.id
  `, transaction);
  for (const row of subscriptionRecognition) {
    const start = Date.parse(row.termStart);
    const end = Date.parse(row.termEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const refundBoundary = row.refundedAt ? new Date(row.refundedAt).getTime() : reconciliationTime.getTime();
    const bounded = Math.max(start, Math.min(reconciliationTime.getTime(), refundBoundary, end));
    const expected = Math.floor((integer(row.amountTiyin) * (bounded - start)) / (end - start));
    const actual = integer(row.recognizedTiyin);
    if (actual !== expected) {
      mismatches.deferredRevenue.push({
        paymentId: row.paymentId,
        expectedRecognizedTiyin: String(expected),
        ledgerRecognizedTiyin: String(actual),
        reason: 'subscription revenue recognition does not match exact term progress',
      });
    }
  }

  const promotionRecognition = await rows(`
    SELECT p.id AS "paymentId", p.amount_tiyin AS "amountTiyin", p.refunded_at AS "refundedAt",
      lp.status, lp.duration_days AS "durationDays", lp.remaining_seconds AS "remainingSeconds",
      lp.active_since AS "activeSince", lp.ends_at AS "endsAt", lp.starts_at AS "startsAt",
      COALESCE(SUM(CASE WHEN fe.account = 'revenue:promotion' AND fe.direction = 'credit'
        THEN fe.amount_tiyin ELSE 0 END), 0)::text AS "recognizedTiyin"
    FROM payments p
    JOIN lawyer_promotions lp ON lp.id = p.lawyer_promotion_id AND lp.payment_id = p.id
    LEFT JOIN financial_transactions ft ON ft.payment_id = p.id AND ft.is_posted = true
    LEFT JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
    WHERE p.purpose = 'lawyer_promotion'
      AND p.status IN ('paid', 'refund_pending', 'partially_refunded', 'refunded')
    GROUP BY p.id, p.amount_tiyin, p.refunded_at, lp.id
    ORDER BY p.id
  `, transaction);
  for (const row of promotionRecognition) {
    const durationDays = integer(row.durationDays);
    const gross = integer(row.amountTiyin);
    const actual = integer(row.recognizedTiyin);
    if (!durationDays || !gross || !row.startsAt) continue;
    const totalSeconds = durationDays * 24 * 60 * 60;
    let servedSeconds = row.status === 'expired'
      ? totalSeconds
      : totalSeconds - (integer(row.remainingSeconds) ?? totalSeconds);
    if (row.status === 'active' && row.activeSince) {
      const activeSince = new Date(row.activeSince).getTime();
      const end = row.endsAt
        ? Math.min(reconciliationTime.getTime(), new Date(row.endsAt).getTime())
        : reconciliationTime.getTime();
      servedSeconds += Math.max(0, Math.floor((end - activeSince) / 1000));
    }
    servedSeconds = Math.max(0, Math.min(totalSeconds, servedSeconds));
    const completedDays = Math.min(durationDays, Math.floor(servedSeconds / (24 * 60 * 60)));
    const expected = completedDays === durationDays
      ? gross
      : Math.floor(gross / durationDays) * completedDays;
    if (actual !== expected) {
      mismatches.deferredRevenue.push({
        paymentId: row.paymentId,
        expectedRecognizedTiyin: String(expected),
        ledgerRecognizedTiyin: String(actual),
        reason: 'promotion revenue recognition does not match completed service days',
      });
    }
  }

  const duplicateBaseRows = await rows(`
    SELECT consultation_id AS "consultationId", ARRAY_AGG(id ORDER BY id) AS "paymentIds"
    FROM payments
    WHERE purpose = 'consultation'
      AND status IN ('pending', 'processing', 'paid', 'refund_pending', 'partially_refunded')
      AND consultation_id IS NOT NULL
    GROUP BY consultation_id
    HAVING COUNT(*) > 1
    ORDER BY consultation_id
  `, transaction);
  mismatches.ambiguousRows.push(...duplicateBaseRows.map((row) => ({
    ...row,
    reason: 'duplicate active base consultation payments',
  })));

  const subscriptionTerms = await rows(`
    SELECT id AS "paymentId", subscription_id AS "subscriptionId",
      provider_data->>'termStart' AS "termStart", provider_data->>'termEnd' AS "termEnd"
    FROM payments
    WHERE purpose = 'subscription' AND status = 'paid'
    ORDER BY subscription_id, id
  `, transaction);
  const termsBySubscription = new Map();
  for (const row of subscriptionTerms) {
    const start = Date.parse(row.termStart);
    const end = Date.parse(row.termEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      mismatches.ambiguousRows.push({ paymentId: row.paymentId, reason: 'invalid paid subscription term snapshot' });
      continue;
    }
    const terms = termsBySubscription.get(row.subscriptionId) || [];
    terms.push({ ...row, start, end });
    termsBySubscription.set(row.subscriptionId, terms);
  }
  for (const [subscriptionId, terms] of termsBySubscription) {
    terms.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let left = 0; left < terms.length; left += 1) {
      for (let right = left + 1; right < terms.length; right += 1) {
        if (terms[right].start >= terms[left].end) break;
        mismatches.ambiguousRows.push({
          subscriptionId,
          paymentIds: [terms[left].paymentId, terms[right].paymentId],
          reason: 'overlapping paid subscription terms',
        });
      }
    }
  }

  const paidReceiptRows = await rows(`
    SELECT p.id AS "paymentId", p.purpose, p.provider, p.consultation_id AS "consultationId",
      p.amount_tiyin AS "amountTiyin",
      p.provider_transaction_id AS "providerTransactionId", p.escrow_released AS "escrowReleased",
      c.status AS "consultationStatus", c.billing_status AS "billingStatus",
      c.gross_amount_tiyin AS "grossAmountTiyin", c.lawyer_net_amount_tiyin AS "lawyerNetAmountTiyin",
      ft.id AS "financialTransactionId", ft.operation_key AS "operationKey", ft.is_posted AS "isPosted",
      fe.account, fe.direction, fe.amount_tiyin AS "entryAmountTiyin"
    FROM payments p
    LEFT JOIN consultations c ON c.id = p.consultation_id
    LEFT JOIN financial_transactions ft ON ft.payment_id = p.id
    LEFT JOIN financial_entries fe ON fe.financial_transaction_id = ft.id
    WHERE p.status = 'paid'
    ORDER BY p.id, ft.id, fe.id
  `, transaction);
  const paidPayments = new Map();
  for (const row of paidReceiptRows) {
    let payment = paidPayments.get(row.paymentId);
    if (!payment) {
      payment = {
        paymentId: row.paymentId,
        purpose: row.purpose,
        provider: row.provider,
        consultationId: row.consultationId,
        amountTiyin: row.amountTiyin,
        providerTransactionId: row.providerTransactionId,
        escrowReleased: row.escrowReleased,
        consultationStatus: row.consultationStatus,
        billingStatus: row.billingStatus,
        grossAmountTiyin: row.grossAmountTiyin,
        lawyerNetAmountTiyin: row.lawyerNetAmountTiyin,
        transactions: new Map(),
      };
      paidPayments.set(row.paymentId, payment);
    }
    if (row.financialTransactionId) {
      let receipt = payment.transactions.get(row.financialTransactionId);
      if (!receipt) {
        receipt = {
          operationKey: row.operationKey,
          isPosted: row.isPosted,
          entries: [],
        };
        payment.transactions.set(row.financialTransactionId, receipt);
      }
      if (row.account) receipt.entries.push({ account: row.account, direction: row.direction, amountTiyin: row.entryAmountTiyin });
    }
  }
  const validReleasedLegacyPayments = new Set();
  const releasedLegacyGroups = new Map();
  for (const payment of paidPayments.values()) {
    const released = payment.escrowReleased || payment.consultationStatus === 'completed' || payment.billingStatus === 'released';
    if (!released || !['consultation', 'consultation_extension'].includes(payment.purpose) || !payment.consultationId) continue;
    const receipt = [...payment.transactions.values()].find((candidate) => candidate.operationKey === `legacy:opening:${payment.paymentId}`);
    const parts = receipt && legacyReleasedParts(payment, receipt);
    if (!parts) continue;
    const group = releasedLegacyGroups.get(payment.consultationId) || [];
    group.push({ payment, parts });
    releasedLegacyGroups.set(payment.consultationId, group);
  }
  for (const group of releasedLegacyGroups.values()) {
    const first = group[0].payment;
    const snapshotGross = integer(first.grossAmountTiyin);
    const snapshotNet = integer(first.lawyerNetAmountTiyin);
    const consistentSnapshots = group.every(({ payment }) => integer(payment.grossAmountTiyin) === snapshotGross
      && integer(payment.lawyerNetAmountTiyin) === snapshotNet);
    const cash = group.reduce((sum, item) => sum + item.parts.cash, 0);
    const payable = group.reduce((sum, item) => sum + item.parts.payable, 0);
    const commission = group.reduce((sum, item) => sum + item.parts.commission, 0);
    if (consistentSnapshots && snapshotGross !== null && snapshotNet !== null
      && snapshotNet >= 0 && snapshotNet <= snapshotGross
      && cash === snapshotGross && payable === snapshotNet && commission === snapshotGross - snapshotNet) {
      group.forEach(({ payment }) => validReleasedLegacyPayments.add(payment.paymentId));
    }
  }
  for (const payment of paidPayments.values()) {
    if (!validReleasedLegacyPayments.has(payment.paymentId)
      && ![...payment.transactions.values()].some((receipt) => validPaidReceipt(payment, receipt))) {
      mismatches.state.push({
        paymentId: payment.paymentId,
        status: 'paid',
        reason: 'paid payment has no exact finalized balanced receipt',
      });
    }
  }

  const accountRows = await rows(`
      SELECT account,
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_tiyin ELSE -amount_tiyin END), 0)::text AS balance
      FROM financial_entries
      WHERE account IN ('liability:consultation_escrow', 'liability:lawyer_payable')
      GROUP BY account
    `, transaction);
  const pendingRows = await rows(`
      WITH obligations AS (
        SELECT c.lawyer_id,
          COALESCE(SUM(c.lawyer_net_amount_tiyin), 0)::bigint AS expected
        FROM consultations c
        WHERE EXISTS (
          SELECT 1 FROM payments p
          WHERE p.consultation_id = c.id
            AND p.purpose IN ('consultation', 'consultation_extension')
            AND p.status IN ('paid', 'refund_pending')
            AND p.escrow_released = false
        )
        GROUP BY c.lawyer_id
      )
      SELECT COALESCE(o.lawyer_id::text, lp.user_id::text) AS "userId",
        o.expected::text AS expected,
        CASE WHEN lp.id IS NULL THEN NULL ELSE ROUND(lp.pending_balance * 100)::text END AS actual,
        lp.id IS NULL AS "cacheMissing"
      FROM obligations o
      FULL OUTER JOIN lawyer_profiles lp ON lp.user_id = o.lawyer_id
      ORDER BY COALESCE(o.lawyer_id::text, lp.user_id::text)
    `, transaction);
  const accounts = new Map(accountRows.map((row) => [row.account, integer(row.balance)]));

  for (const row of pendingRows) {
    const expected = integer(row.expected) || 0;
    const actual = row.cacheMissing ? null : integer(row.actual);
    if (row.cacheMissing || actual !== expected) {
      mismatches.ledgerCaches.push({
        cache: 'lawyer.pendingBalance',
        userId: row.userId,
        ledgerTiyin: expected,
        cacheTiyin: actual,
        cacheMissing: row.cacheMissing,
      });
    }
  }

  const expectedEscrowRows = await rows(`
    SELECT COALESCE(SUM(amount_tiyin), 0)::text AS total
    FROM payments
    WHERE purpose IN ('consultation', 'consultation_extension')
      AND status IN ('paid', 'refund_pending')
      AND escrow_released = false
  `, transaction);
  const expectedEscrow = integer(expectedEscrowRows[0].total);
  const ledgerEscrow = accounts.get('liability:consultation_escrow') || 0;
  if (ledgerEscrow !== expectedEscrow) {
    mismatches.ledgerCaches.push({
      cache: 'consultation.escrow', ledgerTiyin: ledgerEscrow, cacheTiyin: expectedEscrow,
    });
  }

  const payableEntries = await rows(`
    SELECT ft.id AS "financialTransactionId",
      NULLIF(ft.metadata->>'lawyerId', '') AS "metadataLawyerId",
      payment_consultation.lawyer_id::text AS "paymentLawyerId",
      release_consultation.lawyer_id::text AS "operationLawyerId",
      CASE WHEN fe.direction = 'credit' THEN fe.amount_tiyin ELSE -fe.amount_tiyin END AS amount
    FROM financial_entries fe
    JOIN financial_transactions ft ON ft.id = fe.financial_transaction_id
    LEFT JOIN payments p ON p.id = ft.payment_id
    LEFT JOIN consultations payment_consultation ON payment_consultation.id = p.consultation_id
    LEFT JOIN consultations release_consultation
      ON ft.operation_key = 'consultation:release:' || release_consultation.id::text
    WHERE fe.account = 'liability:lawyer_payable'
    ORDER BY ft.id, fe.id
  `, transaction);
  const payableByLawyer = new Map();
  for (const entry of payableEntries) {
    const sources = [...new Set([
      entry.metadataLawyerId,
      entry.paymentLawyerId,
      entry.operationLawyerId,
    ].filter(Boolean))];
    if (sources.length !== 1) {
      mismatches.ledgerAttribution.push({
        financialTransactionId: entry.financialTransactionId,
        reason: sources.length === 0
          ? 'missing lawyer attribution source'
          : 'conflicting lawyer attribution sources',
        sources,
      });
      continue;
    }
    payableByLawyer.set(sources[0], (payableByLawyer.get(sources[0]) || 0) + integer(entry.amount));
  }
  const profileBalanceRows = await rows(`
    SELECT user_id::text AS "userId", ROUND(balance * 100)::text AS "cacheTiyin"
    FROM lawyer_profiles
    ORDER BY user_id
  `, transaction);
  const profilesByLawyer = new Map(profileBalanceRows.map((row) => [row.userId, integer(row.cacheTiyin)]));
  const lawyerIds = [...new Set([...payableByLawyer.keys(), ...profilesByLawyer.keys()])].sort();
  for (const userId of lawyerIds) {
    const ledgerTiyin = payableByLawyer.get(userId) || 0;
    const cacheMissing = !profilesByLawyer.has(userId);
    const cacheTiyin = cacheMissing ? null : profilesByLawyer.get(userId);
    if (cacheMissing || ledgerTiyin !== cacheTiyin) {
      mismatches.ledgerCaches.push({
        cache: 'lawyer.balance',
        userId,
        ledgerTiyin,
        cacheTiyin,
        cacheMissing,
      });
    }
  }

  try {
    validateShadowEvidence(shadowEvidence, { requireCutover: true });
  } catch (error) {
    mismatches.shadowEvidence.push({ reason: error.message });
  }
  if (providerSnapshot) {
    try {
      const expectedDigest = providerSnapshot.snapshotDigest;
      const normalized = buildProviderSnapshot(providerSnapshot.totals, providerSnapshot.capturedAt);
      if (providerSnapshot.schemaVersion !== 1 || providerSnapshot.provider !== 'payme'
        || providerSnapshot.currency !== 'UZS' || normalized.snapshotDigest !== expectedDigest) {
        throw new Error('Provider totals snapshot digest or metadata does not match');
      }
      const capturedAt = Date.parse(normalized.capturedAt);
      const nowTime = reconciliationTime.getTime();
      if (capturedAt > nowTime + 5 * 60 * 1000) throw new Error('Provider totals snapshot is from the future');
      if (nowTime - capturedAt > 15 * 60 * 1000) throw new Error('Provider totals snapshot is stale');
      const totals = (await rows(`
        SELECT COALESCE(SUM(amount_tiyin), 0)::text AS "paidTiyin",
          COALESCE(SUM(refunded_amount_tiyin), 0)::text AS "refundedTiyin",
          COUNT(*)::int AS "transactionCount"
        FROM payments
        WHERE provider = 'payme'
          AND status IN ('paid', 'refund_pending', 'partially_refunded', 'refunded')
      `, transaction))[0];
      if (integer(totals.paidTiyin) !== normalized.totals.paidTiyin
        || integer(totals.refundedTiyin) !== normalized.totals.refundedTiyin
        || integer(totals.transactionCount) !== normalized.totals.transactionCount) {
        mismatches.providerTotals.push({ reason: 'Sanitized Payme totals do not match database totals' });
      }
    } catch (error) {
      mismatches.providerTotals.push({ reason: error.message });
    }
  }
  return mismatches;
}

async function reconcilePayments({
  failOnMismatch = false, shadowEvidence = null, providerSnapshot = null, now = new Date(),
  expectedMigrationHead = null,
} = {}) {
  const result = await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY', { transaction });
    const databaseEvidence = await assertReconciliationDatabase({
      transaction,
      expectedMigrationHead,
      reconciledAt: now,
    });
    const mismatches = await collectReconciliation(shadowEvidence, transaction, providerSnapshot, now);
    return { mismatches, databaseEvidence };
  });
  const { mismatches, databaseEvidence } = result;
  const mismatchCount = Object.values(mismatches).reduce((sum, list) => sum + list.length, 0);
  const report = { ready: mismatchCount === 0, mismatchCount, mismatches, databaseEvidence };
  if (failOnMismatch && mismatchCount > 0) throw new PaymentReconciliationError(report);
  return report;
}

function parseCliArgs(argv) {
  const options = {
    failOnMismatch: false, recordMetadata: false, metadataFile: null, shadowEvidenceFile: null,
    providerSnapshotFile: null, sourceAttestationFile: null,
    summaryBindingsFile: null, summaryFile: null, reconcileAt: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fail-on-mismatch') options.failOnMismatch = true;
    else if (arg === '--record-metadata') options.recordMetadata = true;
    else if (arg === '--metadata-file') options.metadataFile = argv[++index];
    else if (arg === '--shadow-evidence') options.shadowEvidenceFile = argv[++index];
    else if (arg === '--provider-snapshot') options.providerSnapshotFile = argv[++index];
    else if (arg === '--source-attestation') options.sourceAttestationFile = argv[++index];
    else if (arg === '--reconcile-at') options.reconcileAt = argv[++index];
    else if (arg === '--summary-bindings') options.summaryBindingsFile = argv[++index];
    else if (arg === '--summary-file') options.summaryFile = argv[++index];
    else if (arg !== '--') throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.metadataFile && !options.recordMetadata) {
    throw new Error('--metadata-file requires explicit --record-metadata');
  }
  if (options.recordMetadata && !options.metadataFile) {
    throw new Error('--record-metadata requires --metadata-file');
  }
  if (Boolean(options.summaryBindingsFile) !== Boolean(options.summaryFile)) {
    throw new Error('--summary-bindings and --summary-file are required together');
  }
  if (options.summaryFile && !options.sourceAttestationFile) {
    throw new Error('--source-attestation is required with reconciliation summary output');
  }
  if (options.providerSnapshotFile && !options.reconcileAt) {
    throw new Error('--provider-snapshot requires injected --reconcile-at');
  }
  return options;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseCliArgs(argv);
  const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const writeFile = dependencies.writeFile || ((file, value) => fs.writeFileSync(file, value, { flag: 'wx' }));
  const reconcile = dependencies.reconcile || reconcilePayments;
  const shadowEvidence = options.shadowEvidenceFile
    ? JSON.parse(readFile(options.shadowEvidenceFile))
    : null;
  const providerSnapshot = options.providerSnapshotFile
    ? JSON.parse(readFile(options.providerSnapshotFile))
    : null;
  const now = options.reconcileAt ? new Date(options.reconcileAt) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('--reconcile-at must be an ISO timestamp');
  const bindings = options.summaryBindingsFile
    ? JSON.parse(readFile(options.summaryBindingsFile))
    : null;
  const sourceRelease = options.sourceAttestationFile
    ? releaseFromSourceAttestation(JSON.parse(readFile(options.sourceAttestationFile)))
    : null;
  const effectiveBindings = bindings
    ? { ...bindings, ...sourceRelease, expectedMigrationHead: sourceRelease.migrationHead }
    : null;
  const report = await reconcile({
    failOnMismatch: options.failOnMismatch,
    shadowEvidence,
    providerSnapshot,
    now,
    expectedMigrationHead: sourceRelease?.migrationHead || null,
  });
  if (options.recordMetadata) {
    const metadata = {
      ready: report.ready,
      mismatchCount: report.mismatchCount,
      mismatchCounts: Object.fromEntries(
        Object.entries(report.mismatches || {}).map(([category, values]) => [category, values.length])
      ),
    };
    writeFile(options.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  if (options.summaryFile) {
    writeFile(options.summaryFile, `${JSON.stringify(buildReconciliationSummary(report, effectiveBindings), null, 2)}\n`);
  }
  if (!dependencies.reconcile) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  runCli()
    .catch((error) => {
      const output = error.report || { error: error.message };
      process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = {
  PaymentReconciliationError,
  assertReconciliationDatabase,
  buildProviderSnapshot,
  buildReconciliationSummary,
  releaseFromSourceAttestation,
  parseCliArgs,
  reconcilePayments,
  runCli,
};
