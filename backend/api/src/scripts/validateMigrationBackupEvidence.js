#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { TextDecoder } = require('util');

const FIELDS = Object.freeze([
  'evidence_version',
  'created_at',
  'backup_id',
  'release_sha',
  'source_cluster_sha256',
  'backup_job_result',
  'committed_triplet',
  'manifest_sha256',
  'manifest_signature_sha256',
  'backup_signing_key_id',
  'migration_count',
  'migration_digest',
  'evidence_signing_key_id',
]);
const MAX_ALLOWED_AGE_SECONDS = 3600;
const MAX_FUTURE_SKEW_SECONDS = 300;

function fail(message) {
  throw new Error(message);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseEvidence(evidence) {
  if (!Buffer.isBuffer(evidence) || evidence.length === 0 || evidence.length > 65536) {
    fail('evidence size is invalid');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(evidence);
  } catch {
    return fail('evidence is not canonical UTF-8');
  }
  if (!text.endsWith('\n') || text.includes('\r') || text.includes('\0')) fail('evidence is not canonical');
  const values = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 1) fail('evidence field is malformed');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (Object.hasOwn(values, key)) fail(`evidence field ${key} is duplicated`);
    values[key] = value;
  }
  const keys = Object.keys(values);
  if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
    fail('evidence field set is not exact and canonical');
  }
  return values;
}

function validateMigrationBackupEvidence({
  evidence,
  signature,
  publicKey,
  expectedKeyId,
  expectedReleaseSha,
  expectedClusterId,
  maxAgeSeconds,
  nowMs = Date.now(),
}) {
  if (!Buffer.isBuffer(signature) || signature.length === 0 || signature.length > 16384) fail('signature size is invalid');
  if (!publicKey || !crypto.verify('sha256', evidence, publicKey, signature)) fail('evidence signature is invalid');
  const values = parseEvidence(evidence);
  if (values.evidence_version !== '2') fail('evidence version is unsupported');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(values.created_at)
      || new Date(values.created_at).toISOString().replace('.000Z', 'Z') !== values.created_at) {
    fail('created_at is invalid');
  }
  if (!/^\d{8}T\d{6}Z-[A-Za-z0-9._-]+$/.test(values.backup_id)
      || !values.backup_id.startsWith(`${values.created_at.replace(/[-:]/g, '')}-`)) {
    fail('backup identity is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(values.release_sha) || !/^[a-f0-9]{40}$/.test(expectedReleaseSha || '')) {
    fail('release SHA is invalid');
  }
  if (!safeEqual(values.release_sha, expectedReleaseSha)) fail('evidence release does not match Railway release');
  if (!expectedClusterId) fail('expected source cluster is missing');
  const expectedClusterSha = crypto.createHash('sha256').update(expectedClusterId, 'utf8').digest('hex');
  if (!/^[a-f0-9]{64}$/.test(values.source_cluster_sha256)
      || !safeEqual(values.source_cluster_sha256, expectedClusterSha)) {
    fail('evidence source cluster does not match');
  }
  if (values.backup_job_result !== 'success') fail('backup evidence does not record success');
  if (values.committed_triplet !== 'true') fail('backup evidence does not record a committed triplet');
  for (const field of ['manifest_sha256', 'manifest_signature_sha256', 'migration_digest']) {
    if (!/^[a-f0-9]{64}$/.test(values[field])) fail(`${field} is invalid`);
  }
  for (const field of ['backup_signing_key_id', 'evidence_signing_key_id']) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values[field])) fail(`${field} is invalid`);
  }
  if (!expectedKeyId || !safeEqual(values.evidence_signing_key_id, expectedKeyId)) {
    fail('evidence signing key ID does not match');
  }
  if (!/^\d+$/.test(values.migration_count) || Number(values.migration_count) < 1) fail('migration_count is invalid');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > MAX_ALLOWED_AGE_SECONDS) {
    fail('max backup age must be between 1 and 3600 seconds');
  }
  const createdMs = Date.parse(values.created_at);
  const ageSeconds = Math.floor((nowMs - createdMs) / 1000);
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) fail('backup evidence timestamp is in the future');
  if (ageSeconds > maxAgeSeconds) fail('backup evidence is stale');
  return values;
}

function decodeBase64(name, value) {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(`${name} is required and must be canonical base64`);
  }
  return Buffer.from(value, 'base64');
}

function main(env = process.env) {
  const required = [
    'MIGRATION_BACKUP_EVIDENCE_B64',
    'MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64',
    'MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64',
    'MIGRATION_BACKUP_EVIDENCE_KEY_ID',
    'MIGRATION_BACKUP_EXPECTED_CLUSTER_ID',
    'RAILWAY_GIT_COMMIT_SHA',
  ];
  for (const name of required) if (!env[name]) fail(`required environment variable ${name} is missing`);
  const values = validateMigrationBackupEvidence({
    evidence: decodeBase64('MIGRATION_BACKUP_EVIDENCE_B64', env.MIGRATION_BACKUP_EVIDENCE_B64),
    signature: decodeBase64('MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64', env.MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64),
    publicKey: decodeBase64('MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64', env.MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64),
    expectedKeyId: env.MIGRATION_BACKUP_EVIDENCE_KEY_ID,
    expectedReleaseSha: env.RAILWAY_GIT_COMMIT_SHA,
    expectedClusterId: env.MIGRATION_BACKUP_EXPECTED_CLUSTER_ID,
    maxAgeSeconds: Number(env.MIGRATION_BACKUP_MAX_AGE_SECONDS || MAX_ALLOWED_AGE_SECONDS),
  });
  process.stdout.write(`migration_backup_gate=ok backup_id=${values.backup_id} migration_count=${values.migration_count}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Migration backup gate failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { FIELDS, parseEvidence, validateMigrationBackupEvidence };
