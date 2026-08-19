const fs = require('fs');

const PRODUCTION_HOSTS = ['maslaxat.uz'];
const PROFILES = new Set(['smoke', 'baseline', 'spike']);

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateSummary(artifact) {
  if (!artifact || typeof artifact !== 'object' || !artifact.metadata || !artifact.summary) {
    throw new Error('Summary artifact and metadata are required');
  }
  const metadata = artifact.metadata;
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported summary schemaVersion');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{5,39}$/.test(String(metadata.runId || ''))) {
    throw new Error('Invalid summary runId');
  }
  if (!PROFILES.has(metadata.profile)) throw new Error('Invalid summary profile');
  if (!/^[A-Za-z0-9.-]{1,64}$/.test(String(metadata.seedVersion || ''))) {
    throw new Error('Invalid summary seedVersion');
  }
  if (!/^[A-Fa-f0-9]{7,40}$/.test(String(metadata.commitSha || ''))) {
    throw new Error('Invalid summary commitSha');
  }
  let target;
  try {
    target = new URL(metadata.targetOrigin);
  } catch {
    throw new Error('Invalid summary targetOrigin');
  }
  if (target.protocol !== 'https:') throw new Error('Summary targetOrigin must use HTTPS');
  if (PRODUCTION_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))) {
    throw new Error('Summary targetOrigin is production');
  }
  if (!validDate(metadata.startedAt) || !validDate(metadata.completedAt)) {
    throw new Error('Invalid summary timestamps');
  }
  if (new Date(metadata.completedAt) < new Date(metadata.startedAt)) {
    throw new Error('Summary completedAt precedes startedAt');
  }
  if (typeof artifact.summary !== 'object' || Array.isArray(artifact.summary)) {
    throw new Error('Invalid summary payload');
  }
  return metadata;
}

module.exports = { validateSummary };

if (require.main === module) {
  const artifactPath = process.argv[2];
  if (!artifactPath) throw new Error('Usage: node load/validate-summary.js <summary.json>');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const metadata = validateSummary(artifact);
  process.stdout.write(`${JSON.stringify({ valid: true, metadata })}\n`);
}
