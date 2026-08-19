import { configureStore } from '@reduxjs/toolkit';
import api from '../../services/api';
import aiReducer, { aiActions } from './aiSlice';
import {
  getSessionEpoch,
  configureSessionRuntime,
  registerPrivateCacheClearer,
  registerSessionSocket,
} from '../../services/sessionRuntime';
import authReducer, {
  createInitialState,
  establishSession,
  getHomePath,
  hydrateSession,
  logout,
  synchronizeModeFromStorage,
  sessionReceived,
  replaceSessionToken,
  switchMode,
  synchronizeTokenFromStorage,
} from './authSlice';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

const memoryStorage = (values = {}) => ({
  getItem: jest.fn((key) => values[key] ?? null),
  setItem: jest.fn((key, value) => { values[key] = String(value); }),
  removeItem: jest.fn((key) => { delete values[key]; }),
});

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition not reached');
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  configureSessionRuntime({
    unbindPush: () => Promise.resolve(true),
    purgeCaches: () => Promise.resolve(),
    rebindPush: () => Promise.resolve(false),
  });
});

test('startup trusts only a token and ignores corrupt retained identity and mode data', () => {
  const storage = memoryStorage({ token: 'token-1', user: '{broken', role: 'admin', maslaxatMode: 'lawyer' });

  expect(createInitialState(storage)).toMatchObject({
    token: 'token-1', user: null, accountType: null, capabilities: [], activeMode: null,
    isAuthenticated: false, bootstrapStatus: 'pending',
  });
  expect(storage.removeItem).toHaveBeenCalledWith('user');
  expect(storage.removeItem).toHaveBeenCalledWith('role');
});

test('authoritative session capabilities determine applicant navigation despite legacy role', () => {
  const start = createInitialState(memoryStorage({ token: 'token-1' }));
  const next = authReducer(start, sessionReceived({
    user: { id: 'u1', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant'], preferredMode: 'lawyer', activeMode: 'lawyer',
  }));

  expect(next.isAuthenticated).toBe(true);
  expect(next.capabilities).toEqual(['client', 'lawyerApplicant']);
  expect(getHomePath(next)).toBe('/lawyer/onboarding');
});

test('token bootstrap hydrates auth me without a stale mode header', async () => {
  localStorage.setItem('token', 'token-hydrate');
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: createInitialState(localStorage) },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'u-hydrate', role: 'client' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client',
  } });

  await store.dispatch(hydrateSession());

  expect(api.get).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ skipModeHeader: true }));
  expect(store.getState().auth).toMatchObject({ isAuthenticated: true, bootstrapStatus: 'ready', activeMode: 'client' });
});

test('validated mode switch commits only after persistence, hydration, and compatibility probe', async () => {
  localStorage.setItem('token', 'token-1');
  localStorage.setItem('maslaxatMode', 'client');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u1', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  api.put.mockResolvedValueOnce({ data: { user: { id: 'u1', preferredMode: 'lawyer' } } });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u1', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockResolvedValueOnce({ data: { totalConsultations: 0 } });

  await store.dispatch(switchMode('lawyer'));

  expect(api.put).toHaveBeenCalledWith('/users/profile', { preferredMode: 'lawyer' }, expect.objectContaining({ modeOverride: 'lawyer' }));
  expect(api.get).toHaveBeenLastCalledWith('/lawyer/dashboard/stats', expect.objectContaining({ modeOverride: 'lawyer' }));
  expect(store.getState().auth.activeMode).toBe('lawyer');
  expect(localStorage.getItem('maslaxatMode')).toBe('lawyer');
});

test('compatibility denial restores the previous validated mode and reports unavailability', async () => {
  localStorage.setItem('token', 'token-2');
  localStorage.setItem('maslaxatMode', 'client');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u2', role: 'client' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  api.put
    .mockResolvedValueOnce({ data: {} })
    .mockResolvedValueOnce({ data: {} });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u2', role: 'client' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockRejectedValueOnce({ response: { status: 403, data: { code: 'AUTH_CAPABILITY_MISMATCH' } } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u2', role: 'client' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client',
    } });

  await expect(store.dispatch(switchMode('lawyer'))).rejects.toBeDefined();

  expect(api.put).toHaveBeenLastCalledWith('/users/profile', { preferredMode: 'client' }, expect.objectContaining({ modeOverride: 'client' }));
  expect(store.getState().auth.activeMode).toBe('client');
  expect(store.getState().auth.modeUnavailable).toMatch(/недоступ/i);
  expect(localStorage.getItem('maslaxatMode')).toBe('client');
});

