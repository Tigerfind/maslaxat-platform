import { isAuthBootstrapPending, shouldMountOperationalCallSocket } from './appSession';

test('retained token blocks private UI until hydration completes', () => {
  expect(isAuthBootstrapPending({ token: 'token', bootstrapStatus: 'pending' })).toBe(true);
  expect(isAuthBootstrapPending({ token: 'token', bootstrapStatus: 'ready' })).toBe(false);
});

test('applicant lawyer mode suppresses operational call socket', () => {
  expect(shouldMountOperationalCallSocket({ isAuthenticated: true, activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant'] })).toBe(false);
  expect(shouldMountOperationalCallSocket({ isAuthenticated: true, activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant', 'lawyer'] })).toBe(true);
  expect(shouldMountOperationalCallSocket({ isAuthenticated: true, activeMode: 'client', capabilities: ['client'] })).toBe(true);
});
