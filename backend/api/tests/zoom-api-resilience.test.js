process.env.ZOOM_API_MAX_RETRIES = '1';
process.env.ZOOM_API_TIMEOUT_MS = '3000';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

const zoomApi = require('../src/services/zoomApiService');
const secretBox = require('../src/services/secretBox');
const { resetDb, models, makeLawyer } = require('./helpers');

const originalFetch = global.fetch;
beforeEach(async () => { await resetDb(); global.fetch = jest.fn(); });
afterAll(() => { global.fetch = originalFetch; });

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  json: async () => body,
});

async function connection() {
  const { user } = await makeLawyer(`zoom-api-${Date.now()}@test.uz`);
  return models.ZoomConnection.create({
    userId: user.id, zoomUserId: `z-${user.id}`,
    accessTokenEncrypted: secretBox.encrypt('access', `zoom:${user.id}:access`),
    refreshTokenEncrypted: secretBox.encrypt('refresh', `zoom:${user.id}:refresh`),
    tokenExpiresAt: new Date(Date.now() + 3600000), status: 'connected',
  });
}

test('GET повторяется после 429 с Retry-After', async () => {
  const current = await connection();
  global.fetch.mockResolvedValueOnce(response(429, {}, { 'retry-after': '0.001' })).mockResolvedValueOnce(response(200, { id: 1 }));
  await expect(zoomApi.api(current, '/meetings/1')).resolves.toEqual({ id: 1 });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('401 обновляет OAuth token один раз и повторяет запрос', async () => {
  const current = await connection();
  global.fetch
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(response(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }))
    .mockResolvedValueOnce(response(200, { id: 2 }));
  await expect(zoomApi.api(current, '/meetings/2')).resolves.toEqual({ id: 2 });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('POST создания не повторяется после 500', async () => {
  const current = await connection();
  global.fetch.mockResolvedValue(response(500));
  await expect(zoomApi.api(current, '/users/me/meetings', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'ZOOM_UPSTREAM_ERROR' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('timeout классифицируется как временная безопасная ошибка', async () => {
  const current = await connection();
  global.fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await expect(zoomApi.api(current, '/meetings/3')).rejects.toMatchObject({ code: 'ZOOM_TIMEOUT', retryable: true });
});
