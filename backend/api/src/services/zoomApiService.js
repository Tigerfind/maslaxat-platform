const { ZoomConnection } = require('../models');
const secretBox = require('./secretBox');

const enabled = () => Boolean(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET && process.env.ZOOM_REDIRECT_URI);

async function tokenRequest(params) {
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Zoom token request failed (${response.status})`);
  return data;
}

async function revokeToken(token) {
  if (!token) return;
  const response = await fetch(`https://zoom.us/oauth/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Zoom token revoke failed (${response.status})`);
}

async function validAccessToken(connection) {
  return ZoomConnection.sequelize.transaction(async (transaction) => {
    const current = await ZoomConnection.findByPk(connection.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!current || !['connected', 'disconnecting'].includes(current.status)) throw new Error('Zoom connection requires authorization');
    if (new Date(current.tokenExpiresAt).getTime() > Date.now() + 5 * 60 * 1000) {
      return secretBox.decrypt(current.accessTokenEncrypted, `zoom:${current.userId}:access`);
    }
    const refreshToken = secretBox.decrypt(current.refreshTokenEncrypted, `zoom:${current.userId}:refresh`);
    try {
      const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      await current.update({
        accessTokenEncrypted: secretBox.encrypt(tokens.access_token, `zoom:${current.userId}:access`),
        refreshTokenEncrypted: secretBox.encrypt(tokens.refresh_token || refreshToken, `zoom:${current.userId}:refresh`),
        tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
        status: 'connected',
        lastError: null,
      }, { transaction });
      return tokens.access_token;
    } catch (error) {
      await current.update({ status: 'reauth_required', lastError: 'token_refresh_failed' }, { transaction });
      throw error;
    }
  });
}

async function api(connection, path, options = {}) {
  const token = await validAccessToken(connection);
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Zoom API failed (${response.status})`);
  return data;
}

module.exports = { enabled, tokenRequest, revokeToken, api, validAccessToken };
