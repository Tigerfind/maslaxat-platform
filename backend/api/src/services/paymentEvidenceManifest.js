const crypto = require('crypto');
const {
  canonicalize,
  digest,
  scenarioInventoryDigest,
  validateInventory,
} = require('./paymentShadowEvidence');

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const APPROVAL_ROLES = Object.freeze(['payment_owner', 'release_owner']);
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_OBSERVATION_SPAN_MS = 7 * 24 * 60 * 60 * 1000;

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || Object.keys(value).some((field) => !fields.includes(field))) {
    throw new Error(`${label} must contain exactly the approved fields`);
  }
}

function timestamp(value, label) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return Date.parse(value);
}

function validateRelease(release) {
  exactFields(release, ['commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead'], 'release');
  if (!COMMIT.test(release.commitSha) || !SHA256.test(release.configDigest)
    || !release.deploymentId || !release.serviceId || !/^[0-9]{14}-[a-z0-9-]+\.js$/.test(release.migrationHead)) {
    throw new Error('Complete release bindings are required');
  }
}

function verifierTime(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Injected verifier time is required');
  }
  return value.getTime();
}

function enforceFresh(value, label, now, { notBefore = null } = {}) {
  const time = timestamp(value, label);
  if (time > now + MAX_FUTURE_SKEW_MS) throw new Error(`${label} is from the future`);
  if (now - time > MAX_EVIDENCE_AGE_MS) throw new Error(`${label} is stale`);
  if (notBefore !== null && time < notBefore) throw new Error(`${label} predates its required evidence`);
  return time;
}

function validateArtifact(artifact, inventory) {
  exactFields(artifact, [
    'schemaVersion', 'inventoryId', 'inventoryDigest', 'counts', 'stream', 'coverage', 'events', 'artifactDigest',
  ], 'shadow artifact');
  if (artifact.schemaVersion !== 2 || artifact.inventoryId !== inventory.inventoryId
    || artifact.inventoryDigest !== scenarioInventoryDigest(inventory) || !SHA256.test(artifact.artifactDigest || '')) {
    throw new Error('Shadow artifact does not match the scenario inventory');
  }
  exactFields(artifact.counts, ['received', 'accepted', 'duplicates', 'gaps', 'matched', 'mismatched'], 'artifact counts');
  if (artifact.counts.accepted <= 0 || artifact.counts.gaps !== 0) throw new Error('Shadow artifact contains a collection gap');
  if (artifact.counts.mismatched !== 0 || artifact.counts.matched !== artifact.counts.accepted) {
    throw new Error('Shadow artifact contains a compatibility mismatch');
  }
  exactFields(artifact.stream, [
    'streamId', 'firstSequence', 'lastSequence', 'firstCheckpoint', 'lastCheckpoint', 'eventCount',
    'firstObservedAt', 'lastObservedAt',
  ], 'shadow stream');
  if (!artifact.stream.streamId || artifact.stream.eventCount !== artifact.counts.accepted
    || artifact.stream.lastSequence - artifact.stream.firstSequence + 1 !== artifact.stream.eventCount
    || !SHA256.test(artifact.stream.firstCheckpoint || '') || !SHA256.test(artifact.stream.lastCheckpoint || '')) {
    throw new Error('Shadow stream bounds are invalid');
  }
  const firstObservedAt = timestamp(artifact.stream.firstObservedAt, 'firstObservedAt');
  const lastObservedAt = timestamp(artifact.stream.lastObservedAt, 'lastObservedAt');
  if (lastObservedAt < firstObservedAt || lastObservedAt - firstObservedAt > MAX_OBSERVATION_SPAN_MS) {
    throw new Error('Shadow stream observation bounds are invalid');
  }
  for (const scenario of inventory.scenarios) {
    if (!Number.isSafeInteger(artifact.coverage?.[scenario.key]) || artifact.coverage[scenario.key] <= 0) {
      throw new Error(`Shadow artifact coverage is incomplete for ${scenario.key}`);
    }
  }
  const unsigned = { ...artifact };
  delete unsigned.artifactDigest;
  if (digest(unsigned) !== artifact.artifactDigest) throw new Error('Shadow artifact digest does not match');
}

