const fs = require('fs');
const path = require('path');
const { getPaymentConfig } = require('../src/config/payment');
const {
  validateDispatchInput,
  validateApprovalRun,
  validateProofRun,
  buildApprovalAttestation,
  validateSourceRun,
  verifySourceAttestation,
} = require('../src/services/paymentEvidenceProvenance');
const { digest } = require('../src/services/paymentShadowEvidence');
const { signCanonicalArtifact } = require('../src/services/paymentEvidenceManifest');
const crypto = require('crypto');
const os = require('os');
const { runCli: runProvenanceCli } = require('../src/scripts/paymentEvidenceProvenance');

const root = path.join(__dirname, '..', '..', '..');

test('payment staging workflow is protected evidence-only and cannot toggle active mode', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');

  expect(workflow).toMatch(/workflow_dispatch:/);
  expect(workflow).toMatch(/environment:\s*payment-staging-signing/);
  expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  expect(workflow).toMatch(/proof_run_id:/);
  expect(workflow).toMatch(/validate-proof-run/);
  expect(workflow).toMatch(/payment-reconciliation-proof/);
  expect(workflow).not.toMatch(/paymentEvidenceManifest\.js collect|reconcilePayments\.js/);
  expect(workflow).toMatch(/paymentEvidenceManifest\.js sign-artifact/);
  expect(workflow).toMatch(/paymentEvidenceManifest\.js generate/);
  expect(workflow).toMatch(/paymentEvidenceManifest\.js sign/);
  expect(workflow).toMatch(/paymentEvidenceManifest\.js verify/);
  expect(workflow).toMatch(/paymentEvidenceManifest\.js verify[\s\S]{0,300}--expectations/);
  expect(workflow).toMatch(/STOP_BEFORE_PAYMENT_MODE_CHANGE/);
  expect(workflow).not.toMatch(/PAYMENT_V2_MODE\s*[:=]\s*active/i);
  expect(workflow).not.toMatch(/railway\s+(up|deploy)|kubectl|docker\s+push|git\s+push/i);
  const runBlocks = workflow.split(/^\s+- name:/m).map((block) => block.split(/^\s+- uses:/m)[0]);
  expect(runBlocks.filter((block) => /\brun:\s*[>|]/.test(block)).join('\n')).not.toMatch(/\$\{\{\s*inputs\./);
  expect(workflow).toMatch(/PAYMENT_EVIDENCE_REVIEWED_SHA/);
  expect(workflow).toMatch(/validate-proof-run/);
  expect(() => getPaymentConfig({ PAYMENT_V2_MODE: 'active' })).toThrow(/explicit cutover approval/i);
});

test('workflow keeps collection, reconciliation, and signing credentials in separate jobs', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');
  const signer = workflow.slice(workflow.indexOf('  sign-and-verify:'));

  expect(workflow).not.toMatch(/collect-and-prove:|reconcile-read-only:|PAYMENT_STAGING_READONLY_DATABASE_URL|DATABASE_URL/);
  expect(signer).toMatch(/PAYMENT_EVIDENCE_PRIVATE_KEY_B64/);
  expect(signer).not.toMatch(/DATABASE_URL|READONLY_DATABASE/);
  expect(workflow).toMatch(/environment:\s*payment-staging-verification/);
  const signingOnly = workflow.slice(workflow.indexOf('  sign-and-verify:'), workflow.indexOf('  verify-and-stop:'));
  const verifier = workflow.slice(workflow.indexOf('  verify-and-stop:'));
  expect(signingOnly).not.toMatch(/PAYMENT_EVIDENCE_PUBLIC_KEY_B64|paymentEvidenceManifest\.js verify/);
  expect(verifier).toMatch(/PAYMENT_EVIDENCE_PUBLIC_KEY_B64|paymentEvidenceManifest\.js verify/);
  expect(verifier).not.toMatch(/PRIVATE_KEY|DATABASE_URL|READONLY_DATABASE/);
});

