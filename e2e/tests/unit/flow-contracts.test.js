const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const contracts = {
  'auth-modes.spec.js': ['registers and logs in', 'switches client and lawyer modes', 'completes 2FA', 'keeps applicant out of operational pages'],
  'linkedin-import.spec.js': ['uploads a LinkedIn PDF', 'rejects a stale draft', 'shows provenance', 'lets an admin inspect the source'],
  'promotion.spec.js': ['creates one sandbox checkout on retry', 'shows sponsored catalog placement', 'shows campaign analytics', 'requests a provider-confirmed refund'],
  'consultation-call.spec.js': ['sends chat between participants', 'keeps private documents owner-only', 'connects two call contexts with fake media'],
  'security-access.spec.js': ['rejects API IDOR', 'rejects socket IDOR'],
};

test('all required real flow specs expose their critical scenarios', () => {
  for (const [file, titles] of Object.entries(contracts)) {
    const fullPath = path.join(root, file);
    assert.equal(fs.existsSync(fullPath), true, `${file} is required`);
    const source = fs.readFileSync(fullPath, 'utf8');
    for (const title of titles) assert.match(source, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('review hardening scenarios are encoded in executable specs', () => {
  const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(source('promotion.spec.js'), /refundPromotionId/);
  assert.match(source('promotion.spec.js'), /toBe\(202\)/);
  assert.match(source('promotion.spec.js'), /refund_pending/);
  assert.match(source('consultation-call.spec.js'), /participants\.client.*participants\.lawyer/s);
  assert.match(source('consultation-call.spec.js'), /readyState.*live/s);
  assert.match(source('linkedin-import.spec.js'), /acceptedPaths/);
  assert.match(source('linkedin-import.spec.js'), /document_checked/);
  assert.match(source('linkedin-import.spec.js'), /profile-fields\/education\/verify/);
  assert.match(source('security-access.spec.js'), /actors\.importer/);
  assert.match(source('security-access.spec.js'), /actors\.otherLawyer/);
  for (const event of ['join-chat', 'join-room', 'send-message', 'call-user']) {
    assert.match(source('security-access.spec.js'), new RegExp(event));
  }
  assert.match(source('security-access.spec.js'), /afterMessages/);
  assert.match(source('security-access.spec.js'), /\/notifications/);
});
