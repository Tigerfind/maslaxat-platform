const fs = require('fs');
const { verifyAuthorizationCutoverEnvelope } = require('./authorizationEvidenceManifest');

async function assertAuthorizationStartup({ config, runtimeIdentity = null, now = new Date() }) {
  if (!config || config.mode === 'compatibility') return { mode: 'compatibility' };
  if (config.mode !== 'capability_only' || !config.evidence) {
    throw new Error('Authorization cutover evidence is required');
  }
  try {
    if (!runtimeIdentity) throw new Error('Runtime authorization identity is required');
    const envelope = JSON.parse(fs.readFileSync(config.evidence.path, 'utf8'));
    const manifest = verifyAuthorizationCutoverEnvelope(envelope, {
      now,
      manifestKey: {
        keyId: config.evidence.manifestKeyId,
        publicKey: config.evidence.manifestPublicKey,
      },
      approvalKeys: config.evidence.approvalKeys,
      expectedRelease: { ...runtimeIdentity, authorizationMode: 'capability_only' },
    });
    return { mode: 'capability_only', manifestDigest: manifest.evidence.artifactDigest };
  } catch (error) {
    throw Object.assign(new Error('Authorization cutover evidence is invalid'), {
      code: 'AUTHORIZATION_CUTOVER_REFUSED', cause: error,
    });
  }
}

module.exports = { assertAuthorizationStartup };
