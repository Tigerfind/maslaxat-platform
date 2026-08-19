const { resetDb, models, makeAdmin } = require('./helpers');
const authChallenges = require('../src/services/authChallengeService');

const { AuthChallenge } = models;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(resetDb);

async function challenge(user, nonce, overrides = {}) {
  return AuthChallenge.create({
    userId: user.id,
    nonceHash: nonce.repeat(64).slice(0, 64),
    factorVersion: user.twoFactorVersion,
    passwordState: '0',
    expiresAt: new Date(Date.now() + DAY_MS),
    ...overrides,
  });
}

test('prunes only expired or consumed challenges older than seven days', async () => {
  const admin = await makeAdmin('retention-prune@test.uz');
  const now = Date.now();
  await challenge(admin, 'a', { expiresAt: new Date(now - 8 * DAY_MS) });
  await challenge(admin, 'b', { expiresAt: new Date(now - DAY_MS) });
  await challenge(admin, 'c', { consumedAt: new Date(now - 8 * DAY_MS) });
  await challenge(admin, 'd', { consumedAt: new Date(now - DAY_MS) });
  await challenge(admin, 'e');

  const deleted = await authChallenges.pruneAuthChallenges();
  const retained = await AuthChallenge.findAll({ order: [['nonceHash', 'ASC']] });

  expect(deleted).toBe(2);
  expect(retained.map((row) => row.nonceHash[0])).toEqual(['b', 'd', 'e']);
});

test('cleanup failure is fail-safe and throttled while challenge persistence still succeeds', async () => {
  const admin = await makeAdmin('retention-fail-safe@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const destroy = jest.spyOn(AuthChallenge, 'destroy').mockRejectedValueOnce(new Error('cleanup unavailable'));

  try {
    const first = await authChallenges.issueChallenge(admin.id);
    const second = await authChallenges.issueChallenge(admin.id);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(await AuthChallenge.count({ where: { userId: admin.id } })).toBe(2);
  } finally {
    destroy.mockRestore();
  }
});
