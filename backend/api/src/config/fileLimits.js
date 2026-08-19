'use strict';

const MIB = 1024 * 1024;
const FILE_LIMITS = Object.freeze({
  avatar: 5 * MIB,
  document: 10 * MIB,
  case: 10 * MIB,
  lawyer: 10 * MIB,
  ai: 10 * MIB,
});

function uploadLimitFor(kind, configured = process.env.MAX_FILE_SIZE) {
  const domainLimit = FILE_LIMITS[kind];
  if (!domainLimit) throw new TypeError('Unsupported file limit domain');
  const parsed = Number.parseInt(configured, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, domainLimit) : domainLimit;
}

module.exports = { FILE_LIMITS, uploadLimitFor };