function expectPrivateKeyOnlyOnSigningStep(workflow, variable) {
  const lines = workflow.split('\n');
  const secretLines = lines.filter((line) => line.includes(`${variable}: ` + '${{ secrets.'));
  expect(secretLines.length).toBeGreaterThan(0);
  expect(secretLines.every((line) => /^\s{10,}[A-Z0-9_]+:\s*\$\{\{\s*secrets\./.test(line))).toBe(true);
  for (const line of secretLines) {
    const index = lines.indexOf(line);
    let start = index;
    while (start > 0 && !/^\s{6}- name:/.test(lines[start])) start -= 1;
    let end = index + 1;
    while (end < lines.length && !/^\s{6}- (?:name:|uses:|run:)/.test(lines[end])) end += 1;
    const block = lines.slice(start, end).join('\n');
    expect(block).toMatch(/name:.*[Ss]ign/);
    expect(block).toMatch(/trap .*rm -f/);
    expect(block).not.toMatch(/uses:|actions\/checkout|download-artifact|npm\s|curl\s|gh\s+api/);
  }
}

test('every private key exists only in one minimal cleanup-guarded signing step', () => {
  const finalWorkflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');
  const telemetry = fs.readFileSync(path.join(root, '.github/workflows/payment-shadow-telemetry.yml'), 'utf8');
  const approval = fs.readFileSync(path.join(root, '.github/workflows/payment-evidence-approval.yml'), 'utf8');

  expectPrivateKeyOnlyOnSigningStep(finalWorkflow, 'PAYMENT_EVIDENCE_PRIVATE_KEY_B64');
  expectPrivateKeyOnlyOnSigningStep(telemetry, 'TELEMETRY_PRIVATE_KEY_B64');
  expectPrivateKeyOnlyOnSigningStep(approval, 'APPROVAL_PRIVATE_KEY_B64');
});

test('independent verifier uploads a bounded immutable final package before deliberate refusal', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');
  const finalUpload = workflow.indexOf('name: payment-final-verified-');
  const stop = workflow.indexOf('name: STOP_BEFORE_PAYMENT_MODE_CHANGE');

  expect(workflow).toMatch(/name: payment-signed-pending-verification/);
  expect(workflow).toMatch(/verification-result\.json/);
  expect(workflow).toMatch(/sha256sums\.txt/);
  expect(workflow).toMatch(/if:\s*\$\{\{\s*success\(\)\s*\}\}/);
  expect(finalUpload).toBeGreaterThan(0);
  expect(finalUpload).toBeLessThan(stop);
  expect(workflow).toMatch(/retention-days:\s*30/);
  const runbook = fs.readFileSync(path.join(root, 'docs/runbooks/payme-cutover.md'), 'utf8');
  expect(runbook).toMatch(/pending-verification.*not final evidence/i);
});

test('prepare proof preserves the exact signed telemetry source envelope', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/payment-staging-evidence-prepare.yml'),
    'utf8',
  );
  const collectionStep = workflow.slice(
    workflow.indexOf('name: Verify source and collect continuity proof'),
    workflow.indexOf('name: payment-collection-proof'),
  );
  const collectionProof = workflow.slice(
    workflow.indexOf('name: payment-collection-proof'),
    workflow.indexOf('  reconcile-read-only:'),
  );
  const reconciliationProof = workflow.slice(workflow.indexOf('name: payment-reconciliation-proof'));

  expect(collectionStep).toMatch(/cp -n .*payment-input\/source-attestation\.signed\.json.*source-attestation\.signed\.json/s);
  expect(collectionStep).toMatch(/cp -n .*payment-input\/provider-totals\.json.*provider-totals\.json/s);
  expect(collectionProof).toContain('${{ runner.temp }}/source-attestation.signed.json');
  expect(collectionProof).toContain('${{ runner.temp }}/provider-totals.json');
  expect(collectionProof).not.toContain('${{ runner.temp }}/payment-input/');
  expect(reconciliationProof).toContain('${{ runner.temp }}/collection/source-attestation.signed.json');
});

test('final verified package retains and checksums every independently verified trust-chain input', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');
  const pending = workflow.slice(
    workflow.indexOf('name: payment-signed-pending-verification'),
    workflow.indexOf('  verify-and-stop:'),
  );
  const finalPackage = workflow.slice(
    workflow.indexOf('name: Create bounded final verified package'),
    workflow.indexOf('name: Upload immutable final verified package'),
  );
  const exactInputs = [
    'source-run.verified.json',
    'source-attestation.signed.json',
    'source-attestation.verified.json',
    'provider-totals.json',
    'shadow-artifact.json',
    'reconciliation-summary.json',
    'payment-owner-approval.signed.json',
    'release-owner-approval.signed.json',
  ];

  expect(pending).toMatch(/payment-signed-pending-verification/);
  expect(pending).not.toMatch(/payment-final-verified-/);
  for (const file of exactInputs) {
    expect(pending).toContain(file);
    expect(finalPackage).toMatch(new RegExp(`cp -n .*${file.replaceAll('.', '\\.')}`));
    expect(finalPackage).toContain(file);
  }
  const checksumCommand = finalPackage.slice(finalPackage.indexOf('shasum -a 256'));
  for (const file of exactInputs) expect(checksumCommand).toContain(file);
});

