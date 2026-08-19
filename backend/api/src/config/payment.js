const crypto = require('crypto');

const REQUIRED_SHADOW_METHODS = Object.freeze([
  'CheckPerformTransaction',
  'CreateTransaction',
  'PerformTransaction',
  'CancelTransaction',
  'CheckTransaction',
  'GetStatement',
]);
const COMPARISON_FIELDS = Object.freeze([
  'scenarioId',
  'method',
  'v2Accepted',
  'v2ErrorCode',
  'legacyOutcome',
  'legacyErrorCode',
  'v2PayloadHash',
  'legacyPayloadHash',
  'comparisonMatched',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion',
  'mode',
  'source',
  'environment',
  'commitSha',
  'observedFrom',
  'observedUntil',
  'sandboxScenarioSet',
  'comparisons',
  'integrity',
]);

function scenarioId(method, accepted, errorCode) {
  return `${method}:${accepted ? 'result' : 'error'}${errorCode === null ? '' : `:${errorCode}`}`;
}

function presentTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalResult(method, payload = {}) {
  switch (method) {
    case 'CheckPerformTransaction':
      return { allow: payload.allow === true };
    case 'CreateTransaction':
      return {
        create_time: Number.isSafeInteger(payload.create_time) ? payload.create_time : null,
        transaction: typeof payload.transaction === 'string' ? payload.transaction : null,
        state: Number.isInteger(payload.state) ? payload.state : null,
      };
    case 'PerformTransaction':
      return {
        perform_time_present: presentTimestamp(payload.perform_time),
        transaction: typeof payload.transaction === 'string' ? payload.transaction : null,
        state: Number.isInteger(payload.state) ? payload.state : null,
      };
    case 'CancelTransaction':
      return {
        cancel_time_present: presentTimestamp(payload.cancel_time),
        transaction: typeof payload.transaction === 'string' ? payload.transaction : null,
        state: Number.isInteger(payload.state) ? payload.state : null,
      };
    case 'CheckTransaction':
      return {
        create_time: Number.isSafeInteger(payload.create_time) ? payload.create_time : null,
        perform_time: Number.isSafeInteger(payload.perform_time) ? payload.perform_time : null,
        cancel_time: Number.isSafeInteger(payload.cancel_time) ? payload.cancel_time : null,
        transaction: typeof payload.transaction === 'string' ? payload.transaction : null,
        state: Number.isInteger(payload.state) ? payload.state : null,
        reason: Number.isInteger(payload.reason) ? payload.reason : null,
      };
    case 'GetStatement':
      return {
        transactions: Array.isArray(payload.transactions) ? payload.transactions.map((transaction) => ({
          id: typeof transaction.id === 'string' ? transaction.id : null,
          time: Number.isSafeInteger(transaction.time) ? transaction.time : null,
          amount: Number.isSafeInteger(transaction.amount) ? transaction.amount : null,
          account: {
            consultation_id: typeof transaction.account?.consultation_id === 'string'
              ? transaction.account.consultation_id : null,
          },
          create_time: Number.isSafeInteger(transaction.create_time) ? transaction.create_time : null,
          perform_time: Number.isSafeInteger(transaction.perform_time) ? transaction.perform_time : null,
          cancel_time: Number.isSafeInteger(transaction.cancel_time) ? transaction.cancel_time : null,
          transaction: typeof transaction.transaction === 'string' ? transaction.transaction : null,
          state: Number.isInteger(transaction.state) ? transaction.state : null,
          reason: Number.isInteger(transaction.reason) ? transaction.reason : null,
        })) : [],
      };
    default:
      return {};
  }
}

function payloadHash(method, outcome, payload) {
  const normalized = outcome === 'result'
    ? canonicalResult(method, payload)
    : { code: Number.isInteger(payload?.code) ? payload.code : null };
  return crypto.createHash('sha256').update(canonicalize(normalized)).digest('hex');
}

