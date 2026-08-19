import {
  helpPrimaryDestination,
  notificationDestination,
} from './modeNavigation';

test('consultation notifications route by active perspective', () => {
  const notification = { type: 'consultation_accepted', metadata: { consultationId: 'c1' } };
  expect(notificationDestination(notification, { activeMode: 'client', capabilities: ['client'] })).toBe('/consultations');
  expect(notificationDestination(notification, { activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant', 'lawyer'] })).toBe('/lawyer/consultations');
  expect(notificationDestination(notification, { activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant'] })).toBe('/lawyer/onboarding');
});

test('missed call never routes an applicant into operational video', () => {
  const notification = { type: 'consultation_started', metadata: { consultationId: 'c2', missedCall: true } };
  expect(notificationDestination(notification, { activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant'] })).toBe('/lawyer/onboarding');
  expect(notificationDestination(notification, { activeMode: 'client', capabilities: ['client'] })).toBe('/consultations/video/c2');
});

test('help exposes AI only in client mode and routes lawyer actions to lawyer consultations', () => {
  expect(helpPrimaryDestination({ activeMode: 'client', capabilities: ['client'] })).toEqual({ path: '/ai-chat', kind: 'ai' });
  expect(helpPrimaryDestination({ activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant', 'lawyer'] })).toEqual({ path: '/lawyer/consultations', kind: 'consultations' });
  expect(helpPrimaryDestination({ activeMode: 'lawyer', capabilities: ['client', 'lawyerApplicant'] })).toEqual({ path: '/lawyer/onboarding', kind: 'onboarding' });
  expect(helpPrimaryDestination({ activeMode: 'admin', capabilities: ['admin'] })).toBeNull();
});
