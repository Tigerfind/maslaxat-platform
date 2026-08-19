const crypto = require('crypto');
const {
  AUTHORIZATION_SURFACES,
  authorizationSurfaceDigest,
  getAuthorizationSurface,
} = require('../config/authorizationSurfaces');
const { canonicalize, digest } = require('./paymentShadowEvidence');

const CANARY_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[a-z0-9._-]{3,160}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== (value instanceof Date ? date.toISOString() : value)) {
    throw new Error(`${label} must be an exact ISO timestamp`);
  }
  return date;
}

function validateRelease(release, expectedMode = null) {
  const fields = ['commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead', 'authorizationMode'];
  if (!release || Object.keys(release).sort().join(',') !== fields.sort().join(',')
    || !COMMIT.test(release.commitSha || '') || !SAFE_ID.test(release.deploymentId || '')
    || !SAFE_ID.test(release.serviceId || '') || !SHA256.test(release.configDigest || '')
    || !/^[0-9]{14}-[a-z0-9-]+\.js$/.test(release.migrationHead || '')
    || !['compatibility', 'capability_only'].includes(release.authorizationMode)
    || (expectedMode && release.authorizationMode !== expectedMode)) {
    throw new Error('Exact authorization release binding is required');
  }
  return release;
}

function commonEvent({ eventId, observedAt, release, type }) {
  validateRelease(release);
  if (!SAFE_ID.test(eventId || '')) throw new Error('Safe idempotent authorization event ID is required');
  return {
    schemaVersion: 1,
    type,
    eventId,
    observedAt: iso(observedAt, 'observedAt').toISOString(),
    commitSha: release.commitSha,
    deploymentId: release.deploymentId,
    serviceId: release.serviceId,
    configDigest: release.configDigest,
    migrationHead: release.migrationHead,
    authorizationMode: release.authorizationMode,
  };
}

function decisionEvent(input) {
  const surface = getAuthorizationSurface(input.surface, input.mode);
  if (surface.channel !== input.channel || typeof input.legacyAllowed !== 'boolean'
    || typeof input.capabilityAllowed !== 'boolean') {
    throw new Error('Valid sanitized authorization decision is required');
  }
  return {
    ...commonEvent({ ...input, type: 'decision' }),
    channel: input.channel,
    surface: input.surface,
    mode: input.mode,
    legacyAllowed: input.legacyAllowed,
    capabilityAllowed: input.capabilityAllowed,
  };
}

function canaryEvent(input) {
  const event = commonEvent({ ...input, type: 'canary' });
  const bucket = Math.floor(Date.parse(event.observedAt) / CANARY_INTERVAL_MS) * CANARY_INTERVAL_MS;
  return { ...event, observedAt: new Date(bucket).toISOString() };
}

function sameRelease(event, release) {
  return ['commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead', 'authorizationMode']
    .every((field) => event[field] === release[field]);
}

function eventSort(left, right) {
  return Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.eventId.localeCompare(right.eventId);
}

function validateProvenance(provenance, release) {
  if (!provenance || Object.keys(provenance).sort().join(',')
      !== 'providerMetadataDigest,release,validatedAt,workflow'
    || canonicalize(provenance.release) !== canonicalize(release)
    || !SHA256.test(provenance.providerMetadataDigest || '')
    || !provenance.workflow
    || Object.keys(provenance.workflow).sort().join(',')
      !== 'ref,repository,reviewedCommitSha,runAttempt,runId'
    || !Number.isSafeInteger(provenance.workflow.runId) || provenance.workflow.runId <= 0
    || !Number.isSafeInteger(provenance.workflow.runAttempt) || provenance.workflow.runAttempt <= 0
    || provenance.workflow.reviewedCommitSha !== release.commitSha
    || typeof provenance.workflow.repository !== 'string'
    || typeof provenance.workflow.ref !== 'string') {
    throw new Error('Exact provider and workflow provenance is required');
  }
  iso(provenance.validatedAt, 'provenance validatedAt');
  return provenance;
}