test('telemetry and approval source workflows are protected and produce signed private artifacts', () => {
  const telemetry = fs.readFileSync(path.join(root, '.github/workflows/payment-shadow-telemetry.yml'), 'utf8');
  const approval = fs.readFileSync(path.join(root, '.github/workflows/payment-evidence-approval.yml'), 'utf8');
  const prepare = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence-prepare.yml'), 'utf8');

  expect(telemetry).toMatch(/environment:\s*payment-shadow-telemetry/);
  expect(telemetry).toMatch(/PAYMENT_EVIDENCE_REVIEWED_SHA/);
  expect(telemetry).toMatch(/PAYMENT_STAGING_METADATA_URL/);
  expect(telemetry).toMatch(/PAYMENT_STAGING_TELEMETRY_EXPORT_URL/);
  expect(telemetry).toMatch(/source-attestation\.signed\.json/);
  expect(telemetry).not.toMatch(/PAYMENT_EVIDENCE_PRIVATE_KEY_B64/);

  expect(approval).toMatch(/environment:\s*payment-owner-approval/);
  expect(approval).toMatch(/environment:\s*release-owner-approval/);
  expect(approval).toMatch(/payment-evidence-approval-/);
  expect(approval).toMatch(/sign-artifact/);
  expect(approval).not.toMatch(/approver_id:/);
  expect(approval).not.toMatch(/PAYMENT_EVIDENCE_PRIVATE_KEY_B64|DATABASE_URL/);
  expect(prepare).toMatch(/payment-staging-collection/);
  expect(prepare).toMatch(/payment-staging-reconciliation/);
  expect(prepare).toMatch(/payment-reconciliation-proof/);
  expect(prepare).not.toMatch(/PAYMENT_EVIDENCE_PRIVATE_KEY_B64|sign-and-verify/);
  expect(prepare).toMatch(/--source-attestation/);
  expect(prepare).toMatch(/databaseIdentityDigest/);
  expect(prepare).toMatch(/snapshotIdentityDigest/);
  expect(prepare).toMatch(/reconciledAt/);
  expect(prepare).not.toMatch(/--arg (?:migrationHead|expectedMigrationHead) .*source-attestation/);
});

test('approval and final workflows preserve database and snapshot proof bindings', () => {
  const approval = fs.readFileSync(path.join(root, '.github/workflows/payment-evidence-approval.yml'), 'utf8');
  const finalWorkflow = fs.readFileSync(path.join(root, '.github/workflows/payment-staging-evidence.yml'), 'utf8');

  for (const field of ['databaseIdentityDigest', 'snapshotIdentityDigest', 'reconciledAt']) {
    expect(approval).toContain(field);
    expect(finalWorkflow).toContain(field);
  }
});

test.each([
  { proofRunId: "12'\nprintf pwned", paymentApprovalRunId: '13', releaseApprovalRunId: '14' },
  { proofRunId: '12', paymentApprovalRunId: '13\n14', releaseApprovalRunId: '15' },
  { proofRunId: '12', paymentApprovalRunId: '$(id)', releaseApprovalRunId: '15' },
])('strict dispatch validation rejects hostile quote/newline/substitution input', (input) => {
  expect(() => validateDispatchInput(input)).toThrow(/run id/i);
});

test('final proof run validation requires the exact successful prepare workflow and reviewed commit', () => {
  expect(validateProofRun({
    id: 222, status: 'completed', conclusion: 'success',
    path: '.github/workflows/payment-staging-evidence-prepare.yml', head_sha: 'a'.repeat(40),
    head_branch: 'release/staging', event: 'workflow_dispatch', run_attempt: 1,
    repository: { full_name: 'owner/maslaxat' },
  }, {
    proofRunId: '222', repository: 'owner/maslaxat', trustedRef: 'release/staging',
    reviewedCommitSha: 'a'.repeat(40),
  })).toEqual(expect.objectContaining({ id: 222, commitSha: 'a'.repeat(40) }));

  expect(() => validateProofRun({
    id: 222, status: 'completed', conclusion: 'success',
    path: '.github/workflows/payment-staging-evidence.yml', head_sha: 'a'.repeat(40),
    head_branch: 'release/staging', event: 'workflow_dispatch', run_attempt: 1,
    repository: { full_name: 'owner/maslaxat' },
  }, {
    proofRunId: '222', repository: 'owner/maslaxat', trustedRef: 'release/staging',
    reviewedCommitSha: 'a'.repeat(40),
  })).toThrow(/prepare proof/i);
});

