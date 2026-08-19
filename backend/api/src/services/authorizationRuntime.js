const { AuthorizationEvidenceEvent } = require('../models');
const { createAuthorizationEvidenceRecorder } = require('./authorizationEvidence');
const { deriveRuntimeAuthorizationIdentity } = require('./authorizationRuntimeIdentity');

let runtimeIdentity = null;

function getAuthorizationMode(env = process.env) {
  const mode = String(env.AUTHORIZATION_MODE || 'compatibility').trim().toLowerCase();
  if (!['compatibility', 'capability_only'].includes(mode)) throw new Error('Invalid authorization mode');
  return mode;
}

function getAuthorizationRelease(env = process.env) {
  if (runtimeIdentity) return runtimeIdentity;
  if (env.NODE_ENV === 'production') throw new Error('Runtime authorization identity is not initialized');
  return deriveRuntimeAuthorizationIdentity({ env, migrationState: null });
}

function setAuthorizationRuntimeIdentity(identity) {
  runtimeIdentity = Object.freeze({ ...identity });
  return runtimeIdentity;
}

async function recordAuthorizationDecision(event) {
  const recorder = createAuthorizationEvidenceRecorder({
    EventModel: AuthorizationEvidenceEvent,
    release: getAuthorizationRelease(),
  });
  return recorder.recordDecision(event);
}

async function recordAuthorizationCanary(now = new Date()) {
  const recorder = createAuthorizationEvidenceRecorder({
    EventModel: AuthorizationEvidenceEvent,
    release: getAuthorizationRelease(),
    clock: () => now,
  });
  return recorder.recordCanary();
}

module.exports = {
  getAuthorizationMode,
  getAuthorizationRelease,
  recordAuthorizationCanary,
  recordAuthorizationDecision,
  setAuthorizationRuntimeIdentity,
};
