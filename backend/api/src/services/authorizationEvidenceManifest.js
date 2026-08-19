const crypto = require('crypto');
const { canonicalize, digest } = require('./paymentShadowEvidence');
const {
  authorizationSurfaceDigest,
  getAuthorizationSurfaceInventory,
} = require('../config/authorizationSurfaces');
const { CANARY_INTERVAL_MS, validateProvenance, validateRelease } = require('./authorizationEvidence');

const ROLES = Object.freeze(['security_owner', 'release_owner', 'cutover_owner']);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new Error(`${label} must contain exactly the approved fields`);
  }
}

function timestamp(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error(`${label} must be an ISO timestamp`);
  return time;
}

function publicKey(value) {
  try {
    const key = value?.type === 'public' ? value : crypto.createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong type');
    return key;
  } catch (_error) {
    throw new Error('Ed25519 public key is required');
  }
}

function privateKey(value) {
  try {
    const key = value?.type === 'private' ? value : crypto.createPrivateKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong type');
    return key;
  } catch (_error) {
    throw new Error('Ed25519 private key is required');
  }
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(publicKey(value).export({ type: 'spki', format: 'der' })).digest('hex');
}

function signAuthorizationArtifact(artifact, { privateKey: value, keyId }) {
  if (!/^[a-z0-9._-]{3,80}$/i.test(keyId || '')) throw new Error('Authorization signing key ID is required');
  return {
    artifact,
    signature: {
      algorithm: 'ed25519',
      keyId,
      value: crypto.sign(null, Buffer.from(canonicalize(artifact)), privateKey(value)).toString('base64'),
    },
  };
}

function verifySigned(envelope, keyConfig) {
  exact(envelope, ['artifact', 'signature'], 'signed authorization artifact');
  exact(envelope.signature, ['algorithm', 'keyId', 'value'], 'authorization signature');
  if (envelope.signature.algorithm !== 'ed25519' || envelope.signature.keyId !== keyConfig?.keyId
    || !crypto.verify(null, Buffer.from(canonicalize(envelope.artifact)), publicKey(keyConfig?.publicKey),
      Buffer.from(envelope.signature.value || '', 'base64'))) {
    throw new Error('Authorization evidence signature does not match');
  }
  return envelope.artifact;
}

function verifyAuthorizationArtifact(envelope, keyConfig) {
  return verifySigned(envelope, keyConfig);
}

function buildApprovalAttestation(input) {
  exact(input, [
    'role', 'environment', 'approvalRunId', 'approvedAt', 'artifactDigest', 'release',
    'toolingCommitSha', 'decision',
  ], 'approval input');
  validateRelease(input.release, 'compatibility');
  const expectedEnvironment = `authorization-${input.role.replace('_', '-')}-approval`;
  if (!ROLES.includes(input.role) || input.environment !== expectedEnvironment
    || !Number.isSafeInteger(input.approvalRunId) || input.approvalRunId <= 0
    || input.decision !== 'approve' || !SHA256.test(input.artifactDigest || '')
    || !/^[a-f0-9]{40}$/.test(input.toolingCommitSha || '')
    || input.toolingCommitSha !== input.release.commitSha) {
    throw new Error('Valid protected authorization approval and tooling commit are required');
  }
  timestamp(input.approvedAt, 'approvedAt');
  const unsigned = {
    schemaVersion: 1,
    kind: 'authorization-cutover-approval',
    role: input.role,
    environment: input.environment,
    approvalRunId: input.approvalRunId,
    approvedAt: input.approvedAt,
    decision: input.decision,
    artifactDigest: input.artifactDigest,
    release: input.release,
    toolingCommitSha: input.toolingCommitSha,
  };
  return { ...unsigned, attestationDigest: digest(unsigned) };
}

