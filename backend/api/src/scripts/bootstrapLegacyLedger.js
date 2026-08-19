const {
  sequelize,
  Consultation,
  FinancialTransaction,
  Payment,
  Subscription,
} = require('../models');
const { ACCOUNTS, postTransaction } = require('../services/ledgerService');

class LegacyLedgerAmbiguityError extends Error {
  constructor(report) {
    super(`Legacy ledger bootstrap aborted: ${report.length} ambiguous payment(s)`);
    this.name = 'LegacyLedgerAmbiguityError';
    this.report = report;
  }
}

function amountTiyin(payment) {
  const amount = Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function subscriptionOpening(payment, subscription, now) {
  const gross = amountTiyin(payment);
  const start = new Date(payment.providerData?.termStart);
  const end = new Date(payment.providerData?.termEnd);
  if (!subscription || !gross || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const elapsed = Math.max(0, Math.min(now.getTime(), end.getTime()) - start.getTime());
  const recognized = Math.floor((gross * elapsed) / (end.getTime() - start.getTime()));
  const deferred = gross - recognized;
  const entries = [{ account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross }];
  if (recognized > 0) entries.push({ account: ACCOUNTS.SUBSCRIPTION_REVENUE, direction: 'credit', amountTiyin: recognized });
  if (deferred > 0) entries.push({ account: ACCOUNTS.SUBSCRIPTION_DEFERRED_REVENUE, direction: 'credit', amountTiyin: deferred });
  return entries;
}

function consultationOpening(payment, consultation, consultationPayments) {
  const gross = amountTiyin(payment);
  if (!consultation || !gross) return null;
  const isReleased = payment.escrowReleased || consultation.status === 'completed' || consultation.billingStatus === 'released';
  if (isReleased) {
    const snapshotGross = Number(consultation.grossAmountTiyin);
    const snapshotNet = Number(consultation.lawyerNetAmountTiyin);
    const rate = Number(consultation.commissionRateBps);
    const group = consultationPayments.filter((row) => row.consultationId === consultation.id);
    const groupGross = group.reduce((sum, row) => sum + (amountTiyin(row) || 0), 0);
    if (!Number.isSafeInteger(snapshotGross) || snapshotGross <= 0 || !Number.isSafeInteger(snapshotNet)
      || snapshotNet < 0 || snapshotNet > snapshotGross || !Number.isInteger(rate) || rate < 0 || rate > 5000
      || snapshotGross !== groupGross) return null;
    const allocations = group.map((row) => {
      const rowGross = amountTiyin(row);
      return rowGross - Math.round((rowGross * rate) / 10000);
    });
    allocations[allocations.length - 1] += snapshotNet - allocations.reduce((sum, value) => sum + value, 0);
    const lawyerNet = allocations[group.findIndex((row) => row.id === payment.id)];
    if (!Number.isSafeInteger(lawyerNet) || lawyerNet < 0 || lawyerNet > gross) return null;
    const commission = gross - lawyerNet;
    const entries = [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.LAWYER_PAYABLE, direction: 'credit', amountTiyin: lawyerNet },
    ];
    if (commission > 0) entries.push({ account: ACCOUNTS.PLATFORM_COMMISSION_REVENUE, direction: 'credit', amountTiyin: commission });
    return entries;
  }
  if (!['payment_pending', 'pending', 'accepted', 'in_progress'].includes(consultation.status)) return null;
  return [
    { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
    { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: gross },
  ];
}

async function bootstrapLegacyLedger({ through = new Date() } = {}) {
  return sequelize.transaction(async (tx) => {
    const payments = await Payment.findAll({
      where: { status: 'paid' },
      include: [
        { model: Consultation, as: 'consultation', required: false },
        { model: Subscription, as: 'subscription', required: false },
      ],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      lock: { level: tx.LOCK.UPDATE, of: Payment },
      transaction: tx,
    });
    const existing = await FinancialTransaction.findAll({
      where: { operationKey: payments.map((payment) => `legacy:opening:${payment.id}`) },
      attributes: ['operationKey'],
      transaction: tx,
    });
    const existingKeys = new Set(existing.map((row) => row.operationKey));
    const candidates = [];
    const report = [];

    for (const payment of payments) {
      const operationKey = `legacy:opening:${payment.id}`;
      if (existingKeys.has(operationKey)) continue;
      let entries = null;
      if (['consultation', 'consultation_extension'].includes(payment.purpose)) {
        entries = consultationOpening(
          payment,
          payment.consultation,
          payments.filter((row) => ['consultation', 'consultation_extension'].includes(row.purpose))
        );
      } else if (payment.purpose === 'subscription') {
        entries = subscriptionOpening(payment, payment.subscription, new Date(through));
      }
      if (!entries) {
        report.push({
          paymentId: payment.id,
          purpose: payment.purpose,
          status: payment.status,
          reason: 'amount, status, subject, or financial snapshot is ambiguous',
        });
      } else {
        candidates.push({ payment, operationKey, entries });
      }
    }
    if (report.length) throw new LegacyLedgerAmbiguityError(report);

    let posted = 0;
    for (const candidate of candidates) {
      const transaction = await postTransaction({
        operationKey: candidate.operationKey,
        paymentId: candidate.payment.id,
        reason: 'legacy_opening_balance',
        currency: candidate.payment.currency,
        metadata: { bootstrappedAt: new Date().toISOString() },
        entries: candidate.entries,
      }, { transaction: tx });
      if (transaction.wasCreated) posted += 1;
    }
    return { posted, skipped: payments.length - posted, report: [] };
  });
}

if (require.main === module) {
  bootstrapLegacyLedger()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return sequelize.close();
    })
    .catch(async (error) => {
      process.stderr.write(`${JSON.stringify({ error: error.message, report: error.report || [] }, null, 2)}\n`);
      await sequelize.close();
      process.exitCode = 1;
    });
}

module.exports = { bootstrapLegacyLedger, LegacyLedgerAmbiguityError };
