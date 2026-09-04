import { describe, expect, it } from 'vitest';
import { isAuthoritativeUnavailableLawyerError, nextJoinPolicyRefreshDelay } from './consultationRefresh';

describe('consultation refresh policy', () => {
  it('schedules one authoritative refresh at the earliest join rollover', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    const rows = [
      { policy: { reason: 'TOO_EARLY', canJoin: false, joinAvailableAt: '2026-09-04T10:02:00Z' } },
      { policy: { reason: 'TOO_EARLY', canJoin: false, joinAvailableAt: '2026-09-04T10:01:00Z' } },
    ];
    expect(nextJoinPolicyRefreshDelay(rows, 0, now)).toBe(60_100);
    expect(nextJoinPolicyRefreshDelay({ policy: { reason: 'TOO_EARLY', canJoin: false, joinAvailableAt: '2026-09-04T09:59:00Z' } }, 0, now)).toBe(100);
  });

  it('does not permanently disable rebooking for transient failures', () => {
    expect(isAuthoritativeUnavailableLawyerError({ response: { status: 503 } })).toBe(false);
    expect(isAuthoritativeUnavailableLawyerError({ code: 'ERR_NETWORK' })).toBe(false);
    expect(isAuthoritativeUnavailableLawyerError({ response: { status: 404 } })).toBe(true);
  });
});
