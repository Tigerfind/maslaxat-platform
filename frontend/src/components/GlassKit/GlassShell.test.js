import { vi } from 'vitest';
import {
  canShowMemberModeSwitcher,
  MODE_SWITCH_MIN_SIZE,
  navKeysForAuth,
} from './GlassShell';

vi.mock('../../services/api', () => ({ __esModule: true, default: { get: vi.fn(), put: vi.fn() } }));

test('only dual-capability members receive the mode switcher', () => {
  expect(canShowMemberModeSwitcher({ accountType: 'member', capabilities: ['client', 'lawyerApplicant'] })).toBe(true);
  expect(canShowMemberModeSwitcher({ accountType: 'member', capabilities: ['client'] })).toBe(false);
  expect(canShowMemberModeSwitcher({ accountType: 'admin', capabilities: ['admin', 'client', 'lawyer'] })).toBe(false);
});

test('applicant navigation contains only applicant-safe destinations', () => {
  expect(navKeysForAuth({
    accountType: 'member', activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant'],
  })).toEqual([
    '/lawyer/onboarding',
    '/lawyer/profile/edit',
    '/lawyer/imports',
    '/settings#two-factor',
    '/settings',
    '/help',
  ]);
});

test('both mode switch targets meet the minimum touch size', () => {
  expect(MODE_SWITCH_MIN_SIZE).toBeGreaterThanOrEqual(44);
});
