#!/usr/bin/env node
'use strict';

const fs = require('fs');

const FIELDS = Object.freeze([
  'manifest_version',
  'backup_id',
  'created_at',
  'signing_key_id',
  'encrypted_object',
  'encrypted_sha256',
  'plaintext_sha256',
  'postgres_version',
  'applied_migration_count',
  'applied_migration_digest',
  'applied_migration_head',
  'target_migration_count',
  'target_migration_digest',
  'target_migration_head',
  'users_count',
  'consultations_count',
  'payments_count',
  'documents_count',
  'reviews_count',
]);

function fail(message) {
  throw new Error(message);
}

function extractSigningKeyId(text) {
  if (!text.endsWith('\n') || text.includes('\r')) fail('manifest field set is not canonical');
  const matches = text.split('\n').filter((line) => line.startsWith('signing_key_id='));
  if (matches.length !== 1) fail('signing_key_id is missing or duplicated');
  const keyId = matches[0].slice('signing_key_id='.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) fail('signing_key_id is invalid');
  return keyId;
}

function validateManifest(text, expectedBackupId) {
  if (!text.endsWith('\n') || text.includes('\r')) fail('manifest field set is not canonical');
  const lines = text.slice(0, -1).split('\n');
  const values = {};
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator < 1) fail('manifest field set is malformed');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (Object.hasOwn(values, key)) fail(`manifest field ${key} is missing or duplicated`);
    values[key] = value;
  }
  const keys = Object.keys(values);
  if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
    fail('manifest field set is not exact or canonical');
  }
  if (values.manifest_version !== '5') fail('manifest_version is unsupported');
  if (!/^\d{8}T\d{6}Z-[A-Za-z0-9._-]+$/.test(values.backup_id)) fail('backup_id is invalid');
  if (expectedBackupId && values.backup_id !== expectedBackupId) fail('backup identity mismatch');
  if (values.encrypted_object !== `${values.backup_id}.dump.age`) fail('encrypted_object identity mismatch');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(values.created_at)
    || new Date(values.created_at).toISOString().replace('.000Z', 'Z') !== values.created_at) {
    fail('created_at is not canonical UTC');
  }
  const expectedTimestamp = values.created_at.replace(/[-:]/g, '');
  if (!values.backup_id.startsWith(`${expectedTimestamp}-`)) fail('backup timestamp disagrees with created_at');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values.signing_key_id)) fail('signing_key_id is invalid');
  for (const field of ['encrypted_sha256', 'plaintext_sha256']) {
    if (!/^[a-fA-F0-9]{64}$/.test(values[field])) fail('manifest checksum format is invalid');
  }
  if (!/^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9._-]+)?$/.test(values.postgres_version)) {
    fail('postgres_version is invalid');
  }
  for (const prefix of ['applied', 'target']) {
    if (!/^[A-Za-z0-9._-]+\.js$/.test(values[`${prefix}_migration_head`])) fail(`${prefix}_migration_head is invalid`);
    if (!/^\d+$/.test(values[`${prefix}_migration_count`])
        || Number(values[`${prefix}_migration_count`]) < 1) fail(`${prefix}_migration_count is invalid`);
    if (!/^[a-f0-9]{64}$/.test(values[`${prefix}_migration_digest`])) fail(`${prefix}_migration_digest is invalid`);
  }
  if (Number(values.applied_migration_count) > Number(values.target_migration_count)) {
    fail('applied migration count exceeds target migration count');
  }
  for (const field of FIELDS.filter((name) => name.endsWith('_count'))) {
    if (!/^\d+$/.test(values[field])) fail(`${field} is invalid`);
  }
  return values;
}

if (require.main === module) {
  try {
    const [, , manifestPath, expectedBackupId = '', mode = 'validate'] = process.argv;
    if (!manifestPath) fail('manifest path is required');
    const text = fs.readFileSync(manifestPath, 'utf8');
    if (mode === 'key-id') {
      process.stdout.write(`${extractSigningKeyId(text)}\n`);
      process.exit(0);
    }
    const values = validateManifest(text, expectedBackupId);
    process.stdout.write(FIELDS.map((field) => values[field]).join('\t'));
    process.stdout.write('\n');
  } catch (error) {
    process.stderr.write(`manifest validation failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { FIELDS, extractSigningKeyId, validateManifest };
