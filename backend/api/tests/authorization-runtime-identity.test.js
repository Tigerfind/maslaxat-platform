const {
  canonicalAuthorizationConfigDigest,
  deriveRuntimeAuthorizationIdentity,
} = require('../src/services/authorizationRuntimeIdentity');
const express = require('express');
const request = require('supertest');
const { createAuthorizationMetadataHandler } = require('../src/routes/authorization-metadata');

test('runtime identity uses provider/build identity and ignores self-declared authorization labels', () => {
  const identity = deriveRuntimeAuthorizationIdentity({
    env: {
      NODE_ENV: 'production',
      AUTHORIZATION_MODE: 'capability_only',
      RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
      RAILWAY_DEPLOYMENT_ID: 'provider-deployment-123',
      RAILWAY_SERVICE_ID: 'provider-service-456',
      AUTHORIZATION_RELEASE_COMMIT_SHA: 'f'.repeat(40),
      AUTHORIZATION_DEPLOYMENT_ID: 'spoofed-deployment',
      AUTHORIZATION_SERVICE_ID: 'spoofed-service',
      AUTHORIZATION_CONFIG_DIGEST: 'f'.repeat(64),
    },
    migrationState: { migrationHead: '20260824000000-create-authorization-evidence-events.js' },
  });

  expect(identity).toMatchObject({
    commitSha: 'a'.repeat(40),
    deploymentId: 'provider-deployment-123',
    serviceId: 'provider-service-456',
    migrationHead: '20260824000000-create-authorization-evidence-events.js',
    authorizationMode: 'capability_only',
  });
  expect(identity.configDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(identity)).not.toContain('spoofed');
});

test('canonical config digest is order-independent and changes with authorization semantics', () => {
  const left = canonicalAuthorizationConfigDigest({
    inventoryDigest: 'a'.repeat(64), canaryIntervalMs: 300000, authorityVersion: 2,
  });
  const reordered = canonicalAuthorizationConfigDigest({
    authorityVersion: 2, canaryIntervalMs: 300000, inventoryDigest: 'a'.repeat(64),
  });
  const changed = canonicalAuthorizationConfigDigest({
    inventoryDigest: 'a'.repeat(64), canaryIntervalMs: 600000, authorityVersion: 2,
  });

  expect(left).toBe(reordered);
  expect(changed).not.toBe(left);
});

test.each([
  ['commit', { RAILWAY_GIT_COMMIT_SHA: '' }],
  ['deployment', { RAILWAY_DEPLOYMENT_ID: '' }],
  ['service', { RAILWAY_SERVICE_ID: '' }],
])('production refuses missing provider-derived %s identity', (_label, overrides) => {
  expect(() => deriveRuntimeAuthorizationIdentity({
    env: {
      NODE_ENV: 'production', AUTHORIZATION_MODE: 'compatibility',
      RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40), RAILWAY_DEPLOYMENT_ID: 'deployment-123',
      RAILWAY_SERVICE_ID: 'service-123', ...overrides,
    },
    migrationState: { migrationHead: '20260824000000-create-authorization-evidence-events.js' },
  })).toThrow(/provider|build/i);
});

test('runtime metadata endpoint authenticates and returns only derived release identity', async () => {
  const identity = {
    commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'service-123',
    configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js',
    authorizationMode: 'compatibility',
  };
  const app = express();
  app.get('/metadata', createAuthorizationMetadataHandler({
    token: 'metadata-token-that-is-at-least-32-characters',
    getIdentity: () => identity,
    clock: () => new Date('2026-08-19T00:00:00.000Z'),
  }));

  const denied = await request(app).get('/metadata').set('Authorization', 'Bearer wrong');
  const allowed = await request(app).get('/metadata')
    .set('Authorization', 'Bearer metadata-token-that-is-at-least-32-characters');

  expect(denied.status).toBe(401);
  expect(allowed.body).toEqual({ ...identity, issuedAt: '2026-08-19T00:00:00.000Z' });
  expect(Object.keys(allowed.body).sort()).toEqual([
    'authorizationMode', 'commitSha', 'configDigest', 'deploymentId', 'issuedAt',
    'migrationHead', 'serviceId',
  ]);
});
