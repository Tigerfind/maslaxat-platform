const Sentry = require('@sentry/node');

const enabled = Boolean(process.env.SENTRY_DSN);

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'RequestData'),
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      // Отправляем только exception/stack. Юридический запрос и HTTP-контекст
      // не должны покидать платформу даже при ошибке SDK-интеграции.
      delete event.request;
      delete event.breadcrumbs;
      delete event.extra;
      delete event.user;
      delete event.transaction;
      delete event.contexts;
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((value) => ({
          type: value.type,
          stacktrace: value.stacktrace,
          mechanism: value.mechanism ? { handled: value.mechanism.handled } : undefined,
        }));
      }
      return event;
    },
    beforeSendTransaction: () => null,
  });
}

function setupExpressErrorHandler(app) {
  if (enabled) Sentry.setupExpressErrorHandler(app);
}

module.exports = { Sentry, enabled, setupExpressErrorHandler };
