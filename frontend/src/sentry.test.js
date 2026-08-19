const mockInit = jest.fn();
const mockCaptureException = jest.fn();
const mockBrowserTracingIntegration = jest.fn(() => ({ name: 'BrowserTracing' }));

jest.mock('@sentry/react', () => ({
  init: mockInit,
  captureException: mockCaptureException,
  browserTracingIntegration: mockBrowserTracingIntegration,
}), { virtual: true });

function loadSentry(path = '/') {
  window.history.replaceState({}, '', path);
  let sentry;
  jest.isolateModules(() => {
    sentry = require('./sentry');
  });
  return sentry;
}

beforeEach(() => {
  mockInit.mockClear();
  mockCaptureException.mockClear();
  mockBrowserTracingIntegration.mockClear();
});

test('frontend sanitizer strips Redux, storage, axios bodies, auth, contact data, and signed URLs', () => {
  loadSentry();
  const event = mockInit.mock.calls[0][0].beforeSend({
    event_id: 'event-safe',
    reduxState: { auth: { token: 'redux-secret' } },
    localStorage: { token: 'storage-secret' },
    request: {
      url: 'https://files.example/doc?X-Amz-Signature=signed-secret',
      method: 'POST',
      data: { legalText: 'axios-body' },
      headers: { Authorization: 'Bearer token' },
    },
    email: 'client@example.com',
    phone: '+998 90 123 45 67',
  });
  const serialized = JSON.stringify(event);

  expect(event.event_id).toBe('event-safe');
  expect(event.request).toEqual({ url: '/doc', method: 'POST' });
  expect(serialized).not.toMatch(/redux-secret|storage-secret|axios-body|Bearer token/);
  expect(serialized).not.toMatch(/client@example\.com|998 90 123 45 67|signed-secret/);
});

test('frontend sanitizer canonicalizes sensitive key variants and international phones', () => {
  const { sanitizeTelemetry } = loadSentry();
  const output = sanitizeTelemetry([
    'Bearer FRONTEND_VARIANT_MARKER_W6P4',
    '+1 (415) 555-2671 / 0044 20 7946 0958',
  ]);

  expect(JSON.stringify(output)).not.toMatch(/FRONTEND_VARIANT_MARKER_W6P4|415.{0,8}555|7946.{0,5}0958/);
});

test('generic frontend sanitizer never traverses object values', () => {
  const { sanitizeTelemetry } = loadSentry();
  let ownKeys = 0;
  const proxy = new Proxy({}, { ownKeys() { ownKeys += 1; return ['secret']; } });
  const output = sanitizeTelemetry({ nested: proxy, safe: 1 });

  expect(output).toBe('[UnsupportedObject]');
  expect(ownKeys).toBe(0);
});

test('frontend key normalization bounds oversized keys before regex work', () => {
  const { sanitizeTelemetry } = loadSentry();
  const originalReplace = String.prototype.replace;
  let largestReceiver = 0;
  const replaceSpy = jest.spyOn(String.prototype, 'replace').mockImplementation(function boundedReplace(...args) {
    largestReceiver = Math.max(largestReceiver, this.length);
    return originalReplace.apply(this, args);
  });

  try {
    sanitizeTelemetry({ [`${'x'.repeat(20_000)}-token`]: 1 });
  } finally {
    replaceSpy.mockRestore();
  }

  expect(largestReceiver).toBe(0);
});

