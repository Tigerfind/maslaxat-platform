#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

try {
  const [, , outputDir, allowedRaw, jsonRaw] = process.argv;
  const allowed = new Set(allowedRaw.split(',').map((value) => value.trim()).filter(Boolean));
  const values = JSON.parse(jsonRaw);
  if (!outputDir || allowed.size === 0 || !values || Array.isArray(values) || typeof values !== 'object') throw new Error('invalid keyring input');
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  for (const keyId of allowed) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId) || typeof values[keyId] !== 'string') throw new Error(`missing allowlisted key ${keyId}`);
    fs.writeFileSync(path.join(outputDir, `${keyId}.pem`), Buffer.from(values[keyId], 'base64'), { mode: 0o600, flag: 'wx' });
  }
  if (Object.keys(values).some((keyId) => !allowed.has(keyId))) throw new Error('keyring contains a non-allowlisted key');
} catch (error) {
  process.stderr.write(`keyring materialization failed: ${error.message}\n`);
  process.exit(1);
}
