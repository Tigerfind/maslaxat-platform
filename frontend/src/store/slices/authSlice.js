import { createSlice } from '@reduxjs/toolkit';
import api from '../../services/api';
import {
  cleanupSession,
  getSessionEpoch,
  publishSessionEvent,
  rotateSessionEpoch,
  sessionRuntime,
} from '../../services/sessionRuntime';

const AUTH_STORAGE_KEYS = ['token', 'role', 'user', 'maslaxatMode'];
const browserStorage = () => (typeof window !== 'undefined' ? window.localStorage : null);

export const createInitialState = (storage = browserStorage()) => {
  let token = null;
  try {
    token = storage?.getItem('token') || null;
    // Legacy builds persisted an untrusted role/user snapshot. Current sessions hydrate
    // identity only from /auth/me, so migrate by retaining only the token.
    storage?.removeItem('role');
    storage?.removeItem('user');
  } catch (error) {
    token = null;
  }
  return {
    user: null,
    token,
    role: null,
    accountType: null,
    capabilities: [],
    preferredMode: null,
    activeMode: null,
    sessionEpoch: getSessionEpoch(),
    isAuthenticated: false,
    bootstrapStatus: token ? 'pending' : 'anonymous',
    loading: false,
    switchingMode: false,
    modeUnavailable: null,
    error: null,
  };
};

const isModeAllowed = (mode, capabilities = [], accountType) => {
  if (mode === 'admin') return accountType === 'admin' && capabilities.includes('admin');
  if (accountType !== 'member') return false;
  if (mode === 'client') return capabilities.includes('client');
  if (mode === 'lawyer') return capabilities.includes('lawyerApplicant') || capabilities.includes('lawyer');
  return false;
};

export const resolveServerMode = (payload = {}, requestedMode) => {
  const user = payload.user || null;
  const accountType = payload.accountType || user?.accountType || null;
  const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : [];
  const preferredMode = payload.preferredMode ?? user?.preferredMode ?? null;
  if (accountType === 'admin') return isModeAllowed('admin', capabilities, accountType) ? 'admin' : null;
  return [requestedMode, preferredMode, 'client', 'lawyer']
    .find((mode) => isModeAllowed(mode, capabilities, accountType)) || null;
};

export const getHomePath = (auth) => {
  if (auth.accountType === 'admin' && auth.capabilities?.includes('admin')) return '/admin/dashboard';
  if (auth.activeMode === 'lawyer') {
    return auth.capabilities?.includes('lawyer') ? '/lawyer/dashboard' : '/lawyer/onboarding';
  }
  return '/dashboard';
};

export const dashboardForMode = (mode, capabilities = []) => {
  if (mode === 'admin') return '/admin/dashboard';
  if (mode === 'lawyer') return capabilities.includes('lawyer') ? '/lawyer/dashboard' : '/lawyer/onboarding';
  return '/dashboard';
};

const normalizeSession = (data, requestedMode) => {
  const payload = data?.data || data || {};
  const user = payload.user || null;
  const accountType = payload.accountType || user?.accountType || null;
  const capabilities = Array.isArray(payload.capabilities) ? [...new Set(payload.capabilities)] : [];
  const preferredMode = payload.preferredMode ?? user?.preferredMode ?? null;
  const activeMode = resolveServerMode({ user, accountType, capabilities, preferredMode }, requestedMode);
  return { user, accountType, capabilities, preferredMode, activeMode };
};

const sameCapabilities = (left = [], right = []) => (
  [...left].sort().join('|') === [...right].sort().join('|')
);

const sessionBoundaryChanged = (current, incoming) => (
  current.user?.id !== incoming.user?.id
  || current.accountType !== incoming.accountType
  || current.activeMode !== incoming.activeMode
  || current.preferredMode !== incoming.preferredMode
  || !sameCapabilities(current.capabilities, incoming.capabilities)
);

const serverStrictlyConfirmsMode = (data, mode) => {
  const payload = data?.data || data || {};
  const accountType = payload.accountType || payload.user?.accountType || null;
  return payload.preferredMode === mode
    && Array.isArray(payload.capabilities)
    && isModeAllowed(mode, payload.capabilities, accountType);
};