test('frontend sanitizer is bounded, getter-safe, BigInt-safe, and prototype-safe', () => {
  const { sanitizeTelemetry } = loadSentry();
  const hostile = Object.create(null);
  Object.defineProperty(hostile, 'danger', { enumerable: true, get() { throw new Error('FRONTEND_GETTER_MARKER'); } });
  hostile.safe = 99n;
  const proxy = new Proxy({}, { ownKeys() { throw new Error('FRONTEND_PROXY_MARKER'); } });
  const polluted = JSON.parse('{"__proto__":{"bad":true},"constructor":"bad","safe":"ok"}');
  expect(sanitizeTelemetry(hostile)).toBe('[UnsupportedObject]');
  expect(sanitizeTelemetry(proxy)).toBe('[UnsupportedObject]');
  expect(sanitizeTelemetry(polluted)).toBe('[UnsupportedObject]');
  const output = sanitizeTelemetry([
    99n,
    'x'.repeat(10000),
    ...Array.from({ length: 200 }, (_, index) => index),
  ], { maxStringLength: 128, maxArrayLength: 10, maxNodes: 40 });
  expect(output[0]).toBe('99');
  expect(output[1].length).toBeLessThanOrEqual(140);
  expect(output.length).toBeLessThanOrEqual(11);
  expect(JSON.stringify(output)).not.toMatch(/FRONTEND_GETTER_MARKER|FRONTEND_PROXY_MARKER/);
});

test('frontend sanitizer caps inspected strings before regex processing', () => {
  const { sanitizeTelemetry } = loadSentry();
  const originalReplace = String.prototype.replace;
  let largestReceiver = 0;
  const replaceSpy = jest.spyOn(String.prototype, 'replace').mockImplementation(function boundedReplace(...args) {
    largestReceiver = Math.max(largestReceiver, this.length);
    return originalReplace.apply(this, args);
  });
  try {
    sanitizeTelemetry([`${'x'.repeat(20_000)} FRONTEND_AI_MARKER_T6B4`], { maxStringLength: 128 });
  } finally {
    replaceSpy.mockRestore();
  }

  expect(largestReceiver).toBeLessThanOrEqual(8192);
});

test('frontend sanitizer never enumerates huge proxy or accessor objects', () => {
  const { sanitizeTelemetry } = loadSentry();
  const keyCount = 100_000;
  let descriptorReads = 0;
  const hugeProxy = new Proxy(Object.create(null), {
    ownKeys: () => Array.from({ length: keyCount }, (_, index) => `safe${index}`),
    getOwnPropertyDescriptor: (_target, key) => {
      descriptorReads += 1;
      return { configurable: true, enumerable: true, value: key, writable: true };
    },
  });
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'safeAccessor', {
    enumerable: true,
    get() { throw new Error('FRONTEND_ACCESSOR_MUST_NOT_RUN'); },
  });
  expect(() => sanitizeTelemetry(hugeProxy)).not.toThrow();
  expect(sanitizeTelemetry(hugeProxy)).toBe('[UnsupportedObject]');
  expect(sanitizeTelemetry(accessor)).toBe('[UnsupportedObject]');
  expect(descriptorReads).toBe(0);
});

test('frontend sanitizer accepts only plain data and marks unsupported objects', () => {
  const { sanitizeTelemetry } = loadSentry();
  class CustomRecord {
    constructor() { this.safe = 'must-not-traverse'; }
  }

  for (const value of [
    new CustomRecord(),
    new Map([['safe', 'must-not-traverse']]),
    new Date('2026-08-18T00:00:00.000Z'),
    new TypeError('raw message'),
    { safe: 1 },
    Object.assign(Object.create(null), { safe: 2 }),
  ]) expect(sanitizeTelemetry(value)).toBe('[UnsupportedObject]');
});