function validateReconciliation(reconciliation) {
  exactFields(reconciliation, [
    'summaryDigest', 'ready', 'mismatchCount', 'providerSnapshotDigest',
    'providerSnapshotCapturedAt', 'summaryGeneratedAt', 'databaseIdentityDigest',
    'snapshotIdentityDigest', 'reconciledAt',
  ], 'reconciliation');
  if (!SHA256.test(reconciliation.summaryDigest || '') || !SHA256.test(reconciliation.providerSnapshotDigest || '')
    || !SHA256.test(reconciliation.databaseIdentityDigest || '')
    || !SHA256.test(reconciliation.snapshotIdentityDigest || '')
    || reconciliation.ready !== true || reconciliation.mismatchCount !== 0) {
    throw new Error('Clean bound reconciliation evidence is required');
  }
}

function expectedApprovalBindings(input) {
  return {
    ...input.release,
    inventoryDigest: scenarioInventoryDigest(input.inventory),
    shadowArtifactDigest: input.shadowArtifact.artifactDigest,
    reconciliationSummaryDigest: input.reconciliation.summaryDigest,
    providerSnapshotDigest: input.reconciliation.providerSnapshotDigest,
    databaseIdentityDigest: input.reconciliation.databaseIdentityDigest,
    snapshotIdentityDigest: input.reconciliation.snapshotIdentityDigest,
    reconciledAt: input.reconciliation.reconciledAt,
  };
}

function verifyApprovals(envelopes, options, expectedBindings, times) {
  if (!Array.isArray(envelopes) || envelopes.length !== APPROVAL_ROLES.length) {
    throw new Error('Exactly two externally signed approval attestations are required');
  }
  const approvals = [];
  const environments = new Set();
  const keyIds = new Set();
  const keyFingerprints = new Set();
  for (const role of APPROVAL_ROLES) {
    const envelope = envelopes.find((candidate) => candidate?.artifact?.role === role);
    const keyConfig = options.approvalKeys?.[role];
    if (!envelope || !keyConfig) throw new Error(`Signed ${role} approval is required`);
    const artifact = verifyCanonicalArtifact(envelope, {
      publicKey: keyConfig.publicKey,
      keyId: keyConfig.keyId,
      kind: 'payment-evidence-approval',
      digestField: 'attestationDigest',
    });
    exactFields(artifact, [
      'schemaVersion', 'kind', 'role', 'environment', 'approvalRunId', 'proofRunId',
      'roleKeyFingerprint', 'approvedAt', 'decision', 'bindings', 'attestationDigest',
    ], 'approval attestation');
    exactFields(artifact.bindings, Object.keys(expectedBindings), 'approval bindings');
    const expectedEnvironment = role === 'payment_owner' ? 'payment-owner-approval' : 'release-owner-approval';
    if (artifact.environment !== expectedEnvironment) {
      throw new Error(`Signed ${role} approval environment does not match`);
    }
    if (artifact.proofRunId !== options.proofRun?.id) {
      throw new Error(`Signed ${role} approval does not match the prepare proof run`);
    }
    const fingerprint = publicKeyFingerprint(keyConfig.publicKey);
    if (artifact.roleKeyFingerprint !== fingerprint) {
      throw new Error(`Signed ${role} approval public key fingerprint does not match`);
    }
    if (artifact.schemaVersion !== 1 || artifact.role !== role || artifact.decision !== 'approve'
      || !Number.isSafeInteger(artifact.approvalRunId) || artifact.approvalRunId <= 0
      || artifact.approvalRunId !== options.approvalRuns?.[role]?.id
      || !Number.isSafeInteger(artifact.proofRunId) || artifact.proofRunId <= 0
      || canonicalize(artifact.bindings) !== canonicalize(expectedBindings)) {
      throw new Error(`Signed ${role} approval does not match the evidence package`);
    }
    enforceFresh(artifact.approvedAt, `${role} approvedAt`, times.now, { notBefore: times.summaryGeneratedAt });
    if (timestamp(artifact.approvedAt, 'approvedAt') > times.generatedAt) {
      throw new Error(`${role} approval is later than manifest generation`);
    }
    if (environments.has(artifact.environment) || keyIds.has(envelope.signature.keyId)
      || keyFingerprints.has(fingerprint)) {
      throw new Error('Payment and release approvals use the same public key material');
    }
    environments.add(artifact.environment);
    keyIds.add(envelope.signature.keyId);
    keyFingerprints.add(fingerprint);
    approvals.push({
      role,
      environment: artifact.environment,
      approvalRunId: artifact.approvalRunId,
      proofRunId: artifact.proofRunId,
      roleKeyFingerprint: fingerprint,
      approvedAt: artifact.approvedAt,
      attestationDigest: artifact.attestationDigest,
      keyId: envelope.signature.keyId,
      signatureDigest: digest(envelope.signature.value),
    });
  }
  return approvals;
}

