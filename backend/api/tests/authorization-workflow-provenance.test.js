const fs = require('fs');
const path = require('path');
const {
  validateProviderWorkflowProvenance,
  validateRunId,
} = require('../src/services/authorizationEvidenceProvenance');
const { canonicalAuthorizationConfigDigest } = require('../src/services/authorizationRuntimeIdentity');

const root = path.join(__dirname, '..', '..', '..');

test('provider metadata is bound to exact reviewed build and workflow run provenance', () => {
  const result = validateProviderWorkflowProvenance({
    metadata: {
      commitSha: 'a'.repeat(40),
      deploymentId: 'provider-deployment-123',
      serviceId: 'provider-service-456',
      configDigest: canonicalAuthorizationConfigDigest(),
      migrationHead: '20260824000000-create-authorization-evidence-events.js',
      authorizationMode: 'compatibility',
      issuedAt: '2026-08-19T00:00:00.000Z',
    },
    context: {
      repository: 'owner/maslaxat',
      workflowRef: 'owner/maslaxat/.github/workflows/authorization-evidence-prepare.yml@refs/heads/release/staging',
      workflowRunId: '12345',
      workflowRunAttempt: '2',
      reviewedCommitSha: 'a'.repeat(40),
      trustedRef: 'refs/heads/release/staging',
      now: '2026-08-19T00:05:00.000Z',
    },
  });

  expect(result.release).toMatchObject({
    commitSha: 'a'.repeat(40), deploymentId: 'provider-deployment-123',
  });
  expect(result.workflow).toMatchObject({ runId: 12345, runAttempt: 2 });
  expect(result.providerMetadataDigest).toMatch(/^[a-f0-9]{64}$/);
});

test.each([
  ['12\nprintf pwned'],
  ['$(id)'],
  ["12' || true"],
  ['0'],
])('hostile workflow run ID %j is rejected before shell use', (value) => {
  expect(() => validateRunId(value)).toThrow(/run id/i);
});

test('provider provenance rejects mismatched commit, ref, stale metadata, and hostile service identity', () => {
  const base = {
    metadata: {
      commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'service-123',
      configDigest: canonicalAuthorizationConfigDigest(), migrationHead: '20260824000000-create-authorization-evidence-events.js',
      authorizationMode: 'compatibility', issuedAt: '2026-08-19T00:00:00.000Z',
    },
    context: {
      repository: 'owner/maslaxat',
      workflowRef: 'owner/maslaxat/.github/workflows/authorization-evidence-prepare.yml@refs/heads/release/staging',
      workflowRunId: '123', workflowRunAttempt: '1', reviewedCommitSha: 'a'.repeat(40),
      trustedRef: 'refs/heads/release/staging', now: '2026-08-19T00:05:00.000Z',
    },
  };
  expect(() => validateProviderWorkflowProvenance({
    ...base, metadata: { ...base.metadata, commitSha: 'c'.repeat(40) },
  })).toThrow(/commit/i);
  expect(() => validateProviderWorkflowProvenance({
    ...base, context: { ...base.context, trustedRef: 'refs/heads/main' },
  })).toThrow(/ref/i);
  expect(() => validateProviderWorkflowProvenance({
    ...base, context: { ...base.context, now: '2026-08-20T02:00:00.000Z' },
  })).toThrow(/stale/i);
  expect(() => validateProviderWorkflowProvenance({
    ...base, metadata: { ...base.metadata, serviceId: "service'\nprintf pwned" },
  })).toThrow(/identity/i);
});

test('workflow run blocks contain no direct GitHub expressions and key IDs are not hard-coded downstream', () => {
  const files = [
    '.github/workflows/authorization-evidence-prepare.yml',
    '.github/workflows/authorization-evidence-approval.yml',
    '.github/workflows/authorization-cutover-evidence.yml',
  ];
  for (const file of files) {
    const workflow = fs.readFileSync(path.join(root, file), 'utf8');
    const runBlocks = [...workflow.matchAll(/^\s{8}run:\s*\|\n((?:\s{10,}.*(?:\n|$))*)/gm)]
      .map((match) => match[1]);
    expect(runBlocks.join('\n')).not.toMatch(/\$\{\{/);
  }
  const final = fs.readFileSync(path.join(root, '.github/workflows/authorization-cutover-evidence.yml'), 'utf8');
  expect(final).not.toMatch(/--(?:security|release|cutover)-owner-key-id\s+(?:security|release|cutover)-owner-v1/);
  expect(final).toMatch(/approval\.signed\.json/);
});
