const { canonicalize, digest } = require('./paymentShadowEvidence');
const { authorizationSurfaceDigest } = require('../config/authorizationSurfaces');
const { CANARY_INTERVAL_MS } = require('./authorizationEvidence');

const COMMIT = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-z0-9._-]{3,160}$/i;
const MIGRATION = /^[0-9]{14}-[a-z0-9-]+\.js$/;

function canonicalAuthorizationConfigDigest(input = {}) {
  const config = {
    authorityVersion: input.authorityVersion ?? 2,
    inventoryDigest: input.inventoryDigest ?? authorizationSurfaceDigest(),
    canaryIntervalMs: input.canaryIntervalMs ?? CANARY_INTERVAL_MS,
    evidenceSchemaVersion: 1,
    manifestSchemaVersion: 1,
    telemetryPersistence: 'postgres-before-side-effects',
  };
  return digest(JSON.parse(canonicalize(config)));
}

function deriveRuntimeAuthorizationIdentity({ env = process.env, migrationState } = {}) {
  const production = env.NODE_ENV === 'production';
  const commitSha = production ? env.RAILWAY_GIT_COMMIT_SHA : (env.RAILWAY_GIT_COMMIT_SHA || '0'.repeat(40));
  const deploymentId = production ? env.RAILWAY_DEPLOYMENT_ID : (env.RAILWAY_DEPLOYMENT_ID || 'local-test-deployment');
  const serviceId = production ? env.RAILWAY_SERVICE_ID : (env.RAILWAY_SERVICE_ID || 'local-test-api');
  const migrationHead = migrationState?.migrationHead
    || (!production ? '20260824000000-create-authorization-evidence-events.js' : null);
  const authorizationMode = String(env.AUTHORIZATION_MODE || 'compatibility').trim().toLowerCase();
  if (!COMMIT.test(commitSha || '') || !SAFE_ID.test(deploymentId || '') || !SAFE_ID.test(serviceId || '')
    || !MIGRATION.test(migrationHead || '') || !['compatibility', 'capability_only'].includes(authorizationMode)) {
    throw new Error('Provider/build authorization identity is incomplete or invalid');
  }
  return {
    commitSha: commitSha.toLowerCase(),
    deploymentId,
    serviceId,
    configDigest: canonicalAuthorizationConfigDigest(),
    migrationHead,
    authorizationMode,
  };
}

module.exports = { canonicalAuthorizationConfigDigest, deriveRuntimeAuthorizationIdentity };
