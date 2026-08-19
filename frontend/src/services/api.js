import axios from 'axios';
import { sessionRuntime } from './sessionRuntime';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
const AUTH_ENDPOINT = /\/auth\/(login|register|forgot-password|reset-password|verify-email)/;
const AUTH_PAGE = /\/(login|register|forgot-password|reset-password|verify-email)/;
const SAFE_METHODS = new Set(['get', 'head']);

const errorCode = (error) => error.response?.data?.code || error.response?.data?.error?.code;

const staleResponseError = () => {
  const error = new Error('STALE_SESSION_RESPONSE');
  error.code = 'ERR_CANCELED';
  return error;
};

export const getApprovedMode = () => sessionRuntime.getSnapshot().activeMode || null;

export const attachInterceptors = (client, runtime = sessionRuntime) => {
  client.interceptors.request.use((config) => {
    const snapshot = runtime.getSnapshot();
    const headers = config.headers || {};
    if (snapshot.token) headers.Authorization = `Bearer ${snapshot.token}`;
    const explicitMode = config.modeOverride || headers['X-Maslaxat-Mode'];
    const mode = explicitMode || (!config.skipModeHeader ? snapshot.activeMode : null);
    if (mode) headers['X-Maslaxat-Mode'] = mode;
    else delete headers['X-Maslaxat-Mode'];
    config.headers = headers;

    const request = runtime.beginRequest?.(config.signal);
    if (request) {
      config.__sessionEpoch = request.epoch;
      config.__releaseSessionRequest = request.release;
      if (!config.signal) config.signal = request.signal;
    } else {
      config.__sessionEpoch = runtime.getEpoch();
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      response.config?.__releaseSessionRequest?.();
      if (response.config?.__sessionEpoch !== runtime.getEpoch()) {
        return Promise.reject(staleResponseError());
      }
      return response;
    },
    async (error) => {
      const config = error.config || {};
      config.__releaseSessionRequest?.();
      if (config.__sessionEpoch !== runtime.getEpoch()) {
        return Promise.reject(staleResponseError());
      }
      const status = error.response?.status;
      const code = errorCode(error);
      const method = String(config.method || 'get').toLowerCase();

      if (code === 'MODE_REQUIRED' && SAFE_METHODS.has(method) && !config.__modeRetried) {
        const mode = runtime.chooseMode();
        if (mode) {
          config.__modeRetried = true;
          config.skipModeHeader = false;
          config.headers = { ...(config.headers || {}), 'X-Maslaxat-Mode': mode };
          return client(config);
        }
      }

      if (['MODE_FORBIDDEN', 'AUTH_CAPABILITY_MISMATCH'].includes(code) && !config.skipModeReconcile) {
        try { await runtime.reconcile(); } catch (reconcileError) { /* preserve original error */ }
      }

      const url = config.url || '';
      if (status === 401 && !AUTH_ENDPOINT.test(url) && !config.skipSessionRevocation) {
        await runtime.onUnauthorized();
        if (typeof window !== 'undefined' && !AUTH_PAGE.test(window.location.pathname)) {
          window.history.replaceState(null, '', '/login');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }
      return Promise.reject(error);
    }
  );
  return client;
};

const api = attachInterceptors(axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
}));

export default api;
