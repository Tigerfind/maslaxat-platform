#!/usr/bin/env node
'use strict';

const DIGEST_IMAGE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/;

function validateImageReference(value) {
  if (typeof value !== 'string' || !DIGEST_IMAGE.test(value)) {
    throw new Error('image reference must be digest-pinned as name@sha256:<64 lowercase hex>');
  }
  return value;
}

if (require.main === module) {
  try {
    for (const value of process.argv.slice(2)) process.stdout.write(`${validateImageReference(value)}\n`);
  } catch (error) {
    process.stderr.write(`image reference validation failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { validateImageReference };
