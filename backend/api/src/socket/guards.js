const jwt = require('jsonwebtoken');

const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 70 * 1024;
const EVENT_FIELDS = Object.freeze({
  'join-room': ['consultationId'],
  signal: ['to', 'signal'],
  'call-user': ['consultationId'],
  'call-accept': ['consultationId'],
  'call-decline': ['consultationId'],
  'call-cancel': ['consultationId'],
  'media-state': ['audio', 'video', 'consultationId'],
  'extend-request': ['minutes', 'proposalId'],
  'extend-accept': [],
  'extend-decline': [],
  'join-chat': ['consultationId'],
  'send-message': ['consultationId', 'text'],
  typing: ['consultationId'],
  'stop-typing': ['consultationId'],
  'end-call': [],
});

class BoundedTtlLru {
  constructor({ maxEntries, ttlMs, clock = Date.now }) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new TypeError('Valid cache bounds are required');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.values = new Map();
  }

  get(key) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: this.clock() + this.ttlMs });
    while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value);
    return value;
  }

  delete(key) { this.values.delete(key); }
}

function assertSocketTokenCurrent(token) {
  if (typeof token !== 'string' || !token) throw new Error('Authentication required');
  return jwt.verify(token, process.env.JWT_SECRET);
}

const POLICIES = Object.freeze({
  'join-room': { capacity: 10, windowMs: 10_000 },
  'join-chat': { capacity: 10, windowMs: 10_000 },
  signal: { capacity: 60, windowMs: 1000 },
  'call-user': { capacity: 3, windowMs: 60_000 },
  'call-accept': { capacity: 10, windowMs: 10_000 },
  'call-decline': { capacity: 10, windowMs: 10_000 },
  'call-cancel': { capacity: 10, windowMs: 10_000 },
  'media-state': { capacity: 20, windowMs: 1000 },
  'extend-request': { capacity: 5, windowMs: 10_000 },
  'extend-accept': { capacity: 5, windowMs: 10_000 },
  'extend-decline': { capacity: 5, windowMs: 10_000 },
  'send-message': { capacity: 5, windowMs: 10_000 },
  typing: { capacity: 10, windowMs: 1000 },
  'stop-typing': { capacity: 10, windowMs: 1000 },
  'end-call': { capacity: 5, windowMs: 10_000 },
});

function isDataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataValue(source, key) {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function exactObject(value, fields) {
  if (!isDataObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= fields.length && keys.every((key) => fields.includes(key));
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function copySignal(value) {
  const fields = ['type', 'sdp', 'candidate', 'renegotiate', 'transceiverRequest'];
  if (!exactObject(value, fields)) return null;
  const output = {};
  const type = dataValue(value, 'type');
  const sdp = dataValue(value, 'sdp');
  const renegotiate = dataValue(value, 'renegotiate');
  if (type !== undefined) {
    if (!boundedString(type, 32)) return null;
    output.type = type;
  }
  if (sdp !== undefined) {
    if (!boundedString(sdp, MAX_SIGNAL_BYTES)) return null;
    output.sdp = sdp;
  }
  if (renegotiate !== undefined) {
    if (typeof renegotiate !== 'boolean') return null;
    output.renegotiate = renegotiate;
  }
  const candidate = dataValue(value, 'candidate');
  if (candidate !== undefined) {
    if (typeof candidate === 'string') {
      if (!boundedString(candidate, 8192)) return null;
      output.candidate = candidate;
    } else {
      const candidateFields = ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'];
      if (!exactObject(candidate, candidateFields)) return null;
      const safeCandidate = {};
      for (const key of candidateFields) {
        const item = dataValue(candidate, key);
        if (item === undefined || item === null) continue;
        if (key === 'sdpMLineIndex') {
          if (!Number.isInteger(item) || item < 0 || item > 65535) return null;
        } else if (!boundedString(item, key === 'candidate' ? 8192 : 256)) return null;
        safeCandidate[key] = item;
      }
      output.candidate = safeCandidate;
    }
  }
  const request = dataValue(value, 'transceiverRequest');
  if (request !== undefined) {
    if (!exactObject(request, ['kind', 'init'])) return null;
    const kind = dataValue(request, 'kind');
    const init = dataValue(request, 'init');
    if (!['audio', 'video'].includes(kind) || (init !== undefined && !exactObject(init, ['direction']))) return null;
    const safeRequest = { kind };
    if (init !== undefined) {
      const direction = dataValue(init, 'direction');
      if (!['sendrecv', 'sendonly', 'recvonly', 'inactive'].includes(direction)) return null;
      safeRequest.init = { direction };
    }
    output.transceiverRequest = safeRequest;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_SIGNAL_BYTES) return null;
  } catch (_error) {
    return null;
  }
  return Object.keys(output).length ? output : null;
}

function sanitizePayload(event, payload) {
  const fields = EVENT_FIELDS[event];
  if (!fields) return null;
  if (payload === undefined && fields.length === 0) payload = {};
  if (!exactObject(payload, fields)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_EVENT_BYTES) return null;
  } catch (_error) {
    return null;
  }
  const output = {};
  for (const field of fields) output[field] = dataValue(payload, field);
  const consultationId = output.consultationId;
  if (fields.includes('consultationId') && consultationId !== undefined
    && !boundedString(consultationId, 128)) return null;
  if (['join-room', 'join-chat', 'call-user', 'call-accept', 'call-decline', 'call-cancel',
    'send-message', 'typing', 'stop-typing'].includes(event) && consultationId === undefined) return null;
  if (event === 'send-message' && (typeof output.text !== 'string' || output.text.length > 4000)) return null;
  if (event === 'signal') {
    if (!boundedString(output.to, 128)) return null;
    output.signal = copySignal(output.signal);
    if (!output.signal) return null;
  }
  if (event === 'media-state') {
    if (typeof output.audio !== 'boolean' || typeof output.video !== 'boolean') return null;
  }
  if (event === 'extend-request') {
    if (!Number.isInteger(output.minutes) || output.minutes < 1 || output.minutes > 120) return null;
    if (!boundedString(output.proposalId, 128)) return null;
  }
  return output;
}

function createSocketEventGate({ socket, authorize, verifyToken = assertSocketTokenCurrent, clock = Date.now }) {
  const buckets = new Map();
  let violations = 0;
  const reject = (code) => {
    violations += 1;
    socket.emit('socket-violation', { code });
    if (violations >= 3) socket.disconnect?.(true);
    return null;
  };
  return async (event, payload) => {
    let safePayload;
    try {
      safePayload = sanitizePayload(event, payload);
    } catch (_error) {
      safePayload = null;
    }
    if (!safePayload) return reject('INVALID_PAYLOAD');
    try {
      verifyToken(socket.handshake.auth?.token);
    } catch (_error) {
      socket.emit('auth-error', { code: 'SOCKET_AUTH_REVOKED' });
      socket.disconnect?.(true);
      return null;
    }
    const policy = POLICIES[event];
    const current = clock();
    let bucket = buckets.get(event);
    if (!bucket || current - bucket.startedAt >= policy.windowMs) {
      bucket = { startedAt: current, used: 0 };
      buckets.set(event, bucket);
    }
    if (bucket.used >= policy.capacity) return reject('RATE_LIMITED');
    bucket.used += 1;
    return await authorize(event) ? safePayload : null;
  };
}

module.exports = {
  BoundedTtlLru,
  EVENT_FIELDS,
  MAX_SIGNAL_BYTES,
  POLICIES,
  assertSocketTokenCurrent,
  createSocketEventGate,
  sanitizePayload,
};