test('source run and signed attestation bind the approved workflow, commit, deployment and artifact digests', () => {
  const run = validateSourceRun({
    id: 123,
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/payment-shadow-telemetry.yml',
    head_sha: 'a'.repeat(40),
    head_branch: 'release/staging',
    event: 'workflow_dispatch',
    run_attempt: 1,
    repository: { full_name: 'owner/maslaxat' },
  }, {
    sourceRunId: '123', repository: 'owner/maslaxat', trustedRef: 'release/staging',
    reviewedCommitSha: 'a'.repeat(40),
  });
  expect(run).toEqual(expect.objectContaining({ id: 123, commitSha: 'a'.repeat(40) }));

  const pair = crypto.generateKeyPairSync('ed25519');
  const unsigned = {
    schemaVersion: 1,
    kind: 'payment-shadow-source',
    sourceRunId: 123,
    sourceWorkflow: '.github/workflows/payment-shadow-telemetry.yml',
    repository: 'owner/maslaxat',
    commitSha: 'a'.repeat(40),
    deploymentId: 'deployment-123',
    serviceId: 'maslaxat-api-staging',
    configDigest: 'b'.repeat(64),
    migrationHead: '20260824000000-create-authorization-evidence-events.js',
    generatedAt: '2026-08-19T01:00:00.000Z',
    observationMode: 'scenario-set',
    inventoryDigest: 'c'.repeat(64),
    eventsDigest: 'd'.repeat(64),
    streamMetadataDigest: 'e'.repeat(64),
    providerSnapshotDigest: 'f'.repeat(64),
  };
  const artifact = { ...unsigned, sourceDigest: digest(unsigned) };
  const envelope = signCanonicalArtifact(artifact, { privateKey: pair.privateKey, keyId: 'telemetry-source-v1' });

  expect(verifySourceAttestation(envelope, {
    publicKey: pair.publicKey,
    keyId: 'telemetry-source-v1',
    now: new Date('2026-08-19T01:05:00.000Z'),
    run,
  })).toEqual(artifact);
  expect(() => verifySourceAttestation(envelope, {
    publicKey: pair.publicKey, keyId: 'telemetry-source-v1',
    now: new Date('2026-08-20T02:00:00.000Z'), run,
  })).toThrow(/stale/i);
  expect(() => verifySourceAttestation(envelope, {
    publicKey: pair.publicKey, keyId: 'telemetry-source-v1',
    now: new Date('2026-08-19T00:50:00.000Z'), run,
  })).toThrow(/future/i);

  const hostile = JSON.parse(JSON.stringify(envelope));
  hostile.artifact.deploymentId = "deployment'\nprintf pwned";
  expect(() => verifySourceAttestation(hostile, {
    publicKey: pair.publicKey, keyId: 'telemetry-source-v1',
    now: new Date('2026-08-19T01:05:00.000Z'), run,
  })).toThrow(/signature|deployment/i);
});

test('approval run validation requires the reviewed approval workflow and exact trusted commit', () => {
  expect(validateApprovalRun({
    id: 321, status: 'completed', conclusion: 'success',
    path: '.github/workflows/payment-evidence-approval.yml', head_sha: 'a'.repeat(40),
    head_branch: 'release/staging', event: 'workflow_dispatch', run_attempt: 1,
    repository: { full_name: 'owner/maslaxat' },
  }, {
    runId: '321', repository: 'owner/maslaxat', trustedRef: 'release/staging',
    reviewedCommitSha: 'a'.repeat(40), role: 'payment_owner',
  })).toEqual(expect.objectContaining({ id: 321, role: 'payment_owner' }));

  expect(() => validateApprovalRun({
    id: 321, status: 'completed', conclusion: 'success', path: '.github/workflows/other.yml',
    head_sha: 'a'.repeat(40), head_branch: 'release/staging', event: 'workflow_dispatch', run_attempt: 1,
    repository: { full_name: 'owner/maslaxat' },
  }, {
    runId: '321', repository: 'owner/maslaxat', trustedRef: 'release/staging',
    reviewedCommitSha: 'a'.repeat(40), role: 'payment_owner',
  })).toThrow(/approval workflow/i);
});

