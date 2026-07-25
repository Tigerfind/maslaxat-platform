const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const ISSUER = 'MaslaXat';

// Небольшое окно допускает рассинхрон часов ±1 шаг (30с)
authenticator.options = { window: 1 };

function generateSecret() {
  return authenticator.generateSecret();
}

// otpauth:// URL для QR + сам QR как data URL (PNG)
async function buildOtpAuth(email, secret) {
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrDataUrl };
}

function verifyToken(secret, token) {
  if (!secret || !token) return false;
  try {
    return authenticator.verify({ token: String(token).replace(/\s/g, ''), secret });
  } catch (e) {
    return false;
  }
}

// Резервные коды: генерируем читаемые (XXXX-XXXX), храним только sha256-хеши
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateBackupCodes(count = 8) {
  const plain = [];
  const hashes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    plain.push(code);
    hashes.push(hashCode(code));
  }
  return { plain, hashes };
}

// Проверяет резервный код; возвращает обновлённый список хешей (с удалённым)
// или null, если код не подошёл.
function consumeBackupCode(storedHashes, code) {
  if (!Array.isArray(storedHashes) || !code) return null;
  const h = hashCode(String(code).trim().toUpperCase());
  if (!storedHashes.includes(h)) return null;
  return storedHashes.filter((x) => x !== h);
}

module.exports = {
  generateSecret,
  buildOtpAuth,
  verifyToken,
  generateBackupCodes,
  consumeBackupCode,
};