function buildShadowComparison(shadow, legacyOutcome, legacyErrorCode = null, legacyPayload = null) {
  const v2Outcome = shadow.v2Accepted ? 'result' : 'error';
  const v2PayloadHash = payloadHash(shadow.method, v2Outcome, shadow.v2Payload);
  const legacyPayloadHash = payloadHash(shadow.method, legacyOutcome, legacyPayload);
  const exact = v2Outcome === legacyOutcome && shadow.v2ErrorCode === legacyErrorCode
    && v2PayloadHash === legacyPayloadHash;
  const comparisonMatched = exact && legacyErrorCode !== -31003;
  return {
    scenarioId: scenarioId(shadow.method, shadow.v2Accepted, shadow.v2ErrorCode),
    method: shadow.method,
    v2Accepted: shadow.v2Accepted,
    v2ErrorCode: shadow.v2ErrorCode,
    legacyOutcome,
    legacyErrorCode,
    v2PayloadHash,
    legacyPayloadHash,
    comparisonMatched,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nullableInteger(value) {
  return value === null || Number.isInteger(value);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((field) => fields.includes(field));
}

function parseTimestamp(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} must be an ISO timestamp`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return timestamp;
}

function validateComparison(value) {
  if (!exactFields(value, COMPARISON_FIELDS)
    || !REQUIRED_SHADOW_METHODS.includes(value.method)
    || typeof value.scenarioId !== 'string' || !value.scenarioId
    || typeof value.v2Accepted !== 'boolean'
    || !nullableInteger(value.v2ErrorCode)
    || !['result', 'error'].includes(value.legacyOutcome)
    || !nullableInteger(value.legacyErrorCode)
    || typeof value.v2PayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.v2PayloadHash)
    || typeof value.legacyPayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.legacyPayloadHash)
    || typeof value.comparisonMatched !== 'boolean') {
    throw new Error('Each sanitized shadow comparison must contain every correctly typed approved field');
  }
  if ((value.v2Accepted && value.v2ErrorCode !== null)
    || (!value.v2Accepted && value.v2ErrorCode === null)
    || (value.legacyOutcome === 'result' && value.legacyErrorCode !== null)
    || (value.legacyOutcome === 'error' && value.legacyErrorCode === null)) {
    throw new Error('Shadow comparison outcome and error code are inconsistent');
  }
  const expectedScenarioId = scenarioId(value.method, value.v2Accepted, value.v2ErrorCode);
  const expectedMatched = (value.v2Accepted ? 'result' : 'error') === value.legacyOutcome
    && value.v2ErrorCode === value.legacyErrorCode
    && value.v2PayloadHash === value.legacyPayloadHash
    && value.legacyErrorCode !== -31003;
  if (value.scenarioId !== expectedScenarioId || value.comparisonMatched !== expectedMatched) {
    throw new Error('Shadow evidence contains a compatibility mismatch');
  }
  if (!expectedMatched) throw new Error('Shadow evidence contains a compatibility mismatch');
}

function validateShadowEvidence(evidence, options = {}) {
  if (!exactFields(evidence, EVIDENCE_FIELDS)
    || evidence.schemaVersion !== 2
    || evidence.mode !== 'shadow'
    || typeof evidence.source !== 'string' || !evidence.source.trim()
    || !['local', 'staging'].includes(evidence.environment)
    || typeof evidence.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(evidence.commitSha)
    || !Array.isArray(evidence.comparisons)) {
    throw new Error('Valid shadow evidence manifest metadata is required');
  }
  const observedFrom = parseTimestamp(evidence.observedFrom, 'observedFrom');
  const observedUntil = parseTimestamp(evidence.observedUntil, 'observedUntil');
  if (observedUntil < observedFrom) throw new Error('Shadow evidence observation range is invalid');
  if (evidence.sandboxScenarioSet !== null
    && (!exactFields(evidence.sandboxScenarioSet, ['agreementId', 'complete'])
      || typeof evidence.sandboxScenarioSet.agreementId !== 'string'
      || !evidence.sandboxScenarioSet.agreementId.trim()
      || typeof evidence.sandboxScenarioSet.complete !== 'boolean')) {
    throw new Error('Shadow evidence sandbox scenario marker is invalid');
  }
  for (const method of REQUIRED_SHADOW_METHODS) {
    const matching = evidence.comparisons.filter((comparison) => comparison?.method === method);
    if (matching.length === 0) throw new Error(`Missing shadow comparison for ${method}`);
    if (matching.length > 1) throw new Error(`Duplicate shadow comparison for ${method}`);
  }
  if (evidence.comparisons.length !== REQUIRED_SHADOW_METHODS.length) {
    throw new Error('Shadow evidence contains an unsupported comparison');
  }
  evidence.comparisons.forEach(validateComparison);

  if (evidence.environment === 'local') {
    if (evidence.integrity !== null) throw new Error('Local parser evidence integrity must be null');
    if (options.requireCutover) throw new Error('Cutover requires staging shadow evidence');
    return { valid: true, cutoverEligible: false, comparisonCount: evidence.comparisons.length, source: evidence.source };
  }

  throw new Error('Staging cutover requires the signed schema v4 payment evidence envelope');
}

function getPaymentConfig(env = process.env) {
  const mode = String(env.PAYMENT_V2_MODE || 'legacy').trim().toLowerCase();
  if (!['legacy', 'shadow', 'active'].includes(mode)) {
    throw new Error('PAYMENT_V2_MODE must be legacy or shadow; active requires a later cutover');
  }
  if (mode === 'active') throw new Error('PAYMENT_V2_MODE=active requires Task 6 and explicit cutover approval');
  return { mode, shadowEnabled: mode === 'shadow', activeEnabled: false };
}

module.exports = {
  REQUIRED_SHADOW_METHODS,
  buildShadowComparison,
  getPaymentConfig,
  validateShadowEvidence,
};
