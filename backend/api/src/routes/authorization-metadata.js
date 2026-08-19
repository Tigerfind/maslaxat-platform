const crypto = require('crypto');
const express = require('express');
const { getAuthorizationRelease } = require('../services/authorizationRuntime');

function tokenMatches(supplied, expected) {
  const left = Buffer.from(String(supplied || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function createAuthorizationMetadataHandler({ token, getIdentity, clock = () => new Date() }) {
  if (typeof token !== 'string' || token.length < 32 || typeof getIdentity !== 'function') {
    throw new Error('Authorization metadata token and identity provider are required');
  }
  return (req, res) => {
    const header = req.get('Authorization') || '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!tokenMatches(supplied, token)) return res.status(401).json({ error: 'Unauthorized' });
    const identity = getIdentity();
    return res.json({
      commitSha: identity.commitSha,
      deploymentId: identity.deploymentId,
      serviceId: identity.serviceId,
      configDigest: identity.configDigest,
      migrationHead: identity.migrationHead,
      authorizationMode: identity.authorizationMode,
      issuedAt: clock().toISOString(),
    });
  };
}

function createAuthorizationMetadataRouter({
  token,
  getIdentity = getAuthorizationRelease,
  clock,
} = {}) {
  const router = express.Router();
  router.get('/', createAuthorizationMetadataHandler({ token, getIdentity, clock }));
  return router;
}

module.exports = { createAuthorizationMetadataHandler, createAuthorizationMetadataRouter };
