const { validateImageReference } = require('../../../deployment/scripts/validate-image-reference');

test.each([
  'ghcr.io/emaslaxat/backup-tools@sha256:' + 'a'.repeat(64),
  'postgres@sha256:' + 'b'.repeat(64),
  'redis@sha256:' + 'c'.repeat(64),
])('accepts exact digest image reference %s', (value) => {
  expect(validateImageReference(value)).toBe(value);
});

test.each([
  'postgres:16.4', 'redis:7.4.0', 'ghcr.io/emaslaxat/backup-tools:latest',
  'postgres@sha256:abc', 'postgres@sha256:' + 'g'.repeat(64),
])('rejects mutable or malformed image reference %s', (value) => {
  expect(() => validateImageReference(value)).toThrow('digest-pinned');
});
