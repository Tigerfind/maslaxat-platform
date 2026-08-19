const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  AUTHORIZATION_SURFACES,
  authorizationSurfaceDigest,
  getAuthorizationSurfaceInventory,
  validateAuthorizationSurfaceInventory,
} = require('../src/config/authorizationSurfaces');
const {
  CANARY_INTERVAL_MS,
  buildAuthorizationEvidenceArtifact,
  decisionEvent,
  canaryEvent,
} = require('../src/services/authorizationEvidence');
const {
  buildApprovalAttestation,
  buildAuthorizationManifest,
  signAuthorizationArtifact,
  verifyAuthorizationCutoverEnvelope,
} = require('../src/services/authorizationEvidenceManifest');
const { assertAuthorizationStartup } = require('../src/services/authorizationCutover');
const { digest } = require('../src/services/paymentShadowEvidence');

const RELEASE = Object.freeze({
  commitSha: 'a'.repeat(40),
  deploymentId: 'deployment-123',
  serviceId: 'maslaxat-api-staging',
  configDigest: 'b'.repeat(64),
  migrationHead: '20260824000000-create-authorization-evidence-events.js',
  authorizationMode: 'compatibility',
});
const FROM = new Date('2026-08-18T00:00:00.000Z');
const UNTIL = new Date('2026-08-19T00:00:00.000Z');
const GENERATED = new Date('2026-08-19T00:05:00.000Z');
const PROVENANCE = Object.freeze({
  release: RELEASE,
  workflow: {
    repository: 'owner/maslaxat',
    ref: 'owner/maslaxat/.github/workflows/authorization-evidence-prepare.yml@refs/heads/release/staging',
    runId: 123,
    runAttempt: 1,
    reviewedCommitSha: RELEASE.commitSha,
  },
  providerMetadataDigest: 'c'.repeat(64),
  validatedAt: '2026-08-19T00:00:00.000Z',
});

function completeEvents(from = FROM, until = UNTIL) {
  const events = [];
  for (let time = from.getTime(); time <= until.getTime(); time += CANARY_INTERVAL_MS) {
    events.push(canaryEvent({
      eventId: `canary-${time}`,
      observedAt: new Date(time),
      release: RELEASE,
    }));
  }
  for (const entry of getAuthorizationSurfaceInventory().surfaces) {
    for (const mode of entry.modes) {
      events.push(decisionEvent({
        eventId: `decision-${crypto.createHash('sha256').update(`${entry.id}:${mode}`).digest('hex')}`,
        observedAt: new Date(from.getTime() + CANARY_INTERVAL_MS),
        release: RELEASE,
        channel: entry.channel,
        surface: entry.id,
        mode,
        legacyAllowed: true,
        capabilityAllowed: true,
      }));
    }
  }
  return events;
}

function keys() {
  return {
    manifest: crypto.generateKeyPairSync('ed25519'),
    security_owner: crypto.generateKeyPairSync('ed25519'),
    release_owner: crypto.generateKeyPairSync('ed25519'),
    cutover_owner: crypto.generateKeyPairSync('ed25519'),
  };
}

