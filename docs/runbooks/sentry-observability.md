# Sentry Observability Runbook

## Privacy Contract

- Backend and frontend use separate Sentry projects and DSNs.
- Error sampling is 100%; trace sampling is 5%; health transactions are 0%.
- `sendDefaultPii` is disabled. Request/axios bodies, headers, cookies, query strings,
  fragments, auth tokens, contact data, signed URLs, AI/legal/document/import/provider
  payloads, Redux, and browser storage are removed before sending.
- Logs contain `requestId`, structured route/path fields, and operational IDs/codes only.
- Reset and verification query tokens are removed from browser history before React starts.

## Runtime Variables

Backend service:

```text
SENTRY_BACKEND_DSN=<backend project DSN>
SENTRY_ENVIRONMENT=staging|production
RAILWAY_GIT_COMMIT_SHA=<deployed commit SHA>
```

Frontend build/runtime:

```text
REACT_APP_SENTRY_DSN=<frontend project DSN>
REACT_APP_SENTRY_ENVIRONMENT=staging|production
REACT_APP_SENTRY_RELEASE=<same deployed commit SHA>
```

Source-map upload is disabled by default and produces no maps. Enable only in the private
frontend build environment with every variable present:

```text
SENTRY_SOURCE_MAPS_ENABLED=1
SENTRY_AUTH_TOKEN=<project release upload token>
SENTRY_ORG=<organization slug>
SENTRY_FRONTEND_PROJECT=<frontend project slug>
RAILWAY_GIT_COMMIT_SHA=<deployed commit SHA>
```

An enabled build fails if any upload variable is absent. Uploaded maps are deleted from the
build output. `SENTRY_AUTH_TOKEN` must never use the `REACT_APP_` prefix.

## External Setup Blockers

The following require Sentry/Railway owner access and are intentionally not performed locally:

- Create separate backend/frontend projects and install their DSNs in staging secrets.
- Create a least-privilege release upload token and install build-only source-map variables.
- Verify one sanitized backend and frontend test event in staging without customer data.
- Configure ownership and alerts, then record alert IDs/screenshots in staging evidence.
- Verify source maps resolve stack frames and are absent from public frontend assets.

Required alerts:

- New production regression.
- HTTP 5xx rate above 1% for five minutes.
- Payment/provider failures (`operation=payme_webhook`, provider operations).
- Background-job failures (reminder/import/cleanup operation tags).
- Readiness failures after Task 4 introduces `/api/ready`.

DSN presence alone is not completion evidence. Do not enable production reporting until the
staging privacy inspection and alerts are complete.
