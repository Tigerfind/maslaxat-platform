import { canUseOperationalCalls, createModeSocket } from './modeSocket';
import {
  registerPrivateCacheClearer,
  registerSessionSocket,
  rotateSessionEpoch,
} from './sessionRuntime';

test('socket handshake carries token and validated active mode', () => {
  const socket = { disconnect: jest.fn() };
  const ioFactory = jest.fn(() => socket);
  const unregister = jest.fn();
  const register = jest.fn(() => unregister);
  expect(createModeSocket(ioFactory, 'https://api.test', 'token', 'lawyer', register)).toEqual({ socket, unregister });
  expect(ioFactory).toHaveBeenCalledWith('https://api.test', {
    auth: { token: 'token', mode: 'lawyer' }, transports: ['websocket', 'polling'],
  });
});

test('applicant mode is not operational calling mode', () => {
  expect(canUseOperationalCalls('lawyer', ['client', 'lawyerApplicant'])).toBe(false);
  expect(canUseOperationalCalls('lawyer', ['client', 'lawyerApplicant', 'lawyer'])).toBe(true);
  expect(canUseOperationalCalls('client', ['client'])).toBe(true);
});

test('session revocation disconnects sockets and clears private caches together', () => {
  const socket = { disconnect: jest.fn() };
  const clear = jest.fn();
  registerSessionSocket(socket);
  const unregisterClear = registerPrivateCacheClearer(clear);

  rotateSessionEpoch();

  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledTimes(1);
  unregisterClear();
});
