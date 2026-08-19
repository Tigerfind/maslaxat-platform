const assert = require('node:assert/strict');
const test = require('node:test');

test('static checker accepts the completed isolated harness', () => {
  const { checkHarness } = require('../../scripts/static-check');
  assert.deepEqual(checkHarness(), { filesChecked: 5, projectsChecked: 5 });
});

test('static checker rejects sleeps order dependencies and disabled tests', () => {
  const { inspectSpecSource } = require('../../scripts/static-check');
  assert.throws(() => inspectSpecSource('bad.spec.js', 'test.skip("x", () => {})'), /skip/);
  assert.throws(() => inspectSpecSource('bad.spec.js', 'page.waitForTimeout(1000)'), /sleep/);
  assert.throws(() => inspectSpecSource('bad.spec.js', 'test.describe.serial("ordered", () => {})'), /order dependency/);
});
