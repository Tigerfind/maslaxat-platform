const { EventEmitter } = require('events');

const mockCaptureException = jest.fn();
const mockInit = jest.fn();
const mockSetupExpressErrorHandler = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);

const {
  beforeBreadcrumb,
  beforeSend,
  beforeSendSpan,
  beforeSendTransaction,
  createInstrumentation,
  exitAfterFatal,
  tracesSampler,
} = require('../src/instrument');
const {
  canonicalizeKey,
  sanitizeString,
  sanitizeTelemetry,
  sanitizeUrl,
} = require('../src/observability/sanitize');
const {
  getRequestContext,
  requestContext,
} = require('../src/middleware/requestContext');
const { addRequestContext, SAFE_LOG_EVENTS } = require('../src/config/logger');
const { safeRequestMeta } = require('../src/middleware/errorHandler');
const fakeInstrumentation = createInstrumentation({
  captureException: mockCaptureException,
  init: mockInit,
  setupExpressErrorHandler: mockSetupExpressErrorHandler,
  flush: mockFlush,
}, { NODE_ENV: 'production' });

function runRequest(id, delay) {
  const req = { headers: id ? { 'x-request-id': id } : {} };
  const response = new EventEmitter();
  response.setHeader = jest.fn();
  return new Promise((resolve, reject) => {
    requestContext(req, response, () => {
      const first = getRequestContext().requestId;
      setTimeout(() => {
        try {
          resolve({ first, second: getRequestContext().requestId, req, response });
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  });
}

beforeEach(() => {
  mockCaptureException.mockClear();
  mockSetupExpressErrorHandler.mockClear();
  mockFlush.mockClear();
});

test('deep sanitizer is nonmutating, bounded, circular-safe, and strips legal/private payloads', () => {
  const input = {
    consultationId: '4ebfdc8a-c2d2-4da2-a44a-1fa9d2639d83',
    code: 'PAYMENT_FAILED',
    body: { marker: 'BODY_SECRET' },
    headers: { authorization: 'Bearer header-secret' },
    cookies: 'session=cookie-secret',
    query: { resetToken: 'query-secret' },
    providerResponse: { payload: 'provider-secret' },
    aiText: 'private legal advice',
    documentContent: 'private contract',
    importDraft: { summary: 'private resume' },
    email: 'client@example.com',
    phone: '+998 90 123 45 67',
    url: 'https://files.example/doc.pdf?X-Amz-Signature=signed-secret&token=url-secret#fragment-secret',
    nested: { safeId: 'job-42', next: { next: { next: { next: { secret: 'too deep' } } } } },
  };
  input.circular = input;

  const output = sanitizeTelemetry(input, { maxDepth: 4 });
  const serialized = JSON.stringify(output);

  expect(output).not.toBe(input);
  expect(input.body.marker).toBe('BODY_SECRET');
  expect(output.consultationId).toBe(input.consultationId);
  expect(output.code).toBe('PAYMENT_FAILED');
  expect(serialized).not.toMatch(/BODY_SECRET|header-secret|cookie-secret|query-secret|provider-secret/);
  expect(serialized).not.toMatch(/private legal advice|private contract|private resume/);
  expect(serialized).not.toMatch(/client@example\.com|998 90 123 45 67|signed-secret|url-secret|fragment-secret/);
  expect(serialized).toContain('[Circular]');
  expect(serialized).toContain('[MaxDepth]');
});

test('sensitive key matching is canonical across case and underscore, dash, and dot variants', () => {
  const markers = ['ACCESS_MARKER', 'ID_MARKER', 'API_MARKER', 'COOKIE_MARKER', 'PHONE_MARKER'];
  const output = sanitizeTelemetry({
    ACCESS_token: markers[0],
    'id-token': markers[1],
    'api.key': markers[2],
    'Set-Cookie': markers[3],
    phone_number: markers[4],
    operationCode: 'SAFE_OPERATION',
  });

  expect(output.operationCode).toBe('SAFE_OPERATION');
  expect(JSON.stringify(output)).not.toMatch(new RegExp(markers.join('|')));
});

test('sensitive key matching removes punctuation and rejects embedded secret, identity, and content tokens', () => {
  const marker = 'CANONICAL_EMBEDDED_MARKER_R8J4';
  const output = sanitizeTelemetry({
    auth_token: marker,
    session_cookie: marker,
    'request.authorization': marker,
    'x-api-key': marker,
    webhookCredentialValue: marker,
    providerSignatureHeader: marker,
    customerEmailAddress: marker,
    legalDocumentContent: marker,
    operationCode: 'SAFE_OPERATION',
  });

  expect(output.operationCode).toBe('SAFE_OPERATION');
  expect(JSON.stringify(output)).not.toContain(marker);
});

test('canonical key normalization bounds string input before regex and rejects non-string keys', () => {
  const originalReplace = String.prototype.replace;
  let largestReceiver = 0;
  const replaceSpy = jest.spyOn(String.prototype, 'replace').mockImplementation(function boundedReplace(...args) {
    largestReceiver = Math.max(largestReceiver, this.length);
    return originalReplace.apply(this, args);
  });

  try {
    expect(canonicalizeKey(`${'x'.repeat(20_000)}-token`)).toHaveLength(256);
    expect(canonicalizeKey({ toString() { throw new Error('KEY_COERCION_MARKER'); } })).toBe('');
  } finally {
    replaceSpy.mockRestore();
  }

  expect(largestReceiver).toBeLessThanOrEqual(256);
});

test('international phones, cards, OTPs, and opaque exception content are removed', () => {
  const marker = 'OPAQUE_PROVIDER_CONTENT_Z7Q9';
  const event = beforeSend({
    exception: { values: [{ type: 'ProviderError', value: `${marker} OTP 483921 card 4111111111111111`, stack: `Error: ${marker}\n at safe.js:1:1` }] },
    extra: { contact: '+1 (415) 555-2671 / 0044 20 7946 0958' },
  });
  const serialized = JSON.stringify(event);

  expect(serialized).not.toMatch(/OPAQUE_PROVIDER_CONTENT_Z7Q9|483921|4111111111111111|415.{0,8}555|7946.{0,5}0958/);
  expect(event.exception.values[0].value).toBe('[REDACTED_EXCEPTION]');
  expect(event.exception.values[0].stack.split('\n')[0]).toBe('[REDACTED_EXCEPTION]');
});

test('sanitizer bounds strings, arrays, object keys, and total visited nodes', () => {
  const output = sanitizeTelemetry({
    long: 'x'.repeat(10000),
    many: Array.from({ length: 200 }, (_, index) => `item-${index}`),
    object: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key-${index}`, index])),
    tree: { children: Array.from({ length: 200 }, (_, index) => ({ index })) },
  }, { maxStringLength: 128, maxArrayLength: 10, maxObjectKeys: 10, maxNodes: 30 });

  expect(output.long.length).toBeLessThanOrEqual(140);
  expect(output.many.length).toBeLessThanOrEqual(11);
  expect(Object.keys(output.object).length).toBeLessThanOrEqual(11);
  expect(JSON.stringify(output).length).toBeLessThan(2000);
});

test('sanitizer caps inspected strings before regex processing', () => {
  const originalReplace = String.prototype.replace;
  let largestReceiver = 0;
  const replaceSpy = jest.spyOn(String.prototype, 'replace').mockImplementation(function boundedReplace(...args) {
    largestReceiver = Math.max(largestReceiver, this.length);
    return originalReplace.apply(this, args);
  });

  try {
    sanitizeString(`${'x'.repeat(20_000)} AI_DOCUMENT_PROVIDER_MARKER_Q9L2`, 128);
    sanitizeUrl(`https://example.test/${'x'.repeat(20_000)}?token=secret`, 128);
  } finally {
    replaceSpy.mockRestore();
  }

  expect(largestReceiver).toBeLessThanOrEqual(8192);
});

test('backend sanitizer rejects proxies before enumeration and never invokes accessors', () => {
  const keyCount = 100_000;
  let descriptorReads = 0;
  let ownKeyReads = 0;
  const hugeProxy = new Proxy(Object.create(null), {
    ownKeys: () => {
      ownKeyReads += 1;
      return Array.from({ length: keyCount }, (_, index) => `safe${index}`);
    },
    getOwnPropertyDescriptor: (_target, key) => {
      descriptorReads += 1;
      return { configurable: true, enumerable: true, value: key, writable: true };
    },
  });
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'safeAccessor', {
    enumerable: true,
    get() { throw new Error('ACCESSOR_MUST_NOT_RUN'); },
  });
  const objectKeysSpy = jest.spyOn(Object, 'keys');

  let output;
  try {
    expect(() => {
      output = sanitizeTelemetry({ hugeProxy, accessor }, {
        maxObjectKeys: 7,
        maxNodes: 20,
      });
    }).not.toThrow();
  } finally {
    objectKeysSpy.mockRestore();
  }

  expect(objectKeysSpy).not.toHaveBeenCalled();
  expect(ownKeyReads).toBe(0);
  expect(descriptorReads).toBe(0);
  expect(output.hugeProxy).toBe('[Proxy]');
  expect(output.accessor.safeAccessor).toBe('[Accessor]');
});

test('backend sanitizer accepts only plain data, arrays, and known errors', () => {
  class CustomRecord {
    constructor() { this.safe = 'must-not-traverse'; }
  }

  const output = sanitizeTelemetry({
    custom: new CustomRecord(),
    map: new Map([['safe', 'must-not-traverse']]),
    date: new Date('2026-08-18T00:00:00.000Z'),
    error: new TypeError('raw message'),
    plain: { safe: 1 },
    nullPrototype: Object.assign(Object.create(null), { safe: 2 }),
    array: [3],
  });

  expect(output).toMatchObject({
    custom: '[UnsupportedObject]',
    map: '[UnsupportedObject]',
    date: '[UnsupportedObject]',
    error: '[Error]',
    plain: { safe: 1 },
    nullPrototype: { safe: 2 },
    array: [3],
  });
});

test('sanitizer handles BigInt, hostile getters/proxies, and prototype keys without throwing', () => {
  const getter = Object.create(null);
  Object.defineProperty(getter, 'danger', { enumerable: true, get() { throw new Error('GETTER_MARKER'); } });
  getter.safe = 42n;
  const proxy = new Proxy({}, { ownKeys() { throw new Error('PROXY_MARKER'); } });
  const polluted = JSON.parse('{"__proto__":{"polluted":true},"constructor":"BAD","prototype":"BAD","safe":"ok"}');

  let output;
  expect(() => {
    output = sanitizeTelemetry({ getter, proxy, polluted });
  }).not.toThrow();
  expect(Object.getPrototypeOf(output)).toBeNull();
  expect(Object.getPrototypeOf(output.polluted)).toBeNull();
  expect(output.getter.safe).toBe('42');
  expect(output.polluted).not.toHaveProperty('__proto__');
  expect(output.polluted).not.toHaveProperty('constructor');
  expect(output.polluted).not.toHaveProperty('prototype');
  expect(JSON.stringify(output)).not.toMatch(/GETTER_MARKER|PROXY_MARKER|"constructor"|"prototype"/);
});

test('URL sanitizer retains only safe route shape and removes credentials, query, fragments, and path tokens', () => {
  expect(sanitizeUrl('/api/auth/verify-email/super-secret?email=a@b.uz#token'))
    .toBe('/api/auth/verify-email/[REDACTED]');
  expect(sanitizeUrl('https://user:pass@example.com/api/payments/abc?token=secret'))
    .toBe('/api/payments/abc');
});

test('all Sentry hooks sanitize events, transactions, spans, and breadcrumbs', () => {
  const unsafe = {
    request: { url: '/api/reset?token=secret', headers: { authorization: 'Basic abc' }, data: 'body' },
    extra: { email: 'person@example.com', phone: '+998901234567', reduxState: { token: 'jwt' } },
    description: 'POST https://host/path?X-Amz-Signature=secret',
    message: 'Bearer abc.def.ghi for person@example.com',
  };

  for (const result of [
    beforeSend(unsafe),
    beforeSendTransaction(unsafe),
    beforeSendSpan(unsafe),
    beforeBreadcrumb(unsafe),
  ]) {
    expect(JSON.stringify(result)).not.toMatch(/secret|Basic abc|abc\.def\.ghi|person@example\.com|998901234567|reduxState/);
  }
});

test('trace sampling is five percent except health endpoints at zero', () => {
  expect(tracesSampler({ name: 'GET /api/health' })).toBe(0);
  expect(tracesSampler({ name: 'GET /api/live' })).toBe(0);
  expect(tracesSampler({ name: 'GET /api/ready' })).toBe(0);
  expect(tracesSampler({ name: 'GET /api/lawyers/:id' })).toBe(0.05);
});

test('production SDK configuration binds DSN, environment, release, error sampling, and privacy hooks', () => {
  const fake = {
    captureException: jest.fn(),
    init: jest.fn(),
    setupExpressErrorHandler: jest.fn(),
  };
  createInstrumentation(fake, {
    NODE_ENV: 'production',
    SENTRY_BACKEND_DSN: 'https://public@example.ingest.sentry.io/1',
    SENTRY_ENVIRONMENT: 'staging',
    RAILWAY_GIT_COMMIT_SHA: 'abc123',
  });

  expect(fake.init).toHaveBeenCalledWith(expect.objectContaining({
    dsn: 'https://public@example.ingest.sentry.io/1',
    environment: 'staging',
    release: 'abc123',
    sampleRate: 1,
    sendDefaultPii: false,
    tracesSampler,
    beforeSend: expect.any(Function),
    beforeSendTransaction,
    beforeSendSpan,
    beforeBreadcrumb,
  }));
});

test('request IDs remain isolated across concurrent async work and are added to response and logs', async () => {
  const [one, two] = await Promise.all([
    runRequest('8b4ed2d8-53ef-4bef-b6f8-73d365cfc0e9', 20),
    runRequest('not-a-uuid', 5),
  ]);

  expect(one.first).toBe('8b4ed2d8-53ef-4bef-b6f8-73d365cfc0e9');
  expect(one.second).toBe(one.first);
  expect(two.first).toMatch(/^[0-9a-f-]{36}$/);
  expect(two.second).toBe(two.first);
  expect(two.first).not.toBe(one.first);
  expect(one.response.setHeader).toHaveBeenCalledWith('X-Request-ID', one.first);
  expect(one.req.requestId).toBe(one.first);

  await new Promise((resolve) => requestContext(
    { headers: {} },
    { setHeader: jest.fn() },
    () => {
      expect(addRequestContext({ message: 'http_request' })).toMatchObject({
        message: 'http_request',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      resolve();
    }
  ));
});

test('logger transform returns only sanitized metadata, required level symbol, and request ID', async () => {
  await new Promise((resolve) => requestContext(
    { headers: { 'x-request-id': '737cc4ee-07b1-40da-8bd8-c647d2b46f06' } },
    { setHeader: jest.fn() },
    () => {
      const info = {
        level: 'error',
        message: 'request_failed',
        authorization: 'Bearer LOGGER_AUTH_MARKER',
        body: 'LOGGER_BODY_MARKER',
        email: 'logger-marker@example.com',
      };
      info[Symbol.for('level')] = 'error';
      const output = addRequestContext(info);
      expect(output).not.toBe(info);
      expect(output.requestId).toBe('737cc4ee-07b1-40da-8bd8-c647d2b46f06');
      expect(output[Symbol.for('level')]).toBe('error');
      expect(JSON.stringify(output)).not.toMatch(/LOGGER_AUTH_MARKER|LOGGER_BODY_MARKER|logger-marker@example\.com/);
      expect(output).not.toHaveProperty('authorization');
      expect(output).not.toHaveProperty('body');
      expect(output).not.toHaveProperty('email');

      const marker = 'RAW_WINSTON_ERROR_MARKER_M5C2';
      const unsafeError = addRequestContext({
        level: 'error',
        message: marker,
        stack: `Error: ${marker}`,
      });
      expect(unsafeError.message).toBe('application_error');
      expect(JSON.stringify(unsafeError)).not.toContain(marker);

      const lowercaseMarker = 'lowercasesecretmarker';
      const lowercaseError = addRequestContext({ level: 'error', message: lowercaseMarker });
      expect(lowercaseError.message).toBe('application_error');
      expect(JSON.stringify(lowercaseError)).not.toContain(lowercaseMarker);

      const nullMessage = Object.assign(Object.create(null), { marker: 'NULL_MESSAGE_SECRET' });
      const unknownInfo = addRequestContext({ level: 'info', message: nullMessage });
      expect(unknownInfo.message).toBe('application_log');
      expect(JSON.stringify(unknownInfo)).not.toContain('NULL_MESSAGE_SECRET');

      expect(SAFE_LOG_EVENTS).toBeInstanceOf(Set);
      expect(SAFE_LOG_EVENTS).toContain('request_failed');
      expect(SAFE_LOG_EVENTS).toContain('http_request');
      resolve();
    }
  ));
});

test('sanitized error events are tagged with the active request ID', async () => {
  const response = { setHeader: jest.fn() };
  await new Promise((resolve) => requestContext(
    { headers: { 'x-request-id': '26e85d8f-f14d-4d1c-9d3a-6f06cd70593e' } },
    response,
    () => {
      expect(beforeSend({ tags: {}, extra: { body: 'private' } })).toEqual({
        tags: { requestId: '26e85d8f-f14d-4d1c-9d3a-6f06cd70593e' },
        extra: {},
      });
      resolve();
    }
  ));
});

test('Express Sentry handler is installed once per app', () => {
  const app = {};
  fakeInstrumentation.setupSentryHandler(app);
  fakeInstrumentation.setupSentryHandler(app);
  expect(mockSetupExpressErrorHandler).toHaveBeenCalledTimes(1);
  expect(mockSetupExpressErrorHandler).toHaveBeenCalledWith(app);
});

test('ordinary test mode loads instrumentation without initializing or capturing through the SDK', () => {
  const fake = {
    captureException: jest.fn(),
    init: jest.fn(),
    setupExpressErrorHandler: jest.fn(),
  };
  const disabled = createInstrumentation(fake, {
    NODE_ENV: 'test',
    SENTRY_BACKEND_DSN: 'https://public@example.ingest.sentry.io/1',
  });

  disabled.setupSentryHandler({});
  disabled.reportCaughtException(new Error('test failure'), { operation: 'test' });
  expect(fake.init).not.toHaveBeenCalled();
  expect(fake.setupExpressErrorHandler).not.toHaveBeenCalled();
  expect(fake.captureException).not.toHaveBeenCalled();
});

test('caught exceptions are explicitly reported once with sanitized operational context', () => {
  const marker = 'RAW_CAUGHT_PROVIDER_MARKER_Q2V8';
  const error = new Error(`${marker} person@example.com Bearer abc.def.ghi`);
  error.stack = `ProviderError: ${marker}\n at provider (${marker}.js:1:1)`;
  fakeInstrumentation.reportCaughtException(error, {
    operation: 'payment_webhook',
    paymentId: 'pay-42',
    unknownField: marker,
    providerPayload: { card: '8600123412341234' },
    body: 'raw-body',
  });
  fakeInstrumentation.reportCaughtException(error, { operation: 'payment_webhook' });

  expect(mockCaptureException).toHaveBeenCalledTimes(1);
  const [reported, hint] = mockCaptureException.mock.calls[0];
  expect(reported).not.toBe(error);
  expect(reported).toMatchObject({ name: 'OperationalError', code: 'CAUGHT_EXCEPTION' });
  expect(reported.message).toBe('Operational failure');
  expect(hint.extra).toEqual(expect.objectContaining({ operation: 'payment_webhook', paymentId: 'pay-42' }));
  expect(hint.fingerprint).toEqual(['operational', 'payment_webhook', 'CAUGHT_EXCEPTION']);
  expect(JSON.stringify([reported.message, reported.stack, hint])).not.toMatch(new RegExp(`${marker}|8600123412341234|raw-body`));
  expect(hint.extra).not.toHaveProperty('unknownField');
});

test('explicitly reported originals are dropped if Express later tries to capture them', () => {
  const fake = {
    captureException: jest.fn(),
    init: jest.fn(),
    setupExpressErrorHandler: jest.fn(),
    flush: jest.fn(),
  };
  const instrumentation = createInstrumentation(fake, { NODE_ENV: 'production' });
  const error = new Error('EXPRESS_DUPLICATE_MARKER_C9F2');
  instrumentation.reportCaughtException(error, { operation: 'payment_webhook' });
  const options = fake.init.mock.calls[0][0];

  expect(options.beforeSend({ exception: { values: [{ value: 'duplicate' }] } }, { originalException: error })).toBeNull();
  expect(fake.captureException).toHaveBeenCalledTimes(1);
});

test('fatal boundary reports a controlled exception, flushes with a bound, then exits', async () => {
  const reporter = jest.fn().mockResolvedValue(undefined);
  const exit = jest.fn();
  const logger = { error: jest.fn() };
  const marker = 'FATAL_RAW_MARKER_K4M6';

  await exitAfterFatal(new Error(marker), { operation: 'server_startup', body: marker }, {
    reporter,
    exit,
    logger,
  });

  expect(reporter).toHaveBeenCalledWith(expect.any(Error), { operation: 'server_startup', body: marker });
  expect(logger.error).toHaveBeenCalledWith('fatal_process_error', { operation: 'server_startup' });
  expect(exit).toHaveBeenCalledWith(1);
  expect(reporter.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
});

test('fatal reporter captures once and requests a bounded Sentry flush', async () => {
  const marker = 'FATAL_PROVIDER_MARKER_B5N7';
  await fakeInstrumentation.reportFatalException(new Error(marker), { operation: 'seed_cli' });

  expect(mockCaptureException).toHaveBeenCalledTimes(1);
  expect(mockFlush).toHaveBeenCalledWith(2000);
  expect(JSON.stringify(mockCaptureException.mock.calls)).not.toContain(marker);
});

test('request telemetry uses pathname and route templates without original URLs', () => {
  expect(safeRequestMeta({
    method: 'GET',
    path: '/reset-password/super-secret',
    originalUrl: '/reset-password/super-secret?token=query-secret',
    baseUrl: '/api/auth',
    route: { path: '/verify-email/:token' },
    requestId: 'request-42',
    userId: 'user-42',
  })).toEqual({
    method: 'GET',
    pathname: '/reset-password/[REDACTED]',
    route: '/api/auth/verify-email/:token',
    requestId: 'request-42',
    userId: 'user-42',
  });
});
