const { types: utilTypes } = require('util');

const DROP = Symbol('drop');
const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 8,
  maxStringLength: 2048,
  maxArrayLength: 50,
  maxObjectKeys: 50,
  maxNodes: 500,
});
const MAX_INSPECTED_STRING_LENGTH = 8192;
const MAX_KEY_LENGTH = 256;

const SENSITIVE_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'cookies', 'setcookie',
  'body', 'requestbody', 'responsebody', 'headers', 'query', 'search', 'hash', 'fragment',
  'password', 'pass', 'secret', 'token', 'accesstoken', 'refreshtoken', 'resettoken',
  'verificationtoken', 'idtoken', 'apikey', 'jwt', 'email', 'phone', 'phonenumber', 'mobile',
  'html', 'text', 'content', 'prompt', 'completion', 'messages', 'attachment', 'attachments',
  'file', 'files', 'document', 'documentcontent', 'aitext', 'aianalysis', 'importdraft', 'raw',
  'payload', 'providerpayload', 'providerresponse', 'redux', 'reduxstate', 'state',
  'localstorage', 'sessionstorage', 'storage', 'data', 'signal', 'otp', 'onetimecode',
]);
const SENSITIVE_KEY_TOKENS = Object.freeze([
  'authorization', 'cookie', 'setcookie', 'token', 'password', 'secret', 'apikey',
  'credential', 'signature', 'email', 'phone', 'mobile', 'body', 'html',
  'content', 'prompt', 'completion', 'attachment', 'payload',
]);
const PROTOTYPE_KEYS = new Set(['proto', 'prototype', 'constructor']);
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const CARD = /\b(?:\d[\s-]*?){12,19}\b/g;
const PHONE = /(?:\+|00)?\d(?:[\s().-]*\d){7,14}/g;
const OTP = /\b(?:otp|one[ -]?time code|verification code|код)\s*[:#-]?\s*\d{4,8}\b/gi;
const AUTH = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const TOKEN_PATH = /(\/(?:reset-password|verify-email|auth\/verify-email|auth\/reset-password)\/)[^/?#\s]+/gi;

function canonicalizeKey(key) {
  if (typeof key !== 'string') return '';
  return key.slice(0, MAX_KEY_LENGTH).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function limitsFor(options) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const supplied = options?.[name];
    limits[name] = Number.isInteger(supplied) && supplied > 0 ? supplied : fallback;
  }
  return limits;
}

function truncateString(value, maxLength = DEFAULT_LIMITS.maxStringLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}[Truncated]`;
}

function inspectString(value) {
  return value.slice(0, MAX_INSPECTED_STRING_LENGTH);
}

function sanitizeUrl(value, maxLength) {
  if (typeof value !== 'string') return value;
  const inspected = inspectString(value);
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(inspected);
    const parsed = new URL(inspected, 'https://telemetry.invalid');
    let pathname = parsed.pathname.replace(TOKEN_PATH, '$1[REDACTED]');
    pathname = pathname.replace(/\/{2,}/g, '/');
    return truncateString(absolute || inspected.startsWith('/') ? pathname : inspected.split(/[?#]/, 1)[0], maxLength);
  } catch (_error) {
    return truncateString(inspected.split(/[?#]/, 1)[0].replace(TOKEN_PATH, '$1[REDACTED]'), maxLength);
  }
}

function sanitizeString(value, maxLength = DEFAULT_LIMITS.maxStringLength) {
  const inspected = inspectString(value);
  const safe = inspected
    .replace(URL_IN_TEXT, (url) => sanitizeUrl(url, maxLength))
    .replace(TOKEN_PATH, '$1[REDACTED]')
    .replace(AUTH, '[REDACTED_AUTH]')
    .replace(JWT, '[REDACTED_JWT]')
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(OTP, '[REDACTED_OTP]')
    .replace(CARD, '[REDACTED_NUMBER]')
    .replace(PHONE, '[REDACTED_PHONE]');
  return truncateString(safe, maxLength);
}

function shouldDropKey(key) {
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) return true;
  const canonical = canonicalizeKey(key);
  return PROTOTYPE_KEYS.has(canonical)
    || SENSITIVE_KEYS.has(canonical)
    || SENSITIVE_KEY_TOKENS.some((token) => canonical.includes(token))
    || canonical.includes('signedurl')
    || (canonical.includes('document') && canonical !== 'documentid')
    || canonical.includes('attachment')
    || (canonical.includes('provider') && (canonical.includes('payload') || canonical.includes('response')))
    || (canonical.includes('import') && ['draft', 'payload', 'content'].some((part) => canonical.includes(part)))
    || (canonical.includes('ai') && ['text', 'content', 'prompt', 'response'].some((part) => canonical.includes(part)));
}

function sanitizeTelemetry(value, options = {}) {
  const limits = limitsFor(options);
  const seen = new WeakSet();
  let visited = 0;

  function visit(current, depth, key = '') {
    if (shouldDropKey(key)) return DROP;
    visited += 1;
    if (visited > limits.maxNodes) return '[MaxNodes]';
    if (current === null || current === undefined || typeof current === 'boolean' || typeof current === 'number') return current;
    if (typeof current === 'bigint') return String(current);
    if (typeof current === 'string') {
      return ['url', 'pathname'].includes(canonicalizeKey(key))
        ? sanitizeUrl(current, limits.maxStringLength)
        : sanitizeString(current, limits.maxStringLength);
    }
    if (typeof current === 'function' || typeof current === 'symbol') return DROP;
    if (depth >= limits.maxDepth) return '[MaxDepth]';
    if (typeof current !== 'object') return DROP;
    if (utilTypes.isProxy(current)) return '[Proxy]';
    if (Buffer.isBuffer(current) || ArrayBuffer.isView(current)) return '[Binary]';
    if (utilTypes.isNativeError(current)) return '[Error]';

    let prototype;
    try {
      prototype = Object.getPrototypeOf(current);
    } catch (_error) {
      return '[UnsupportedObject]';
    }
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      return '[UnsupportedObject]';
    }

    try {
      if (seen.has(current)) return '[Circular]';
      seen.add(current);
    } catch (_error) {
      return '[Unserializable]';
    }

    if (Array.isArray(current)) {
      const output = [];
      let currentLength;
      try {
        currentLength = current.length;
      } catch (_error) {
        return '[Unserializable]';
      }
      const length = Math.min(currentLength, limits.maxArrayLength);
      for (let index = 0; index < length; index += 1) {
        if (visited >= limits.maxNodes) {
          output.push('[MaxNodes]');
          break;
        }
        let item;
        try {
          item = current[index];
        } catch (_error) {
          item = '[Unserializable]';
        }
        const result = visit(item, depth + 1);
        output.push(result === DROP ? '[REDACTED]' : result);
      }
      if (currentLength > length) output.push('[Truncated]');
      return output;
    }

    const output = Object.create(null);
    let retainedKeys = 0;
    let truncated = false;
    try {
      for (const childKey in current) {
        if (retainedKeys >= limits.maxObjectKeys || visited >= limits.maxNodes) {
          truncated = true;
          break;
        }
        visited += 1;
        if (shouldDropKey(childKey)) continue;
        let descriptor;
        descriptor = Object.getOwnPropertyDescriptor(current, childKey);
        if (!descriptor) continue;
        retainedKeys += 1;
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          output[childKey] = '[Accessor]';
          continue;
        }
        const result = visit(descriptor.value, depth + 1, childKey);
        if (result !== DROP) output[childKey] = result;
      }
    } catch (_error) {
      return '[Unserializable]';
    }
    if (truncated) output._truncated = '[Truncated]';
    return output;
  }

  try {
    const result = visit(value, 0);
    return result === DROP ? undefined : result;
  } catch (_error) {
    return '[Unserializable]';
  }
}

module.exports = {
  canonicalizeKey,
  sanitizeString,
  sanitizeTelemetry,
  sanitizeUrl,
};
