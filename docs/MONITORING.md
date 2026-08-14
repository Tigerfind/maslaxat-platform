# Мониторинг

Backend и frontend готовы к Sentry, но полностью отключены без DSN.

## Backend

Переменные Railway backend:

```env
SENTRY_DSN=https://...
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git-sha>
SENTRY_TRACES_SAMPLE_RATE=0
```

Необработанные Express-ошибки сохраняют текущий Winston log и дополнительно отправляются в Sentry. Интеграция работает в error-only режиме: breadcrumbs и tracing отключены; request, URL, body, cookies, headers, query, extra и user context удаляются.

## Frontend

Переменные должны существовать во время сборки frontend:

```env
REACT_APP_SENTRY_DSN=https://...
REACT_APP_SENTRY_ENVIRONMENT=production
REACT_APP_SENTRY_RELEASE=<git-sha>
REACT_APP_SENTRY_TRACES_SAMPLE_RATE=0
```

React ErrorBoundary сохраняет брендовый fallback и отправляет exception с component stack.

Tracing намеренно отключён независимо от переменной окружения: юридические запросы нельзя помещать в spans.

Production source maps сейчас отключены, поэтому browser stack будет минифицирован. Для символизации нужно отдельно настроить Sentry release upload с auth token в CI; сам token нельзя вшивать во frontend.

## Uptime

Внешний uptime monitor должен проверять `GET /api/health` каждую минуту и уведомлять после двух последовательных ошибок. Production smoke запускается командой `node scripts/smoke-production.js`.