test('approval builder binds an external run to exact observed proof and rejects hostile identities', () => {
  const input = {
    role: 'payment_owner', approvalRunId: 321, proofRunId: 222,
    roleKeyFingerprint: '1'.repeat(64),
    approvedAt: '2026-08-19T01:10:00.000Z',
    release: {
      commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'api-staging',
      configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js',
    },
    inventoryDigest: 'c'.repeat(64), shadowArtifactDigest: 'd'.repeat(64),
    reconciliationSummaryDigest: 'e'.repeat(64), providerSnapshotDigest: 'f'.repeat(64),
    databaseIdentityDigest: '6'.repeat(64), snapshotIdentityDigest: '7'.repeat(64),
    reconciledAt: '2026-08-19T01:00:00.000Z',
  };
  const artifact = buildApprovalAttestation(input);
  expect(artifact).toEqual(expect.objectContaining({
    kind: 'payment-evidence-approval', approvalRunId: 321,
    environment: 'payment-owner-approval', proofRunId: 222,
    roleKeyFingerprint: '1'.repeat(64),
    attestationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(JSON.stringify(artifact)).not.toMatch(/approverId|person|actor/i);
  expect(() => buildApprovalAttestation({ ...input, approverId: "owner'\nprintf pwned" })).toThrow(/approved fields/i);
});

test('provenance CLI validates files without shell evaluation and uses exclusive private output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-provenance-'));
  const input = path.join(directory, 'dispatch.json');
  const output = path.join(directory, 'validated.json');
  const approvalInput = path.join(directory, 'approval-input.json');
  const approvalOutput = path.join(directory, 'approval.json');
  fs.writeFileSync(input, JSON.stringify({
    proofRunId: '123', paymentApprovalRunId: '124', releaseApprovalRunId: '125',
  }), { mode: 0o600 });
  fs.writeFileSync(approvalInput, JSON.stringify({
    role: 'payment_owner', approvalRunId: 321, proofRunId: 222,
    roleKeyFingerprint: '1'.repeat(64),
    approvedAt: '2026-08-19T01:10:00.000Z',
    release: { commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'api-staging',
      configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js' },
    inventoryDigest: 'c'.repeat(64), shadowArtifactDigest: 'd'.repeat(64),
    reconciliationSummaryDigest: 'e'.repeat(64), providerSnapshotDigest: 'f'.repeat(64),
    databaseIdentityDigest: '6'.repeat(64), snapshotIdentityDigest: '7'.repeat(64),
    reconciledAt: '2026-08-19T01:00:00.000Z',
  }), { mode: 0o600 });

  runProvenanceCli(['validate-dispatch', '--input', input, '--output', output]);
  runProvenanceCli(['build-approval', '--input', approvalInput, '--output', approvalOutput]);

  expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({
    proofRunId: 123, paymentApprovalRunId: 124, releaseApprovalRunId: 125,
  });
  expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  expect(JSON.parse(fs.readFileSync(approvalOutput, 'utf8')).kind).toBe('payment-evidence-approval');
  expect(() => runProvenanceCli(['validate-dispatch', '--input', input, '--output', output])).toThrow(/exist/i);
});

test('Payme runbook requires private artifacts, independent keys and approvals, and explicit external refusal', () => {
  const runbook = fs.readFileSync(path.join(root, 'docs/runbooks/payme-cutover.md'), 'utf8');

  expect(runbook).toMatch(/Ed25519/i);
  expect(runbook).toMatch(/private key outside the application runtime/i);
  expect(runbook).toMatch(/public verification key/i);
  expect(runbook).toMatch(/payment_owner/);
  expect(runbook).toMatch(/release_owner/);
  expect(runbook).toMatch(/24 hours|24-hour/i);
  expect(runbook).toMatch(/representative sanitized staging/i);
  expect(runbook).toMatch(/STOP_BEFORE_PAYMENT_MODE_CHANGE/);
  expect(runbook).toMatch(/external.*blocked/i);
});
