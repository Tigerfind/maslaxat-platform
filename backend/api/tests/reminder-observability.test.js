const mockFindAll = jest.fn();
const mockReportCaughtException = jest.fn();

jest.mock('../src/models', () => ({
  Consultation: { findAll: mockFindAll, update: jest.fn() },
  User: {},
}));
jest.mock('../src/services/notificationService', () => ({ notifyConsultationReminder: jest.fn() }));
jest.mock('../src/services/emailService', () => ({ sendMail: jest.fn() }));
jest.mock('../src/config/logger', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../src/instrument', () => ({ reportCaughtException: mockReportCaughtException }));

const { checkUpcomingReminders } = require('../src/services/reminderService');

test('reminder job explicitly reports a swallowed batch failure', async () => {
  const error = new Error('database connection detail');
  mockFindAll.mockRejectedValueOnce(error);

  await expect(checkUpcomingReminders()).resolves.toBe(0);
  expect(mockReportCaughtException).toHaveBeenCalledWith(error, { operation: 'reminder_check' });
});