function approvedEnvelope({
  reuseApprovalKey = false,
  from = FROM,
  until = UNTIL,
  generated = GENERATED,
  keyIds = {
    security_owner: 'security_owner-v1',
    release_owner: 'release_owner-v1',
    cutover_owner: 'cutover_owner-v1',
  },
  mutateArtifact = (artifact) => artifact,
  bypassManifestBuilder = false,
} = {}) {
  const keySet = keys();
  if (reuseApprovalKey) keySet.cutover_owner = keySet.release_owner;
  let artifact = buildAuthorizationEvidenceArtifact({
    events: completeEvents(from, until),
    release: RELEASE,
    observedFrom: from,
    observedUntil: until,
    sourceUri: 'private://authorization-evidence/run-123/events.json',
    provenance: PROVENANCE,
  });
  artifact = mutateArtifact(JSON.parse(JSON.stringify(artifact)));
  const unsignedArtifact = { ...artifact };
  delete unsignedArtifact.artifactDigest;
  artifact.artifactDigest = digest(unsignedArtifact);
  const approvals = ['security_owner', 'release_owner', 'cutover_owner'].map((role, index) => {
    const attestation = buildApprovalAttestation({
      role,
      environment: `authorization-${role.replace('_', '-')}-approval`,
      approvalRunId: 100 + index,
      approvedAt: new Date(generated.getTime() + (index + 1) * 60_000).toISOString(),
      artifactDigest: artifact.artifactDigest,
      release: RELEASE,
      toolingCommitSha: RELEASE.commitSha,
      decision: 'approve',
    });
    return signAuthorizationArtifact(attestation, {
      privateKey: keySet[role].privateKey,
      keyId: keyIds[role],
    });
  });
  const generatedAt = new Date(generated.getTime() + 4 * 60_000).toISOString();
  const manifest = bypassManifestBuilder ? {
    schemaVersion: 1,
    kind: 'maslaxat-authorization-cutover-manifest',
    generatedAt,
    evidence: artifact,
    approvals: approvals.map((envelope) => ({ envelope })),
  } : buildAuthorizationManifest({
    generatedAt,
    evidenceArtifact: artifact,
    approvalEnvelopes: approvals,
  }, {
    now: new Date(generated.getTime() + 5 * 60_000),
    approvalKeys: Object.fromEntries(['security_owner', 'release_owner', 'cutover_owner'].map((role) => [role, {
      keyId: keyIds[role], publicKey: keySet[role].publicKey,
    }])),
  });
  const envelope = signAuthorizationArtifact(manifest, {
    privateKey: keySet.manifest.privateKey,
    keyId: 'authorization-evidence-v1',
  });
  return { artifact, approvals, envelope, keySet };
}

test('surface inventory is exact, versioned, unique, and digest-stable', () => {
  const checked = validateAuthorizationSurfaceInventory(AUTHORIZATION_SURFACES);

  expect(checked.schemaVersion).toBe(2);
  expect(checked.surfaces.some((entry) => entry.id === 'SOCKET handshake')).toBe(true);
  expect(checked.surfaces.some((entry) => entry.id === 'CATALOG GET /api/lawyers')).toBe(true);
  expect(new Set(checked.surfaces.map((entry) => entry.id)).size).toBe(checked.surfaces.length);
  expect(authorizationSurfaceDigest()).toMatch(/^[a-f0-9]{64}$/);
  expect(() => validateAuthorizationSurfaceInventory({
    ...AUTHORIZATION_SURFACES,
    surfaces: [...AUTHORIZATION_SURFACES.surfaces, AUTHORIZATION_SURFACES.surfaces[0]],
  })).toThrow(/duplicate/i);
});