test('failed server rollback accepts authoritative auth me and reports a partial switch', async () => {
  localStorage.setItem('token', 'token-partial');
  localStorage.setItem('maslaxatMode', 'client');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u-partial', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  api.put
    .mockResolvedValueOnce({ data: {} })
    .mockRejectedValueOnce({ response: { status: 503 } });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-partial', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockRejectedValueOnce({ response: { status: 403, data: { code: 'AUTH_CAPABILITY_MISMATCH' } } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-partial', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } });

  await expect(store.dispatch(switchMode('lawyer'))).rejects.toBeDefined();

  expect(api.get).toHaveBeenLastCalledWith('/auth/me', expect.objectContaining({ skipModeHeader: true }));
  expect(store.getState().auth.activeMode).toBe('lawyer');
  expect(store.getState().auth.modeUnavailable).toMatch(/частично|вернуть/i);
  expect(localStorage.getItem('maslaxatMode')).toBe('lawyer');
});

test('rollback preferredMode mismatch cannot be masked by requested-mode normalization', async () => {
  localStorage.setItem('token', 'token-rollback-preference');
  localStorage.setItem('maslaxatMode', 'client');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u-rollback-preference', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer, ai: aiReducer }, preloadedState: { auth: ready } });
  api.put.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: {} });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-preference', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockRejectedValueOnce({ response: { status: 403, data: { code: 'AUTH_CAPABILITY_MISMATCH' } } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-preference', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-preference', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } });
  const beforeEpoch = getSessionEpoch();

  await expect(store.dispatch(switchMode('lawyer'))).rejects.toBeDefined();

  expect(api.get).toHaveBeenLastCalledWith('/auth/me', expect.objectContaining({ skipModeHeader: true }));
  expect(store.getState().auth.activeMode).toBe('lawyer');
  expect(store.getState().auth.modeUnavailable).toMatch(/частично|вернуть/i);
  expect(store.getState().auth.sessionEpoch).toBeGreaterThan(beforeEpoch);
});

test('rollback capability mismatch falls through to authoritative server mode', async () => {
  localStorage.setItem('token', 'token-rollback-capability');
  localStorage.setItem('maslaxatMode', 'lawyer');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u-rollback-capability', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer', activeMode: 'lawyer',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  api.put.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: {} });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-capability', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client',
    } })
    .mockRejectedValueOnce({ response: { status: 403, data: { code: 'AUTH_CAPABILITY_MISMATCH' } } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-capability', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client'], preferredMode: 'lawyer',
    } })
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-rollback-capability', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client'], preferredMode: 'client',
    } });

  await expect(store.dispatch(switchMode('client'))).rejects.toBeDefined();

  expect(api.get).toHaveBeenLastCalledWith('/auth/me', expect.objectContaining({ skipModeHeader: true }));
  expect(store.getState().auth).toMatchObject({ activeMode: 'client', preferredMode: 'client', capabilities: ['client'] });
  expect(store.getState().auth.modeUnavailable).toMatch(/частично|вернуть/i);
});

