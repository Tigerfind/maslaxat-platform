import { describe, expect, test } from 'vitest';
import { lawyerModerationStatusKey } from './lawyerModeration';

describe('lawyer moderation status labels', () => {
  test.each([
    ['pending_review', 'stPending'],
    ['approved', 'stApproved'],
    ['rejected', 'stRejected'],
    ['draft', 'stDraft'],
    ['suspended', 'stSuspended'],
    ['unexpected', 'stUnknown'],
  ])('maps %s without treating it as rejected', (status, key) => {
    expect(lawyerModerationStatusKey(status)).toBe(key);
  });
});
