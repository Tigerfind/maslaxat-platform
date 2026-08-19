const jwt = require('jsonwebtoken');

test('socket guard checks JWT expiry and uses bounded TTL LRU caches', () => {
  const { assertSocketTokenCurrent, BoundedTtlLru } = require('../src/socket/guards');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-socket-hardening';
  const expired = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: -1 });
  const valid = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: 60 });
  expect(() => assertSocketTokenCurrent(expired)).toThrow();
  expect(assertSocketTokenCurrent(valid).id).toBe('user-1');

  let now = 0;
  const cache = new BoundedTtlLru({ maxEntries: 2, ttlMs: 5, clock: () => now });
  cache.set('a', 1);
  cache.set('b', 2);
  expect(cache.get('a')).toBe(1);
  cache.set('c', 3);
  expect(cache.get('b')).toBeUndefined();
  now = 6;
  expect(cache.get('a')).toBeUndefined();
});

test('socket event gate rejects oversized and rate-limited payloads before authorization', async () => {
  const { createSocketEventGate } = require('../src/socket/guards');
  let authorizations = 0;
  let now = 0;
  const socket = {
    handshake: { auth: { token: 'token' } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  const gate = createSocketEventGate({
    socket,
    clock: () => now,
    verifyToken: () => ({ id: 'user' }),
    authorize: async () => { authorizations += 1; return true; },
  });

  expect(await gate('send-message', { consultationId: 'c', text: 'x'.repeat(4001) })).toBeNull();
  expect(authorizations).toBe(0);
  for (let index = 0; index < 5; index += 1) {
    expect(await gate('send-message', { consultationId: 'c', text: 'ok' }))
      .toEqual({ consultationId: 'c', text: 'ok' });
  }
  expect(await gate('send-message', { consultationId: 'c', text: 'blocked' })).toBeNull();
  expect(authorizations).toBe(5);
  expect(socket.emit).toHaveBeenCalledWith('socket-violation', expect.objectContaining({ code: expect.any(String) }));
  now = 11_000;
  expect(await gate('send-message', { consultationId: 'c', text: 'refilled' }))
    .toEqual({ consultationId: 'c', text: 'refilled' });
});

test('socket event gate rejects primitives, unknown fields, and oversized serialized signals before auth', async () => {
  const { createSocketEventGate } = require('../src/socket/guards');
  const authorize = jest.fn().mockResolvedValue(true);
  const socket = {
    handshake: { auth: { token: 'token' } }, emit: jest.fn(), disconnect: jest.fn(),
  };
  const gate = createSocketEventGate({ socket, authorize, verifyToken: () => ({ id: 'user' }) });

  await expect(gate('join-room', null)).resolves.toBeNull();
  await expect(gate('join-room', 'c-1')).resolves.toBeNull();
  await expect(gate('join-room', { consultationId: 'c-1', admin: true })).resolves.toBeNull();
  expect(socket.disconnect).toHaveBeenCalledWith(true);
  expect(authorize).not.toHaveBeenCalled();

  const tooLarge = {
    to: 'remote',
    signal: { type: 'offer', sdp: 'x'.repeat(64 * 1024) },
  };
  await expect(gate('signal', tooLarge)).resolves.toBeNull();
  expect(authorize).not.toHaveBeenCalled();
});

test('signal relay discovers a same-room target through adapter fetchSockets', async () => {
  const { initSignaling } = require('../src/socket/signaling');
  let middleware;
  let connect;
  const target = { id: 'remote-socket', rooms: new Set(['consultation:c-1']) };
  const emitted = jest.fn();
  const io = {
    use(fn) { middleware = fn; },
    on(_event, fn) { connect = fn; },
    in: jest.fn((room) => ({
      fetchSockets: jest.fn(async () => room === 'consultation:c-1' ? [target] : []),
      emit: emitted,
    })),
    to: jest.fn(() => ({ emit: emitted })),
    sockets: { sockets: new Map() },
  };
  const authorizeSocket = async () => ({
    user: { id: 'user-1', name: 'Client', avatar: null },
    capabilities: ['client'], accountMode: 'client',
  });
  initSignaling(io, {
    authorizeSocket,
    verifySocketToken: () => ({ id: 'user-1' }),
    loadConsultation: async () => ({ id: 'c-1', clientId: 'user-1', lawyerId: 'user-2' }),
  });
  const handlers = {};
  const socket = {
    id: 'local-socket', handshake: { auth: { token: 'token', mode: 'client' } },
    rooms: new Set(['consultation:c-1']), roomId: 'consultation:c-1', consultationId: 'c-1',
    join: jest.fn(), emit: jest.fn(), disconnect: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on(event, fn) { handlers[event] = fn; },
  };
  await new Promise((resolve) => middleware(socket, resolve));
  connect(socket);
  const originalSignal = { type: 'offer', sdp: 'safe' };
  await handlers.signal({ to: 'remote-socket', signal: originalSignal });

  expect(io.in).toHaveBeenCalledWith('consultation:c-1');
  expect(emitted).toHaveBeenCalledWith('signal', expect.objectContaining({ from: 'local-socket' }));
  const relayed = emitted.mock.calls.find(([event]) => event === 'signal')[1];
  expect(relayed.signal).toEqual(originalSignal);
  expect(relayed.signal).not.toBe(originalSignal);
});

test('socket handlers reject malformed payloads without destructuring failures', async () => {
  const { initSignaling } = require('../src/socket/signaling');
  let middleware;
  let connect;
  const io = {
    use(fn) { middleware = fn; }, on(_event, fn) { connect = fn; },
    in: () => ({ fetchSockets: async () => [], emit() {} }),
    to: () => ({ emit() {} }), sockets: { sockets: new Map() },
  };
  initSignaling(io, {
    authorizeSocket: async () => ({
      user: { id: 'user-1', name: 'Client', avatar: null }, capabilities: ['client'], accountMode: 'client',
    }),
    verifySocketToken: () => ({ id: 'user-1' }),
    loadConsultation: async () => null,
  });
  const handlers = {};
  const socket = {
    id: 'socket-1', handshake: { auth: { token: 'token', mode: 'client' } }, rooms: new Set(),
    join: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), to: () => ({ emit() {} }),
    on(event, fn) { handlers[event] = fn; },
  };
  await new Promise((resolve) => middleware(socket, resolve));
  connect(socket);

  await expect(handlers['join-room'](null)).resolves.toBeUndefined();
  await expect(handlers['send-message'](42)).resolves.toBeUndefined();
  await expect(handlers.typing(undefined)).resolves.toBeUndefined();
  expect(socket.emit).toHaveBeenCalledWith('socket-violation', { code: 'INVALID_PAYLOAD' });
  expect(socket.disconnect).toHaveBeenCalledWith(true);
});

test('consultation membership cache requests and stores only the fixed authorization projection', async () => {
  const { initSignaling, CONSULTATION_AUTH_ATTRIBUTES } = require('../src/socket/signaling');
  let middleware;
  let connect;
  const loadConsultation = jest.fn(async () => ({
    id: 'c-1', clientId: 'user-1', lawyerId: 'user-2', status: 'accepted', type: 'video',
    providerData: { secret: true }, lawyerNote: 'secret',
  }));
  const io = {
    use(fn) { middleware = fn; }, on(_event, fn) { connect = fn; },
    in: () => ({ fetchSockets: async () => [], emit() {} }), to: () => ({ emit() {} }),
    sockets: { sockets: new Map() },
  };
  initSignaling(io, {
    authorizeSocket: async () => ({
      user: { id: 'user-1', name: 'Client', avatar: null }, capabilities: ['client'], accountMode: 'client',
    }),
    verifySocketToken: () => ({ id: 'user-1' }), loadConsultation,
  });
  const handlers = {};
  const socket = {
    id: 'socket-1', handshake: { auth: { token: 'token', mode: 'client' } }, rooms: new Set(),
    join: jest.fn((room) => socket.rooms.add(room)), emit: jest.fn(), disconnect: jest.fn(),
    to: () => ({ emit() {} }), on(event, fn) { handlers[event] = fn; },
  };
  await new Promise((resolve) => middleware(socket, resolve));
  connect(socket);
  await handlers['join-chat']({ consultationId: 'c-1' });
  await handlers.typing({ consultationId: 'c-1' });

  expect(loadConsultation).toHaveBeenCalledTimes(1);
  expect(loadConsultation).toHaveBeenCalledWith('c-1', { attributes: CONSULTATION_AUTH_ATTRIBUTES });
  expect(CONSULTATION_AUTH_ATTRIBUTES).toEqual(['id', 'clientId', 'lawyerId', 'status', 'type']);
});

test('status-sensitive message mutation bypasses stale membership cache and blocks completed consultation', async () => {
  const { initSignaling } = require('../src/socket/signaling');
  let middleware;
  let connect;
  const createMessage = jest.fn();
  const withLockedConsultation = jest.fn(async (_id, operation) => operation({
    id: 'c-1', clientId: 'user-1', lawyerId: 'user-2', status: 'completed', type: 'chat',
  }, { id: 'tx-1' }));
  const io = {
    use(fn) { middleware = fn; }, on(_event, fn) { connect = fn; },
    in: () => ({ fetchSockets: async () => [], emit: jest.fn() }), to: () => ({ emit() {} }),
    sockets: { sockets: new Map() },
  };
  initSignaling(io, {
    authorizeSocket: async () => ({
      user: { id: 'user-1', name: 'Client', avatar: null }, capabilities: ['client'], accountMode: 'client',
    }),
    verifySocketToken: () => ({ id: 'user-1' }),
    loadConsultation: async () => ({
      id: 'c-1', clientId: 'user-1', lawyerId: 'user-2', status: 'accepted', type: 'chat',
    }),
    withLockedConsultation,
    createMessage,
  });
  const handlers = {};
  const socket = {
    id: 'socket-1', handshake: { auth: { token: 'token', mode: 'client' } }, rooms: new Set(),
    join: jest.fn((room) => socket.rooms.add(room)), emit: jest.fn(), disconnect: jest.fn(),
    to: () => ({ emit() {} }), on(event, fn) { handlers[event] = fn; },
  };
  await new Promise((resolve) => middleware(socket, resolve));
  connect(socket);
  await handlers['join-chat']({ consultationId: 'c-1' });
  await handlers['send-message']({ consultationId: 'c-1', text: 'must not persist' });

  expect(withLockedConsultation).toHaveBeenCalledWith('c-1', expect.any(Function));
  expect(createMessage).not.toHaveBeenCalled();
});

async function failureHarness(options = {}, ioOverrides = {}) {
  const { initSignaling } = require('../src/socket/signaling');
  let middleware;
  let connect;
  const emitted = jest.fn();
  const io = {
    use(fn) { middleware = fn; }, on(_event, fn) { connect = fn; },
    in: () => ({ fetchSockets: async () => [], emit: emitted }),
    to: () => ({ emit: emitted }), sockets: { sockets: new Map() },
    ...ioOverrides,
  };
  const reportException = jest.fn();
  initSignaling(io, {
    reportException,
    authorizeSocket: async () => ({
      user: { id: 'user-1', name: 'Client', avatar: null }, capabilities: ['client'], accountMode: 'client',
    }),
    verifySocketToken: () => ({ id: 'user-1' }),
    loadConsultation: async () => ({
      id: 'c-1', clientId: 'user-1', lawyerId: 'user-2', status: 'accepted', type: 'video',
    }),
    loadCurrentConsultation: async () => ({
      id: 'c-1', clientId: 'user-1', lawyerId: 'user-2', status: 'accepted', type: 'video',
    }),
    ...options,
  });
  const handlers = {};
  const socket = {
    id: 'socket-1', handshake: { auth: { token: 'token', mode: 'client' } }, rooms: new Set(),
    join: jest.fn((room) => socket.rooms.add(room)), leave: jest.fn(),
    emit: jest.fn(), disconnect: jest.fn(), to: () => ({ emit: emitted }),
    on(event, fn) { handlers[event] = fn; },
  };
  await new Promise((resolve) => middleware(socket, resolve));
  connect(socket);
  return { handlers, io, reportException, socket };
}

test.each([
  ['database', async () => {
    const harness = await failureHarness({
      loadCurrentConsultation: async () => { throw new Error('private database payload'); },
    });
    return { harness, event: 'join-room', payload: { consultationId: 'c-1' } };
  }],
  ['adapter fetchSockets', async () => {
    const harness = await failureHarness({}, {
      in: () => ({ fetchSockets: async () => { throw new Error('private adapter payload'); }, emit: jest.fn() }),
    });
    harness.socket.rooms.add('consultation:c-1');
    harness.socket.roomId = 'consultation:c-1';
    harness.socket.consultationId = 'c-1';
    return {
      harness, event: 'signal', payload: { to: 'remote', signal: { type: 'offer', sdp: 'safe' } },
    };
  }],
  ['mutation', async () => {
    const harness = await failureHarness({
      withLockedConsultation: async () => { throw new Error('private mutation payload'); },
    });
    harness.socket.rooms.add('chat:c-1');
    harness.socket.chatConsultationId = 'c-1';
    return { harness, event: 'send-message', payload: { consultationId: 'c-1', text: 'safe' } };
  }],
])('common socket safety wrapper contains %s failures and returns a sanitized ack', async (_name, setup) => {
  const { harness, event, payload } = await setup();
  const ack = jest.fn();

  await expect(harness.handlers[event](payload, ack)).resolves.toBeUndefined();
  expect(harness.reportException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
    operation: 'socket_event', event, userId: 'user-1',
  }));
  expect(harness.socket.emit).toHaveBeenCalledWith('socket:error', {
    event, code: 'SOCKET_EVENT_FAILED',
  });
  expect(ack).toHaveBeenCalledWith({ ok: false, error: { code: 'SOCKET_EVENT_FAILED' } });
  expect(JSON.stringify(harness.socket.emit.mock.calls)).not.toMatch(/private .* payload/);
});
