const { digest } = require('./paymentShadowEvidence');
const { canonicalAuthorizationConfigDigest } = require('./authorizationRuntimeIdentity');

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9._-]{3,160}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TRUSTED_REF = /^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/;
const MAX_METADATA_AGE_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new Error(`${label} must contain exactly the approved fields`);
  }
}

function validateRunId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)
    || !Number.isSafeInteger(Number(value))) throw new Error('Workflow run ID is invalid');
  return Number(value);
}

function validateProviderWorkflowProvenance({ metadata, context }) {
  exact(metadata, [
    'commitSha', 'deploymentId', 'serviceId', 'configDigest', 'migrationHead',
    'authorizationMode', 'issuedAt',
  ], 'provider metadata');
  exact(context, [
    'repository', 'workflowRef', 'workflowRunId', 'workflowRunAttempt',
    'reviewedCommitSha', 'trustedRef', 'now',
  ], 'workflow context');
  const runId = validateRunId(context.workflowRunId);
  const runAttempt = validateRunId(context.workflowRunAttempt);
  const issuedAt = Date.parse(metadata.issuedAt);
  const now = Date.parse(context.now);
  if (!Number.isFinite(issuedAt) || new Date(issuedAt).toISOString() !== metadata.issuedAt
    || !Number.isFinite(now) || new Date(now).toISOString() !== context.now
    || issuedAt > now + FUTURE_SKEW_MS || now - issuedAt > MAX_METADATA_AGE_MS) {
    throw new Error('Provider metadata is stale or has invalid time');
  }
  if (!COMMIT.test(metadata.commitSha || '') || metadata.commitSha !== context.reviewedCommitSha) {
    throw new Error('Provider commit does not match reviewed build commit');
  }
  if (!SAFE_ID.test(metadata.deploymentId || '') || !SAFE_ID.test(metadata.serviceId || '')) {
    throw new Error('Provider deployment or service identity is invalid');
  }
  if (!SHA256.test(metadata.configDigest || '')
    || metadata.configDigest !== canonicalAuthorizationConfigDigest()) {
    throw new Error('Provider authorization config digest does not match runtime semantics');
  }
  if (!/^[0-9]{14}-[a-z0-9-]+\.js$/.test(metadata.migrationHead || '')
    || metadata.authorizationMode !== 'compatibility') {
    throw new Error('Provider migration or authorization mode is invalid');
  }
  if (!REPOSITORY.test(context.repository || '') || !TRUSTED_REF.test(context.trustedRef || '')
    || context.workflowRef !== `${context.repository}/.github/workflows/authorization-evidence-prepare.yml@${context.trustedRef}`) {
    throw new Error('Workflow ref does not match the trusted evidence workflow ref');
  }
  return {
    release: {
      commitSha: metadata.commitSha,
      deploymentId: metadata.deploymentId,
      serviceId: metadata.serviceId,
      configDigest: metadata.configDigest,
      migrationHead: metadata.migrationHead,
      authorizationMode: metadata.authorizationMode,
    },
    workflow: {
      repository: context.repository,
      ref: context.workflowRef,
      runId,
      runAttempt,
      reviewedCommitSha: context.reviewedCommitSha,
    },
    providerMetadataDigest: digest(metadata),
    validatedAt: context.now,
  };
}

module.exports = { validateProviderWorkflowProvenance, validateRunId };