function generateUnsignedManifest(input, options = {}) {
  exactFields(input, [
    'generatedAt', 'environment', 'release', 'inventory', 'shadowArtifact',
    'observation', 'reconciliation', 'approvalEnvelopes',
  ], 'manifest input');
  const now = verifierTime(options.now);
  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  enforceFresh(input.generatedAt, 'generatedAt', now);
  if (input.environment !== 'staging') throw new Error('Payment evidence environment must be staging');
  validateRelease(input.release);
  const inventory = validateInventory(input.inventory);
  validateArtifact(input.shadowArtifact, inventory);
  exactFields(input.observation, ['mode'], 'observation');
  const from = timestamp(input.shadowArtifact.stream.firstObservedAt, 'firstObservedAt');
  const until = timestamp(input.shadowArtifact.stream.lastObservedAt, 'lastObservedAt');
  if (!['scenario-set', '24h'].includes(input.observation.mode) || until < from || until > generatedAt
    || (input.observation.mode === '24h' && until - from < 24 * 60 * 60 * 1000)) {
    throw new Error('Observation window is invalid or incomplete');
  }
  validateReconciliation(input.reconciliation);
  const providerCapturedAt = enforceFresh(
    input.reconciliation.providerSnapshotCapturedAt,
    'providerSnapshotCapturedAt',
    now,
    { notBefore: until },
  );
  const summaryGeneratedAt = enforceFresh(
    input.reconciliation.summaryGeneratedAt,
    'summaryGeneratedAt',
    now,
    { notBefore: providerCapturedAt },
  );
  const reconciledAt = enforceFresh(input.reconciliation.reconciledAt, 'reconciledAt', now, {
    notBefore: providerCapturedAt,
  });
  if (reconciledAt !== summaryGeneratedAt) {
    throw new Error('Reconciliation time must match signed summary generation time');
  }
  if (summaryGeneratedAt > generatedAt) throw new Error('Reconciliation summary is later than manifest generation');
  const approvals = verifyApprovals(
    input.approvalEnvelopes,
    options,
    expectedApprovalBindings(input),
    { now, generatedAt, summaryGeneratedAt },
  );
  return {
    schemaVersion: 4,
    kind: 'payment-v2-shadow-evidence',
    generatedAt: input.generatedAt,
    environment: input.environment,
    release: input.release,
    scenarioInventory: {
      inventoryId: inventory.inventoryId,
      digest: scenarioInventoryDigest(inventory),
      scenarioCount: inventory.scenarios.length,
    },
    observation: {
      mode: input.observation.mode,
      observedFrom: input.shadowArtifact.stream.firstObservedAt,
      observedUntil: input.shadowArtifact.stream.lastObservedAt,
    },
    shadowArtifact: {
      digest: input.shadowArtifact.artifactDigest,
      counts: input.shadowArtifact.counts,
      stream: input.shadowArtifact.stream,
      coverage: input.shadowArtifact.coverage,
    },
    reconciliation: input.reconciliation,
    approvals,
  };
}

function signingKey(value) {
  try {
    const key = value?.type === 'private' ? value : crypto.createPrivateKey(value);
    if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error('wrong type');
    return key;
  } catch (_error) {
    throw new Error('Offline Ed25519 private signing key is required');
  }
}

function verificationKey(value) {
  try {
    const key = value?.type === 'public' ? value : crypto.createPublicKey(value);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('wrong type');
    return key;
  } catch (_error) {
    throw new Error('Offline Ed25519 public verification key is required');
  }
}