function buildAuthorizationEvidenceArtifact({
  events,
  release,
  observedFrom,
  observedUntil,
  sourceUri,
  provenance,
}) {
  validateRelease(release, 'compatibility');
  validateProvenance(provenance, release);
  const from = iso(observedFrom, 'observedFrom');
  const until = iso(observedUntil, 'observedUntil');
  if (until.getTime() - from.getTime() < DAY_MS) throw new Error('Authorization evidence requires at least 24 hours');
  if (from.getTime() % CANARY_INTERVAL_MS || until.getTime() % CANARY_INTERVAL_MS) {
    throw new Error('Authorization evidence window must align to canary intervals');
  }
  if (typeof sourceUri !== 'string' || !sourceUri.startsWith('private://') || sourceUri.length > 500) {
    throw new Error('Immutable private authorization evidence source is required');
  }
  if (!Array.isArray(events)) throw new Error('Authorization evidence events are required');
  const ids = new Set();
  const normalized = events.map((raw) => {
    if (!['decision', 'canary'].includes(raw?.type)) throw new Error('Authorization event type is invalid');
    const event = raw.type === 'decision' ? decisionEvent({
      eventId: raw.eventId, observedAt: raw.observedAt, release, channel: raw.channel,
      surface: raw.surface, mode: raw.mode, legacyAllowed: raw.legacyAllowed,
      capabilityAllowed: raw.capabilityAllowed,
    }) : canaryEvent({ eventId: raw.eventId, observedAt: raw.observedAt, release });
    if (!sameRelease(raw, release)) throw new Error('Authorization event release does not match');
    if (ids.has(event.eventId)) throw new Error('Duplicate authorization event ID');
    ids.add(event.eventId);
    const time = Date.parse(event.observedAt);
    if (time < from.getTime() || time > until.getTime()) throw new Error('Authorization event is outside the observation window');
    return event;
  }).sort(eventSort);

  const canaryTimes = new Set(normalized.filter((event) => event.type === 'canary').map((event) => event.observedAt));
  const gaps = [];
  for (let time = from.getTime(); time <= until.getTime(); time += CANARY_INTERVAL_MS) {
    const timestamp = new Date(time).toISOString();
    if (!canaryTimes.has(timestamp)) gaps.push(timestamp);
  }
  if (gaps.length) throw new Error(`Authorization evidence contains a canary gap: ${gaps[0]}`);

  const decisions = normalized.filter((event) => event.type === 'decision');
  const coverage = [];
  for (const surface of AUTHORIZATION_SURFACES.surfaces) {
    for (const mode of surface.modes) {
      const rows = decisions.filter((event) => event.surface === surface.id && event.mode === mode);
      if (!rows.length) throw new Error(`Authorization evidence coverage is incomplete for ${surface.id}/${mode}`);
      coverage.push({
        channel: surface.channel,
        surface: surface.id,
        mode,
        decisions: rows.length,
        mismatches: rows.filter((event) => event.legacyAllowed !== event.capabilityAllowed).length,
      });
    }
  }
  const mismatches = coverage.reduce((sum, row) => sum + row.mismatches, 0);
  if (mismatches) throw new Error('Authorization evidence contains a compatibility mismatch');
  const sourceSha256 = digest(normalized);
  const artifact = {
    schemaVersion: 1,
    kind: 'maslaxat-authorization-compatibility-evidence',
    release,
    inventory: {
      inventoryId: AUTHORIZATION_SURFACES.inventoryId,
      digest: authorizationSurfaceDigest(),
      surfaceCount: AUTHORIZATION_SURFACES.surfaces.length,
    },
    observation: {
      observedFrom: from.toISOString(),
      observedUntil: until.toISOString(),
      durationSeconds: Math.floor((until.getTime() - from.getTime()) / 1000),
    },
    counts: { events: normalized.length, decisions: decisions.length, mismatches },
    coverage,
    canaries: {
      intervalSeconds: CANARY_INTERVAL_MS / 1000,
      expected: Math.floor((until.getTime() - from.getTime()) / CANARY_INTERVAL_MS) + 1,
      observed: canaryTimes.size,
      gaps,
    },
    source: { uri: sourceUri, sha256: sourceSha256 },
    provenance,
  };
  return { ...artifact, artifactDigest: digest(artifact) };
}

function createAuthorizationEvidenceRecorder({ EventModel, release, clock = () => new Date() }) {
  if (!EventModel?.create || !EventModel?.findAll) throw new TypeError('Authorization evidence model is required');
  validateRelease(release);
  const persist = async (event) => {
    try {
      return await EventModel.create(event);
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') return null;
      throw Object.assign(new Error('Authorization evidence persistence failed'), {
        code: 'AUTHORIZATION_TELEMETRY_UNAVAILABLE', cause: error,
      });
    }
  };
  return {
    recordDecision(input) {
      return persist(decisionEvent({ eventId: input.eventId || crypto.randomUUID(), observedAt: clock(), release, ...input }));
    },
    recordCanary(input = {}) {
      const observedAt = input.observedAt || clock();
      const bucket = Math.floor(new Date(observedAt).getTime() / CANARY_INTERVAL_MS) * CANARY_INTERVAL_MS;
      return persist(canaryEvent({ eventId: input.eventId || `canary-${release.deploymentId}-${bucket}`, observedAt, release }));
    },
  };
}

async function exportAuthorizationEvidence({ EventModel, release, observedFrom, observedUntil, sourceUri, provenance }) {
  if (!EventModel?.findAll) throw new TypeError('Authorization evidence model is required');
  const rows = await EventModel.findAll({
    where: {
      deploymentId: release.deploymentId,
      observedAt: { [require('sequelize').Op.between]: [observedFrom, observedUntil] },
    },
    order: [['observedAt', 'ASC'], ['eventId', 'ASC']],
  });
  const events = rows.map((row) => {
    const value = row.toJSON ? row.toJSON() : row;
    const common = {
      schemaVersion: value.schemaVersion,
      type: value.type,
      eventId: value.eventId,
      observedAt: new Date(value.observedAt).toISOString(),
      commitSha: value.commitSha,
      deploymentId: value.deploymentId,
      serviceId: value.serviceId,
      configDigest: value.configDigest,
      migrationHead: value.migrationHead,
      authorizationMode: value.authorizationMode,
    };
    return value.type === 'decision' ? {
      ...common,
      channel: value.channel,
      surface: value.surface,
      mode: value.mode,
      legacyAllowed: value.legacyAllowed,
      capabilityAllowed: value.capabilityAllowed,
    } : common;
  });
  return {
    artifact: buildAuthorizationEvidenceArtifact({
      events, release, observedFrom, observedUntil, sourceUri, provenance,
    }),
    events,
  };
}

module.exports = {
  CANARY_INTERVAL_MS,
  buildAuthorizationEvidenceArtifact,
  canaryEvent,
  createAuthorizationEvidenceRecorder,
  decisionEvent,
  exportAuthorizationEvidence,
  validateProvenance,
  validateRelease,
};
