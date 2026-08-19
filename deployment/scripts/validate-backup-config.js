#!/usr/bin/env node
'use strict';

const OVERRIDE_PARAMETERS = new Set(['host', 'hostaddr', 'port', 'dbname', 'service']);
const SAFE_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function fail(message) {
  throw new Error(message);
}

function parsePostgresUrl(raw) {
  let value;
  try {
    value = new URL(raw);
  } catch (_error) {
    fail('must be an absolute postgres URL');
  }
  if (!['postgres:', 'postgresql:'].includes(value.protocol) || !value.hostname || value.pathname.length < 2) {
    fail('must be an absolute postgres URL');
  }
  if (value.hostname.includes(',')) fail('multiple database hosts are not allowed');
  for (const key of value.searchParams.keys()) {
    if (OVERRIDE_PARAMETERS.has(key.toLowerCase())) fail(`libpq destination override parameter ${key} is not allowed`);
  }
  const database = decodeURIComponent(value.pathname.slice(1));
  if (!database || database.includes('/')) fail('database name is invalid');
  return { href: value.href, hostname: value.hostname.toLowerCase(), database };
}

function validatePrefix(prefix) {
  if (!SAFE_PREFIX.test(prefix) || prefix.split('/').some((part) => part === '.' || part === '..')) {
    fail('BACKUP_PREFIX must use canonical safe path segments');
  }
  return prefix;
}

function validateTimestamp(timestamp, now = new Date(), maxFutureSkewSeconds = 300) {
  if (!/^\d{8}T\d{6}Z$/.test(timestamp)) fail('BACKUP_TIMESTAMP must use YYYYMMDDTHHMMSSZ');
  const canonical = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}Z`;
  const value = new Date(canonical);
  if (Number.isNaN(value.getTime()) || value.toISOString().replace('.000Z', 'Z') !== canonical) {
    fail('BACKUP_TIMESTAMP is not a real canonical UTC timestamp');
  }
  if (value.getTime() > now.getTime() + maxFutureSkewSeconds * 1000) fail('BACKUP_TIMESTAMP is too far in the future');
  return canonical;
}

if (require.main === module) {
  try {
    const [, , command, ...args] = process.argv;
    if (command === 'url') {
      const parsed = parsePostgresUrl(args[0]);
      process.stdout.write(`${parsed.hostname}\t${parsed.database}\n`);
    } else if (command === 'prefix') {
      process.stdout.write(`${validatePrefix(args[0] || '')}\n`);
    } else if (command === 'timestamp') {
      process.stdout.write(`${validateTimestamp(args[0] || '')}\n`);
    } else {
      fail('unknown validation command');
    }
  } catch (error) {
    process.stderr.write(`backup configuration validation failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { parsePostgresUrl, validatePrefix, validateTimestamp };
