const { verifyCanonicalArtifact } = require('./paymentEvidenceManifest');
const { digest } = require('./paymentShadowEvidence');

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-z0-9._-]{3,128}$/i;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || Object.keys(value).some((field) => !fields.includes(field))) {
    throw new Error(`${label} must contain exactly the approved fields`);
  }
}

function runId(value, label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)
    || !Number.isSafeInteger(Number(value))) throw new Error(`${label} run ID is invalid`);
  return Number(value);
}

function validateDispatchInput(input) {
  exactFields(input, ['proofRunId', 'paymentApprovalRunId', 'releaseApprovalRunId'], 'dispatch input');
  return {
    proofRunId: runId(input.proofRunId, 'proof'),
    paymentApprovalRunId: runId(input.paymentApprovalRunId, 'payment approval'),
    releaseApprovalRunId: runId(input.releaseApprovalRunId, 'release approval'),
  };
}

function buildApprovalAttestation(input) {
  exactFields(input, [
    'role', 'approvalRunId', 'proofRunId', 'roleKeyFingerprint', 'approvedAt', 'release', 'inventoryDigest',
    'shadowArtifactDigest', 'reconciliationSummaryDigest', 'providerSnapshotDigest',
    'databaseIdentityDigest', 'snapshotIdentityDigest', 'reconciledAt',
  ], 'approval input');
  exactFields(input.release, ['commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead'], 'approval release');
  const approvedAt = Date.parse(input.approvedAt);
  if (!APPROVAL_ROLE.test(input.role)
    || !Number.isSafeInteger(input.approvalRunId) || input.approvalRunId <= 0
    || !Number.isSafeInteger(input.proofRunId) || input.proofRunId <= 0
    || !SHA256.test(input.roleKeyFingerprint || '')
    || !Number.isFinite(approvedAt) || new Date(approvedAt).toISOString() !== input.approvedAt
    || !COMMIT.test(input.release.commitSha || '') || !SAFE_ID.test(input.release.deploymentId || '')
    || !SAFE_ID.test(input.release.serviceId || '') || !SHA256.test(input.release.configDigest || '')
    || !/^[0-9]{14}-[a-z0-9-]+\.js$/.test(input.release.migrationHead || '')
    || [input.inventoryDigest, input.shadowArtifactDigest, input.reconciliationSummaryDigest,
      input.providerSnapshotDigest, input.databaseIdentityDigest, input.snapshotIdentityDigest]
      .some((value) => !SHA256.test(value || ''))
    || !Number.isFinite(Date.parse(input.reconciledAt))
    || new Date(input.reconciledAt).toISOString() !== input.reconciledAt) {
    throw new Error('Approval role, environment, run, time, or evidence bindings are invalid');
  }
  const unsigned = {
    schemaVersion: 1,
    kind: 'payment-evidence-approval',
    role: input.role,
    environment: input.role === 'payment_owner' ? 'payment-owner-approval' : 'release-owner-approval',
    approvalRunId: input.approvalRunId,
    proofRunId: input.proofRunId,
    roleKeyFingerprint: input.roleKeyFingerprint,
    approvedAt: input.approvedAt,
    decision: 'approve',
    bindings: {
      ...input.release,
      inventoryDigest: input.inventoryDigest,
      shadowArtifactDigest: input.shadowArtifactDigest,
      reconciliationSummaryDigest: input.reconciliationSummaryDigest,
      providerSnapshotDigest: input.providerSnapshotDigest,
      databaseIdentityDigest: input.databaseIdentityDigest,
      snapshotIdentityDigest: input.snapshotIdentityDigest,
      reconciledAt: input.reconciledAt,
    },
  };
  return { ...unsigned, attestationDigest: digest(unsigned) };
}

function validateProofRun(run, expected) {
  const expectedRunId = runId(expected.proofRunId, 'proof');
  if (run?.id !== expectedRunId || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/payment-staging-evidence-prepare.yml'
    || run.event !== 'workflow_dispatch' || run.repository?.full_name !== expected.repository
    || run.head_branch !== expected.trustedRef || run.head_sha !== expected.reviewedCommitSha
    || !COMMIT.test(run.head_sha || '') || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    throw new Error('Prepare proof workflow run does not match the approved successful run');
  }
  return {
    id: run.id,
    workflow: run.path,
    repository: run.repository.full_name,
    commitSha: run.head_sha,
    branch: run.head_branch,
    attempt: run.run_attempt,
  };
}

