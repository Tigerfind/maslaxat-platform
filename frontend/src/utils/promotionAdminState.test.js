import {
  createAdminPromotionReloadTracker,
  parseSponsoredPositions,
  runMutationThenRefresh,
  snapshotCampaignFilters,
} from './promotionAdminState';

test('reports a saved mutation separately when the safe list refresh fails', async () => {
  const events = [];
  const result = await runMutationThenRefresh({
    mutate: async () => events.push('mutated'),
    onSaved: () => events.push('closed-and-success'),
    refresh: async () => { throw new Error('refresh unavailable'); },
  });

  expect(events).toEqual(['mutated', 'closed-and-success']);
  expect(result).toEqual({ saved: true, refreshed: false, refreshError: expect.any(Error) });
});

test('does not report success or refresh when the mutation itself fails', async () => {
  const events = [];

  await expect(runMutationThenRefresh({
    mutate: async () => { throw new Error('mutation rejected'); },
    onSaved: () => events.push('must-not-report-success'),
    refresh: async () => events.push('must-not-refresh'),
  })).rejects.toThrow('mutation rejected');
  expect(events).toEqual([]);
});

test.each([
  ['0,3', [0, 3]],
  [' 19 ', [19]],
])('strictly parses valid sponsored positions %s', (input, expected) => {
  expect(parseSponsoredPositions(input)).toEqual({ ok: true, value: expected });
});

test.each(['', 'a,3', '1.5', '0,0', '0,1,2', '-1', '20', '0,'])('rejects invalid sponsored positions %s', (input) => {
  expect(parseSponsoredPositions(input)).toEqual({ ok: false, value: null });
});

test('applied campaign filters remain unchanged while draft values are edited', () => {
  const draft = { status: 'active', lawyerId: '', specialization: 'Civil law', location: '' };
  const applied = snapshotCampaignFilters(draft);

  draft.status = 'queued';
  draft.specialization = 'Family law';

  expect(applied).toEqual({ status: 'active', specialization: 'Civil law' });
});

test('error retry preserves current package and filtered campaign pages', () => {
  const tracker = createAdminPromotionReloadTracker();
  const applied = { status: 'active', specialization: 'Civil law' };

  tracker.recordPackages(3);
  tracker.recordCampaigns(4, applied);
  applied.status = 'queued';

  expect(tracker.current()).toEqual({
    packagePage: 3,
    campaignPage: 4,
    appliedCampaignFilters: { status: 'active', specialization: 'Civil law' },
  });
});

test('mutation recovery reads the same applied snapshot until another request is recorded', () => {
  const tracker = createAdminPromotionReloadTracker();
  tracker.recordCampaigns(2, { lawyerId: 'lawyer-1', location: 'Tashkent' });

  const firstRecovery = tracker.current();
  const secondRecovery = tracker.current();

  expect(firstRecovery).toEqual(secondRecovery);
  expect(secondRecovery.campaignPage).toBe(2);
  expect(secondRecovery.appliedCampaignFilters).toEqual({ lawyerId: 'lawyer-1', location: 'Tashkent' });
});
