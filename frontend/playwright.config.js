const { defineConfig, devices } = require('@playwright/test');
const os = require('os');
const path = require('path');

const backendDir = path.resolve(__dirname, '../backend/api');
const uploadDir = path.join(os.tmpdir(), 'emaslaxat-e2e-uploads');

const disabledSecrets = {
  DATABASE_URL: '', DB_SSL: '0', ANTHROPIC_API_KEY: '', PAYME_KEY: '', PAYME_MERCHANT_ID: '',
  GOOGLE_CLIENT_ID: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_BOT_USERNAME: '',
  SMS_PROVIDER: '', ESKIZ_EMAIL: '', ESKIZ_PASSWORD: '', PLAYMOBILE_URL: '',
  VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', SOCKET_REDIS: '0', RUN_SEED: '0',
  SENTRY_DSN: '',
};

module.exports = defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node src/scripts/prepareE2E.js && node src/server.js',
      cwd: backendDir,
      url: 'http://127.0.0.1:3101/api/health',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        ...process.env, ...disabledSecrets,
        E2E_ALLOW_DB_RESET: '1', NODE_ENV: 'test', PORT: '3101',
        DB_HOST: '127.0.0.1', DB_PORT: process.env.DB_PORT || '5432', DB_NAME: 'emaslaxat_e2e',
        DB_USER: process.env.E2E_DB_USER || process.env.USER || 'macbook', DB_PASSWORD: process.env.E2E_DB_PASSWORD || '',
        JWT_SECRET: 'playwright-e2e-local-secret', CORS_ORIGINS: 'http://127.0.0.1:3100',
        FRONTEND_URL: 'http://127.0.0.1:3100', UPLOAD_DIR: uploadDir,
        REDIS_URL: 'redis://127.0.0.1:1', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1',
      },
    },
    {
      command: 'npm run build:prod && npx serve -s build -l 3100',
      cwd: __dirname,
      url: 'http://127.0.0.1:3100',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        ...process.env, CI: 'true',
        REACT_APP_API_URL: 'http://127.0.0.1:3101/api', REACT_APP_SENTRY_DSN: '',
      },
    },
  ],
});
