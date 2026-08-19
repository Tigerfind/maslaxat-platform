const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('package and lock pin the audited Playwright release exactly to 1.62.1', () => {
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.devDependencies['@playwright/test'], '1.62.1');
  assert.equal(lock.packages['node_modules/@playwright/test'].version, '1.62.1');
  assert.equal(lock.packages['node_modules/playwright'].version, '1.62.1');
  assert.equal(lock.packages['node_modules/playwright-core'].version, '1.62.1');
});

test('Playwright success and retry artifacts are ignored by git', () => {
  const repository = path.resolve(__dirname, '../../..');
  for (const artifact of ['e2e/artifacts/results/trace.zip', 'e2e/playwright-report/index.html', 'e2e/test-results/result.webm']) {
    const result = spawnSync('git', ['check-ignore', '-q', artifact], { cwd: repository });
    assert.equal(result.status, 0, `${artifact} must be ignored`);
  }
});

test('configuration exposes the required desktop and mobile projects', () => {
  process.env.E2E_DISABLE_LIFECYCLE = '1';
  const config = require('../../playwright.config');
  assert.deepEqual(config.projects.map(({ name }) => name), [
    'chromium', 'firefox', 'webkit', 'pixel', 'iphone',
  ]);
});

test('desktop browser projects receive deterministic fake media', () => {
  process.env.E2E_DISABLE_LIFECYCLE = '1';
  const config = require('../../playwright.config');
  const chromium = config.projects.find(({ name }) => name === 'chromium');
  assert.equal(chromium.use.permissions.includes('camera'), true);
  assert.equal(chromium.use.permissions.includes('microphone'), true);
  assert.equal(chromium.use.launchOptions.args.includes('--use-fake-device-for-media-stream'), true);
  assert.equal(chromium.use.launchOptions.args.includes('--use-fake-ui-for-media-stream'), true);
  assert.equal(config.use.trace, 'on-first-retry');
  assert.equal(config.use.video, 'retain-on-failure');
  assert.equal(config.use.screenshot, 'only-on-failure');
  assert.deepEqual(config.reporter, [['list']]);
});