test('frontend Sentry boundary drops hostile proxy events and nested fields without throwing', () => {
  loadSentry();
  const options = mockInit.mock.calls[0][0];
  let rootOwnKeys = 0;
  const hostileRoot = new Proxy({}, {
    ownKeys() {
      rootOwnKeys += 1;
      throw new Error('ROOT_PROXY_OWN_KEYS_MARKER');
    },
  });
  let nestedOwnKeys = 0;
  const hostileNested = new Proxy({}, {
    ownKeys() {
      nestedOwnKeys += 1;
      throw new Error('NESTED_PROXY_OWN_KEYS_MARKER');
    },
  });
  let contextsOwnKeys = 0;
  const hostileContextsValue = new Proxy({}, {
    ownKeys() {
      contextsOwnKeys += 1;
      throw new Error('CONTEXT_PROXY_OWN_KEYS_MARKER');
    },
  });
  let dataOwnKeys = 0;
  const hostileData = new Proxy({}, {
    ownKeys() {
      dataOwnKeys += 1;
      throw new Error('DATA_PROXY_OWN_KEYS_MARKER');
    },
  });

  expect(() => options.beforeSend(hostileRoot)).not.toThrow();
  expect(options.beforeSend(hostileRoot)).toBeNull();
  expect(rootOwnKeys).toBe(0);

  const event = options.beforeSend({
    event_id: 'event-42',
    release: 'release-42',
    tags: { requestId: 'request-42', authorization: 'Bearer secret' },
    request: { url: '/api/lawyers?token=secret', method: 'GET', headers: hostileData },
    extra: { operation: 'render_error', hostile: hostileNested },
    contexts: {
      react: { componentStack: '\n at SecretForm (https://host/app.js?token=secret:1:2)' },
      trace: { trace_id: 'trace-42', span_id: 'span-42', op: 'ui.render' },
      hostile: hostileContextsValue,
    },
    breadcrumbs: [{ category: 'xhr', message: 'person@example.com', data: hostileData }],
  });
  expect(event).toMatchObject({
    event_id: 'event-42',
    release: 'release-42',
    tags: { requestId: 'request-42' },
    request: { url: '/api/lawyers', method: 'GET' },
    extra: { operation: 'render_error' },
    contexts: {
      react: { componentStack: expect.stringContaining('SecretForm') },
      trace: { trace_id: 'trace-42', span_id: 'span-42', op: 'ui.render' },
    },
  });
  expect(event.extra).not.toHaveProperty('hostile');
  expect(JSON.stringify(event)).not.toMatch(/Bearer secret|person@example\.com|token=secret/);
  expect(nestedOwnKeys).toBe(0);
  expect(contextsOwnKeys).toBe(0);
  expect(dataOwnKeys).toBe(0);
});

