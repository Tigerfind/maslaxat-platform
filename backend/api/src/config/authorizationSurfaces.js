const { digest } = require('../services/paymentShadowEvidence');
const { EVENT_FIELDS } = require('../socket/guards');

const VALID_MODES = Object.freeze(['client', 'lawyer', 'admin']);
const ALL_MODES = Object.freeze([...VALID_MODES]);
const SOCKET_EVENTS = Object.freeze(Object.keys(EVENT_FIELDS).sort());
const EXPLICIT_SURFACES = Object.freeze([
  { id: 'SOCKET handshake', channel: 'socket', modes: ALL_MODES },
  ...SOCKET_EVENTS.map((event) => ({ id: `SOCKET ${event}`, channel: 'socket', modes: ALL_MODES })),
  { id: 'CATALOG GET /api/lawyers', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG GET /api/client/lawyers', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG GET /api/lawyers/:id', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG GET /api/client/lawyers/:id', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG POST /api/lawyers/:id/book', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG POST /api/client/lawyers/:id/book', channel: 'catalog', modes: ['lawyer'] },
  { id: 'CATALOG PROMOTION eligibility', channel: 'catalog', modes: ['lawyer'] },
]);

const AUTHORIZATION_SURFACES = {
  schemaVersion: 2,
  inventoryId: 'maslaxat-authorization-surfaces-v2',
  surfaces: [...EXPLICIT_SURFACES],
};
let mountedGuards = [];

function normalizePath(value) {
  const path = String(value || '').split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

function mountPrefix(layer) {
  const source = layer?.regexp?.source || '';
  if (!source.startsWith('^\\/')) return '';
  return source
    .replace(/^\^\\\//, '/')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
}

function guardMetadata(middleware) {
  return middleware?.authorizationGuard || null;
}

function routeEntries(router, prefix) {
  const entries = [];
  const active = [];
  for (const layer of router?.stack || []) {
    if (!layer.route) {
      const metadata = guardMetadata(layer.handle);
      if (metadata) active.push({ middleware: layer.handle, metadata });
      continue;
    }
    const routeGuards = layer.route.stack
      .map((item) => ({ middleware: item.handle, metadata: guardMetadata(item.handle) }))
      .filter((item) => item.metadata);
    const guards = [...active, ...routeGuards];
    for (const method of Object.keys(layer.route.methods).filter((name) => layer.route.methods[name]).sort()) {
      for (const guard of guards) {
        const path = normalizePath(`${prefix}${layer.route.path === '/' ? '' : layer.route.path}`);
        const suffix = guard.metadata.stage ? `#${guard.metadata.stage}` : '';
        entries.push({
          id: `HTTP ${method.toUpperCase()} ${path}${suffix}`,
          channel: 'http',
          method: method.toUpperCase(),
          path,
          routePath: layer.route.path,
          modes: [...guard.metadata.modes],
          legacyRoles: [...guard.metadata.legacyRoles],
          middleware: guard.middleware,
        });
      }
    }
  }
  return entries;
}

function collectMountedAuthorizationGuards(app) {
  const entries = [];
  for (const layer of app?._router?.stack || []) {
    if (layer.name !== 'router' || !layer.handle?.stack) continue;
    entries.push(...routeEntries(layer.handle, mountPrefix(layer)));
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

function initializeMountedAuthorizationInventory(app) {
  const entries = collectMountedAuthorizationGuards(app);
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate mounted authorization surface: ${entry.id}`);
    ids.add(entry.id);
  }
  mountedGuards = entries;
  AUTHORIZATION_SURFACES.surfaces = [
    ...entries.map(({ id, channel, modes }) => ({ id, channel, modes })),
    ...EXPLICIT_SURFACES,
  ].sort((left, right) => left.id.localeCompare(right.id));
  validateAuthorizationSurfaceInventory(AUTHORIZATION_SURFACES);
  return AUTHORIZATION_SURFACES;
}

function ensureMountedAuthorizationInventory() {
  if (mountedGuards.length) return;
  const app = require('../server');
  if (!mountedGuards.length) initializeMountedAuthorizationInventory(app);
}

function getAuthorizationSurfaceInventory() {
  ensureMountedAuthorizationInventory();
  return AUTHORIZATION_SURFACES;
}

function validateAuthorizationSurfaceInventory(value) {
  if (!value || value.schemaVersion !== 2 || value.inventoryId !== 'maslaxat-authorization-surfaces-v2'
    || !Array.isArray(value.surfaces) || value.surfaces.length === 0
    || Object.keys(value).sort().join(',') !== 'inventoryId,schemaVersion,surfaces') {
    throw new Error('Valid authorization surface inventory is required');
  }
  const ids = new Set();
  for (const surface of value.surfaces) {
    if (!surface || Object.keys(surface).sort().join(',') !== 'channel,id,modes'
      || !['http', 'socket', 'catalog'].includes(surface.channel)
      || !Array.isArray(surface.modes) || surface.modes.length === 0
      || surface.modes.some((mode) => !VALID_MODES.includes(mode))
      || new Set(surface.modes).size !== surface.modes.length || ids.has(surface.id)) {
      throw new Error('Authorization surface inventory contains an invalid or duplicate entry');
    }
    ids.add(surface.id);
  }
  return value;
}

function authorizationSurfaceDigest(value = AUTHORIZATION_SURFACES) {
  if (value === AUTHORIZATION_SURFACES) ensureMountedAuthorizationInventory();
  return digest(validateAuthorizationSurfaceInventory(value));
}

function getAuthorizationSurface(id, mode, value = AUTHORIZATION_SURFACES) {
  if (value === AUTHORIZATION_SURFACES) ensureMountedAuthorizationInventory();
  const surface = validateAuthorizationSurfaceInventory(value).surfaces.find((entry) => entry.id === id);
  if (!surface || !surface.modes.includes(mode)) throw new Error('Unknown authorization surface or mode');
  return surface;
}

function templatePattern(template) {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp(`^${escaped}/?$`);
}

function resolveHttpAuthorizationSurface(method, url, stage = null) {
  ensureMountedAuthorizationInventory();
  const normalizedMethod = String(method || '').toUpperCase();
  const pathname = normalizePath(url);
  const matches = mountedGuards.filter((entry) => entry.method === normalizedMethod
    && entry.middleware.authorizationGuard?.stage === stage
    && templatePattern(entry.path).test(pathname));
  const match = matches.sort((left, right) => {
    const leftParams = (left.path.match(/:[A-Za-z0-9_]+/g) || []).length;
    const rightParams = (right.path.match(/:[A-Za-z0-9_]+/g) || []).length;
    return leftParams - rightParams || right.path.length - left.path.length;
  })[0];
  if (!match) {
    throw Object.assign(new Error(`Unregistered mounted authorization surface: ${normalizedMethod} ${pathname}`), {
      code: 'AUTHORIZATION_SURFACE_UNMOUNTED',
    });
  }
  return match.id;
}

function resolveCatalogAuthorizationSurface(method, url) {
  ensureMountedAuthorizationInventory();
  const normalizedMethod = String(method || '').toUpperCase();
  const pathname = normalizePath(url);
  const matches = EXPLICIT_SURFACES.filter((entry) => entry.channel === 'catalog'
    && entry.id.startsWith(`CATALOG ${normalizedMethod} `))
    .map((entry) => ({ entry, template: entry.id.slice(`CATALOG ${normalizedMethod} `.length) }))
    .filter(({ template }) => templatePattern(template).test(pathname))
    .sort((left, right) => {
      const leftParams = (left.template.match(/:[A-Za-z0-9_]+/g) || []).length;
      const rightParams = (right.template.match(/:[A-Za-z0-9_]+/g) || []).length;
      return leftParams - rightParams || right.template.length - left.template.length;
    });
  if (!matches.length) throw new Error(`Unregistered catalog authorization surface: ${normalizedMethod} ${pathname}`);
  return matches[0].entry.id;
}

module.exports = {
  ALL_MODES,
  AUTHORIZATION_SURFACES,
  SOCKET_EVENTS,
  authorizationSurfaceDigest,
  collectMountedAuthorizationGuards,
  getAuthorizationSurface,
  getAuthorizationSurfaceInventory,
  initializeMountedAuthorizationInventory,
  resolveHttpAuthorizationSurface,
  resolveCatalogAuthorizationSurface,
  validateAuthorizationSurfaceInventory,
};
