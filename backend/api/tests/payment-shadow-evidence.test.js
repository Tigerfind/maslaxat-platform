const {
  loadScenarioInventory,
  scenarioInventoryDigest,
  collectShadowEvents,
  digest,
} = require('../src/services/paymentShadowEvidence');
const {
  generateUnsignedManifest,
  publicKeyFingerprint,
  signCanonicalArtifact,
  signManifest,
  verifyManifest,
} = require('../src/services/paymentEvidenceManifest');
const { runCli } = require('../src/scripts/paymentEvidenceManifest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ZERO_CHECKPOINT = '0'.repeat(64);
const STREAM_ID = 'payme-shadow-staging-run-1001';

function scenarioId(scenario) {
  return `${scenario.method}:${scenario.expected.outcome}${scenario.expected.errorCode === null ? '' : `:${scenario.expected.errorCode}`}`;
}

function comparisonFor(scenario, overrides = {}) {
  const payloadHash = crypto.createHash('sha256').update(`approved:${scenario.key}`).digest('hex');
  return {
    scenarioId: scenarioId(scenario),
    method: scenario.method,
    v2Accepted: scenario.expected.outcome === 'result',
    v2ErrorCode: scenario.expected.errorCode,
    legacyOutcome: scenario.expected.outcome,
    legacyErrorCode: scenario.expected.errorCode,
    v2PayloadHash: payloadHash,
    legacyPayloadHash: payloadHash,
    comparisonMatched: true,
    ...overrides,
  };
}

function chainRows(scenarios, { startSequence = 100, startTime = Date.UTC(2026, 7, 19, 0, 0, 0) } = {}) {
  let previousCheckpoint = ZERO_CHECKPOINT;
  return scenarios.map((scenario, index) => {
    const unsigned = {
      streamId: STREAM_ID,
      sequence: startSequence + index,
      observedAt: new Date(startTime + index * 1000).toISOString(),
      scenarioKey: scenario.key,
      comparison: comparisonFor(scenario),
      previousCheckpoint,
    };
    const checkpoint = digest(unsigned);
    previousCheckpoint = checkpoint;
    return { ...unsigned, checkpoint };
  });
}

function streamContract(rows) {
  return {
    streamId: STREAM_ID,
    firstSequence: rows[0].sequence,
    lastSequence: rows[rows.length - 1].sequence,
    firstCheckpoint: rows[0].checkpoint,
    lastCheckpoint: rows[rows.length - 1].checkpoint,
    eventCount: rows.length,
  };
}

test('versioned inventory pins the complete approved error, refund, and idempotency matrix', () => {
  const inventory = loadScenarioInventory();
  const methodCounts = inventory.scenarios.reduce((counts, scenario) => ({
    ...counts,
    [scenario.method]: (counts[scenario.method] || 0) + 1,
  }), {});

  const categories = new Set(inventory.scenarios.map((scenario) => scenario.category));

  expect(inventory.schemaVersion).toBe(2);
  expect(inventory.inventoryId).toBe('payme-pilot-sandbox-v2');
  expect(Object.values(methodCounts).every((count) => count >= 2)).toBe(true);
  expect(categories).toEqual(new Set([
    'success', 'invalid_amount', 'invalid_account', 'unknown_transaction', 'invalid_state',
    'idempotency', 'partial_refund', 'full_refund', 'statement',
  ]));
  expect(inventory.scenarios.map((scenario) => scenario.key)).toEqual(expect.arrayContaining([
    'check-perform-invalid-account', 'check-perform-unknown-transaction',
    'create-unknown-transaction', 'perform-idempotent-retry', 'perform-unknown-transaction',
    'cancel-after-partial-refund', 'cancel-after-full-refund', 'cancel-idempotent-retry',
    'check-partially-refunded', 'check-refunded', 'statement-idempotent-repeat',
  ]));
  expect(scenarioInventoryDigest(inventory)).toBe('88507b5637206ab1e9ad6d2ab4067c160d9d0987c211751df7231f82b3a4f465');
  expect(scenarioInventoryDigest(inventory)).toBe(scenarioInventoryDigest(JSON.parse(JSON.stringify(inventory))));
  expect(scenarioInventoryDigest({ ...inventory, inventoryId: 'changed' }))
    .not.toBe(scenarioInventoryDigest(inventory));
});

test('collector independently proves semantic matches and exports chained stream bounds', () => {
  const inventory = loadScenarioInventory();
  const scenarios = inventory.scenarios.slice(0, 2);
  const rows = chainRows(scenarios);
  const first = rows[0];
  const duplicate = JSON.parse(JSON.stringify(first));
  const artifact = collectShadowEvents([first, duplicate, rows[1]], inventory, streamContract(rows));

  expect(artifact.counts).toEqual({ received: 3, accepted: 2, duplicates: 1, gaps: 0, matched: 2, mismatched: 0 });
  expect(artifact.events).toHaveLength(2);
  expect(artifact.events[0]).toEqual(expect.objectContaining({
    sequence: 100,
    scenarioKey: scenarios[0].key,
    method: scenarios[0].method,
    comparisonMatched: true,
    eventDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(artifact.stream).toEqual({
    ...streamContract(rows),
    firstObservedAt: rows[0].observedAt,
    lastObservedAt: rows[1].observedAt,
  });
  expect(JSON.stringify(artifact)).not.toMatch(/paymentId|params|authorization|rawPayload/i);
  expect(artifact.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
});

test('collector rejects contradictory flags, semantic mismatches, unequal hashes, and comparison extras', () => {
  const inventory = loadScenarioInventory();
  const scenario = inventory.scenarios.find((item) => item.expected.outcome === 'error');
  const [valid] = chainRows([scenario]);
  const contract = streamContract([valid]);

  const contradictory = { ...valid, comparison: { ...valid.comparison, comparisonMatched: false } };
  expect(() => collectShadowEvents([contradictory], inventory, contract)).toThrow(/contradictory/i);
  const wrongOutcome = { ...valid, comparison: { ...valid.comparison, v2Accepted: true, v2ErrorCode: null } };
  expect(() => collectShadowEvents([wrongOutcome], inventory, contract)).toThrow(/expected outcome/i);
  const unequalHash = { ...valid, comparison: { ...valid.comparison, legacyPayloadHash: 'f'.repeat(64) } };
  expect(() => collectShadowEvents([unequalHash], inventory, contract)).toThrow(/payload hash/i);
  const extra = { ...valid, comparison: { ...valid.comparison, paymentId: 'secret' } };
  expect(() => collectShadowEvents([extra], inventory, contract)).toThrow(/approved comparison fields/i);
});

test('collector rejects unknown scenarios, conflicting duplicate sequences, gaps, and broken checkpoints', () => {
  const inventory = loadScenarioInventory();
  const rows = chainRows(inventory.scenarios.slice(0, 3));
  const contract = streamContract(rows);
  const unknown = { ...rows[0], scenarioKey: 'unknown-scenario' };
  expect(() => collectShadowEvents([unknown], inventory, contract)).toThrow(/scenario/i);

  const conflictInput = {
    streamId: rows[0].streamId,
    sequence: rows[0].sequence,
    observedAt: new Date(Date.parse(rows[0].observedAt) + 500).toISOString(),
    scenarioKey: rows[0].scenarioKey,
    comparison: rows[0].comparison,
    previousCheckpoint: rows[0].previousCheckpoint,
  };
  const conflict = { ...conflictInput, checkpoint: digest(conflictInput) };
  expect(() => collectShadowEvents([rows[0], conflict, ...rows.slice(1)], inventory, contract)).toThrow(/duplicate sequence/i);
  expect(() => collectShadowEvents([rows[0], rows[2]], inventory, contract)).toThrow(/gap/i);
  const broken = rows.map((item) => ({ ...item }));
  broken[1].previousCheckpoint = 'f'.repeat(64);
  expect(() => collectShadowEvents(broken, inventory, contract)).toThrow(/checkpoint/i);
});

function completeArtifact(inventory) {
  const rows = completeRows(inventory);
  return collectShadowEvents(rows, inventory, streamContract(rows));
}

function completeRows(inventory) {
  return chainRows(inventory.scenarios);
}

function approvalEnvelope(role, approvalRunId, proofRunId, bindings, pair, approvedAt) {
  const unsigned = {
    schemaVersion: 1,
    kind: 'payment-evidence-approval',
    role,
    environment: role === 'payment_owner' ? 'payment-owner-approval' : 'release-owner-approval',
    approvalRunId,
    proofRunId,
    roleKeyFingerprint: publicKeyFingerprint(pair.publicKey),
    approvedAt,
    decision: 'approve',
    bindings,
  };
  const artifact = { ...unsigned, attestationDigest: digest(unsigned) };
  return signCanonicalArtifact(artifact, { privateKey: pair.privateKey, keyId: `${role}-key-v1` });
}

function manifestFixture() {
  const inventory = loadScenarioInventory();
  const shadowArtifact = completeArtifact(inventory);
  const release = {
    commitSha: 'b'.repeat(40),
    deploymentId: 'railway-deployment-123',
    serviceId: 'maslaxat-api-staging',
    configDigest: 'c'.repeat(64),
    migrationHead: '20260824000000-create-authorization-evidence-events.js',
  };
  const reconciliation = {
    summaryDigest: 'd'.repeat(64),
    ready: true,
    mismatchCount: 0,
    providerSnapshotDigest: 'e'.repeat(64),
    providerSnapshotCapturedAt: '2026-08-19T00:40:00.000Z',
    summaryGeneratedAt: '2026-08-19T00:45:00.000Z',
    databaseIdentityDigest: '8'.repeat(64),
    snapshotIdentityDigest: '9'.repeat(64),
    reconciledAt: '2026-08-19T00:45:00.000Z',
  };
  const approvalBindings = {
    ...release,
    inventoryDigest: scenarioInventoryDigest(inventory),
    shadowArtifactDigest: shadowArtifact.artifactDigest,
    reconciliationSummaryDigest: reconciliation.summaryDigest,
    providerSnapshotDigest: reconciliation.providerSnapshotDigest,
    databaseIdentityDigest: reconciliation.databaseIdentityDigest,
    snapshotIdentityDigest: reconciliation.snapshotIdentityDigest,
    reconciledAt: reconciliation.reconciledAt,
  };
  const paymentPair = crypto.generateKeyPairSync('ed25519');
  const releasePair = crypto.generateKeyPairSync('ed25519');
  const input = {
    generatedAt: '2026-08-19T01:00:00.000Z',
    environment: 'staging',
    release,
    inventory,
    shadowArtifact,
    observation: { mode: 'scenario-set' },
    reconciliation,
    approvalEnvelopes: [
      approvalEnvelope('payment_owner', 9001, 8001, approvalBindings, paymentPair, '2026-08-19T00:50:00.000Z'),
      approvalEnvelope('release_owner', 9002, 8001, approvalBindings, releasePair, '2026-08-19T00:55:00.000Z'),
    ],
  };
  return {
    input,
    options: {
      now: new Date('2026-08-19T01:01:00.000Z'),
      approvalKeys: {
        payment_owner: { publicKey: paymentPair.publicKey, keyId: 'payment_owner-key-v1' },
        release_owner: { publicKey: releasePair.publicKey, keyId: 'release_owner-key-v1' },
      },
      approvalRuns: {
        payment_owner: { id: 9001 },
        release_owner: { id: 9002 },
      },
      proofRun: { id: 8001 },
    },
    pairs: { paymentPair, releasePair },
  };
}

test('manifest binds complete scenario evidence, release identity, reconciliation, and two approvals', () => {
  const { input, options } = manifestFixture();
  const manifest = generateUnsignedManifest(input, options);

  expect(manifest).toEqual(expect.objectContaining({
    schemaVersion: 4,
    kind: 'payment-v2-shadow-evidence',
    environment: 'staging',
    release: input.release,
    scenarioInventory: {
      inventoryId: input.inventory.inventoryId,
      digest: scenarioInventoryDigest(input.inventory),
      scenarioCount: input.inventory.scenarios.length,
    },
    shadowArtifact: expect.objectContaining({
      digest: input.shadowArtifact.artifactDigest,
      counts: input.shadowArtifact.counts,
    }),
    reconciliation: input.reconciliation,
    observation: {
      mode: 'scenario-set',
      observedFrom: input.shadowArtifact.stream.firstObservedAt,
      observedUntil: input.shadowArtifact.stream.lastObservedAt,
    },
    approvals: expect.arrayContaining([
      expect.objectContaining({ role: 'payment_owner', attestationDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ role: 'release_owner', attestationDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]),
  }));
  expect(JSON.stringify(manifest)).not.toContain('"events":');
  expect(JSON.stringify(manifest)).not.toContain('PAYMENT_SHADOW_EVIDENCE_KEY');
  expect(JSON.stringify(manifest.approvals)).not.toMatch(/approverId|person|actor/i);
});

test('offline signature verifies exact release bindings and rejects tampering', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { input, options } = manifestFixture();
  const manifest = generateUnsignedManifest(input, options);
  const envelope = signManifest(manifest, { privateKey, keyId: 'staging-payment-evidence-2026' });

  expect(verifyManifest(envelope, {
    publicKey,
    keyId: 'staging-payment-evidence-2026',
    commitSha: 'b'.repeat(40),
    deploymentId: 'railway-deployment-123',
    serviceId: 'maslaxat-api-staging',
    configDigest: 'c'.repeat(64),
    migrationHead: '20260824000000-create-authorization-evidence-events.js',
    inventoryDigest: scenarioInventoryDigest(),
    reconciliationSummaryDigest: 'd'.repeat(64),
    now: new Date('2026-08-19T01:02:00.000Z'),
  })).toEqual({ valid: true, cutoverEligible: false, schemaVersion: 4 });

  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.manifest.release.deploymentId = 'other-deployment';
  expect(() => verifyManifest(tampered, { publicKey, deploymentId: 'other-deployment', now: options.now })).toThrow(/signature/i);
  expect(() => verifyManifest(envelope, { publicKey, commitSha: 'a'.repeat(40), now: options.now })).toThrow(/commit/i);
  expect(() => signManifest(manifest, { privateKey: publicKey, keyId: 'wrong' })).toThrow(/private/i);

  const extra = signManifest({ ...manifest, unapproved: true }, { privateKey, keyId: 'staging-payment-evidence-2026' });
  expect(() => verifyManifest(extra, { publicKey, now: options.now })).toThrow(/approved fields/i);
  const missingCoverageManifest = JSON.parse(JSON.stringify(manifest));
  missingCoverageManifest.shadowArtifact.coverage[Object.keys(missingCoverageManifest.shadowArtifact.coverage)[0]] = 0;
  const missingCoverage = signManifest(missingCoverageManifest, { privateKey, keyId: 'staging-payment-evidence-2026' });
  expect(() => verifyManifest(missingCoverage, { publicKey, now: options.now })).toThrow(/coverage/i);
  expect(() => verifyManifest(envelope, { publicKey, now: new Date('2026-08-20T02:00:00.000Z') })).toThrow(/stale/i);
  expect(() => verifyManifest(envelope, { publicKey, now: new Date('2026-08-19T00:50:00.000Z') })).toThrow(/future/i);
});

test('manifest fails closed for collection gaps, mismatches, missing coverage, or missing approvals', () => {
  const missingFixture = manifestFixture();
  missingFixture.input.approvalEnvelopes.pop();
  expect(() => generateUnsignedManifest(missingFixture.input, missingFixture.options)).toThrow(/approval/i);

  const gapFixture = manifestFixture();
  const gap = gapFixture.input;
  gap.shadowArtifact.counts.gaps = 1;
  expect(() => generateUnsignedManifest(gap, gapFixture.options)).toThrow(/gap/i);

  const incompleteFixture = manifestFixture();
  const incomplete = incompleteFixture.input;
  incomplete.shadowArtifact.coverage[incomplete.inventory.scenarios[0].key] = 0;
  expect(() => generateUnsignedManifest(incomplete, incompleteFixture.options)).toThrow(/coverage/i);

  const wrongEnvironment = manifestFixture();
  const releaseArtifact = wrongEnvironment.input.approvalEnvelopes[1].artifact;
  const wrongUnsigned = { ...releaseArtifact, environment: 'payment-owner-approval' };
  delete wrongUnsigned.attestationDigest;
  wrongEnvironment.input.approvalEnvelopes[1] = signCanonicalArtifact(
    { ...wrongUnsigned, attestationDigest: digest(wrongUnsigned) },
    { privateKey: wrongEnvironment.pairs.releasePair.privateKey, keyId: 'release_owner-key-v1' },
  );
  expect(() => generateUnsignedManifest(wrongEnvironment.input, wrongEnvironment.options)).toThrow(/environment/i);

  const futureProvider = manifestFixture();
  futureProvider.input.reconciliation.providerSnapshotCapturedAt = '2026-08-19T01:10:00.000Z';
  expect(() => generateUnsignedManifest(futureProvider.input, futureProvider.options)).toThrow(/future/i);

  const staleSummary = manifestFixture();
  staleSummary.input.reconciliation.summaryGeneratedAt = '2026-08-17T00:00:00.000Z';
  expect(() => generateUnsignedManifest(staleSummary.input, staleSummary.options)).toThrow(/stale|predates/i);

  const wrongProof = manifestFixture();
  wrongProof.options.proofRun = { id: 8002 };
  expect(() => generateUnsignedManifest(wrongProof.input, wrongProof.options)).toThrow(/proof run/i);

  const sameKey = manifestFixture();
  sameKey.options.approvalKeys.release_owner.publicKey = sameKey.pairs.paymentPair.publicKey;
  sameKey.input.approvalEnvelopes[1] = approvalEnvelope(
    'release_owner', 9002, 8001,
    sameKey.input.approvalEnvelopes[1].artifact.bindings,
    sameKey.pairs.paymentPair, '2026-08-19T00:55:00.000Z',
  );
  expect(publicKeyFingerprint(sameKey.pairs.paymentPair.publicKey)).toBe(
    publicKeyFingerprint(sameKey.options.approvalKeys.release_owner.publicKey),
  );
  expect(() => generateUnsignedManifest(sameKey.input, sameKey.options)).toThrow(/same public key material/i);
});

test('operator CLI keeps generation keyless and signs through a separate key-file command', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-evidence-'));
  const inputFile = path.join(directory, 'input.json');
  const manifestFile = path.join(directory, 'manifest.json');
  const eventsFile = path.join(directory, 'events.jsonl');
  const streamFile = path.join(directory, 'stream.json');
  const artifactFile = path.join(directory, 'artifact.json');
  const keyFile = path.join(directory, 'offline.key');
  const publicKeyFile = path.join(directory, 'offline.pub');
  const paymentApprovalKeyFile = path.join(directory, 'payment-approval.pub');
  const releaseApprovalKeyFile = path.join(directory, 'release-approval.pub');
  const paymentApprovalRunFile = path.join(directory, 'payment-approval-run.json');
  const releaseApprovalRunFile = path.join(directory, 'release-approval-run.json');
  const proofRunFile = path.join(directory, 'proof-run.json');
  const envelopeFile = path.join(directory, 'signed.json');
  const verifiedFile = path.join(directory, 'verified.json');
  const summaryFile = path.join(directory, 'summary.json');
  const signedSummaryFile = path.join(directory, 'signed-summary.json');
  const verifiedSummaryFile = path.join(directory, 'verified-summary.json');
  const fixture = manifestFixture();
  fs.writeFileSync(inputFile, JSON.stringify(fixture.input), { mode: 0o600 });
  const rows = completeRows(loadScenarioInventory());
  fs.writeFileSync(eventsFile, `${rows.map(JSON.stringify).join('\n')}\n`, { mode: 0o600 });
  fs.writeFileSync(streamFile, JSON.stringify(streamContract(rows)), { mode: 0o600 });
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(paymentApprovalKeyFile,
    fixture.options.approvalKeys.payment_owner.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(releaseApprovalKeyFile,
    fixture.options.approvalKeys.release_owner.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(paymentApprovalRunFile, JSON.stringify({ id: 9001, proofRunId: 8001 }), { mode: 0o600 });
  fs.writeFileSync(releaseApprovalRunFile, JSON.stringify({ id: 9002, proofRunId: 8001 }), { mode: 0o600 });
  fs.writeFileSync(proofRunFile, JSON.stringify({ id: 8001 }), { mode: 0o600 });
  const summary = { schemaVersion: 1, kind: 'payment-reconciliation-summary', ready: true };
  fs.writeFileSync(summaryFile, JSON.stringify({ ...summary, summaryDigest: digest(summary) }), { mode: 0o600 });

  runCli(['collect', '--input', eventsFile, '--stream-metadata', streamFile, '--output', artifactFile]);
  runCli(['generate', '--input', inputFile, '--output', manifestFile,
    '--payment-approval-key-file', paymentApprovalKeyFile,
    '--release-approval-key-file', releaseApprovalKeyFile,
    '--payment-approval-run-file', paymentApprovalRunFile,
    '--release-approval-run-file', releaseApprovalRunFile,
    '--proof-run-file', proofRunFile,
    '--now', '2026-08-19T01:01:00.000Z'], {
    PAYMENT_EVIDENCE_OFFLINE_SIGNING_KEY: 'must-not-be-consumed',
  });
  runCli(['sign', '--input', manifestFile, '--output', envelopeFile, '--key-file', keyFile, '--key-id', 'staging-key']);
  runCli(['verify', '--input', envelopeFile, '--output', verifiedFile, '--key-file', publicKeyFile,
    '--now', '2026-08-19T01:02:00.000Z']);
  runCli(['sign-artifact', '--input', summaryFile, '--output', signedSummaryFile, '--key-file', keyFile, '--key-id', 'staging-key']);
  runCli(['verify-artifact', '--input', signedSummaryFile, '--output', verifiedSummaryFile,
    '--key-file', publicKeyFile, '--kind', 'payment-reconciliation-summary', '--digest-field', 'summaryDigest']);

  expect(JSON.parse(fs.readFileSync(verifiedFile, 'utf8'))).toEqual({
    valid: true, cutoverEligible: false, schemaVersion: 4,
  });
  expect(fs.statSync(manifestFile).mode & 0o777).toBe(0o600);
  expect(JSON.parse(fs.readFileSync(verifiedSummaryFile, 'utf8'))).toEqual(expect.objectContaining({
    kind: 'payment-reconciliation-summary', ready: true,
  }));
  expect(JSON.parse(fs.readFileSync(artifactFile, 'utf8')).counts.accepted).toBe(loadScenarioInventory().scenarios.length);
  expect(fs.readFileSync(manifestFile, 'utf8')).not.toContain('must-not-be-consumed');
  expect(() => runCli(['generate', '--input', inputFile, '--output', manifestFile,
    '--payment-approval-key-file', paymentApprovalKeyFile,
    '--release-approval-key-file', releaseApprovalKeyFile,
    '--payment-approval-run-file', paymentApprovalRunFile,
    '--release-approval-run-file', releaseApprovalRunFile,
    '--proof-run-file', proofRunFile,
    '--now', '2026-08-19T01:01:00.000Z'])).toThrow(/exist/i);
});
