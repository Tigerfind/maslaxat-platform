const app = require('../src/server');
const { resetDb, makeApprovedOperator, models } = require('./helpers');
const {
  collectMountedAuthorizationGuards,
  getAuthorizationSurfaceInventory,
  resolveHttpAuthorizationSurface,
} = require('../src/config/authorizationSurfaces');

const { AuthorizationEvidenceEvent } = models;
const { EVENT_FIELDS, createSocketEventGate } = require('../src/socket/guards');

function concretePath(template, id = '00000000-0000-4000-8000-000000000001') {
  return template.replace(/:([A-Za-z0-9_]+)/g, id);
}

test('inventory exactly equals mechanically collected mounted guards plus explicit socket/catalog surfaces', () => {
  const collected = collectMountedAuthorizationGuards(app);
  const inventory = getAuthorizationSurfaceInventory();
  const http = inventory.surfaces.filter((surface) => surface.channel === 'http');

  expect(http.map(({ id, modes }) => ({ id, modes })))
    .toEqual(collected.map(({ id, modes }) => ({ id, modes })));
  expect(new Set(http.map((surface) => surface.id)).size).toBe(http.length);
  expect(http.every((surface) => /^HTTP (GET|POST|PUT|PATCH|DELETE) \/api\//.test(surface.id))).toBe(true);
  expect(inventory.surfaces.some((surface) => surface.id === 'SOCKET handshake')).toBe(true);
  expect(inventory.surfaces.some((surface) => surface.id === 'CATALOG GET /api/lawyers')).toBe(true);
});

test('special surfaces declare only modes that can reach their decision point', () => {
  const inventory = getAuthorizationSurfaceInventory();
  expect(inventory.surfaces.find((surface) => surface.id === 'HTTP POST /api/lawyer/imports'))
    .toMatchObject({ modes: ['lawyer'] });
  expect(inventory.surfaces.find((surface) => surface.id === 'HTTP POST /api/favorites/:lawyerId#target'))
    .toMatchObject({ modes: ['client'] });
  expect(inventory.surfaces.find((surface) => surface.id === 'HTTP POST /api/client/favorites/:lawyerId#target'))
    .toMatchObject({ modes: ['client'] });
});

test('every declared mounted HTTP mode produces denominator evidence through its actual guard', async () => {
  await resetDb();
  const collected = collectMountedAuthorizationGuards(app);
  const { user: target } = await makeApprovedOperator('surface-target@test.uz');
  await target.update({ twoFactorEnabled: true });

  for (const entry of collected) {
    for (const mode of entry.modes) {
      const fullPath = concretePath(entry.path, entry.id.endsWith('#target') ? target.id : undefined);
      const capabilities = mode === 'admin' ? ['admin']
        : mode === 'lawyer' ? ['client', 'lawyerApplicant', 'lawyer'] : ['client'];
      const req = {
        method: entry.method,
        originalUrl: fullPath,
        path: concretePath(entry.routePath, entry.id.endsWith('#target') ? target.id : undefined),
        baseUrl: '',
        route: { path: entry.path },
        capabilities,
        userRole: entry.legacyRoles[0],
        accountMode: mode,
        params: { lawyerId: target.id, id: target.id },
        query: {},
        get(name) { return name === 'X-Maslaxat-Mode' ? mode : undefined; },
      };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { return this; },
      };
      await entry.middleware(req, res, () => {});
    }
  }

  const rows = await AuthorizationEvidenceEvent.findAll({ where: { type: 'decision' }, raw: true });
  const observed = new Set(rows.map((row) => `${row.surface}|${row.mode}`));
  const missing = [];
  for (const entry of collected) {
    for (const mode of entry.modes) {
      if (!observed.has(`${entry.id}|${mode}`)) missing.push(`${entry.id}|${mode}`);
    }
  }
  expect(missing).toEqual([]);
});

test('runtime resolver returns templates and rejects unmounted drift', () => {
  expect(resolveHttpAuthorizationSurface('PATCH', '/api/admin/lawyers/abc/promotion-pilot'))
    .toBe('HTTP PATCH /api/admin/lawyers/:id/promotion-pilot');
  expect(() => resolveHttpAuthorizationSurface('POST', '/api/admin/unregistered/new-route'))
    .toThrow(/unregistered/i);
});

test('socket inventory exactly matches and reaches every real sensitive event gate', async () => {
  const inventory = getAuthorizationSurfaceInventory();
  const expected = ['SOCKET handshake', ...Object.keys(EVENT_FIELDS).sort().map((event) => `SOCKET ${event}`)];
  expect(inventory.surfaces.filter((surface) => surface.channel === 'socket').map((surface) => surface.id).sort())
    .toEqual(expected.sort());
  const authorized = [];
  const socket = {
    handshake: { auth: { token: 'test-token' } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  const gate = createSocketEventGate({
    socket,
    verifyToken: () => ({}),
    authorize: async (event) => { authorized.push(event); return true; },
  });
  const consultationId = '00000000-0000-4000-8000-000000000001';
  for (const event of Object.keys(EVENT_FIELDS)) {
    const payload = Object.fromEntries(EVENT_FIELDS[event].map((field) => {
      const value = {
        consultationId,
        to: 'socket-peer',
        signal: { type: 'offer', sdp: 'safe' },
        text: 'safe',
        audio: true,
        video: true,
        minutes: 15,
        proposalId: 'proposal-1',
      }[field];
      return [field, value];
    }));
    expect(await gate(event, payload)).not.toBeNull();
  }
  expect(authorized.sort()).toEqual(Object.keys(EVENT_FIELDS).sort());
});
