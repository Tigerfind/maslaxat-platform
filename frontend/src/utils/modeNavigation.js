const canUsePerspective = ({ activeMode, capabilities = [] }) => (
  (activeMode === 'client' && capabilities.includes('client'))
  || (activeMode === 'lawyer' && capabilities.includes('lawyer'))
);

export const helpPrimaryDestination = (auth) => {
  if (auth.activeMode === 'client' && auth.capabilities?.includes('client')) {
    return { path: '/ai-chat', kind: 'ai' };
  }
  if (auth.activeMode === 'lawyer' && auth.capabilities?.includes('lawyer')) {
    return { path: '/lawyer/consultations', kind: 'consultations' };
  }
  if (auth.activeMode === 'lawyer' && auth.capabilities?.includes('lawyerApplicant')) {
    return { path: '/lawyer/onboarding', kind: 'onboarding' };
  }
  return null;
};

export const notificationDestination = (notification, auth) => {
  const metadata = notification?.metadata || {};
  if (notification?.type === 'verification_request') {
    return auth.activeMode === 'admin' && auth.capabilities?.includes('admin') ? '/admin/lawyers' : null;
  }
  if (notification?.type === 'verification') {
    return auth.activeMode === 'lawyer' && (auth.capabilities?.includes('lawyerApplicant') || auth.capabilities?.includes('lawyer'))
      ? '/lawyer/profile/edit'
      : null;
  }
  if (metadata.consultationId) {
    if (!canUsePerspective(auth)) {
      return auth.activeMode === 'lawyer' && auth.capabilities?.includes('lawyerApplicant')
        ? '/lawyer/onboarding'
        : null;
    }
    if (notification?.type === 'case_document') return `/consultations/chat/${metadata.consultationId}`;
    if (metadata.missedCall) return `/consultations/video/${metadata.consultationId}`;
    return auth.activeMode === 'lawyer' ? '/lawyer/consultations' : '/consultations';
  }
  return null;
};