const authSlice = createSlice({
  name: 'auth',
  initialState: createInitialState(),
  reducers: {
    loginStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    loginSuccess: (state, action) => {
      state.loading = false;
      state.token = action.payload.token;
      state.user = null;
      state.role = null;
      state.accountType = null;
      state.capabilities = [];
      state.preferredMode = null;
      state.activeMode = null;
      state.isAuthenticated = false;
      state.bootstrapStatus = 'pending';
      state.error = null;
    },
    loginFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },
    bootstrapStarted: (state) => {
      state.bootstrapStatus = 'pending';
      state.error = null;
    },
    sessionReceived: (state, action) => {
      Object.assign(state, action.payload);
      state.role = action.payload.user?.role || null;
      state.isAuthenticated = Boolean(action.payload.user && action.payload.activeMode);
      state.bootstrapStatus = state.isAuthenticated ? 'ready' : 'failed';
      state.loading = false;
      state.switchingMode = false;
      state.modeUnavailable = null;
      state.error = state.isAuthenticated ? null : 'SESSION_CAPABILITIES_UNAVAILABLE';
    },
    bootstrapFailed: (state, action) => {
      state.bootstrapStatus = 'failed';
      state.isAuthenticated = false;
      state.loading = false;
      state.error = action.payload || 'SESSION_BOOTSTRAP_FAILED';
    },
    bootstrapRecovered: (state, action) => {
      state.bootstrapStatus = 'ready';
      state.loading = false;
      state.error = action.payload || null;
    },
    sessionRevoked: (state, action) => ({
      ...createInitialState(null),
      sessionEpoch: action.payload.sessionEpoch,
      bootstrapStatus: 'revoked',
      error: action.payload.code,
    }),
    sessionCleared: () => createInitialState(null),
    modeSwitchStarted: (state) => {
      state.switchingMode = true;
      state.modeUnavailable = null;
    },
    modeSwitchFailed: (state, action) => {
      state.switchingMode = false;
      state.modeUnavailable = action.payload || 'Выбранный режим недоступен';
    },
    sessionBoundaryRotated: (state, action) => {
      state.sessionEpoch = action.payload;
    },
    tokenReplaced: (state, action) => {
      state.token = action.payload.token;
      state.sessionEpoch = action.payload.sessionEpoch;
      if (action.payload.resetIdentity) {
        state.user = null;
        state.role = null;
        state.accountType = null;
        state.capabilities = [];
        state.preferredMode = null;
        state.activeMode = null;
        state.isAuthenticated = false;
        state.bootstrapStatus = 'pending';
        state.modeUnavailable = null;
        state.error = null;
      }
    },
    updateProfile: (state, action) => {
      state.user = state.user ? { ...state.user, ...action.payload } : null;
    },
    clearError: (state) => {
      state.error = null;
      state.modeUnavailable = null;
    },
  },
});

export const {
  loginStart,
  loginSuccess,
  loginFailure,
  bootstrapStarted,
  sessionReceived,
  bootstrapFailed,
  bootstrapRecovered,
  sessionRevoked,
  sessionCleared,
  modeSwitchStarted,
  modeSwitchFailed,
  sessionBoundaryRotated,
  tokenReplaced,
  updateProfile,
  clearError,
} = authSlice.actions;

const staleSessionOperation = () => {
  const error = new Error('STALE_SESSION_OPERATION');
  error.code = 'STALE_SESSION_OPERATION';
  return error;
};

const noAvailableMode = () => {
  const error = new Error('NO_AVAILABLE_MODE');
  error.code = 'NO_AVAILABLE_MODE';
  return error;
};

const assertCurrentSession = (expectedEpoch, expectedToken, getState) => {
  if (getSessionEpoch() !== expectedEpoch || getState().auth.token !== expectedToken) {
    throw staleSessionOperation();
  }
};

const rotatePrivateSession = (dispatch) => {
  const epoch = rotateSessionEpoch();
  dispatch(sessionBoundaryRotated(epoch));
  return epoch;
};

const captureAuthOwner = (getState) => {
  const auth = getState().auth;
  return { token: auth.token, userId: auth.user?.id || null, epoch: getSessionEpoch() };
};

const authOwnerMatches = (owner, expectedEpoch, getState) => (
  getState().auth.token === owner.token && getSessionEpoch() === expectedEpoch
);

const revokeSession = async (dispatch, getState, code) => {
  const owner = captureAuthOwner(getState);
  const cleanup = await cleanupSession(owner, () => authOwnerMatches(owner, owner.epoch, getState));
  if (!cleanup.owned || !authOwnerMatches(owner, cleanup.epoch, getState)) return false;
  const sessionEpoch = cleanup.epoch;
  const storage = browserStorage();
  AUTH_STORAGE_KEYS.forEach((key) => storage?.removeItem(key));
  dispatch(sessionRevoked({ code, sessionEpoch }));
  publishSessionEvent('logout');
  return true;
};

const persistValidatedSession = (session, storage = browserStorage()) => {
  if (!storage) return;
  storage.setItem('maslaxatMode', session.activeMode);
  storage.removeItem('role');
  storage.removeItem('user');
};

