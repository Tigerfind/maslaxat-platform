import { registerSessionSocket } from './sessionRuntime';

export const canUseOperationalCalls = (mode, capabilities = []) => (
  (mode === 'client' && capabilities.includes('client'))
  || (mode === 'lawyer' && capabilities.includes('lawyer'))
);

export const createModeSocket = (
  ioFactory,
  url,
  token,
  mode,
  registerSocket = registerSessionSocket
) => {
  if (!token || !mode) throw new Error('Validated token and mode are required');
  const socket = ioFactory(url, {
    auth: { token, mode },
    transports: ['websocket', 'polling'],
  });
  return { socket, unregister: registerSocket(socket) };
};
