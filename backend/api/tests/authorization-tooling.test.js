const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli } = require('../src/scripts/authorizationEvidence');
const { digest } = require('../src/services/paymentShadowEvidence');
const {
  CANARY_INTERVAL_MS,
  buildAuthorizationEvidenceArtifact,
  canaryEvent,
  decisionEvent,
} = require('../src/services/authorizationEvidence');
const { getAuthorizationSurfaceInventory } = require('../src/config/authorizationSurfaces');

const root = path.join(__dirname, '..', '..', '..');

test('authorization evidence CLI signs and verifies canonical artifacts with private outputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authorization-evidence-'));
  const input = path.join(directory, 'artifact.json');
  const signed = path.join(directory, 'artifact.signed.json');
  const verified = path.join(directory, 'artifact.verified.json');
  const privateKey = path.join(directory, 'private.pem');
  const publicKey = path.join(directory, 'public.pem');
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(input, JSON.stringify({ schemaVersion: 1, kind: 'test-artifact', value: 7 }), { mode: 0o600 });
  fs.writeFileSync(privateKey, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicKey, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });

  runCli(['sign-artifact', '--input', input, '--output', signed, '--key-file', privateKey, '--key-id', 'test-v1']);
  runCli(['verify-artifact', '--input', signed, '--output', verified, '--key-file', publicKey, '--key-id', 'test-v1']);

  expect(JSON.parse(fs.readFileSync(verified, 'utf8'))).toEqual({ schemaVersion: 1, kind: 'test-artifact', value: 7 });
  expect(fs.statSync(signed).mode & 0o777).toBe(0o600);
  expect(fs.statSync(verified).mode & 0o777).toBe(0o600);
  expect(() => runCli(['sign-artifact', '--input', input, '--output', signed, '--key-file', privateKey, '--key-id', 'test-v1']))
    .toThrow(/exist/i);
});

test('source verifier recomputes the immutable raw event digest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authorization-source-'));
  const from = new Date('2026-08-18T00:00:00.000Z');
  const until = new Date('2026-08-19T00:00:00.000Z');
  const release = {
    commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'api-staging',
    configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js',
    authorizationMode: 'compatibility',
  };
  const events = [];
  for (let time = from.getTime(); time <= until.getTime(); time += CANARY_INTERVAL_MS) {
    events.push(canaryEvent({ eventId: `canary-${time}`, observedAt: new Date(time), release }));
  }
  for (const surface of getAuthorizationSurfaceInventory().surfaces) {
    for (const mode of surface.modes) {
      events.push(decisionEvent({
        eventId: `decision-${digest(`${surface.id}:${mode}`).slice(0, 80)}`,
        observedAt: new Date(from.getTime() + CANARY_INTERVAL_MS), release,
        channel: surface.channel, surface: surface.id, mode,
        legacyAllowed: true, capabilityAllowed: true,
      }));
    }
  }
  const artifact = buildAuthorizationEvidenceArtifact({
    events, release, observedFrom: from, observedUntil: until,
    sourceUri: 'private://run/events.json',
    provenance: {
      release,
      workflow: {
        repository: 'owner/maslaxat',
        ref: 'owner/maslaxat/.github/workflows/authorization-evidence-prepare.yml@refs/heads/release/staging',
        runId: 123,
        runAttempt: 1,
        reviewedCommitSha: release.commitSha,
      },
      providerMetadataDigest: 'c'.repeat(64),
      validatedAt: '2026-08-19T00:00:00.000Z',
    },
  });
  const eventsFile = path.join(directory, 'events.json');
  const artifactFile = path.join(directory, 'artifact.json');
  const output = path.join(directory, 'verified.json');
  fs.writeFileSync(eventsFile, JSON.stringify(events), { mode: 0o600 });
  fs.writeFileSync(artifactFile, JSON.stringify(artifact), { mode: 0o600 });

  runCli(['verify-source', '--input', artifactFile, '--events', eventsFile, '--output', output,
    '--now', '2026-08-19T00:10:00.000Z']);
  expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual(expect.objectContaining({
    sourceDigestValid: true,
    aggregateCanonicalMatch: true,
    artifactDigest: artifact.artifactDigest,
    eventCount: events.length,
    verifiedAt: '2026-08-19T00:10:00.000Z',
    canonicalAggregateSha256: crypto.createHash('sha256')
      .update(require('../src/services/paymentShadowEvidence').canonicalize(artifact)).digest('hex'),
  }));

  const tampered = path.join(directory, 'tampered-artifact.json');
  fs.writeFileSync(tampered, JSON.stringify({
    ...artifact, counts: { ...artifact.counts, decisions: artifact.counts.decisions + 1 },
  }), { mode: 0o600 });
  expect(() => runCli(['verify-source', '--input', tampered, '--events', eventsFile,
    '--output', path.join(directory, 'bad.json'), '--now', '2026-08-19T00:10:00.000Z']))
    .toThrow(/aggregate/i);
});