test.each([
  ['capabilities', {
    user: { id: 'hydrate-user' }, accountType: 'member', capabilities: ['client', 'lawyerApplicant'], preferredMode: 'client',
  }],
  ['mode', {
    user: { id: 'hydrate-user' }, accountType: 'member', capabilities: ['client', 'lawyerApplicant'], preferredMode: 'lawyer',
  }],
  ['account', {
    user: { id: 'different-user' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  }],
])('hydrate rotates boundary before committing changed %s', async (label, responseData) => {
  localStorage.setItem('token', `hydrate-${label}`);
  const ready = {
    ...createInitialState(localStorage), user: { id: 'hydrate-user' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const socket = { disconnect: jest.fn() };
  const clearCache = jest.fn();
  const unregisterSocket = registerSessionSocket(socket);
  const unregisterCache = registerPrivateCacheClearer(clearCache);
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'private hydrate' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  api.get.mockResolvedValueOnce({ data: responseData });
  const beforeEpoch = getSessionEpoch();

  await store.dispatch(hydrateSession());

  expect(store.getState().auth.sessionEpoch).toBeGreaterThan(beforeEpoch);
  expect(store.getState().ai.messages).toEqual([]);
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  expect(clearCache).toHaveBeenCalledTimes(1);
  unregisterSocket();
  unregisterCache();
});

test('identical hydrate commits without rotating or clearing private state', async () => {
  localStorage.setItem('token', 'hydrate-identical');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'same-user', role: 'client' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const socket = { disconnect: jest.fn() };
  const clearCache = jest.fn();
  const unregisterSocket = registerSessionSocket(socket);
  const unregisterCache = registerPrivateCacheClearer(clearCache);
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'keep private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'same-user', role: 'client' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  } });
  const beforeEpoch = getSessionEpoch();

  await store.dispatch(hydrateSession());

  expect(store.getState().auth.sessionEpoch).toBe(beforeEpoch);
  expect(store.getState().ai.messages).toEqual([{ text: 'keep private' }]);
  expect(socket.disconnect).not.toHaveBeenCalled();
  expect(clearCache).not.toHaveBeenCalled();
  unregisterSocket();
  unregisterCache();
});

test('authoritative auth me with no available mode revokes the session after boundary cleanup', async () => {
  localStorage.setItem('token', 'revoked-token');
  localStorage.setItem('maslaxatMode', 'lawyer');
  localStorage.setItem('user', JSON.stringify({ id: 'revoked-user' }));
  const ready = {
    ...createInitialState(localStorage), user: { id: 'revoked-user', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer', activeMode: 'lawyer',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const socket = { disconnect: jest.fn() };
  const clearCache = jest.fn();
  const unregisterSocket = registerSessionSocket(socket);
  const unregisterCache = registerPrivateCacheClearer(clearCache);
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'revoked private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'revoked-user', role: 'lawyer' }, accountType: 'member', capabilities: [], preferredMode: null,
  } });
  const beforeEpoch = getSessionEpoch();

  await expect(store.dispatch(hydrateSession())).rejects.toMatchObject({ code: 'NO_AVAILABLE_MODE' });

  expect(store.getState().auth).toMatchObject({
    token: null, user: null, capabilities: [], activeMode: null,
    isAuthenticated: false, bootstrapStatus: 'revoked', error: 'NO_AVAILABLE_MODE',
  });
  expect(store.getState().auth.sessionEpoch).toBeGreaterThan(beforeEpoch);
  expect(store.getState().ai.messages).toEqual([]);
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('maslaxatMode')).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
  unregisterSocket();
  unregisterCache();
});

test('temporary auth me failure preserves a previously valid session without boundary rotation', async () => {
  localStorage.setItem('token', 'recoverable-token');
  localStorage.setItem('maslaxatMode', 'client');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'recoverable-user', role: 'client' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const socket = { disconnect: jest.fn() };
  const clearCache = jest.fn();
  const unregisterSocket = registerSessionSocket(socket);
  const unregisterCache = registerPrivateCacheClearer(clearCache);
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'recoverable private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  const failure = Object.assign(new Error('network unavailable'), { code: 'ERR_NETWORK' });
  api.get.mockRejectedValueOnce(failure);
  const beforeEpoch = getSessionEpoch();

  await expect(store.dispatch(hydrateSession())).rejects.toBe(failure);

  expect(store.getState().auth).toMatchObject({
    token: 'recoverable-token', user: { id: 'recoverable-user', role: 'client' },
    activeMode: 'client', isAuthenticated: true, bootstrapStatus: 'ready',
  });
  expect(store.getState().auth.sessionEpoch).toBe(beforeEpoch);
  expect(store.getState().ai.messages).toEqual([{ text: 'recoverable private' }]);
  expect(socket.disconnect).not.toHaveBeenCalled();
  expect(clearCache).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBe('recoverable-token');
  unregisterSocket();
  unregisterCache();
});

test('stale no-mode response cannot revoke a replacement token session', async () => {
  localStorage.setItem('token', 'stale-revocation-token');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'stale-user' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  let resolveHydration;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveHydration = resolve; }));
  const staleHydration = store.dispatch(hydrateSession());
  store.dispatch(replaceSessionToken('replacement-token', { resetIdentity: true }));
  resolveHydration({ data: {
    user: { id: 'stale-user' }, accountType: 'member', capabilities: [], preferredMode: null,
  } });

  await expect(staleHydration).rejects.toMatchObject({ code: 'STALE_SESSION_OPERATION' });
  expect(store.getState().auth).toMatchObject({
    token: 'replacement-token', user: null, isAuthenticated: false, bootstrapStatus: 'pending',
  });
  expect(localStorage.getItem('token')).toBe('replacement-token');
});

