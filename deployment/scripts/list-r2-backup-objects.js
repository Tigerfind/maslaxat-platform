#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function fail(message, exitCode = 66) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function readPage({ bucket, endpoint, prefix, continuationToken }) {
  const args = [
    '--endpoint-url', endpoint,
    's3api', 'list-objects-v2',
    '--no-paginate',
    '--bucket', bucket,
    '--prefix', prefix,
    '--output', 'json',
  ];
  if (continuationToken) args.push('--continuation-token', continuationToken);
  const result = spawnSync('aws', args, {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail('ListObjectsV2 request failed', 70);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail('ListObjectsV2 returned malformed JSON');
  }
}

function validatePage(payload, prefix) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('page is not an object');
  const contents = payload.Contents === undefined ? [] : payload.Contents;
  if (!Array.isArray(contents)) fail('Contents is not an array');
  if (!Number.isInteger(payload.KeyCount) || payload.KeyCount < 0 || payload.KeyCount !== contents.length) {
    fail('KeyCount does not match Contents');
  }
  if (typeof payload.IsTruncated !== 'boolean') fail('IsTruncated is not boolean');
  const keys = contents.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.Key !== 'string') {
      fail('Contents entry has no string Key');
    }
    if (!entry.Key.startsWith(prefix) || /[\0\r\n]/.test(entry.Key)) fail('object key is outside the requested prefix');
    return entry.Key;
  });
  const token = payload.NextContinuationToken;
  if (payload.IsTruncated) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096 || /[\0\r\n]/.test(token)) {
      fail('truncated page has no valid continuation token');
    }
  } else if (token !== undefined) {
    fail('terminal page unexpectedly contains a continuation token');
  }
  return { keys, nextToken: payload.IsTruncated ? token : null };
}

function listAll({ bucket, endpoint, prefix }) {
  const keys = [];
  const seenKeys = new Set();
  const seenTokens = new Set();
  let continuationToken = null;
  do {
    const page = validatePage(readPage({ bucket, endpoint, prefix, continuationToken }), prefix);
    for (const key of page.keys) {
      if (seenKeys.has(key)) fail('duplicate object key across pages');
      seenKeys.add(key);
      keys.push(key);
    }
    if (page.nextToken) {
      if (seenTokens.has(page.nextToken)) fail('continuation token did not progress');
      seenTokens.add(page.nextToken);
    }
    continuationToken = page.nextToken;
  } while (continuationToken);
  return keys;
}

function main() {
  const [, , bucket, endpoint, prefix] = process.argv;
  if (!bucket || !endpoint || !prefix || process.argv.length !== 5) fail('bucket, endpoint, and prefix are required');
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password) fail('endpoint must be HTTPS');
  const keys = listAll({ bucket, endpoint, prefix });
  if (keys.length) process.stdout.write(`${keys.join('\n')}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`list-r2-backup-objects: ${error.message}\n`);
    process.exitCode = error.exitCode || 66;
  }
}

module.exports = { listAll, validatePage };
