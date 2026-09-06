// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import { createSentryBuildConfig } from '../vite.config.mjs';

vi.mock('@sentry/vite-plugin', () => ({
  sentryVitePlugin: vi.fn((options) => ({ name: 'sentry-vite-plugin', options })),
}));

const completeEnv = {
  SENTRY_SOURCE_MAPS_ENABLED: '1',
  SENTRY_AUTH_TOKEN: 'token',
  SENTRY_ORG: 'org',
  SENTRY_FRONTEND_PROJECT: 'frontend',
  RAILWAY_GIT_COMMIT_SHA: 'abc123',
  SENTRY_RELEASE: 'abc123',
  VITE_SENTRY_RELEASE: 'abc123',
};

describe('Vite Sentry source maps', () => {
  test('remain disabled unless explicitly enabled', () => {
    expect(createSentryBuildConfig({})).toEqual({ plugin: null, sourcemap: false });
  });

  test('fail closed when credentials are incomplete', () => {
    expect(() => createSentryBuildConfig({ SENTRY_SOURCE_MAPS_ENABLED: '1' })).toThrow(/Missing Sentry/);
  });

  test('require all release identifiers to match', () => {
    expect(() => createSentryBuildConfig({ ...completeEnv, VITE_SENTRY_RELEASE: 'other' })).toThrow(/match/);
  });

  test('upload hidden source maps and delete them after upload', () => {
    const result = createSentryBuildConfig(completeEnv);
    expect(result.sourcemap).toBe('hidden');
    expect(result.plugin.options.release.name).toBe('abc123');
    expect(result.plugin.options.sourcemaps.filesToDeleteAfterUpload).toBe('./build/**/*.map');
  });
});