test('password token rotation updates Redux and storage atomically', () => {
  localStorage.setItem('token', 'old-token');
  const store = configureStore({ reducer: { auth: authReducer, ai: aiReducer } });
  store.dispatch(aiActions.addMessage({ text: 'private' }));
  const beforeEpoch = store.getState().auth.sessionEpoch || 0;

  store.dispatch(replaceSessionToken('new-token'));

  expect(store.getState().auth.token).toBe('new-token');
  expect(localStorage.getItem('token')).toBe('new-token');
  expect(store.getState().auth.sessionEpoch).toBeGreaterThan(beforeEpoch);
  expect(store.getState().ai.messages).toEqual([]);
});

test('cross-tab token replacement rotates before hydration and stale hydration cannot commit', async () => {
  localStorage.setItem('token', 'old-tab-token');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'old-user' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  let resolveOldHydration;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveOldHydration = resolve; }));
  const staleHydration = store.dispatch(hydrateSession());

  store.dispatch(replaceSessionToken('new-tab-token', { resetIdentity: true }));
  resolveOldHydration({ data: {
    user: { id: 'old-user' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  } });
  await expect(staleHydration).rejects.toMatchObject({ code: 'STALE_SESSION_OPERATION' });

  expect(store.getState().auth).toMatchObject({
    token: 'new-tab-token', user: null, isAuthenticated: false, bootstrapStatus: 'pending',
  });
});

test('cross-tab token synchronization clears private state before hydrating the new account', async () => {
  localStorage.setItem('token', 'old-sync-token');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'old-sync-user' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'old private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'new-sync-user' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  } });

  await store.dispatch(synchronizeTokenFromStorage('new-sync-token'));

  expect(store.getState().auth).toMatchObject({ token: 'new-sync-token', user: { id: 'new-sync-user' }, isAuthenticated: true });
  expect(store.getState().ai.messages).toEqual([]);
});

test('token replacement invalidates an in-flight mode switch before it can probe or rollback', async () => {
  localStorage.setItem('token', 'switch-old-token');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'switch-user', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: ready } });
  let resolvePut;
  api.put.mockImplementationOnce(() => new Promise((resolve) => { resolvePut = resolve; }));
  const switching = store.dispatch(switchMode('lawyer'));

  await waitFor(() => typeof resolvePut === 'function');
  store.dispatch(replaceSessionToken('switch-new-token', { resetIdentity: true }));
  resolvePut({ data: {} });
  await expect(switching).rejects.toMatchObject({ code: 'STALE_SESSION_OPERATION' });

  expect(api.get).not.toHaveBeenCalled();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(store.getState().auth.token).toBe('switch-new-token');
});

test('successful mode switch clears private AI state and advances session epoch', async () => {
  localStorage.setItem('token', 'token-ai-switch');
  const ready = {
    ...createInitialState(localStorage), user: { id: 'u-ai', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: ready, ai: { messages: [{ text: 'private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false } },
  });
  api.put.mockResolvedValueOnce({ data: {} });
  api.get
    .mockResolvedValueOnce({ data: {
      user: { id: 'u-ai', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant', 'lawyer'], preferredMode: 'lawyer',
    } })
    .mockResolvedValueOnce({ data: {} });
  const beforeEpoch = store.getState().auth.sessionEpoch || 0;

  await store.dispatch(switchMode('lawyer'));

  expect(store.getState().ai.messages).toEqual([]);
  expect(store.getState().auth.sessionEpoch).toBeGreaterThan(beforeEpoch);
});

test('logout keeps the authenticated token until push unbind settles, then clears private state', async () => {
  localStorage.setItem('token', 'logout-token');
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: { auth: createInitialState(localStorage) },
  });
  store.dispatch(aiActions.addMessage({ text: 'private logout data' }));
  let finishUnbind;
  configureSessionRuntime({ unbindPush: () => new Promise((resolve) => { finishUnbind = resolve; }) });

  const pending = store.dispatch(logout());
  await waitFor(() => typeof finishUnbind === 'function');
  expect(store.getState().auth.token).toBe('logout-token');
  expect(localStorage.getItem('token')).toBe('logout-token');

  finishUnbind(false);
  await pending;

  expect(store.getState().auth.isAuthenticated).toBe(false);
  expect(store.getState().ai.messages).toEqual([]);
  expect(localStorage.getItem('token')).toBeNull();
});

test('successful hydration attempts opted-in push rebind', async () => {
  localStorage.setItem('token', 'rebind-token');
  const rebindPush = jest.fn().mockResolvedValue(true);
  configureSessionRuntime({ rebindPush });
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: createInitialState(localStorage) },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'rebind-user' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  } });

  await store.dispatch(hydrateSession());

  expect(rebindPush).toHaveBeenCalledTimes(1);
});