test('frontend Sentry preserves bounded stack frames and debug images without enumeration or source secrets', () => {
  loadSentry();
  const options = mockInit.mock.calls[0][0];
  let frameOwnKeys = 0;
  let varsOwnKeys = 0;
  let debugMetaOwnKeys = 0;
  let imageOwnKeys = 0;
  const hostileVars = new Proxy({}, {
    ownKeys() {
      varsOwnKeys += 1;
      throw new Error('VARS_OWN_KEYS_SECRET');
    },
  });
  const hostileFrame = new Proxy({
    filename: '/chunks/vendor.js?token=HOSTILE_FRAME_SECRET',
    function: 'dispatch',
    module: 'runtime',
    lineno: 9,
    colno: 2,
    in_app: false,
    vars: hostileVars,
  }, {
    ownKeys() {
      frameOwnKeys += 1;
      throw new Error('FRAME_OWN_KEYS_SECRET');
    },
  });
  const frames = [{
    filename: 'https://cdn.example.com/static/app.js?token=FRAME_QUERY_SECRET#fragment',
    function: 'renderCard',
    module: 'ui.cards',
    lineno: 12,
    colno: 34,
    in_app: true,
    abs_path: '/private/ABS_PATH_SECRET/app.js',
    context_line: 'CONTEXT_LINE_SECRET',
    pre_context: ['PRE_CONTEXT_SECRET'],
    post_context: ['POST_CONTEXT_SECRET'],
    vars: hostileVars,
  }, hostileFrame];
  while (frames.length < 55) {
    frames.push({ filename: `/chunks/${frames.length}.js?token=TAIL_FRAME_SECRET`, lineno: frames.length });
  }
  const hostileImage = new Proxy({
    type: 'sourcemap',
    code_file: 'https://cdn.example.com/assets/app.js?token=DEBUG_QUERY_SECRET',
    debug_id: 'ABCD-1234-EF56',
    code_id: 'build:5678',
    unknown: 'DEBUG_UNKNOWN_SECRET',
  }, {
    ownKeys() {
      imageOwnKeys += 1;
      throw new Error('IMAGE_OWN_KEYS_SECRET');
    },
  });
  const images = [hostileImage];
  while (images.length < 25) {
    images.push({
      type: 'sourcemap',
      code_file: `/assets/${images.length}.js?token=TAIL_DEBUG_SECRET`,
      debug_id: `DEBUG-${images.length}`,
    });
  }
  const debugMeta = new Proxy({ images }, {
    ownKeys() {
      debugMetaOwnKeys += 1;
      throw new Error('DEBUG_META_OWN_KEYS_SECRET');
    },
  });

  let event;
  expect(() => {
    event = options.beforeSend({
      event_id: 'event-source-map',
      release: 'release-42',
      environment: 'staging',
      tags: { requestId: 'request-42' },
      contexts: {
        react: { componentStack: '\n at RenderCard (/static/app.js:12:34)' },
        trace: { trace_id: 'trace-42', span_id: 'span-42', op: 'ui.render' },
      },
      exception: {
        values: [{
          type: 'TypeError',
          value: 'private exception',
          stacktrace: { frames },
        }],
      },
      debug_meta: debugMeta,
    });
  }).not.toThrow();

  const safeFrames = event.exception.values[0].stacktrace.frames;
  expect(safeFrames).toHaveLength(50);
  expect(safeFrames[0]).toEqual({
    filename: '/chunks/5.js',
    lineno: 5,
  });
  expect(event.debug_meta.images).toHaveLength(20);
  expect(event.debug_meta.images[0]).toEqual({
    type: 'sourcemap',
    code_file: '/assets/app.js',
    debug_id: 'ABCD-1234-EF56',
    code_id: 'build:5678',
  });
  expect(event).toMatchObject({
    release: 'release-42',
    environment: 'staging',
    tags: { requestId: 'request-42' },
    contexts: {
      react: { componentStack: expect.stringContaining('RenderCard') },
      trace: { trace_id: 'trace-42', span_id: 'span-42' },
    },
  });
  expect(JSON.stringify(event)).not.toMatch(
    /FRAME_QUERY_SECRET|HOSTILE_FRAME_SECRET|ABS_PATH_SECRET|CONTEXT_LINE_SECRET|PRE_CONTEXT_SECRET|POST_CONTEXT_SECRET|VARS_OWN_KEYS_SECRET|TAIL_FRAME_SECRET|DEBUG_QUERY_SECRET|DEBUG_UNKNOWN_SECRET|TAIL_DEBUG_SECRET/
  );
  expect(frameOwnKeys).toBe(0);
  expect(varsOwnKeys).toBe(0);
  expect(debugMetaOwnKeys).toBe(0);
  expect(imageOwnKeys).toBe(0);
});

test('frontend Sentry keeps newest frames and prioritizes their debug images before bounded fill', () => {
  loadSentry();
  const options = mockInit.mock.calls[0][0];
  const frames = Array.from({ length: 55 }, (_, index) => ({
    filename: `/assets/frame-${index}.js?token=frame-secret`,
    lineno: index,
  }));
  const images = Array.from({ length: 25 }, (_, index) => ({
    type: 'sourcemap',
    code_file: `/assets/unmatched-${index}.js?token=image-secret`,
    debug_id: `UNMATCHED-${index}`,
  }));
  images[24] = {
    type: 'sourcemap',
    code_file: '/assets/frame-54.js?token=matching-secret',
    debug_id: 'MATCHING-54',
  };

  const event = options.beforeSend({
    exception: { values: [{ stacktrace: { frames } }] },
    debug_meta: { images },
  });

  expect(event.exception.values[0].stacktrace.frames).toHaveLength(50);
  expect(event.exception.values[0].stacktrace.frames[0].filename).toBe('/assets/frame-5.js');
  expect(event.exception.values[0].stacktrace.frames[49].filename).toBe('/assets/frame-54.js');
  expect(event.debug_meta.images).toHaveLength(20);
  expect(event.debug_meta.images[0]).toEqual({
    type: 'sourcemap',
    code_file: '/assets/frame-54.js',
    debug_id: 'MATCHING-54',
  });
});