const commitAuthoritativeSession = (session, dispatch, getState) => {
  if (sessionBoundaryChanged(getState().auth, session)) rotatePrivateSession(dispatch);
  persistValidatedSession(session);
  dispatch(sessionReceived(session));
  return session;
};

export const hydrateSession = (options = {}) => async (dispatch, getState) => {
  const token = getState().auth.token || browserStorage()?.getItem('token');
  if (!token) {
    dispatch(sessionCleared());
    return null;
  }
  const hadValidatedSession = Boolean(getState().auth.isAuthenticated && getState().auth.activeMode);
  const expectedEpoch = getSessionEpoch();
  dispatch(bootstrapStarted());
  try {
    const response = await api.get('/auth/me', {
      skipModeHeader: true,
      skipModeReconcile: true,
    });
    assertCurrentSession(expectedEpoch, token, getState);
    const session = normalizeSession(response.data, options.requestedMode);
    if (!session.user || !session.activeMode) {
      const revocation = noAvailableMode();
      await revokeSession(dispatch, getState, revocation.code);
      throw revocation;
    }
    const committed = commitAuthoritativeSession(session, dispatch, getState);
    const owner = captureAuthOwner(getState);
    await sessionRuntime.rebindPush(owner, () => authOwnerMatches(owner, owner.epoch, getState));
    return committed;
  } catch (error) {
    if (error.code === 'NO_AVAILABLE_MODE') throw error;
    if (error.code === 'STALE_SESSION_OPERATION' || getSessionEpoch() !== expectedEpoch || getState().auth.token !== token) {
      throw error.code === 'STALE_SESSION_OPERATION' ? error : staleSessionOperation();
    }
    if (error.response?.status !== 401) {
      if (hadValidatedSession) dispatch(bootstrapRecovered(error.message));
      else dispatch(bootstrapFailed(error.message));
    }
    throw error;
  }
};

export const establishSession = (payload) => async (dispatch) => {
  dispatch(replaceSessionToken(payload.token, { resetIdentity: true }));
  return dispatch(hydrateSession());
};

export const logout = ({ broadcast = true } = {}) => async (dispatch, getState) => {
  const owner = captureAuthOwner(getState);
  const cleanup = await cleanupSession(owner, () => authOwnerMatches(owner, owner.epoch, getState));
  if (!cleanup.owned || !authOwnerMatches(owner, cleanup.epoch, getState)) return false;
  const storage = browserStorage();
  AUTH_STORAGE_KEYS.forEach((key) => storage?.removeItem(key));
  dispatch(sessionCleared());
  if (broadcast) publishSessionEvent('logout');
  return true;
};

export const replaceSessionToken = (token, options = {}) => (dispatch) => {
  const sessionEpoch = rotateSessionEpoch();
  browserStorage()?.setItem('token', token);
  dispatch(tokenReplaced({ token, sessionEpoch, resetIdentity: Boolean(options.resetIdentity) }));
};

export const synchronizeTokenFromStorage = (token) => async (dispatch, getState) => {
  if (!token) {
    await dispatch(logout({ broadcast: false }));
    return null;
  }
  const owner = captureAuthOwner(getState);
  const cleanup = await cleanupSession(owner, () => authOwnerMatches(owner, owner.epoch, getState));
  if (!cleanup.owned || !authOwnerMatches(owner, cleanup.epoch, getState)) return null;
  dispatch(replaceSessionToken(token, { resetIdentity: true }));
  return dispatch(hydrateSession());
};

const probeForMode = (targetMode, capabilities) => {
  if (targetMode === 'client') return '/client/dashboard/stats';
  if (targetMode === 'lawyer' && capabilities.includes('lawyer')) return '/lawyer/dashboard/stats';
  if (targetMode === 'lawyer') return '/lawyer/profile';
  return null;
};

let modeSwitchQueue = Promise.resolve();

