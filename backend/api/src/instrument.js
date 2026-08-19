const Sentry = require('@sentry/node');
const { sanitizeTelemetry } = require('./observability/sanitize');
const { getRequestContext } = require('./middleware/requestContext');

const HEALTH_TRANSACTION = /(?:^|\s|\/)(?:api\/)?(?:health|live|ready)(?:$|[/?\s])/i;
const OPERATIONAL_CONTEXT_KEYS = new Set([
  'operation', 'code', 'statusCode', 'method', 'provider', 'event', 'userId', 'paymentId',
  'consultationId', 'notificationId', 'importId', 'jobId', 'type', 'route', 'mode', 'attempt', 'count',
]);

function operationalToken(value, fallback, maxLength = 80) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]+$/.test(value) && value.length <= maxLength
    ? value
    : fallback;
}

function operationalContext(context = {}) {
  const output = Object.create(null);
  if (!context || typeof context !== 'object') return output;
  for (const key of OPERATIONAL_CONTEXT_KEYS) {
    let value;
    try {
      value = context[key];
    } catch (_error) {
      continue;
    }
    if (typeof value === 'string') output[key] = operationalToken(value, undefined, 128);
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else if (typeof value === 'boolean') output[key] = value;
    if (output[key] === undefined) delete output[key];
  }
  return sanitizeTelemetry(output, { maxDepth: 3, maxStringLength: 128, maxObjectKeys: 20, maxNodes: 30 }) || Object.create(null);
}

function sanitizeErrorEvent(event) {
  const safe = sanitizeTelemetry(event);
  const values = safe?.exception?.values;
  if (Array.isArray(values)) {
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      value.value = '[REDACTED_EXCEPTION]';
      if (typeof value.stack === 'string') value.stack = '[REDACTED_EXCEPTION]';
    }
    if (safe.message) safe.message = '[REDACTED_EXCEPTION]';
  }
  return safe;
}

function beforeSend(event) {
  const safe = sanitizeErrorEvent(event);
  const requestId = getRequestContext().requestId;
  if (safe && requestId) safe.tags = { ...(safe.tags || {}), requestId };
  return safe;
}

function beforeSendTransaction(event) {
  return sanitizeTelemetry(event);
}

function beforeSendSpan(span) {
  return sanitizeTelemetry(span);
}

function beforeBreadcrumb(breadcrumb) {
  return sanitizeTelemetry(breadcrumb);
}

function tracesSampler(context) {
  const name = context?.name || context?.transactionContext?.name || '';
  return HEALTH_TRANSACTION.test(name) ? 0 : 0.05;
}

function createInstrumentation(sentry, env = process.env) {
  const installedApps = new WeakSet();
  const reportedErrors = new WeakSet();
  const enabled = env.NODE_ENV !== 'test';
  const sdkBeforeSend = (event, hint = {}) => {
    if (hint.originalException instanceof Error && reportedErrors.has(hint.originalException)) return null;
    return beforeSend(event);
  };
  if (enabled) {
    sentry.init({
      dsn: env.SENTRY_BACKEND_DSN || undefined,
      environment: env.SENTRY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV,
      release: env.RAILWAY_GIT_COMMIT_SHA || undefined,
      sampleRate: 1,
      tracesSampler,
      sendDefaultPii: false,
      beforeSend: sdkBeforeSend,
      beforeSendTransaction,
      beforeSendSpan,
      beforeBreadcrumb,
    });
  }

  function reportCaughtException(error, context = {}) {
    if (!enabled || !(error instanceof Error) || reportedErrors.has(error)) return;
    reportedErrors.add(error);
    const extra = operationalContext(context);
    const operation = operationalToken(extra.operation, 'unknown_operation');
    const code = operationalToken(extra.code || error.code, 'CAUGHT_EXCEPTION');
    const controlled = new Error('Operational failure');
    controlled.name = 'OperationalError';
    controlled.code = code;
    controlled.stack = 'OperationalError: Operational failure';
    sentry.captureException(controlled, {
      extra,
      tags: { operation, errorCode: code },
      fingerprint: ['operational', operation, code],
    });
  }

  return {
    setupSentryHandler(app) {
      if (!enabled || !app || installedApps.has(app)) return;
      sentry.setupExpressErrorHandler(app);
      installedApps.add(app);
    },
    reportCaughtException,
    async reportFatalException(error, context = {}) {
      reportCaughtException(error, context);
      if (!enabled || typeof sentry.flush !== 'function') return;
      try {
        await sentry.flush(2000);
      } catch (_error) {
        // Fatal exit must continue even when telemetry transport cannot flush.
      }
    },
  };
}

const instrumentation = createInstrumentation(Sentry);

async function exitAfterFatal(error, context = {}, options = {}) {
  const reporter = options.reporter || instrumentation.reportFatalException;
  const exit = options.exit || process.exit;
  const logger = options.logger;
  try {
    await reporter(error, context);
  } catch (_error) {
    // Reporting must never prevent the fatal exit.
  }
  const operation = operationalToken(context?.operation, 'unknown_operation');
  if (logger?.error) logger.error('fatal_process_error', { operation });
  return exit(1);
}

module.exports = {
  beforeBreadcrumb,
  beforeSend,
  beforeSendSpan,
  beforeSendTransaction,
  createInstrumentation,
  exitAfterFatal,
  ...instrumentation,
  tracesSampler,
};
