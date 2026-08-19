const crypto = require('crypto');

function key() {
  const encoded = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!encoded && process.env.NODE_ENV === 'test') return crypto.createHash('sha256').update('test-encryption-key').digest();
  const value = Buffer.from(String(encoded || ''), 'base64');
  if (value.length !== 32) throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be a base64 32-byte key');
  return value;
}

function encrypt(value, context) {
  if (value == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(context)));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decrypt(payload, context) {
  if (!payload) return null;
  const [version, iv, tag, encrypted] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(String(context)));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
