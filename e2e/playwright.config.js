const { defineConfig, devices } = require('@playwright/test');

const frontendUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const lifecycleDisabled = process.env.E2E_DISABLE_LIFECYCLE === '1';
const mediaPermissions = ['camera', 'microphone'];
const chromiumMedia = {
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
};
const firefoxMedia = {
  firefoxUserPrefs: {
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
  },
};

module.exports = defineConfig({
  testDir: './tests',
  testIgnore: '**/unit/**',
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'artifacts/results',
  globalSetup: lifecycleDisabled ? undefined : require.resolve('./global-setup'),
  globalTeardown: lifecycleDisabled ? undefined : require.resolve('./global-teardown'),
  use: {
    baseURL: frontendUrl,
    permissions: mediaPermissions,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], permissions: mediaPermissions, launchOptions: chromiumMedia } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], permissions: mediaPermissions, launchOptions: firefoxMedia } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], permissions: mediaPermissions } },
    { name: 'pixel', use: { ...devices['Pixel 7'], permissions: mediaPermissions, launchOptions: chromiumMedia } },
    { name: 'iphone', use: { ...devices['iPhone 15'], permissions: mediaPermissions } },
  ],
});