test('Sentry initializes without console breadcrumbs and with privacy hooks and five percent traces', () => {
  process.env.REACT_APP_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  process.env.REACT_APP_SENTRY_ENVIRONMENT = 'staging';
  process.env.REACT_APP_SENTRY_RELEASE = 'abc123';
  const sentry = loadSentry();
  expect(mockInit).toHaveBeenCalledTimes(1);
  const options = mockInit.mock.calls[0][0];
  expect(options.sendDefaultPii).toBe(false);
  expect(options.dsn).toBeUndefined();
  expect(options.environment).toBe('staging');
  expect(options.release).toBe('abc123');
  expect(options.tracesSampler({ name: 'GET /api/health' })).toBe(0);
  expect(options.tracesSampler({ name: 'GET /dashboard' })).toBe(0.05);
  expect(options.beforeBreadcrumb({ category: 'console', message: 'private' })).toBeNull();
  expect(options.beforeBreadcrumb({ category: 'xhr', data: { requestBody: 'secret' } }))
    .not.toHaveProperty('data.requestBody');
  const marker = 'FRONTEND_EXCEPTION_MARKER_H3C8';
  const errorEvent = options.beforeSend({
    exception: { values: [{ value: marker, stack: `Error: ${marker}\n at app.js:1:1` }] },
  });
  expect(JSON.stringify(errorEvent)).not.toContain(marker);
  expect(errorEvent.exception.values[0]).toMatchObject({
    value: '[REDACTED_EXCEPTION]',
    stack: '[REDACTED_EXCEPTION]',
  });
  expect(sentry).toHaveProperty('captureRenderError');
  delete process.env.REACT_APP_SENTRY_DSN;
  delete process.env.REACT_APP_SENTRY_ENVIRONMENT;
  delete process.env.REACT_APP_SENTRY_RELEASE;
});

test.each(['/reset-password?token=reset-secret', '/verify-email?token=verify-secret']) (
  'auth token is removed from browser history immediately for %s',
  (path) => {
    const sentry = loadSentry(path);
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe(path.split('?')[0]);
    expect(sentry.consumeAuthQueryToken(window.location.pathname)).toMatch(/^(reset|verify)-secret$/);
    expect(sentry.consumeAuthQueryToken(window.location.pathname)).toBeNull();
  }
);

test('SPA navigation clears and consumes an auth query after Sentry is already initialized', () => {
  const sentry = loadSentry('/');
  window.history.pushState({}, '', '/reset-password?token=late-secret');

  expect(sentry.consumeAuthQueryToken('/reset-password')).toBe('late-secret');
  expect(window.location.pathname).toBe('/reset-password');
  expect(window.location.search).toBe('');
});

test('render errors include only a bounded component stack', () => {
  const { captureRenderError } = loadSentry();
  const error = new Error('render failed');
  captureRenderError(error, {
    componentStack: '\n at SecretForm (http://localhost/app.js:1:2)',
    reduxState: { auth: { token: 'secret' } },
  });

  expect(mockCaptureException).toHaveBeenCalledTimes(1);
  expect(mockCaptureException).toHaveBeenCalledWith(error, {
    contexts: { react: { componentStack: '\n at SecretForm (http://localhost/app.js:1:2)' } },
  });
});
