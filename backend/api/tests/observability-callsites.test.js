const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockReportCaughtException = jest.fn();

jest.mock('../src/config/logger', () => mockLogger);
jest.mock('../src/instrument', () => ({ reportCaughtException: mockReportCaughtException }));

describe('provider telemetry call sites', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    Object.keys(mockLogger).forEach((key) => mockLogger[key].mockClear());
    mockReportCaughtException.mockClear();
    process.env = { ...originalEnv };
    delete process.env.SMS_PROVIDER;
    delete process.env.ESKIZ_EMAIL;
    delete process.env.ESKIZ_PASSWORD;
    delete process.env.PLAYMOBILE_URL;
    delete process.env.PLAYMOBILE_LOGIN;
    delete process.env.PLAYMOBILE_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('development SMS logging excludes recipient and message content', async () => {
    const { sendSms } = require('../src/services/smsService');
    await sendSms('+998901234567', 'verification code 123456');

    expect(JSON.stringify(mockLogger.info.mock.calls)).not.toMatch(/998901234567|123456/);
    expect(mockLogger.info).toHaveBeenCalledWith('sms_delivery_skipped', { reason: 'provider_not_configured' });
  });

  test('swallowed SMS provider failure is reported with provider code but no payload', async () => {
    process.env.SMS_PROVIDER = 'playmobile';
    process.env.PLAYMOBILE_URL = 'https://sms.example/send';
    process.env.PLAYMOBILE_LOGIN = 'login';
    process.env.PLAYMOBILE_PASSWORD = 'password';
    const marker = 'SMS_PROVIDER_BODY_MARKER_R8T3';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: jest.fn().mockResolvedValue(marker),
    });
    const { sendSms } = require('../src/services/smsService');

    const result = await sendSms('+998901234567', 'verification code 123456');

    expect(result).toEqual({ sent: false, error: 'provider_error' });
    expect(mockReportCaughtException).toHaveBeenCalledWith(expect.objectContaining({
      name: 'SmsProviderError',
      message: 'SMS provider request failed',
      code: 'SMS_PROVIDER_ERROR',
    }), {
      operation: 'sms_send',
      provider: 'playmobile',
    });
    expect(JSON.stringify(mockReportCaughtException.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toMatch(/998901234567|123456|SMS_PROVIDER_BODY_MARKER_R8T3/);
  });
});
