import { canUseOperationalCalls } from './services/modeSocket';

export const isAuthBootstrapPending = ({ token, bootstrapStatus }) => (
  Boolean(token) && bootstrapStatus === 'pending'
);

export const shouldMountOperationalCallSocket = (auth) => (
  auth.isAuthenticated && canUseOperationalCalls(auth.activeMode, auth.capabilities)
);
