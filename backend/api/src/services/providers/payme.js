const PAYME_ERRORS = Object.freeze({
  PARSE_ERROR: -32700,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
});

class PaymeProtocolError extends Error {
  constructor(message, code = PAYME_ERRORS.INVALID_PARAMS) {
    super(message);
    this.name = 'PaymeProtocolError';
    this.code = code;
  }
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaymeProtocolError(`${name} must be an object`);
  }
  return value;
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PaymeProtocolError(`${name} must be a non-empty string`);
  }
  return value;
}

function safeInteger(value, name, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || (positive && value <= 0)) {
    throw new PaymeProtocolError(`${name} must be ${positive ? 'a positive ' : ''}safe integer`);
  }
  return value;
}

function paymentAccount(params) {
  const account = object(params.account, 'params.account');
  return nonEmptyString(account.payment_id || account.consultation_id, 'payment account');
}

function parseWebhook(body) {
  const request = object(body, 'request');
  if (request.jsonrpc !== '2.0') throw new PaymeProtocolError('jsonrpc must equal 2.0', PAYME_ERRORS.PARSE_ERROR);
  const method = nonEmptyString(request.method, 'method');
  const params = object(request.params, 'params');
  const base = { id: request.id ?? null, method };

  switch (method) {
    case 'CheckPerformTransaction':
      return { ...base, paymentId: paymentAccount(params), amountTiyin: safeInteger(params.amount, 'amount', { positive: true }) };
    case 'CreateTransaction':
      return {
        ...base,
        paymentId: paymentAccount(params),
        providerTransactionId: nonEmptyString(params.id, 'provider transaction id'),
        amountTiyin: safeInteger(params.amount, 'amount', { positive: true }),
        time: safeInteger(params.time, 'time'),
      };
    case 'PerformTransaction':
    case 'CheckTransaction':
      return { ...base, providerTransactionId: nonEmptyString(params.id, 'provider transaction id') };
    case 'CancelTransaction':
      return {
        ...base,
        providerTransactionId: nonEmptyString(params.id, 'provider transaction id'),
        reason: safeInteger(params.reason, 'reason'),
      };
    case 'GetStatement': {
      const from = safeInteger(params.from, 'from');
      const to = safeInteger(params.to, 'to');
      if (from > to) throw new PaymeProtocolError('Invalid statement range');
      return { ...base, from, to };
    }
    default:
      throw new PaymeProtocolError('Method not found', PAYME_ERRORS.METHOD_NOT_FOUND);
  }
}

function createCheckoutUrl(payment) {
  const merchantId = String(process.env.PAYME_MERCHANT_ID || '').trim();
  if (!merchantId) throw new Error('PAYME_MERCHANT_ID is not configured');
  const amountTiyin = Number(payment.amountTiyin);
  if (!Number.isSafeInteger(amountTiyin) || amountTiyin <= 0) throw new Error('Invalid checkout amount');
  const params = Buffer.from(`m=${merchantId};ac.consultation_id=${payment.id};a=${amountTiyin}`).toString('base64');
  return `https://checkout.paycom.uz/${params}`;
}

module.exports = {
  PAYME_ERRORS,
  PaymeProtocolError,
  parseWebhook,
  createCheckoutUrl,
};
