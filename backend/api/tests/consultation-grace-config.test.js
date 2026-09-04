test('join grace is configurable from the shared server constant', () => {
  const previous = process.env.CONSULTATION_GRACE_MINUTES;
  process.env.CONSULTATION_GRACE_MINUTES = '12';
  jest.isolateModules(() => {
    const { GRACE_MINUTES, consultationAccess } = require('../src/services/consultationAccessService');
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T11:00:00.000Z');
    const access = consultationAccess({ status: 'accepted', scheduledStartAt: start, scheduledEndAt: end }, new Date('2026-01-01T11:11:00.000Z'));
    expect(GRACE_MINUTES).toBe(12);
    expect(access.canJoin).toBe(true);
    expect(access.closesAt.toISOString()).toBe('2026-01-01T11:12:00.000Z');
  });
  if (previous === undefined) delete process.env.CONSULTATION_GRACE_MINUTES;
  else process.env.CONSULTATION_GRACE_MINUTES = previous;
});
