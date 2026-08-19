const { Op } = require('sequelize');
const { Payment } = require('../models');

const ERROR = Object.freeze({
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANT_PERFORM: -31008,
  ALREADY_DONE: -31060,
});

function result(method, v2Payload) {
  return { method, v2Accepted: true, v2ErrorCode: null, v2Payload };
}

function error(method, code) {
  return { method, v2Accepted: false, v2ErrorCode: code, v2Payload: { code } };
}

function expectedAmount(payment) {
  return Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
}

async function byProvider(providerTransactionId) {
  return Payment.findOne({
    where: { [Op.or]: [{ providerTransactionId }, { transactionId: providerTransactionId }] },
  });
}

function buildStatementResult(payments) {
  return {
    transactions: payments.map((payment) => ({
      id: payment.transactionId,
      time: payment.providerData?.createTime || payment.providerResponse?.createTime || payment.createdAt.getTime(),
      amount: Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100)),
      account: { consultation_id: payment.id },
      create_time: payment.providerData?.createTime || payment.providerResponse?.createTime || payment.createdAt.getTime(),
      perform_time: payment.providerData?.performTime || payment.providerResponse?.performTime || 0,
      cancel_time: payment.providerData?.cancelTime || payment.providerResponse?.cancelTime || 0,
      transaction: payment.id,
      state: 2,
      reason: null,
    })),
  };
}

async function evaluatePaymentShadow(parsed) {
  switch (parsed.method) {
    case 'CheckPerformTransaction': {
      const payment = await Payment.findByPk(parsed.paymentId);
      if (!payment) return error(parsed.method, ERROR.TRANSACTION_NOT_FOUND);
      if (parsed.amountTiyin !== expectedAmount(payment)) return error(parsed.method, ERROR.INVALID_AMOUNT);
      if (payment.status !== 'pending') return error(parsed.method, ERROR.CANT_PERFORM);
      return result(parsed.method, { allow: true });
    }
    case 'CreateTransaction': {
      const payment = await Payment.findByPk(parsed.paymentId);
      if (!payment) return error(parsed.method, ERROR.TRANSACTION_NOT_FOUND);
      if (parsed.amountTiyin !== expectedAmount(payment)) return error(parsed.method, ERROR.INVALID_AMOUNT);
      if (payment.status === 'paid') return error(parsed.method, ERROR.ALREADY_DONE);
      if (payment.status === 'failed'
        || (payment.providerTransactionId && payment.providerTransactionId !== parsed.providerTransactionId)
        || (payment.transactionId && payment.transactionId !== parsed.providerTransactionId)) {
        return error(parsed.method, ERROR.CANT_PERFORM);
      }
      const collision = await Payment.count({
        where: {
          provider: payment.provider,
          providerTransactionId: parsed.providerTransactionId,
          id: { [Op.ne]: payment.id },
        },
      });
      return collision ? error(parsed.method, ERROR.CANT_PERFORM) : result(parsed.method, {
        create_time: parsed.time,
        transaction: payment.id,
        state: 1,
      });
    }
    case 'PerformTransaction': {
      const payment = await byProvider(parsed.providerTransactionId);
      if (!payment) return error(parsed.method, ERROR.TRANSACTION_NOT_FOUND);
      if (payment.status === 'paid') return error(parsed.method, ERROR.ALREADY_DONE);
      if (payment.status === 'failed') return error(parsed.method, ERROR.CANT_PERFORM);
      return result(parsed.method, {
        perform_time: 0,
        transaction: payment.id,
        state: 2,
      });
    }
    case 'CancelTransaction': {
      const payment = await byProvider(parsed.providerTransactionId);
      if (!payment) return error(parsed.method, ERROR.TRANSACTION_NOT_FOUND);
      const refunded = ['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(payment.status);
      return result(parsed.method, {
        cancel_time: 0,
        transaction: payment.id,
        state: refunded ? -2 : -1,
      });
    }
    case 'CheckTransaction': {
      const payment = await byProvider(parsed.providerTransactionId);
      if (!payment) return error(parsed.method, ERROR.TRANSACTION_NOT_FOUND);
      const stateMap = { pending: 1, processing: 1, paid: 2, failed: -1, refunded: -2 };
      return result(parsed.method, {
        create_time: payment.providerData?.createTime || payment.providerResponse?.createTime || 0,
        perform_time: payment.providerData?.performTime || payment.providerResponse?.performTime || 0,
        cancel_time: payment.providerData?.cancelTime || payment.providerResponse?.cancelTime || 0,
        transaction: payment.id,
        state: stateMap[payment.status] || 1,
        reason: payment.providerResponse?.reason || null,
      });
    }
    case 'GetStatement': {
      const payments = await Payment.findAll({
        where: { status: 'paid', createdAt: { [Op.between]: [new Date(parsed.from), new Date(parsed.to)] } },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
      });
      return result(parsed.method, buildStatementResult(payments));
    }
    default:
      return error('unknown', -32601);
  }
}

module.exports = { buildStatementResult, evaluatePaymentShadow };