function validateSourceRun(run, expected) {
  const expectedRunId = runId(expected.sourceRunId, 'source');
  if (run?.id !== expectedRunId || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/payment-shadow-telemetry.yml'
    || run.event !== 'workflow_dispatch' || run.repository?.full_name !== expected.repository
    || run.head_branch !== expected.trustedRef || run.head_sha !== expected.reviewedCommitSha
    || !COMMIT.test(run.head_sha || '') || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    throw new Error('Source workflow run does not match the approved successful telemetry run');
  }
  return {
    id: run.id,
    workflow: run.path,
    repository: run.repository.full_name,
    commitSha: run.head_sha,
    branch: run.head_branch,
    attempt: run.run_attempt,
  };
}

function validateApprovalRun(run, expected) {
  const expectedRunId = runId(expected.runId, `${expected.role || 'approval'}`);
  if (!APPROVAL_ROLE.test(expected.role || '') || run?.id !== expectedRunId
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/payment-evidence-approval.yml'
    || run.event !== 'workflow_dispatch' || run.repository?.full_name !== expected.repository
    || run.head_branch !== expected.trustedRef || run.head_sha !== expected.reviewedCommitSha
    || !COMMIT.test(run.head_sha || '') || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    throw new Error('Approval workflow run does not match the approved successful workflow');
  }
  return {
    id: run.id,
    role: expected.role,
    workflow: run.path,
    repository: run.repository.full_name,
    commitSha: run.head_sha,
    branch: run.head_branch,
    attempt: run.run_attempt,
  };
}

function verifySourceAttestation(envelope, { publicKey, keyId, now, run }) {
  const artifact = verifyCanonicalArtifact(envelope, {
    publicKey, keyId, kind: 'payment-shadow-source', digestField: 'sourceDigest',
  });
  exactFields(artifact, [
    'schemaVersion', 'kind', 'sourceRunId', 'sourceWorkflow', 'repository', 'commitSha',
    'deploymentId', 'serviceId', 'configDigest', 'migrationHead', 'generatedAt',
    'observationMode', 'inventoryDigest', 'eventsDigest', 'streamMetadataDigest',
    'providerSnapshotDigest', 'sourceDigest',
  ], 'source attestation');
  const verifierTime = now instanceof Date ? now.getTime() : NaN;
  const generatedAt = Date.parse(artifact.generatedAt);
  if (!Number.isFinite(verifierTime) || !Number.isFinite(generatedAt)
    || new Date(generatedAt).toISOString() !== artifact.generatedAt) {
    throw new Error('Injected verifier time and source generation time are required');
  }
  if (generatedAt > verifierTime + FUTURE_SKEW_MS) throw new Error('Source attestation is from the future');
  if (verifierTime - generatedAt > MAX_AGE_MS) throw new Error('Source attestation is stale');
  if (artifact.schemaVersion !== 1 || artifact.sourceRunId !== run.id
    || artifact.sourceWorkflow !== run.workflow || artifact.repository !== run.repository
    || artifact.commitSha !== run.commitSha || !COMMIT.test(artifact.commitSha)
    || !SAFE_ID.test(artifact.deploymentId || '') || !SAFE_ID.test(artifact.serviceId || '')
    || !['scenario-set', '24h'].includes(artifact.observationMode)
    || !/^[0-9]{14}-[a-z0-9-]+\.js$/.test(artifact.migrationHead || '')
    || [artifact.configDigest, artifact.inventoryDigest, artifact.eventsDigest,
      artifact.streamMetadataDigest, artifact.providerSnapshotDigest].some((value) => !SHA256.test(value || ''))) {
    throw new Error('Source attestation deployment or artifact bindings are invalid');
  }
  return artifact;
}

const APPROVAL_ROLE = /^(payment_owner|release_owner)$/;

module.exports = {
  buildApprovalAttestation,
  validateApprovalRun,
  validateDispatchInput,
  validateProofRun,
  validateSourceRun,
  verifySourceAttestation,
};