export const switchMode = (targetMode) => (dispatch, getState) => {
  const operation = modeSwitchQueue.then(async () => {
    const previous = getState().auth;
    const expectedEpoch = getSessionEpoch();
    const expectedToken = previous.token;
    if (!isModeAllowed(targetMode, previous.capabilities, previous.accountType)) {
      dispatch(modeSwitchFailed('Этот режим недоступен для текущего аккаунта'));
      throw new Error('MODE_UNAVAILABLE');
    }
    if (targetMode === previous.activeMode) return previous;
    dispatch(modeSwitchStarted());
    let targetPersisted = false;
    try {
      await api.put('/users/profile', { preferredMode: targetMode }, {
        modeOverride: targetMode,
        skipModeReconcile: true,
      });
      assertCurrentSession(expectedEpoch, expectedToken, getState);
      targetPersisted = true;
      const response = await api.get('/auth/me', {
        modeOverride: targetMode,
        skipModeReconcile: true,
      });
      assertCurrentSession(expectedEpoch, expectedToken, getState);
      const session = normalizeSession(response.data, targetMode);
      if (session.preferredMode !== targetMode || session.activeMode !== targetMode) throw new Error('MODE_FORBIDDEN');
      const probe = probeForMode(targetMode, session.capabilities);
      if (probe) {
        await api.get(probe, { modeOverride: targetMode, skipModeReconcile: true });
        assertCurrentSession(expectedEpoch, expectedToken, getState);
      }
      return commitAuthoritativeSession(session, dispatch, getState);
    } catch (error) {
      if (error.code === 'STALE_SESSION_OPERATION'
        || getSessionEpoch() !== expectedEpoch
        || getState().auth.token !== expectedToken) {
        throw error.code === 'STALE_SESSION_OPERATION' ? error : staleSessionOperation();
      }

      let rollbackConfirmed = false;
      let authoritativeSession = null;
      if (targetPersisted) {
        try {
          await api.put('/users/profile', { preferredMode: previous.activeMode }, {
            modeOverride: previous.activeMode,
            skipModeReconcile: true,
          });
          assertCurrentSession(expectedEpoch, expectedToken, getState);
          const response = await api.get('/auth/me', {
            modeOverride: previous.activeMode,
            skipModeReconcile: true,
          });
          assertCurrentSession(expectedEpoch, expectedToken, getState);
          if (!serverStrictlyConfirmsMode(response.data, previous.activeMode)) {
            const mismatch = new Error('ROLLBACK_NOT_CONFIRMED');
            mismatch.code = 'ROLLBACK_NOT_CONFIRMED';
            throw mismatch;
          }
          const restored = normalizeSession(response.data);
          if (!restored.user || restored.activeMode !== previous.activeMode) {
            const mismatch = new Error('ROLLBACK_NOT_CONFIRMED');
            mismatch.code = 'ROLLBACK_NOT_CONFIRMED';
            throw mismatch;
          }
          commitAuthoritativeSession(restored, dispatch, getState);
          rollbackConfirmed = true;
        } catch (rollbackError) {
          if (rollbackError.code === 'STALE_SESSION_OPERATION'
            || getSessionEpoch() !== expectedEpoch
            || getState().auth.token !== expectedToken) {
            throw rollbackError.code === 'STALE_SESSION_OPERATION' ? rollbackError : staleSessionOperation();
          }
          try {
            const response = await api.get('/auth/me', {
              skipModeHeader: true,
              skipModeReconcile: true,
            });
            assertCurrentSession(expectedEpoch, expectedToken, getState);
            const current = normalizeSession(response.data);
            if (current.user && current.activeMode) {
              commitAuthoritativeSession(current, dispatch, getState);
              authoritativeSession = current;
            }
          } catch (refreshError) {
            if (refreshError.code === 'STALE_SESSION_OPERATION'
              || getSessionEpoch() !== expectedEpoch
              || getState().auth.token !== expectedToken) {
              throw refreshError.code === 'STALE_SESSION_OPERATION' ? refreshError : staleSessionOperation();
            }
          }
        }
      }

      const message = rollbackConfirmed
        ? 'Этот режим недоступен в текущем режиме совместимости. Предыдущий режим восстановлен.'
        : authoritativeSession
          ? 'Переключение применилось на сервере частично: вернуть предыдущий режим не удалось. Показан подтвержденный сервером режим.'
          : targetPersisted
            ? 'Не удалось вернуть или подтвердить режим после частичного переключения. Повторите вход.'
            : 'Этот режим сейчас недоступен. Предыдущий режим не изменен.';
      dispatch(modeSwitchFailed(message));
      throw error;
    }
  });
  modeSwitchQueue = operation.catch(() => undefined);
  return operation;
};

export const synchronizeModeFromStorage = (mode) => async (dispatch, getState) => {
  const auth = getState().auth;
  if (mode === auth.activeMode || !isModeAllowed(mode, auth.capabilities, auth.accountType)) return;
  const expectedEpoch = getSessionEpoch();
  const expectedToken = auth.token;
  try {
    const response = await api.get('/auth/me', { skipModeHeader: true, skipModeReconcile: true });
    assertCurrentSession(expectedEpoch, expectedToken, getState);
    const session = normalizeSession(response.data);
    if (session.preferredMode !== mode || session.activeMode !== mode) return;
    commitAuthoritativeSession(session, dispatch, getState);
  } catch (error) {
    if (error.code === 'STALE_SESSION_OPERATION') throw error;
    // Ignore stale, corrupt, or unauthenticated cross-tab events.
  }
};

export default authSlice.reducer;