function publicKeyFingerprint(value) {
  const der = verificationKey(value).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function signCanonicalArtifact(artifact, { privateKey, keyId }) {
  if (typeof keyId !== 'string' || !/^[a-z0-9._-]{3,80}$/i.test(keyId)) throw new Error('Signing key ID is required');
  const signature = crypto.sign(null, Buffer.from(canonicalize(artifact)), signingKey(privateKey)).toString('base64');
  return { artifact, signature: { algorithm: 'ed25519', keyId, value: signature } };
}

function verifyCanonicalArtifact(envelope, { publicKey, keyId, kind, digestField } = {}) {
  exactFields(envelope, ['artifact', 'signature'], 'signed artifact envelope');
  exactFields(envelope.signature, ['algorithm', 'keyId', 'value'], 'signature');
  if (envelope.signature.algorithm !== 'ed25519' || (keyId && envelope.signature.keyId !== keyId)) {
    throw new Error('Valid offline evidence signature configuration is required');
  }
  const signature = Buffer.from(envelope.signature.value || '', 'base64');
  if (!crypto.verify(null, Buffer.from(canonicalize(envelope.artifact)), verificationKey(publicKey), signature)) {
    throw new Error('Payment evidence signature does not match');
  }
  if (kind && envelope.artifact.kind !== kind) throw new Error('Signed artifact kind does not match');
  if (digestField) {
    const unsigned = { ...envelope.artifact };
    const supplied = unsigned[digestField];
    delete unsigned[digestField];
    if (!SHA256.test(supplied || '') || digest(unsigned) !== supplied) throw new Error('Signed artifact digest does not match');
  }
  return envelope.artifact;
}

function signManifest(manifest, options) {
  const signed = signCanonicalArtifact(manifest, options);
  return { manifest: signed.artifact, signature: signed.signature };
}

function validateSignedManifestShape(manifest, now) {
  exactFields(manifest, [
    'schemaVersion', 'kind', 'generatedAt', 'environment', 'release', 'scenarioInventory',
    'observation', 'shadowArtifact', 'reconciliation', 'approvals',
  ], 'signed manifest');
  if (manifest.schemaVersion !== 4 || manifest.kind !== 'payment-v2-shadow-evidence'
    || manifest.environment !== 'staging') throw new Error('Signed payment evidence manifest metadata is invalid');
  const generatedAt = timestamp(manifest.generatedAt, 'generatedAt');
  enforceFresh(manifest.generatedAt, 'generatedAt', now);
  validateRelease(manifest.release);
  exactFields(manifest.scenarioInventory, ['inventoryId', 'digest', 'scenarioCount'], 'scenario inventory binding');
  if (!manifest.scenarioInventory.inventoryId || !SHA256.test(manifest.scenarioInventory.digest || '')
    || !Number.isSafeInteger(manifest.scenarioInventory.scenarioCount) || manifest.scenarioInventory.scenarioCount <= 0) {
    throw new Error('Scenario inventory binding is invalid');
  }
  exactFields(manifest.observation, ['mode', 'observedFrom', 'observedUntil'], 'observation');
  const from = timestamp(manifest.observation.observedFrom, 'observedFrom');
  const until = timestamp(manifest.observation.observedUntil, 'observedUntil');
  if (!['scenario-set', '24h'].includes(manifest.observation.mode) || until < from || until > generatedAt
    || (manifest.observation.mode === '24h' && until - from < 24 * 60 * 60 * 1000)) {
    throw new Error('Signed observation window is invalid');
  }
  exactFields(manifest.shadowArtifact, ['digest', 'counts', 'stream', 'coverage'], 'shadow artifact binding');
  exactFields(manifest.shadowArtifact.counts, ['received', 'accepted', 'duplicates', 'gaps', 'matched', 'mismatched'], 'artifact counts');
  if (!SHA256.test(manifest.shadowArtifact.digest || '') || manifest.shadowArtifact.counts.accepted <= 0
    || manifest.shadowArtifact.counts.gaps !== 0 || manifest.shadowArtifact.counts.mismatched !== 0
    || manifest.shadowArtifact.counts.matched !== manifest.shadowArtifact.counts.accepted) {
    throw new Error('Signed shadow artifact counts are invalid');
  }
  const coverage = Object.values(manifest.shadowArtifact.coverage || {});
  if (coverage.length !== manifest.scenarioInventory.scenarioCount
    || coverage.some((count) => !Number.isSafeInteger(count) || count <= 0)) {
    throw new Error('Signed shadow artifact coverage is incomplete');
  }
  exactFields(manifest.shadowArtifact.stream, [
    'streamId', 'firstSequence', 'lastSequence', 'firstCheckpoint', 'lastCheckpoint', 'eventCount',
    'firstObservedAt', 'lastObservedAt',
  ], 'signed stream binding');
  if (manifest.shadowArtifact.stream.firstObservedAt !== manifest.observation.observedFrom
    || manifest.shadowArtifact.stream.lastObservedAt !== manifest.observation.observedUntil
    || manifest.shadowArtifact.stream.eventCount !== manifest.shadowArtifact.counts.accepted
    || manifest.shadowArtifact.stream.lastSequence - manifest.shadowArtifact.stream.firstSequence + 1
      !== manifest.shadowArtifact.stream.eventCount) {
    throw new Error('Signed stream and observation bindings do not match');
  }
  validateReconciliation(manifest.reconciliation);
  const providerCapturedAt = enforceFresh(
    manifest.reconciliation.providerSnapshotCapturedAt,
    'providerSnapshotCapturedAt', now, { notBefore: until },
  );
  const summaryGeneratedAt = enforceFresh(
    manifest.reconciliation.summaryGeneratedAt,
    'summaryGeneratedAt', now, { notBefore: providerCapturedAt },
  );
  if (summaryGeneratedAt > generatedAt) throw new Error('Reconciliation summary is later than manifest generation');
  if (!Array.isArray(manifest.approvals) || manifest.approvals.length !== APPROVAL_ROLES.length) {
    throw new Error('Exactly two signed approval bindings are required');
  }
  const environments = new Set();
  const keyIds = new Set();
  const keyFingerprints = new Set();
  let approvalProofRunId = null;
  for (const approval of manifest.approvals) {
    exactFields(approval, [
      'role', 'environment', 'approvalRunId', 'proofRunId', 'roleKeyFingerprint', 'approvedAt',
      'attestationDigest', 'keyId', 'signatureDigest',
    ], 'signed approval binding');
    if (!APPROVAL_ROLES.includes(approval.role) || environments.has(approval.environment) || keyIds.has(approval.keyId)
      || approval.environment !== (approval.role === 'payment_owner' ? 'payment-owner-approval' : 'release-owner-approval')
      || !Number.isSafeInteger(approval.approvalRunId) || approval.approvalRunId <= 0
      || !Number.isSafeInteger(approval.proofRunId) || approval.proofRunId <= 0
      || !SHA256.test(approval.roleKeyFingerprint || '')
      || !SHA256.test(approval.attestationDigest || '') || !SHA256.test(approval.signatureDigest || '')) {
      throw new Error('Signed approval bindings are not distinct or valid');
    }
    if (approvalProofRunId !== null && approval.proofRunId !== approvalProofRunId) {
      throw new Error('Signed approvals do not bind the same prepare proof run');
    }
    approvalProofRunId = approval.proofRunId;
    if (keyFingerprints.has(approval.roleKeyFingerprint)) {
      throw new Error('Signed approvals use the same public key material');
    }
    const approvalTime = enforceFresh(approval.approvedAt, 'approvedAt', now, { notBefore: summaryGeneratedAt });
    if (approvalTime > generatedAt) throw new Error('Approval is later than manifest generation');
    environments.add(approval.environment);
    keyIds.add(approval.keyId);
    keyFingerprints.add(approval.roleKeyFingerprint);
  }
}

function verifyManifest(envelope, expectations = {}) {
  const now = verifierTime(expectations.now);
  exactFields(envelope, ['manifest', 'signature'], 'signed evidence envelope');
  exactFields(envelope.signature, ['algorithm', 'keyId', 'value'], 'signature');
  if (envelope.signature.algorithm !== 'ed25519'
    || (expectations.keyId && envelope.signature.keyId !== expectations.keyId)
    || typeof envelope.signature.value !== 'string') {
    throw new Error('Valid offline evidence signature configuration is required');
  }
  let signature;
  try { signature = Buffer.from(envelope.signature.value, 'base64'); } catch (_error) { signature = Buffer.alloc(0); }
  if (!crypto.verify(null, Buffer.from(canonicalize(envelope.manifest)), verificationKey(expectations.publicKey), signature)) {
    throw new Error('Payment evidence signature does not match');
  }
  const manifest = envelope.manifest;
  validateSignedManifestShape(manifest, now);
  const bindings = {
    commitSha: manifest.release?.commitSha,
    deploymentId: manifest.release?.deploymentId,
    serviceId: manifest.release?.serviceId,
    configDigest: manifest.release?.configDigest,
    migrationHead: manifest.release?.migrationHead,
    inventoryDigest: manifest.scenarioInventory?.digest,
    reconciliationSummaryDigest: manifest.reconciliation?.summaryDigest,
    databaseIdentityDigest: manifest.reconciliation?.databaseIdentityDigest,
    snapshotIdentityDigest: manifest.reconciliation?.snapshotIdentityDigest,
    reconciledAt: manifest.reconciliation?.reconciledAt,
  };
  for (const [field, expectedValue] of Object.entries(expectations)) {
    if (['publicKey', 'keyId', 'now'].includes(field) || expectedValue === undefined) continue;
    if (bindings[field] !== expectedValue) throw new Error(`Payment evidence ${field} binding does not match`);
  }
  return { valid: true, cutoverEligible: false, schemaVersion: 4 };
}

module.exports = {
  generateUnsignedManifest,
  publicKeyFingerprint,
  signCanonicalArtifact,
  signManifest,
  verifyCanonicalArtifact,
  verifyManifest,
};