test('authorization workflows separate collection, three approvals, signing, verification, and stop before cutover', () => {
  const prepare = fs.readFileSync(path.join(root, '.github/workflows/authorization-evidence-prepare.yml'), 'utf8');
  const approval = fs.readFileSync(path.join(root, '.github/workflows/authorization-evidence-approval.yml'), 'utf8');
  const finalize = fs.readFileSync(path.join(root, '.github/workflows/authorization-cutover-evidence.yml'), 'utf8');

  expect(prepare).toMatch(/environment:\s*authorization-telemetry-export/);
  expect(prepare).toMatch(/authorizationEvidence\.js export/);
  expect(prepare).not.toMatch(/PRIVATE_KEY|AUTHORIZATION_MODE\s*[:=]\s*capability_only/);
  expect(approval).toMatch(/authorization-security-owner-approval/);
  expect(approval).toMatch(/authorization-release-owner-approval/);
  expect(approval).toMatch(/authorization-cutover-owner-approval/);
  expect(approval).toMatch(/authorizationEvidence\.js build-approval/);
  expect(approval).toMatch(/authorizationEvidence\.js sign-artifact/);
  expect(finalize).toMatch(/environment:\s*authorization-evidence-signing/);
  expect(finalize).toMatch(/environment:\s*authorization-evidence-verification/);
  expect(finalize).toMatch(/authorizationEvidence\.js build-manifest/);
  expect(finalize).toMatch(/authorizationEvidence\.js verify/);
  expect(finalize).toMatch(/authorization-final-verified-/);
  expect(finalize).toMatch(/STOP_BEFORE_AUTHORIZATION_MODE_CHANGE/);
  expect(finalize).not.toMatch(/AUTHORIZATION_MODE\s*[:=]\s*capability_only|railway\s+(up|deploy)|kubectl|git\s+push/i);
});

test('approval workflow pins prepared tooling before the step-scoped private key is exposed', () => {
  const approval = fs.readFileSync(path.join(root, '.github/workflows/authorization-evidence-approval.yml'), 'utf8');
  const download = approval.indexOf('actions/download-artifact@');
  const resolve = approval.indexOf('Resolve prepared release tooling commit');
  const checkout = approval.indexOf('actions/checkout@');
  const verify = approval.indexOf('Verify exact approval tooling checkout');
  const privateKey = approval.indexOf('APPROVAL_PRIVATE_KEY_B64:');

  expect([download, resolve, checkout, verify, privateKey].every((index) => index >= 0)).toBe(true);
  expect(download).toBeLessThan(resolve);
  expect(resolve).toBeLessThan(checkout);
  expect(checkout).toBeLessThan(verify);
  expect(verify).toBeLessThan(privateKey);
  expect(approval).toMatch(/ref:\s*\$\{\{ steps\.prepared\.outputs\.release_commit \}\}/);
  expect(approval).toMatch(/test "\$\(git rev-parse HEAD\)" = "\$TOOLING_COMMIT"/);
  expect(approval).toMatch(/prepared_commit=[\s\S]*provenance_commit=[\s\S]*test "\$prepared_commit" = "\$provenance_commit"/);
  expect(approval).toMatch(/toolingCommitSha/);
});

test('capability cutover runbook preserves compatibility and role rollback boundaries', () => {
  const runbook = fs.readFileSync(path.join(root, 'docs/runbooks/capability-cutover.md'), 'utf8');
  expect(runbook).toMatch(/24 hours/i);
  expect(runbook).toMatch(/zero mismatch/i);
  expect(runbook).toMatch(/Ed25519/i);
  expect(runbook).toMatch(/security_owner/);
  expect(runbook).toMatch(/release_owner/);
  expect(runbook).toMatch(/cutover_owner/);
  expect(runbook).toMatch(/STOP_BEFORE_AUTHORIZATION_MODE_CHANGE/);
  expect(runbook).toMatch(/legacy.*role.*rollback/i);
  expect(runbook).toMatch(/no role-removal migration/i);
  expect(runbook).toMatch(/external.*blocked/i);
});
