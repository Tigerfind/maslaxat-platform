const crypto = require('crypto');
const inventory = require('../config/paymentSandboxScenarios.json');

const ROW_FIELDS = Object.freeze([
  'streamId', 'sequence', 'observedAt', 'scenarioKey', 'comparison', 'previousCheckpoint', 'checkpoint',
]);
const COMPARISON_FIELDS = Object.freeze([
  'scenarioId', 'method', 'v2Accepted', 'v2ErrorCode', 'legacyOutcome', 'legacyErrorCode',
  'v2PayloadHash', 'legacyPayloadHash', 'comparisonMatched',
]);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
}

function loadScenarioInventory() {
  return JSON.parse(JSON.stringify(inventory));
}

function validateInventory(value) {
  if (!value || value.schemaVersion !== 2 || typeof value.inventoryId !== 'string'
    || !Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw new Error('Valid payment sandbox scenario inventory is required');
  }
  const keys = new Set();
  for (const scenario of value.scenarios) {
    if (!scenario || Object.keys(scenario).sort().join(',') !== 'category,expected,key,method'
      || typeof scenario.key !== 'string' || !scenario.key
      || typeof scenario.category !== 'string' || !scenario.category
      || typeof scenario.method !== 'string'
      || !exactRoot(scenario.expected, ['outcome', 'errorCode'])
      || !['result', 'error'].includes(scenario.expected.outcome)
      || !(scenario.expected.errorCode === null || Number.isInteger(scenario.expected.errorCode))
      || keys.has(scenario.key)) {
      throw new Error('Payment sandbox inventory contains an invalid or duplicate scenario');
    }
    keys.add(scenario.key);
  }
  return value;
}

function scenarioInventoryDigest(value = inventory) {
  return digest(validateInventory(value));
}

