const { ZoomConnection } = require('../models');
const secretBox = require('./secretBox');

const TIMEOUT_MS = Math.max(3000, Number(process.env.ZOOM_API_TIMEOUT_MS) || 10000);
const MAX_RETRIES = Math.min(5, Math.max(0, Number(process.env.ZOOM_API_MAX_RETRIES) || 3));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ZoomApiError extends Error {
  constructor(message, { status, code, retryable = false, retryAfterMs, requestId } = {}) {
    super(message);
    this.name = 'ZoomApiError';
    this.status = status;
    this.code = code || 'ZOOM_API_ERROR';
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.requestId = requestId;
  }
}

const configured = (value, minLength = 16) => Boolean(value && !String(value).includes('CHANGE_ME') && String(value).length >= minLength);
const enabled = () => {
  if (!configured(process.env.ZOOM_CLIENT_ID) || !configured(process.env.ZOOM_CLIENT_SECRET) || !secretBox.isConfigured()) return false;
  try { return new URL(process.env.ZOOM_REDIRECT_URI).protocol === 'https:' || process.env.NODE_ENV !== 'production'; }
  catch { return false; }
};

async function rawRequest(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new ZoomApiError('Zoom временно не отвечает', { code: 'ZOOM_TIMEOUT', retryable: true });
    throw new ZoomApiError('Не удалось связаться с Zoom', { code: 'ZOOM_NETWORK_ERROR', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  throw new ZoomApiError(
    response.status === 429 ? 'Zoom ограничил частоту запросов' : response.status >= 500 ? 'Zoom временно недоступен' : 'Zoom отклонил запрос',
    {
      status: response.status,
      code: response.status === 401 ? 'ZOOM_UNAUTHORIZED' : response.status === 429 ? 'ZOOM_RATE_LIMITED' : response.status >= 500 ? 'ZOOM_UPSTREAM_ERROR' : 'ZOOM_REQUEST_REJECTED',
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      requestId: response.headers?.get?.('x-zm-trackingid') || response.headers?.get?.('x-zm-request-id') || null,
    },
  );
}

async function withRetry(operation, { retries = MAX_RETRIES } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(attempt); } catch (error) {
      lastError = error;
      if (!error.retryable || attempt >= retries) throw error;
      const delay = error.retryAfterMs || Math.min(30000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function tokenRequest(params) {
  const response = await rawRequest('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  return parseResponse(response);
}

async function revokeToken(token) {
  if (!token) return;
  const response = await rawRequest(`https://zoom.us/oauth/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}` },
  });
  if (response.status !== 404) await parseResponse(response);
}

async function userProfile(accessToken) {
  return parseResponse(await rawRequest('https://api.zoom.us/v2/users/me', { headers: { Authorization: `Bearer ${accessToken}` } }));
}

async function validAccessToken(connection, { forceRefresh = false } = {}) {
  return ZoomConnection.sequelize.transaction(async (transaction) => {
    const current = await ZoomConnection.findByPk(connection.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!current || !['connected', 'disconnecting'].includes(current.status)) throw new ZoomApiError('Требуется повторное подключение Zoom', { code: 'ZOOM_REAUTH_REQUIRED' });
    if (!forceRefresh && new Date(current.tokenExpiresAt).getTime() > Date.now() + 5 * 60 * 1000) {
      return secretBox.decrypt(current.accessTokenEncrypted, `zoom:${current.userId}:access`);
    }
    const refreshToken = secretBox.decrypt(current.refreshTokenEncrypted, `zoom:${current.userId}:refresh`);
    try {
      const tokens = await withRetry(() => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }), { retries: 2 });
      await current.update({
        accessTokenEncrypted: secretBox.encrypt(tokens.access_token, `zoom:${current.userId}:access`),
        refreshTokenEncrypted: secretBox.encrypt(tokens.refresh_token || refreshToken, `zoom:${current.userId}:refresh`),
        tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000), status: 'connected', lastError: null,
      }, { transaction });
      return tokens.access_token;
    } catch (error) {
      if (!error.retryable) await current.update({ status: 'reauth_required', lastError: error.code || 'token_refresh_failed' }, { transaction });
      throw error;
    }
  });
}

async function api(connection, path, options = {}) {
  const method = options.method || 'GET';
  const canRetry = ['GET', 'PATCH', 'DELETE'].includes(method);
  let refreshed = false;
  const perform = async () => {
    const token = await validAccessToken(connection, { forceRefresh: refreshed });
    const response = await rawRequest(`https://api.zoom.us/v2${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (method === 'DELETE' && response.status === 404) return null;
    try { return await parseResponse(response); } catch (error) {
      if (error.status === 401 && !refreshed && canRetry) { refreshed = true; error.retryable = true; }
      else if (!canRetry) error.retryable = false;
      throw error;
    }
  };
  try {
    return await withRetry(perform, { retries: canRetry ? MAX_RETRIES : 0 });
  } catch (error) {
    if (!canRetry && error.status === 401 && !refreshed) {
      refreshed = true;
      return perform();
    }
    throw error;
  }
}

async function getZak(connection) {
  const data = await api(connection, `/users/${encodeURIComponent(connection.zoomUserId)}/token?type=zak`);
  if (!data?.token) throw new ZoomApiError('Zoom не выдал разрешение ведущего', { code: 'ZOOM_ZAK_UNAVAILABLE' });
  return data.token;
}

module.exports = { enabled, tokenRequest, revokeToken, userProfile, api, validAccessToken, getZak, ZoomApiError, TIMEOUT_MS, MAX_RETRIES };
