const crypto = require('crypto');

const OTP_PREFIX = 'otp:v1:';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const secret = () => {
  const value = process.env.EMAIL_OTP_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('EMAIL_OTP_SECRET or JWT_SECRET is required');
  return value;
};

const digestCode = (userId, email, code) => crypto
  .createHmac('sha256', secret())
  .update(`${userId}\0${String(email).trim().toLowerCase()}\0${code}`)
  .digest('hex');

const createVerificationCode = (userId, email, now = new Date()) => {
  const code = String(crypto.randomInt(100000, 1000000));
  return {
    code,
    verificationToken: `${OTP_PREFIX}${digestCode(userId, email, code)}`,
    verificationTokenExpiry: new Date(now.getTime() + OTP_TTL_MS),
    verificationAttempts: 0,
    verificationSentAt: now,
  };
};

const matchesVerificationCode = (user, code) => {
  if (!/^\d{6}$/.test(code) || !user.verificationToken?.startsWith(OTP_PREFIX)) return false;
  const actual = Buffer.from(user.verificationToken.slice(OTP_PREFIX.length), 'hex');
  const expected = Buffer.from(digestCode(user.id, user.email, code), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  createVerificationCode,
  matchesVerificationCode,
};