function exactRoot(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function parseIso(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function expectedScenarioId(scenario) {
  return `${scenario.method}:${scenario.expected.outcome}${scenario.expected.errorCode === null ? '' : `:${scenario.expected.errorCode}`}`;
}

function sanitizeShadowEvent(row, scenarioMap) {
  if (!exactRoot(row, ROW_FIELDS)) throw new Error('Shadow event must contain only approved fields');
  if (typeof row.streamId !== 'string' || !/^[a-z0-9._-]{8,120}$/i.test(row.streamId)
    || !Number.isSafeInteger(row.sequence) || row.sequence < 0) {
    throw new Error('Shadow event sequence and timestamp are invalid');
  }
  parseIso(row.observedAt, 'observedAt');
  if (!/^[a-f0-9]{64}$/.test(row.previousCheckpoint || '') || !/^[a-f0-9]{64}$/.test(row.checkpoint || '')) {
    throw new Error('Shadow event checkpoint is malformed');
  }
  const scenario = scenarioMap.get(row.scenarioKey);
  if (!scenario) throw new Error('Shadow event references an unknown scenario');
  const comparison = row.comparison;
  if (!exactRoot(comparison, COMPARISON_FIELDS)) {
    throw new Error('Shadow event must contain exactly the approved comparison fields');
  }
  if (comparison.method !== scenario.method) {
    throw new Error('Shadow event method does not match its scenario');
  }
  const approved = { ...comparison };
  if (typeof approved.scenarioId !== 'string' || typeof approved.v2Accepted !== 'boolean'
    || !['result', 'error'].includes(approved.legacyOutcome)
    || typeof approved.comparisonMatched !== 'boolean'
    || !/^[a-f0-9]{64}$/.test(approved.v2PayloadHash || '')
    || !/^[a-f0-9]{64}$/.test(approved.legacyPayloadHash || '')) {
    throw new Error('Shadow comparison is malformed');
  }
  const v2Outcome = approved.v2Accepted ? 'result' : 'error';
  const v2Consistent = (v2Outcome === 'result' && approved.v2ErrorCode === null)
    || (v2Outcome === 'error' && Number.isInteger(approved.v2ErrorCode));
  const legacyConsistent = (approved.legacyOutcome === 'result' && approved.legacyErrorCode === null)
    || (approved.legacyOutcome === 'error' && Number.isInteger(approved.legacyErrorCode));
  if (!v2Consistent || !legacyConsistent) throw new Error('Shadow outcome and error code are inconsistent');
  if (approved.scenarioId !== expectedScenarioId(scenario)
    || v2Outcome !== scenario.expected.outcome || approved.v2ErrorCode !== scenario.expected.errorCode
    || approved.legacyOutcome !== scenario.expected.outcome || approved.legacyErrorCode !== scenario.expected.errorCode) {
    throw new Error('Shadow comparison does not match the approved expected outcome');
  }
  if (approved.v2PayloadHash !== approved.legacyPayloadHash) {
    throw new Error('Shadow comparison payload hashes do not match');
  }
  const computedMatched = v2Outcome === approved.legacyOutcome
    && approved.v2ErrorCode === approved.legacyErrorCode
    && approved.v2PayloadHash === approved.legacyPayloadHash;
  if (approved.comparisonMatched !== computedMatched) {
    throw new Error('Shadow comparison producer flag is contradictory');
  }
  if (!computedMatched) throw new Error('Shadow comparison is not semantically compatible');
  const checkpointInput = {
    streamId: row.streamId,
    sequence: row.sequence,
    observedAt: row.observedAt,
    scenarioKey: row.scenarioKey,
    comparison: approved,
    previousCheckpoint: row.previousCheckpoint,
  };
  if (digest(checkpointInput) !== row.checkpoint) throw new Error('Shadow event checkpoint does not match');
  const sanitized = {
    streamId: row.streamId,
    sequence: row.sequence,
    observedAt: row.observedAt,
    scenarioKey: row.scenarioKey,
    previousCheckpoint: row.previousCheckpoint,
    checkpoint: row.checkpoint,
    ...approved,
  };
  return { ...sanitized, eventDigest: digest(sanitized) };
}

function validateStreamContract(contract) {
  const fields = ['streamId', 'firstSequence', 'lastSequence', 'firstCheckpoint', 'lastCheckpoint', 'eventCount'];
  if (!exactRoot(contract, fields) || typeof contract.streamId !== 'string'
    || !Number.isSafeInteger(contract.firstSequence) || !Number.isSafeInteger(contract.lastSequence)
    || !Number.isSafeInteger(contract.eventCount) || contract.eventCount <= 0
    || !/^[a-f0-9]{64}$/.test(contract.firstCheckpoint || '')
    || !/^[a-f0-9]{64}$/.test(contract.lastCheckpoint || '')) {
    throw new Error('Exact source stream metadata is required');
  }
  return contract;
}

function collectShadowEvents(rows, value = inventory, sourceStream = null) {
  const checked = validateInventory(value);
  if (!Array.isArray(rows)) throw new Error('Shadow event rows must be an array');
  const contract = validateStreamContract(sourceStream);
  const scenarioMap = new Map(checked.scenarios.map((scenario) => [scenario.key, scenario]));
  const bySequence = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const event = sanitizeShadowEvent(row, scenarioMap);
    const existing = bySequence.get(event.sequence);
    if (existing) {
      if (existing.eventDigest !== event.eventDigest) throw new Error('Conflicting duplicate sequence in shadow stream');
      duplicates += 1;
    } else {
      bySequence.set(event.sequence, event);
    }
  }
  const events = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
  if (events.length !== contract.eventCount || events[0]?.streamId !== contract.streamId
    || events[0]?.sequence !== contract.firstSequence || events.at(-1)?.sequence !== contract.lastSequence
    || events[0]?.checkpoint !== contract.firstCheckpoint || events.at(-1)?.checkpoint !== contract.lastCheckpoint) {
    throw new Error('Collected stream bounds or sequence gap do not match source metadata');
  }
  if (events[0].previousCheckpoint !== '0'.repeat(64)) throw new Error('First stream checkpoint has no trusted genesis');
  for (let index = 1; index < events.length; index += 1) {
    const missing = events[index].sequence - events[index - 1].sequence - 1;
    if (missing !== 0) throw new Error('Shadow stream contains a sequence gap');
    if (events[index].streamId !== contract.streamId
      || events[index].previousCheckpoint !== events[index - 1].checkpoint) {
      throw new Error('Shadow stream checkpoint chain is broken');
    }
    if (Date.parse(events[index].observedAt) < Date.parse(events[index - 1].observedAt)) {
      throw new Error('Shadow stream timestamps are not monotonic');
    }
  }
  const coverage = Object.fromEntries(checked.scenarios.map((scenario) => [scenario.key, 0]));
  events.forEach((event) => { coverage[event.scenarioKey] += 1; });
  const counts = {
    received: rows.length,
    accepted: events.length,
    duplicates,
    gaps: 0,
    matched: events.length,
    mismatched: 0,
  };
  const artifact = {
    schemaVersion: 2,
    inventoryId: checked.inventoryId,
    inventoryDigest: scenarioInventoryDigest(checked),
    counts,
    stream: {
      ...contract,
      firstObservedAt: events[0].observedAt,
      lastObservedAt: events.at(-1).observedAt,
    },
    coverage,
    events,
  };
  return { ...artifact, artifactDigest: digest(artifact) };
}

module.exports = {
  canonicalize,
  collectShadowEvents,
  digest,
  loadScenarioInventory,
  sanitizeShadowEvent,
  scenarioInventoryDigest,
  validateInventory,
};
