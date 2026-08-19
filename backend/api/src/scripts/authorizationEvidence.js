#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalize, digest } = require('../services/paymentShadowEvidence');
const {
  buildApprovalAttestation,
  buildAuthorizationManifest,
  signAuthorizationArtifact,
  verifyAuthorizationArtifact,
  verifyAuthorizationCutoverEnvelope,
} = require('../services/authorizationEvidenceManifest');

function flags(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('Authorization evidence command is required');
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z0-9-]+$/.test(name || '') || value === undefined) throw new Error('Invalid authorization evidence arguments');
    values[name.slice(2)] = value;
  }
  return { command, values };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function readKey(file) {
  return fs.readFileSync(path.resolve(file), 'utf8');
}

function writePrivate(file, value) {
  const target = path.resolve(file);
  const descriptor = fs.openSync(target, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
}

function approvalKeys(values, envelopes) {
  return Object.fromEntries(['security_owner', 'release_owner', 'cutover_owner'].map((role) => {
    const prefix = role.replace('_', '-');
    const envelope = envelopes.find((candidate) => candidate?.artifact?.role === role);
    if (!envelope?.signature?.keyId) throw new Error(`Signed ${role} key ID is required`);
    return [role, {
      publicKey: readKey(values[`${prefix}-key-file`]),
      keyId: envelope.signature.keyId,
    }];
  }));
}

function runCli(argv) {
  const { command, values } = flags(argv);
  if (command === 'sign-artifact') {
    return writePrivate(values.output, signAuthorizationArtifact(readJson(values.input), {
      privateKey: readKey(values['key-file']), keyId: values['key-id'],
    }));
  }
  if (command === 'verify-artifact') {
    return writePrivate(values.output, verifyAuthorizationArtifact(readJson(values.input), {
      publicKey: readKey(values['key-file']), keyId: values['key-id'],
    }));
  }
  if (command === 'build-approval') {
    return writePrivate(values.output, buildApprovalAttestation(readJson(values.input)));
  }
  if (command === 'validate-provenance') {
    const { validateProviderWorkflowProvenance } = require('../services/authorizationEvidenceProvenance');
    return writePrivate(values.output, validateProviderWorkflowProvenance({
      metadata: readJson(values.metadata),
      context: readJson(values.context),
    }));
  }
  if (command === 'verify-source') {
    const artifact = readJson(values.input);
    const events = readJson(values.events);
    const { buildAuthorizationEvidenceArtifact } = require('../services/authorizationEvidence');
    if (!Array.isArray(events)) throw new Error('Authorization source events are required');
    const rebuilt = buildAuthorizationEvidenceArtifact({
      events,
      release: artifact.release,
      observedFrom: new Date(artifact.observation.observedFrom),
      observedUntil: new Date(artifact.observation.observedUntil),
      sourceUri: artifact.source.uri,
      provenance: artifact.provenance,
    });
    if (canonicalize(rebuilt) !== canonicalize(artifact)) {
      throw new Error('Authorization aggregate does not exactly match raw source events');
    }
    const verifiedAt = new Date(values.now);
    if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt.toISOString() !== values.now) {
      throw new Error('Exact source verification time is required');
    }
    return writePrivate(values.output, {
      schemaVersion: 1,
      kind: 'authorization-source-verification',
      verifiedAt: values.now,
      sourceDigestValid: true,
      aggregateCanonicalMatch: true,
      artifactDigest: rebuilt.artifactDigest,
      canonicalAggregateSha256: crypto.createHash('sha256').update(canonicalize(rebuilt)).digest('hex'),
      eventCount: events.length,
    });
  }
  if (command === 'build-manifest') {
    const input = readJson(values.input);
    return writePrivate(values.output, buildAuthorizationManifest(input, {
      now: new Date(values.now), approvalKeys: approvalKeys(values, input.approvalEnvelopes),
    }));
  }
  if (command === 'verify') {
    const envelope = readJson(values.input);
    const approvalEnvelopes = envelope.artifact?.approvals?.map((approval) => approval.envelope) || [];
    return writePrivate(values.output, verifyAuthorizationCutoverEnvelope(envelope, {
      now: new Date(values.now),
      manifestKey: { publicKey: readKey(values['key-file']), keyId: values['key-id'] },
      approvalKeys: approvalKeys(values, approvalEnvelopes),
      expectedRelease: readJson(values.expectations),
    }));
  }
  if (command === 'export') {
    const { AuthorizationEvidenceEvent } = require('../models');
    const { exportAuthorizationEvidence } = require('../services/authorizationEvidence');
    const provenance = readJson(values.provenance);
    return exportAuthorizationEvidence({
      EventModel: AuthorizationEvidenceEvent,
      release: provenance.release,
      observedFrom: new Date(values.from),
      observedUntil: new Date(values.until),
      sourceUri: values['source-uri'],
      provenance,
    }).then(({ artifact, events }) => {
      writePrivate(values['events-output'], events);
      return writePrivate(values.output, artifact);
    });
  }
  throw new Error('Unknown authorization evidence command');
}

if (require.main === module) {
  Promise.resolve().then(() => runCli(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`authorization evidence command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runCli };
