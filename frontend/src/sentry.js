import * as Sentry from '@sentry/react';

const DROP = Symbol('drop');
const authTokens = new Map();
const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 8,
  maxStringLength: 2048,
  maxArrayLength: 50,
  maxNodes: 500,
});
const MAX_INSPECTED_STRING_LENGTH = 8192;
const MAX_DEBUG_IMAGES_INSPECTED = 200;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const CARD = /\b(?:\d[\s-]*?){12,19}\b/g;
const PHONE = /(?:\+|00)?\d(?:[\s().-]*\d){7,14}/g;
const OTP = /\b(?:otp|one[ -]?time code|verification code|код)\s*[:#-]?\s*\d{4,8}\b/gi;
const AUTH = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const TOKEN_PATH = /(\/(?:reset-password|verify-email|auth\/verify-email|auth\/reset-password)\/)[^/?#\s]+/gi;
const HEALTH_TRANSACTION = /(?:^|\s|\/)(?:api\/)?(?:health|live|ready)(?:$|[/?\s])/i;
const ABSENT = Symbol('absent');
const EVENT_SCALARS = Object.freeze([
  'environment', 'event_id', 'level', 'message', 'platform', 'release', 'server_name',
  'start_timestamp', 'timestamp', 'trace_id', 'transaction', 'type',
]);
const SPAN_SCALARS = Object.freeze([
  'description', 'exclusive_time', 'op', 'origin', 'parent_span_id', 'profile_id',
  'segment_id', 'span_id', 'start_timestamp', 'status', 'timestamp', 'trace_id',
]);
const BREADCRUMB_SCALARS = Object.freeze([
  'category', 'event_id', 'level', 'message', 'timestamp', 'type',
]);
const TAG_SCALARS = Object.freeze([
  'errorCode', 'mode', 'operation', 'requestId', 'route', 'span_id', 'trace_id',
]);
const EXTRA_SCALARS = Object.freeze([
  'attempt', 'code', 'consultationId', 'count', 'event', 'importId', 'jobId', 'method',
  'mode', 'notificationId', 'operation', 'paymentId', 'provider', 'route', 'statusCode',
  'type', 'userId',
]);
const DATA_SCALARS = Object.freeze([
  'method', 'operation', 'requestId', 'route', 'status_code', 'url',
]);
const TRACE_SCALARS = Object.freeze([
  'op', 'origin', 'parent_span_id', 'span_id', 'status', 'trace_id',
]);

function limitsFor(options) {
  const positive = (name) => Number.isInteger(options?.[name]) && options[name] > 0
    ? options[name]
    : DEFAULT_LIMITS[name];
  return {
    maxDepth: positive('maxDepth'),
    maxStringLength: positive('maxStringLength'),
    maxArrayLength: positive('maxArrayLength'),
    maxNodes: positive('maxNodes'),
  };
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
    const parsed = new URL(inspected, window.location.origin);
    return truncateString(parsed.pathname.replace(TOKEN_PATH, '$1[REDACTED]'), maxLength);
  } catch (_error) {
    return truncateString(inspected.split(/[?#]/, 1)[0].replace(TOKEN_PATH, '$1[REDACTED]'), maxLength);
  }
}

function sanitizeString(value, maxLength = DEFAULT_LIMITS.maxStringLength) {
  const safe = inspectString(value)
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

export function sanitizeFrontendValue(value, options = {}) {
  const limits = limitsFor(options);
  const seen = new WeakSet();
  let visited = 0;
  const visit = (current, depth) => {
    visited += 1;
    if (visited > limits.maxNodes) return '[MaxNodes]';
    if (current === null || current === undefined || typeof current === 'boolean' || typeof current === 'number') return current;
    if (typeof current === 'bigint') return String(current);
    if (typeof current === 'string') return sanitizeString(current, limits.maxStringLength);
    if (typeof current === 'function' || typeof current === 'symbol') return DROP;
    if (depth >= limits.maxDepth) return '[MaxDepth]';
    if (!Array.isArray(current)) return '[UnsupportedObject]';
    if (seen.has(current)) return '[Circular]';
    seen.add(current);
    const output = [];
    let currentLength;
    try {
      currentLength = current.length;
    } catch (_error) {
      return '[UnsupportedObject]';
    }
    const length = Math.min(currentLength, limits.maxArrayLength);
    for (let index = 0; index < length; index += 1) {
      if (visited >= limits.maxNodes) {
        output.push('[MaxNodes]');
        break;
      }
      const item = readOwn(current, String(index));
      const result = item === ABSENT ? '[UnsupportedObject]' : visit(item, depth + 1);
      output.push(result === DROP ? '[REDACTED]' : result);
    }
    if (currentLength > length) output.push('[Truncated]');
    return output;
  };
  try {
    const result = visit(value, 0);
    return result === DROP ? undefined : result;
  } catch (_error) {
    return '[Unserializable]';
  }
}

export function sanitizeTelemetry(value, options = {}) {
  return sanitizeFrontendValue(value, options);
}

function readOwn(source, key) {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return ABSENT;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : ABSENT;
  } catch (_error) {
    return ABSENT;
  }
}

function safeScalar(value, key, maxLength = DEFAULT_LIMITS.maxStringLength) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : DROP;
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'string') return DROP;
  return key === 'url' ? sanitizeUrl(value, maxLength) : sanitizeString(value, maxLength);
}

function copyScalars(source, keys, output) {
  let copied = false;
  for (const key of keys) {
    const value = readOwn(source, key);
    if (value === ABSENT) continue;
    const safe = safeScalar(value, key);
    if (safe === DROP) continue;
    output[key] = safe;
    copied = true;
  }
  return copied;
}

function copyFixedObject(source, fields) {
  const output = {};
  return copyScalars(source, fields, output) ? output : null;
}

function copyFixedArray(source, key, copier, limit = DEFAULT_LIMITS.maxArrayLength) {
  const value = readOwn(source, key);
  if (!Array.isArray(value)) return null;
  let length;
  try {
    length = Math.min(value.length, limit);
  } catch (_error) {
    return null;
  }
  const output = [];
  for (let index = 0; index < length; index += 1) {
    const item = readOwn(value, String(index));
    if (item === ABSENT) continue;
    const safe = copier(item);
    if (safe !== null && safe !== undefined && safe !== DROP) output.push(safe);
  }
  return output.length ? output : null;
}

function copyRequest(source) {
  return copyFixedObject(source, ['url', 'method', 'status_code']);
}

function copyUser(source) {
  return copyFixedObject(source, ['id']);
}

function copyMechanism(source) {
  return copyFixedObject(source, ['handled', 'synthetic', 'type']);
}

function copyStackFrame(source) {
  const output = {};
  let copied = false;
  const filename = readOwn(source, 'filename');
  if (typeof filename === 'string') {
    output.filename = sanitizeUrl(filename, 1024);
    copied = true;
  }
  for (const key of ['function', 'module']) {
    const value = readOwn(source, key);
    if (typeof value === 'string') {
      output[key] = sanitizeString(value, 256);
      copied = true;
    }
  }
  for (const key of ['lineno', 'colno']) {
    const value = readOwn(source, key);
    if (Number.isInteger(value) && Number.isFinite(value) && value >= 0) {
      output[key] = value;
      copied = true;
    }
  }
  const inApp = readOwn(source, 'in_app');
  if (typeof inApp === 'boolean') {
    output.in_app = inApp;
    copied = true;
  }
  return copied ? output : null;
}

function copyStacktrace(source) {
  const value = readOwn(source, 'frames');
  if (!Array.isArray(value)) return null;
  let currentLength;
  try {
    currentLength = value.length;
  } catch (_error) {
    return null;
  }
  const output = [];
  const start = Math.max(0, currentLength - 50);
  for (let index = start; index < currentLength; index += 1) {
    const item = readOwn(value, String(index));
    if (item === ABSENT) continue;
    const frame = copyStackFrame(item);
    if (frame) output.push(frame);
  }
  const frames = output.length ? output : null;
  return frames ? { frames } : null;
}

function copyExceptionValue(source) {
  const output = {};
  let copied = copyScalars(source, ['type', 'value', 'stack'], output);
  const mechanism = copyMechanism(readOwn(source, 'mechanism'));
  if (mechanism) {
    output.mechanism = mechanism;
    copied = true;
  }
  const stacktrace = copyStacktrace(readOwn(source, 'stacktrace'));
  if (stacktrace) {
    output.stacktrace = stacktrace;
    copied = true;
  }
  return copied ? output : null;
}

function copyException(source) {
  const values = copyFixedArray(source, 'values', copyExceptionValue);
  return values ? { values } : null;
}

function copyData(source) {
  return copyFixedObject(source, DATA_SCALARS);
}

function copyBreadcrumb(source) {
  const output = {};
  let copied = copyScalars(source, BREADCRUMB_SCALARS, output);
  const data = copyData(readOwn(source, 'data'));
  if (data) {
    output.data = data;
    copied = true;
  }
  return copied ? output : null;
}

function copyReactContext(source) {
  const componentStack = readOwn(source, 'componentStack');
  return typeof componentStack === 'string'
    ? { componentStack: sanitizeString(componentStack, MAX_INSPECTED_STRING_LENGTH) }
    : null;
}

function copyContexts(source) {
  const output = {};
  const react = copyReactContext(readOwn(source, 'react'));
  const trace = copyFixedObject(readOwn(source, 'trace'), TRACE_SCALARS);
  if (react) output.react = react;
  if (trace) output.trace = trace;
  return react || trace ? output : null;
}

function copySpan(source) {
  const output = {};
  let copied = copyScalars(source, SPAN_SCALARS, output);
  for (const [key, fields] of [['tags', TAG_SCALARS], ['data', DATA_SCALARS]]) {
    const child = copyFixedObject(readOwn(source, key), fields);
    if (child) {
      output[key] = child;
      copied = true;
    }
  }
  return copied ? output : null;
}

function safeIdentifier(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

function copyDebugImage(source) {
  const output = {};
  let copied = false;
  const type = readOwn(source, 'type');
  if (typeof type === 'string') {
    output.type = sanitizeString(type, 64);
    copied = true;
  }
  const codeFile = readOwn(source, 'code_file');
  if (typeof codeFile === 'string') {
    output.code_file = sanitizeUrl(codeFile, 1024);
    copied = true;
  }
  for (const key of ['debug_id', 'code_id']) {
    const identifier = safeIdentifier(readOwn(source, key));
    if (identifier) {
      output[key] = identifier;
      copied = true;
    }
  }
  return copied ? output : null;
}

function copyDebugMeta(source, retainedFilenames = new Set()) {
  const value = readOwn(source, 'images');
  if (!Array.isArray(value)) return null;
  let length;
  try {
    length = Math.min(value.length, MAX_DEBUG_IMAGES_INSPECTED);
  } catch (_error) {
    return null;
  }
  const matching = [];
  const fill = [];
  for (let index = 0; index < length; index += 1) {
    const item = readOwn(value, String(index));
    if (item === ABSENT) continue;
    const image = copyDebugImage(item);
    if (!image) continue;
    if (image.code_file && retainedFilenames.has(image.code_file)) matching.push(image);
    else fill.push(image);
  }
  const images = matching.concat(fill).slice(0, 20);
  return images.length ? { images } : null;
}

function copyPrimitiveArray(source, key) {
  return copyFixedArray(source, key, (value) => {
    const safe = safeScalar(value, key);
    return safe === DROP ? null : safe;
  });
}

function copySentryEvent(source) {
  const output = {};
  let copied = copyScalars(source, EVENT_SCALARS, output);
  const fixedChildren = [
    ['request', copyRequest],
    ['user', copyUser],
    ['exception', copyException],
    ['tags', (value) => copyFixedObject(value, TAG_SCALARS)],
    ['extra', (value) => copyFixedObject(value, EXTRA_SCALARS)],
    ['contexts', copyContexts],
  ];
  for (const [key, copier] of fixedChildren) {
    const child = copier(readOwn(source, key));
    if (child) {
      output[key] = child;
      copied = true;
    }
  }
  const retainedFilenames = new Set();
  for (const exception of output.exception?.values || []) {
    for (const frame of exception.stacktrace?.frames || []) {
      if (frame.filename) retainedFilenames.add(frame.filename);
    }
  }
  const debugMeta = copyDebugMeta(readOwn(source, 'debug_meta'), retainedFilenames);
  if (debugMeta) {
    output.debug_meta = debugMeta;
    copied = true;
  }
  for (const [key, copier] of [['breadcrumbs', copyBreadcrumb], ['spans', copySpan]]) {
    const child = copyFixedArray(source, key, copier);
    if (child) {
      output[key] = child;
      copied = true;
    }
  }
  const fingerprint = copyPrimitiveArray(source, 'fingerprint');
  if (fingerprint) {
    output.fingerprint = fingerprint;
    copied = true;
  }
  return copied ? output : null;
}

function beforeSend(event) {
  const safe = copySentryEvent(event);
  if (!safe) return null;
  const values = safe.exception?.values;
  if (Array.isArray(values)) {
    for (const value of values) {
      value.value = '[REDACTED_EXCEPTION]';
      if (typeof value.stack === 'string') value.stack = '[REDACTED_EXCEPTION]';
    }
    if (safe.message) safe.message = '[REDACTED_EXCEPTION]';
  }
  return safe;
}

function beforeSendTransaction(event) {
  return copySentryEvent(event);
}

function beforeSendSpan(span) {
  return copySpan(span);
}

function tracesSampler(context) {
  const name = context?.name || context?.transactionContext?.name || '';
  return HEALTH_TRANSACTION.test(name) ? 0 : 0.05;
}

function beforeBreadcrumb(breadcrumb) {
  const safe = copyBreadcrumb(breadcrumb);
  return safe?.category === 'console' ? null : safe;
}

function clearSensitiveAuthQuery() {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (!['/reset-password', '/verify-email'].includes(pathname) || !search) return;
  const token = new URLSearchParams(search).get('token');
  if (token) authTokens.set(pathname, token);
  window.history.replaceState(window.history.state, '', pathname);
}

export function consumeAuthQueryToken(pathname) {
  let token = authTokens.get(pathname) || null;
  authTokens.delete(pathname);
  if (!token && typeof window !== 'undefined' && window.location.pathname === pathname) {
    token = new URLSearchParams(window.location.search).get('token');
    if (window.location.search || window.location.hash) {
      window.history.replaceState(window.history.state, '', pathname);
    }
  }
  return token;
}

export function captureRenderError(error, info) {
  const componentStack = typeof info?.componentStack === 'string'
    ? info.componentStack.slice(0, 10000)
    : '';
  Sentry.captureException(error, { contexts: { react: { componentStack } } });
}

clearSensitiveAuthQuery();

Sentry.init({
  dsn: process.env.NODE_ENV === 'test' ? undefined : (process.env.REACT_APP_SENTRY_DSN || undefined),
  environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.REACT_APP_SENTRY_RELEASE || undefined,
  sampleRate: 1,
  tracesSampler,
  sendDefaultPii: false,
  integrations(defaultIntegrations) {
    return [
      ...defaultIntegrations.filter((integration) => integration.name !== 'Breadcrumbs'),
      Sentry.browserTracingIntegration(),
    ];
  },
  beforeSend,
  beforeSendTransaction,
  beforeSendSpan,
  beforeBreadcrumb,
});
