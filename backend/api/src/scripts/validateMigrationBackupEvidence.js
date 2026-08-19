#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
  'applied_migration_count',
  'applied_migration_digest',
  'applied_migration_head',
  'target_migration_count',
  'target_migration_digest',
  'target_migration_head',
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

function migrationIdentity(names, label) {
  if (!Array.isArray(names)) fail(`${label} migration set is malformed`);
  let previous = '';
  for (const name of names) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.js$/.test(name)) {
      fail(`${label} migration set is malformed`);
    }
    if (previous && name <= previous) fail(`${label} migration set is not strictly sorted and unique`);
    previous = name;
  }
  const canonical = `${names.join('\n')}\n`;
  return {
    count: String(names.length),
    digest: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
    head: names.at(-1) || '',
  };
}

function assertMigrationIdentity(values, prefix, names) {
  const actual = migrationIdentity(names, prefix);
  if (values[`${prefix}_migration_count`] !== actual.count
      || !safeEqual(values[`${prefix}_migration_digest`], actual.digest)
      || values[`${prefix}_migration_head`] !== actual.head) {
    fail(`${prefix} migration identity does not match signed evidence`);
  }
  return actual;
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
  maxAgeSeconds,
  nowMs = Date.now(),
}) {
  if (!Buffer.isBuffer(signature) || signature.length === 0 || signature.length > 16384) fail('signature size is invalid');
  if (!publicKey || !crypto.verify('sha256', evidence, publicKey, signature)) fail('evidence signature is invalid');
  const values = parseEvidence(evidence);
  if (values.evidence_version !== '3') fail('evidence version is unsupported');
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
  if (!/^[a-f0-9]{64}$/.test(values.source_cluster_sha256)) fail('source_cluster_sha256 is invalid');
  if (values.backup_job_result !== 'success') fail('backup evidence does not record success');
  if (values.committed_triplet !== 'true') fail('backup evidence does not record a committed triplet');
  for (const field of ['manifest_sha256', 'manifest_signature_sha256',
    'applied_migration_digest', 'target_migration_digest']) {
    if (!/^[a-f0-9]{64}$/.test(values[field])) fail(`${field} is invalid`);
  }
  for (const field of ['backup_signing_key_id', 'evidence_signing_key_id']) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values[field])) fail(`${field} is invalid`);
  }
  if (!expectedKeyId || !safeEqual(values.evidence_signing_key_id, expectedKeyId)) {
    fail('evidence signing key ID does not match');
  }
  for (const prefix of ['applied', 'target']) {
    if (!/^\d+$/.test(values[`${prefix}_migration_count`])
        || Number(values[`${prefix}_migration_count`]) < 1) fail(`${prefix}_migration_count is invalid`);
    if (!/^[A-Za-z0-9._-]+\.js$/.test(values[`${prefix}_migration_head`])) {
      fail(`${prefix}_migration_head is invalid`);
    }
  }
  if (Number(values.applied_migration_count) > Number(values.target_migration_count)) {
    fail('applied migration count exceeds target migration count');
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > MAX_ALLOWED_AGE_SECONDS) {
    fail('max backup age must be between 1 and 3600 seconds');
  }
  const createdMs = Date.parse(values.created_at);
  const ageSeconds = Math.floor((nowMs - createdMs) / 1000);
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) fail('backup evidence timestamp is in the future');
  if (ageSeconds > maxAgeSeconds) fail('backup evidence is stale');
  return values;
}

function validateMigrationTargetBindings({ values, actualClusterId, appliedMigrations, targetMigrations }) {
  if (typeof actualClusterId !== 'string' || !/^[0-9]+$/.test(actualClusterId)) {
    fail('migration target system identifier is invalid');
  }
  const actualClusterSha = crypto.createHash('sha256').update(actualClusterId, 'utf8').digest('hex');
  if (!safeEqual(values.source_cluster_sha256, actualClusterSha)) {
    fail('migration target cluster does not match signed backup');
  }
  assertMigrationIdentity(values, 'applied', appliedMigrations);
  assertMigrationIdentity(values, 'target', targetMigrations);
  if (appliedMigrations.length > targetMigrations.length
      || appliedMigrations.some((name, index) => targetMigrations[index] !== name)) {
    fail('applied migrations are not an exact ordered prefix of the packaged target');
  }
  return { pendingMigrations: targetMigrations.slice(appliedMigrations.length) };
}

function decodeBase64(name, value) {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(`${name} is required and must be canonical base64`);
  }
  return Buffer.from(value, 'base64');
}

function prepareMigrationBackupGate({ env = process.env, migrationsDir, nowMs = Date.now() } = {}) {
  const required = [
    'MIGRATION_BACKUP_EVIDENCE_B64',
    'MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64',
    'MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64',
    'MIGRATION_BACKUP_EVIDENCE_KEY_ID',
    'RAILWAY_GIT_COMMIT_SHA',
  ];
  for (const name of required) if (!env[name]) fail(`required environment variable ${name} is missing`);
  const values = validateMigrationBackupEvidence({
    evidence: decodeBase64('MIGRATION_BACKUP_EVIDENCE_B64', env.MIGRATION_BACKUP_EVIDENCE_B64),
    signature: decodeBase64('MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64', env.MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64),
    publicKey: decodeBase64('MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64', env.MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64),
    expectedKeyId: env.MIGRATION_BACKUP_EVIDENCE_KEY_ID,
    expectedReleaseSha: env.RAILWAY_GIT_COMMIT_SHA,
    maxAgeSeconds: Number(env.MIGRATION_BACKUP_MAX_AGE_SECONDS || MAX_ALLOWED_AGE_SECONDS),
    nowMs,
  });
  const directory = migrationsDir || path.resolve(__dirname, '../../migrations');
  const targetMigrations = fs.readdirSync(directory).filter((name) => name.endsWith('.js')).sort();
  assertMigrationIdentity(values, 'target', targetMigrations);
  return { values, targetMigrations };
}

async function verifyMigrationBackupTarget(client, prepared) {
  let identityResult;
  try {
    identityResult = await client.query('SELECT system_identifier::text AS system_identifier FROM pg_control_system()');
  } catch {
    fail('could not query migration target system identifier');
  }
  if (!Array.isArray(identityResult?.rows) || identityResult.rows.length !== 1) {
    fail('migration target system identifier response is invalid');
  }
  const actualClusterId = identityResult.rows[0]?.system_identifier;
  if (typeof actualClusterId !== 'string') fail('migration target system identifier response is invalid');
  let migrationResult;
  try {
    migrationResult = await client.query('SELECT name FROM "SequelizeMeta" ORDER BY name');
  } catch {
    fail('could not query migration target applied migrations');
  }
  return validateMigrationTargetBindings({
    values: prepared.values,
    actualClusterId,
    appliedMigrations: migrationResult.rows.map((row) => row.name),
    targetMigrations: prepared.targetMigrations,
  });
}

function main(env = process.env) {
  const prepared = prepareMigrationBackupGate({ env });
  const values = prepared.values;
  process.stdout.write(`migration_backup_gate=ok backup_id=${values.backup_id} applied_migration_count=${values.applied_migration_count} target_migration_count=${values.target_migration_count}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Migration backup gate failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  FIELDS,
  migrationIdentity,
  parseEvidence,
  prepareMigrationBackupGate,
  validateMigrationBackupEvidence,
  validateMigrationTargetBindings,
  verifyMigrationBackupTarget,
};
