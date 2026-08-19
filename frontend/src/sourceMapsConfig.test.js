const mockSentryWebpackPlugin = jest.fn(() => ({ name: 'SentryWebpackPlugin' }));

jest.mock('@sentry/webpack-plugin', () => ({ sentryWebpackPlugin: mockSentryWebpackPlugin }), { virtual: true });

const ENV_KEYS = [
  'SENTRY_SOURCE_MAPS_ENABLED',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_FRONTEND_PROJECT',
  'RAILWAY_GIT_COMMIT_SHA',
  'SENTRY_RELEASE',
  'REACT_APP_SENTRY_RELEASE',
];

function baseConfig() {
  return { resolve: { fallback: {} }, plugins: [], module: { rules: [] }, devtool: 'source-map' };
}

function loadOverride() {
  let override;
  jest.isolateModules(() => {
    override = require('../config-overrides');
  });
  return override;
}

beforeEach(() => {
  mockSentryWebpackPlugin.mockClear();
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterAll(() => ENV_KEYS.forEach((key) => delete process.env[key]));

test('disabled source-map uploads emit no source maps and no Sentry plugin', () => {
  const result = loadOverride()(baseConfig());
  expect(result.devtool).toBe(false);
  expect(mockSentryWebpackPlugin).not.toHaveBeenCalled();
});

test('enabled source-map uploads fail the build when any credential is missing', () => {
  process.env.SENTRY_SOURCE_MAPS_ENABLED = '1';
  process.env.SENTRY_AUTH_TOKEN = 'token';
  expect(() => loadOverride()(baseConfig())).toThrow(/SENTRY_ORG/);
});

test('enabled source-map uploads fail when any release value differs', () => {
  Object.assign(process.env, {
    SENTRY_SOURCE_MAPS_ENABLED: '1',
    SENTRY_AUTH_TOKEN: 'token',
    SENTRY_ORG: 'org',
    SENTRY_FRONTEND_PROJECT: 'frontend',
    RAILWAY_GIT_COMMIT_SHA: 'abc123',
    SENTRY_RELEASE: 'abc123',
    REACT_APP_SENTRY_RELEASE: 'different',
  });

  expect(() => loadOverride()(baseConfig())).toThrow(/release.*match/i);
});

test('enabled complete source-map uploads use release and delete maps after upload', () => {
  Object.assign(process.env, {
    SENTRY_SOURCE_MAPS_ENABLED: '1',
    SENTRY_AUTH_TOKEN: 'token',
    SENTRY_ORG: 'org',
    SENTRY_FRONTEND_PROJECT: 'frontend',
    RAILWAY_GIT_COMMIT_SHA: 'abc123',
    SENTRY_RELEASE: 'abc123',
    REACT_APP_SENTRY_RELEASE: 'abc123',
  });

  const result = loadOverride()(baseConfig());
  expect(result.devtool).toBe('source-map');
  expect(mockSentryWebpackPlugin).toHaveBeenCalledWith(expect.objectContaining({
    authToken: 'token',
    org: 'org',
    project: 'frontend',
    release: expect.objectContaining({ name: process.env.REACT_APP_SENTRY_RELEASE }),
    sourcemaps: expect.objectContaining({ filesToDeleteAfterUpload: expect.anything() }),
  }));
});