function verifyApprovals(envelopes, approvalKeys, artifact, generatedAt, now) {
  if (!Array.isArray(envelopes) || envelopes.length !== ROLES.length) throw new Error('Three distinct protected approvals are required');
  const keyFingerprints = new Set();
  return ROLES.map((role) => {
    const envelope = envelopes.find((candidate) => candidate?.artifact?.role === role);
    const key = approvalKeys?.[role];
    if (!envelope || !key) throw new Error(`${role} approval is required`);
    const approval = verifySigned(envelope, key);
    exact(approval, [
      'schemaVersion', 'kind', 'role', 'environment', 'approvalRunId', 'approvedAt', 'decision',
      'artifactDigest', 'release', 'toolingCommitSha', 'attestationDigest',
    ], 'authorization approval');
    const expected = buildApprovalAttestation({
      role, environment: approval.environment, approvalRunId: approval.approvalRunId,
      approvedAt: approval.approvedAt, artifactDigest: artifact.artifactDigest,
      release: artifact.release, toolingCommitSha: approval.toolingCommitSha, decision: approval.decision,
    });
    if (canonicalize(expected) !== canonicalize(approval)) throw new Error(`${role} approval does not bind the evidence`);
    const approvedAt = timestamp(approval.approvedAt, 'approvedAt');
    if (approvedAt < timestamp(artifact.observation.observedUntil, 'observedUntil')
      || approvedAt > generatedAt || approvedAt > now + FUTURE_SKEW_MS) {
      throw new Error(`${role} approval time is invalid`);
    }
    const keyFingerprint = fingerprint(key.publicKey);
    if (keyFingerprints.has(keyFingerprint)) throw new Error('Authorization approvals must use distinct public key material');
    keyFingerprints.add(keyFingerprint);
    return {
      role,
      environment: approval.environment,
      approvalRunId: approval.approvalRunId,
      approvedAt: approval.approvedAt,
      toolingCommitSha: approval.toolingCommitSha,
      attestationDigest: approval.attestationDigest,
      keyId: envelope.signature.keyId,
      keyFingerprint,
      envelope,
    };
  });
}

function validateArtifact(artifact) {
  exact(artifact, [
    'schemaVersion', 'kind', 'release', 'inventory', 'observation', 'counts', 'coverage',
    'canaries', 'source', 'provenance', 'artifactDigest',
  ], 'authorization evidence artifact');
  const unsigned = { ...artifact };
  delete unsigned.artifactDigest;
  const inventory = getAuthorizationSurfaceInventory();
  exact(artifact.inventory, ['inventoryId', 'digest', 'surfaceCount'], 'authorization inventory');
  exact(artifact.observation, ['observedFrom', 'observedUntil', 'durationSeconds'], 'authorization observation');
  exact(artifact.counts, ['events', 'decisions', 'mismatches'], 'authorization counts');
  exact(artifact.canaries, ['intervalSeconds', 'expected', 'observed', 'gaps'], 'authorization canaries');
  exact(artifact.source, ['uri', 'sha256'], 'authorization source');
  const expectedCoverage = new Map();
  for (const surface of inventory.surfaces) {
    for (const mode of surface.modes) {
      expectedCoverage.set(`${surface.id}\0${mode}`, surface.channel);
    }
  }
  const observedCoverage = new Set();
  let decisionTotal = 0;
  let mismatchTotal = 0;
  if (!Array.isArray(artifact.coverage) || artifact.coverage.length !== expectedCoverage.size) {
    throw new Error('Authorization surface coverage is incomplete');
  }
  for (const row of artifact.coverage) {
    exact(row, ['channel', 'surface', 'mode', 'decisions', 'mismatches'], 'authorization coverage row');
    const key = `${row.surface}\0${row.mode}`;
    if (observedCoverage.has(key) || expectedCoverage.get(key) !== row.channel
      || !Number.isSafeInteger(row.decisions) || row.decisions <= 0
      || !Number.isSafeInteger(row.mismatches) || row.mismatches < 0) {
      throw new Error('Authorization surface coverage is invalid or incomplete');
    }
    observedCoverage.add(key);
    decisionTotal += row.decisions;
    mismatchTotal += row.mismatches;
  }
  const integerCounts = ['events', 'decisions', 'mismatches'].every((field) => (
    Number.isSafeInteger(artifact.counts[field]) && artifact.counts[field] >= 0
  ));
  const integerCanaries = ['intervalSeconds', 'expected', 'observed'].every((field) => (
    Number.isSafeInteger(artifact.canaries[field]) && artifact.canaries[field] >= 0
  ));
  if (artifact.schemaVersion !== 1 || artifact.kind !== 'maslaxat-authorization-compatibility-evidence'
    || digest(unsigned) !== artifact.artifactDigest
    || artifact.inventory.inventoryId !== inventory.inventoryId
    || artifact.inventory.digest !== authorizationSurfaceDigest()
    || artifact.inventory.surfaceCount !== inventory.surfaces.length
    || !integerCounts || artifact.counts.decisions !== decisionTotal
    || artifact.counts.mismatches !== mismatchTotal || mismatchTotal !== 0
    || !integerCanaries || artifact.canaries.intervalSeconds !== CANARY_INTERVAL_MS / 1000
    || !Array.isArray(artifact.canaries.gaps) || artifact.canaries.gaps.length !== 0
    || artifact.canaries.expected !== artifact.canaries.observed
    || artifact.counts.events !== artifact.counts.decisions + artifact.canaries.observed
    || !SHA256.test(artifact.source.sha256 || '') || !artifact.source.uri.startsWith('private://')) {
    throw new Error('Authorization evidence artifact is invalid or incomplete');
  }
  validateRelease(artifact.release, 'compatibility');
  validateProvenance(artifact.provenance, artifact.release);
  const from = timestamp(artifact.observation.observedFrom, 'observedFrom');
  const until = timestamp(artifact.observation.observedUntil, 'observedUntil');
  const expectedCanaries = Math.floor((until - from) / CANARY_INTERVAL_MS) + 1;
  if (until - from < 24 * 60 * 60 * 1000 || artifact.observation.durationSeconds !== (until - from) / 1000
    || artifact.canaries.expected !== expectedCanaries) {
    throw new Error('Authorization observation must be derived from at least 24 hours');
  }
  return artifact;
}

