# PWA Release Check

This checklist supplements `deploy-rollback.md`; it does not authorize deploys, migrations, payment or capability cutovers, backup changes, or production access.

## Repository Gate

```bash
node --check frontend/public/sw.js
CI=true npm --prefix frontend test -- --runInBand src/services/serviceWorker.test.js src/services/pushService.test.js src/services/sessionRuntime.test.js
npm --prefix e2e run test:dry
npm --prefix backend/api test -- --runInBand --testTimeout=120000 tests/e2e-test-harness.test.js tests/load-test-harness.test.js
git diff --check
```

These checks are local evidence only. A real release still requires the exact staging deployment, browser/device, TURN, push, and rollback evidence listed in `real-device-checklist.md` and `deploy-rollback.md`.

## Cache Policy

- `/`, `/index.html`, `/manifest.json`, and `/sw.js` must revalidate and must not be immutable.
- `/api/*` and `/socket.io/*` must return `Cache-Control: no-store` at the public edge.
- Only fingerprinted files under `/static/` may use one-year immutable caching.
- The service worker may cache only its generic shell and allowlisted hashed static assets.
- API, auth, sockets, uploads, documents, exports, private/no-store responses, errors, opaque responses, query-bearing URLs, and authorization-bearing requests must never enter Cache Storage.

## Staging Check

```bash
BASE_URL=https://staging.example.test
curl -fsSI "$BASE_URL/"
curl -fsSI "$BASE_URL/index.html"
curl -fsSI "$BASE_URL/sw.js"
curl -fsSI "$BASE_URL/manifest.json"
curl -fsSI "$BASE_URL/api/ready"
```

Resolve the deployed main bundle from `asset-manifest.json` and confirm it is immutable. In browser developer tools, verify authenticated navigation creates no private cache entries. Deploy a visibly different second staging frontend, keep an old tab and installed PWA open, then verify controlled update, offline shell reopening, and no stale chunk 404s.

## Rollback Boundary

Rollback only the approved compatible application SHA. Never undo migrations from this runbook. Preserve deployment IDs, headers, controlling service-worker version, browser/device details, UTC timestamps, and the original failure before changing caches or registrations.

Public CDN behavior, Railway deployment history, physical devices, VAPID delivery, TURN relay, and a second staging release are external blockers. Mark unavailable checks blocked, not passed.
