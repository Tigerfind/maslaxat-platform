#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function resolveVerifyKey(keyId, keyringDir, allowedRaw) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) throw new Error('manifest signing key ID is invalid');
  const allowed = new Set(allowedRaw.split(',').map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(keyId)) throw new Error(`manifest signing key ${keyId} is not allowlisted`);
  const resolvedDir = path.resolve(keyringDir);
  const keyPath = path.resolve(resolvedDir, `${keyId}.pem`);
  if (path.dirname(keyPath) !== resolvedDir || !fs.statSync(keyPath).isFile()) throw new Error('verification key is unavailable');
  return keyPath;
}

if (require.main === module) {
  try {
    const [, , keyId, keyringDir, allowedRaw = ''] = process.argv;
    process.stdout.write(`${resolveVerifyKey(keyId, keyringDir, allowedRaw)}\n`);
  } catch (error) {
    process.stderr.write(`verification key resolution failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { resolveVerifyKey };
