const fs = require('node:fs');
const path = require('node:path');

const SPEC_FILES = ['auth-modes.spec.js', 'linkedin-import.spec.js', 'promotion.spec.js', 'consultation-call.spec.js', 'security-access.spec.js'];
const PROJECTS = ['chromium', 'firefox', 'webkit', 'pixel', 'iphone'];

function inspectSpecSource(file, source) {
  if (/\btest\.(?:skip|fixme|only)\s*\(/.test(source)) throw new Error(`${file} contains a forbidden skip/fixme/only`);
  if (/\bwaitForTimeout\s*\(|\bsleep\s*\(/.test(source)) throw new Error(`${file} contains a forbidden fixed sleep`);
  if (/\bdescribe\.serial\s*\(|describe\.configure\s*\(\s*\{[^}]*mode\s*:\s*['"]serial/.test(source)) {
    throw new Error(`${file} contains a forbidden order dependency`);
  }
  if (/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(source)) throw new Error(`${file} contains an external URL`);
  if (/(PAYME_KEY|ANTHROPIC_API_KEY|SMTP_PASS|R2_SECRET_ACCESS_KEY)\s*[:=]\s*['"][^'"]+/.test(source)) throw new Error(`${file} contains a provider secret`);
}

function checkHarness(root = path.resolve(__dirname, '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (manifest.devDependencies['@playwright/test'] !== '1.62.1' || lock.packages['node_modules/@playwright/test'].version !== '1.62.1') {
    throw new Error('Playwright must remain pinned exactly to 1.62.1');
  }
  process.env.E2E_DISABLE_LIFECYCLE = '1';
  const config = require(path.join(root, 'playwright.config'));
  const names = config.projects.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(PROJECTS)) throw new Error('Playwright project matrix is incomplete');
  for (const file of SPEC_FILES) {
    const source = fs.readFileSync(path.join(root, 'tests', file), 'utf8');
    inspectSpecSource(file, source);
  }
  return { filesChecked: SPEC_FILES.length, projectsChecked: PROJECTS.length };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(checkHarness())}\n`);
module.exports = { checkHarness, inspectSpecSource };