function buildAuthorizationManifest(input, options) {
  exact(input, ['generatedAt', 'evidenceArtifact', 'approvalEnvelopes'], 'authorization manifest input');
  const now = options?.now instanceof Date ? options.now.getTime() : NaN;
  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  if (!Number.isFinite(now) || generatedAt > now + FUTURE_SKEW_MS || now - generatedAt > MAX_AGE_MS) {
    throw new Error('Authorization manifest generation time is stale or invalid');
  }
  const artifact = validateArtifact(input.evidenceArtifact);
  const observedUntil = timestamp(artifact.observation.observedUntil, 'observedUntil');
  if (observedUntil > generatedAt) throw new Error('Evidence ends after manifest generation');
  if (now - observedUntil > MAX_AGE_MS) throw new Error('Authorization observation end is stale');
  const approvals = verifyApprovals(input.approvalEnvelopes, options.approvalKeys, artifact, generatedAt, now);
  return {
    schemaVersion: 1,
    kind: 'maslaxat-authorization-cutover-manifest',
    generatedAt: input.generatedAt,
    evidence: artifact,
    approvals,
  };
}

function verifyAuthorizationCutoverEnvelope(envelope, options) {
  const now = options?.now instanceof Date ? options.now.getTime() : NaN;
  if (!Number.isFinite(now)) throw new Error('Injected authorization verifier time is required');
  const manifest = verifySigned(envelope, options.manifestKey);
  exact(manifest, ['schemaVersion', 'kind', 'generatedAt', 'evidence', 'approvals'], 'authorization cutover manifest');
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'maslaxat-authorization-cutover-manifest') {
    throw new Error('Authorization cutover manifest metadata is invalid');
  }
  const generatedAt = timestamp(manifest.generatedAt, 'generatedAt');
  if (generatedAt > now + FUTURE_SKEW_MS || now - generatedAt > MAX_AGE_MS) throw new Error('Authorization cutover manifest is stale');
  const artifact = validateArtifact(manifest.evidence);
  if (now - timestamp(artifact.observation.observedUntil, 'observedUntil') > MAX_AGE_MS) {
    throw new Error('Authorization observation end is stale');
  }
  const approvals = verifyApprovals(
    manifest.approvals.map((approval) => approval.envelope),
    options.approvalKeys,
    artifact,
    generatedAt,
    now,
  );
  const expected = options.expectedRelease;
  validateRelease({ ...expected, authorizationMode: 'compatibility' });
  if (expected.authorizationMode !== 'capability_only'
    || ['commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead']
      .some((field) => expected[field] !== artifact.release[field])) {
    throw new Error('Authorization evidence release does not match the running cutover release');
  }
  return { ...manifest, approvals, cutoverEligible: true };
}

module.exports = {
  ROLES,
  buildApprovalAttestation,
  buildAuthorizationManifest,
  signAuthorizationArtifact,
  verifyAuthorizationArtifact,
  verifyAuthorizationCutoverEnvelope,
};