test('slow User A logout cannot clear or broadcast over a newer User B login', async () => {
  localStorage.setItem('token', 'token-a');
  const readyA = {
    ...createInitialState(localStorage), user: { id: 'user-a' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: readyA } });
  let finishUnbind;
  const posted = [];
  class FakeBroadcastChannel {
    postMessage(message) { posted.push(message); }
    close() {}
  }
  global.BroadcastChannel = FakeBroadcastChannel;
  configureSessionRuntime({
    getSnapshot: () => store.getState().auth,
    unbindPush: () => new Promise((resolve) => { finishUnbind = resolve; }),
  });

  const staleLogout = store.dispatch(logout());
  await waitFor(() => typeof finishUnbind === 'function');
  store.dispatch(replaceSessionToken('token-b', { resetIdentity: true }));
  finishUnbind(true);
  await staleLogout;

  expect(store.getState().auth.token).toBe('token-b');
  expect(localStorage.getItem('token')).toBe('token-b');
  expect(posted).toEqual([]);
  delete global.BroadcastChannel;
});

test('User A teardown completes push cache and private-state cleanup before User B login rebind', async () => {
  localStorage.setItem('token', 'token-a');
  const readyA = {
    ...createInitialState(localStorage), user: { id: 'user-a' }, accountType: 'member',
    capabilities: ['client'], preferredMode: 'client', activeMode: 'client',
    isAuthenticated: true, bootstrapStatus: 'ready',
  };
  const events = [];
  const store = configureStore({
    reducer: { auth: authReducer, ai: aiReducer },
    preloadedState: {
      auth: readyA,
      ai: { messages: [{ text: 'User A private' }], isTyping: false, currentCategory: null, recommendedLawyers: [], isRecording: false },
    },
  });
  const unregister = registerPrivateCacheClearer(() => events.push('private-state-cleared'));
  configureSessionRuntime({
    getSnapshot: () => store.getState().auth,
    unbindPush: async (owner) => { events.push(`push-unbound:${owner.userId}`); },
    purgeCaches: async () => { events.push('caches-purged'); },
    rebindPush: async (owner) => { events.push(`push-rebound:${owner.userId}`); return true; },
  });

  await store.dispatch(logout({ broadcast: false }));
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'user-b' }, accountType: 'member', capabilities: ['client'], preferredMode: 'client',
  } });
  await store.dispatch(establishSession({ token: 'token-b' }));

  expect(events[0]).toBe('push-unbound:user-a');
  expect(events.indexOf('private-state-cleared')).toBeGreaterThan(0);
  expect(events.indexOf('caches-purged')).toBeGreaterThan(events.indexOf('private-state-cleared'));
  expect(events[events.length - 1]).toBe('push-rebound:user-b');
  expect(store.getState().auth).toMatchObject({ token: 'token-b', user: { id: 'user-b' }, isAuthenticated: true });
  expect(store.getState().ai.messages).toEqual([]);
  unregister();
});

test('cross-tab mode event is accepted only after server preference confirmation', async () => {
  localStorage.setItem('token', 'token-tabs');
  localStorage.setItem('maslaxatMode', 'client');
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: {
      ...createInitialState(localStorage), user: { id: 'u-tabs', role: 'lawyer' }, accountType: 'member',
      capabilities: ['client', 'lawyerApplicant'], preferredMode: 'client', activeMode: 'client',
      isAuthenticated: true, bootstrapStatus: 'ready',
    } },
  });
  api.get.mockResolvedValueOnce({ data: {
    user: { id: 'u-tabs', role: 'lawyer' }, accountType: 'member',
    capabilities: ['client', 'lawyerApplicant'], preferredMode: 'lawyer',
  } });

  await store.dispatch(synchronizeModeFromStorage('lawyer'));

  expect(store.getState().auth.activeMode).toBe('lawyer');
  expect(localStorage.getItem('maslaxatMode')).toBe('lawyer');
});