test('artifact derives a complete 24h zero-mismatch window without identity data', () => {
  const artifact = buildAuthorizationEvidenceArtifact({
    events: completeEvents(), release: RELEASE, observedFrom: FROM, observedUntil: UNTIL,
    sourceUri: 'private://authorization-evidence/run-123/events.json',
    provenance: PROVENANCE,
  });

  expect(artifact.release).toEqual(RELEASE);
  expect(artifact.observation).toEqual({
    observedFrom: FROM.toISOString(), observedUntil: UNTIL.toISOString(), durationSeconds: 86400,
  });
  expect(artifact.counts.mismatches).toBe(0);
  expect(artifact.canaries.gaps).toEqual([]);
  expect(artifact.coverage.every((entry) => entry.decisions > 0)).toBe(true);
  expect(artifact.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(artifact.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(artifact)).not.toMatch(/userId|requestId|email|phone|legacyRole/i);
});

test.each([
  ['short window', (events) => ({ events, observedUntil: new Date(FROM.getTime() + 23 * 60 * 60 * 1000) }), /24 hours/i],
  ['missing canary', (events) => ({ events: events.filter((event) => event.eventId !== `canary-${FROM.getTime() + CANARY_INTERVAL_MS}`) }), /canary gap/i],
  ['missing surface coverage', (events) => ({ events: events.filter((event) => event.surface !== 'CATALOG GET /api/lawyers') }), /coverage/i],
  ['mismatch', (events) => ({ events: events.map((event) => event.surface === 'CATALOG GET /api/lawyers' && event.type === 'decision' ? { ...event, capabilityAllowed: false } : event) }), /mismatch/i],
  ['wrong release', (events) => ({ events: events.map((event, index) => index === 0 ? { ...event, deploymentId: 'other-deployment' } : event) }), /release/i],
  ['unknown event type', (events) => ({ events: events.map((event, index) => index === 0 ? { ...event, type: 'unknown' } : event) }), /event type/i],
])('artifact refuses %s', (_label, mutate, expected) => {
  const changed = mutate(completeEvents());
  expect(() => buildAuthorizationEvidenceArtifact({
    events: changed.events,
    release: RELEASE,
    observedFrom: FROM,
    observedUntil: changed.observedUntil || UNTIL,
    sourceUri: 'private://authorization-evidence/run-123/events.json',
    provenance: PROVENANCE,
  })).toThrow(expected);
});

test('artifact refuses missing workflow/provider provenance', () => {
  expect(() => buildAuthorizationEvidenceArtifact({
    events: completeEvents(), release: RELEASE, observedFrom: FROM, observedUntil: UNTIL,
    sourceUri: 'private://authorization-evidence/run-123/events.json',
  })).toThrow(/provenance/i);
});

test('signed manifest requires distinct security, release, and explicit cutover approvals', () => {
  const { envelope, keySet } = approvedEnvelope();
  const verified = verifyAuthorizationCutoverEnvelope(envelope, {
    now: new Date(GENERATED.getTime() + 6 * 60_000),
    manifestKey: { keyId: 'authorization-evidence-v1', publicKey: keySet.manifest.publicKey },
    approvalKeys: Object.fromEntries(['security_owner', 'release_owner', 'cutover_owner'].map((role) => [role, {
      keyId: `${role}-v1`, publicKey: keySet[role].publicKey,
    }])),
    expectedRelease: { ...RELEASE, authorizationMode: 'capability_only' },
  });

  expect(verified.cutoverEligible).toBe(true);
  expect(verified.approvals.map((approval) => approval.role).sort()).toEqual([
    'cutover_owner', 'release_owner', 'security_owner',
  ]);
});

test('validator refuses stale manifests, wrong release binding, and tampering', () => {
  const { envelope, keySet } = approvedEnvelope();
  const options = {
    now: new Date(GENERATED.getTime() + 6 * 60_000),
    manifestKey: { keyId: 'authorization-evidence-v1', publicKey: keySet.manifest.publicKey },
    approvalKeys: Object.fromEntries(['security_owner', 'release_owner', 'cutover_owner'].map((role) => [role, {
      keyId: `${role}-v1`, publicKey: keySet[role].publicKey,
    }])),
    expectedRelease: { ...RELEASE, authorizationMode: 'capability_only' },
  };

  expect(() => verifyAuthorizationCutoverEnvelope(envelope, {
    ...options, now: new Date(GENERATED.getTime() + 25 * 60 * 60 * 1000),
  })).toThrow(/stale/i);
  expect(() => verifyAuthorizationCutoverEnvelope(envelope, {
    ...options, expectedRelease: { ...options.expectedRelease, deploymentId: 'different' },
  })).toThrow(/release/i);
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.artifact.evidence.counts.decisions += 1;
  expect(() => verifyAuthorizationCutoverEnvelope(tampered, options)).toThrow(/signature/i);
});

test('manifest generation refuses reused approval key material', () => {
  expect(() => approvedEnvelope({ reuseApprovalKey: true })).toThrow(/distinct/i);
});

test.each([
  ['different commit', 'd'.repeat(40)],
  ['hostile commit', "$(touch /tmp/approval-pwned)'"],
  ['ref-shaped value', 'refs/heads/release/staging'],
])('approval refuses %s as signer tooling provenance', (_label, toolingCommitSha) => {
  expect(() => buildApprovalAttestation({
    role: 'security_owner',
    environment: 'authorization-security-owner-approval',
    approvalRunId: 101,
    approvedAt: GENERATED.toISOString(),
    artifactDigest: 'd'.repeat(64),
    release: RELEASE,
    toolingCommitSha,
    decision: 'approve',
  })).toThrow(/tooling|commit/i);
});

test('exact rotated approval key IDs are carried from signed envelopes into the manifest', () => {
  const keyIds = {
    security_owner: 'security-2026-09',
    release_owner: 'release-2026-10',
    cutover_owner: 'cutover-2026-11',
  };
  const { envelope } = approvedEnvelope({ keyIds });
  expect(Object.fromEntries(envelope.artifact.approvals.map((approval) => [approval.role, approval.keyId])))
    .toEqual(keyIds);
});

test('new approvals cannot revive an observation window that ended more than 24 hours ago', () => {
  const until = new Date(GENERATED.getTime() - 25 * 60 * 60 * 1000);
  const from = new Date(until.getTime() - 24 * 60 * 60 * 1000);
  expect(() => approvedEnvelope({ from, until, generated: GENERATED })).toThrow(/observation.*stale/i);
});

test.each([
  ['missing coverage', (artifact) => ({ ...artifact, coverage: artifact.coverage.slice(1) })],
  ['extra coverage', (artifact) => ({ ...artifact, coverage: [...artifact.coverage, {
    channel: 'catalog', surface: 'CATALOG unknown', mode: 'lawyer', decisions: 1, mismatches: 0,
  }] })],
  ['duplicate coverage', (artifact) => ({ ...artifact, coverage: [...artifact.coverage, artifact.coverage[0]] })],
  ['wrong surface count', (artifact) => ({
    ...artifact, inventory: { ...artifact.inventory, surfaceCount: artifact.inventory.surfaceCount - 1 },
  })],
  ['wrong decision total', (artifact) => ({
    ...artifact, counts: { ...artifact.counts, decisions: artifact.counts.decisions - 1 },
  })],
  ['wrong mismatch total', (artifact) => ({
    ...artifact, counts: { ...artifact.counts, mismatches: 1 },
  })],
  ['wrong event total', (artifact) => ({
    ...artifact, counts: { ...artifact.counts, events: artifact.counts.events - 1 },
  })],
  ['wrong canary interval', (artifact) => ({
    ...artifact, canaries: { ...artifact.canaries, intervalSeconds: 1 },
  })],
  ['wrong canary expected count', (artifact) => ({
    ...artifact, canaries: { ...artifact.canaries, expected: artifact.canaries.expected - 1,
      observed: artifact.canaries.observed - 1 },
  })],
])('signed manifest refuses %s even after fresh approvals', (_label, mutateArtifact) => {
  expect(() => approvedEnvelope({ mutateArtifact })).toThrow(/invalid|incomplete/i);
});

test('startup refuses a freshly signed and approved manifest with an incomplete denominator', async () => {
  const { envelope, keySet } = approvedEnvelope({
    mutateArtifact: (artifact) => ({ ...artifact, coverage: artifact.coverage.slice(0, 1) }),
    bypassManifestBuilder: true,
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authorization-denominator-'));
  const evidencePath = path.join(directory, 'manifest.json');
  fs.writeFileSync(evidencePath, JSON.stringify(envelope), { mode: 0o600 });

  await expect(assertAuthorizationStartup({
    config: {
      mode: 'capability_only',
      evidence: {
        path: evidencePath,
        manifestPublicKey: keySet.manifest.publicKey,
        manifestKeyId: 'authorization-evidence-v1',
        approvalKeys: Object.fromEntries(['security_owner', 'release_owner', 'cutover_owner'].map((role) => [role, {
          keyId: `${role}-v1`, publicKey: keySet[role].publicKey,
        }])),
      },
    },
    runtimeIdentity: { ...RELEASE, authorizationMode: 'capability_only' },
    now: new Date(GENERATED.getTime() + 6 * 60_000),
  })).rejects.toMatchObject({ code: 'AUTHORIZATION_CUTOVER_REFUSED' });
});
