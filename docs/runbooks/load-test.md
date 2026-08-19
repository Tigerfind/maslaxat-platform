# Staging Load-test Runbook

The k6 harness is staging-only. Never target production, public providers, Claude, SMTP, large uploads, or production data. A real run requires explicit staging approval for the exact target and time window.

## Safety Preconditions

- [ ] `NODE_ENV` is `test` or `staging`, never `production`.
- [ ] `APP_ENV=staging`.
- [ ] `LOAD_TEST_ENABLED=true`.
- [ ] `K6_LOAD_APPROVED=true` with approval recorded in the change ticket.
- [ ] `PAYMENT_SANDBOX_ENABLED=true` and the internal sandbox route is mounted only by `load/internal-server.js`.
- [ ] Target uses HTTPS, is in `LOAD_TEST_ALLOWED_HOSTS`, and is absent from the built-in and configured production denylist.
- [ ] The database is dedicated to this load dataset and contains no production/customer data or unrelated `@load.test` users.
- [ ] The application E2E attestation and load seed use the same nonce/secret and produce the same live database fingerprint.
- [ ] The load role exactly matches `LOAD_DATABASE_ROLE_CONFIRM` and has no superuser, create-role, create-database, replication, or bypass-RLS privilege.
- [ ] `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `AUTH_RATE_LIMIT_MAX` meet the selected profile below; preflight reports `safe=true`.
- [ ] Commit SHA, run ID, seed version, target, and UTC window are recorded.

The shared application server intentionally does not mount `/api/load-test`. Do not change that boundary to make a run easier.

## Dataset

The deterministic seed creates 50 lawyers, 200 clients, and 1,000 consultations. Every client owns five consultations covering `payment_pending`, `pending`, `accepted`, `completed`, and `cancelled`. The manifest is mode `0600` and contains identifiers, not passwords or tokens.

Seeding begins by deleting every user whose email ends in the reserved `@load.test` domain, plus related consultations, messages, payments, and lawyer profiles. Final seed cleanup does the same. It is dataset-wide cleanup, not run-manifest ownership. Use only a dedicated isolated staging database where that domain is reserved exclusively for this harness. Never run seed or fallback cleanup against a shared staging dataset or any database containing provider-confirmed load payments.

```bash
export NODE_ENV=test
export APP_ENV=staging
export LOAD_TEST_ENABLED=true
export K6_LOAD_APPROVED=true
export PAYMENT_SANDBOX_ENABLED=true
export BASE_URL=https://load-staging.example.test
export LOAD_TEST_TARGET_URL="$BASE_URL"
export LOAD_TEST_ALLOWED_HOSTS=load-staging.example.test
export RATE_LIMIT_WINDOW_MS=900000
# These maxima cover all three profiles in one internal load-server process.
export RATE_LIMIT_MAX=18027
export AUTH_RATE_LIMIT_MAX=60
export LOAD_TEST_RUN_ID="run-$(date -u +%Y%m%dT%H%M%SZ)"
export LOAD_TEST_MANIFEST="${RUNNER_TEMP:-/tmp}/load-manifest.json"
export LOAD_TEST_ARTIFACT_DIR="${RUNNER_TEMP:-/tmp}/load-artifacts"
export E2E_RUN_ID=p38-load-v1
export LOAD_DB_ATTESTATION_NONCE="$E2E_SAFETY_ATTESTATION_NONCE"
export LOAD_DB_ATTESTATION_SECRET="$E2E_DB_ATTESTATION_SECRET"
export LOAD_TARGET_DB_FINGERPRINT="$APPLICATION_DATABASE_FINGERPRINT"
export LOAD_DATABASE_ROLE_CONFIRM=maslaxat_load_runner
: "${LOAD_TEST_COMMIT_SHA:?set the exact approved release SHA}"
: "${LOAD_TEST_PASSWORD:?load the secret from the approved store}"
install -d -m 700 "$LOAD_TEST_ARTIFACT_DIR"
node backend/api/src/seeds/load-seed.js seed "$LOAD_TEST_MANIFEST"
```

Use a random `LOAD_TEST_PASSWORD` of at least 16 characters supplied through the approved secret store. Never upload the password or manifest as an artifact.

## Internal Server

Start the isolated launcher after seeding:

```bash
node load/internal-server.js
```

It binds to `127.0.0.1` by default. Any remote staging execution requires an approved private runner/tunnel and the same host allowlist at the runner, seed, route, and k6 layers.
Because the harness requires HTTPS, expose this loopback listener only through an approved TLS proxy on the same private runner; do not bind the internal sandbox route directly to a public interface.

## Profiles

Request mix: 43% catalog, 14% dashboards, 13% auth/profile, 14% consultation list/create sandbox, 10% chat history, and 6% idempotent checkout sandbox.

With the default `RATE_LIMIT_WINDOW_MS=900000`, the preflight requires:

| Profile | Minimum `RATE_LIMIT_MAX` | Minimum `AUTH_RATE_LIMIT_MAX` |
|---|---:|---:|
| smoke | 63 | 1 |
| baseline | 18,027 | 25 |
| spike | 6,062 | 60 |

The global minimum is `ceil(maxRps * min(durationSeconds, windowSeconds)) + maxVUs + 2`; auth minimum is `maxVUs`. Recalculate when changing the window or profile shape. When one server runs all profiles, use the maximum of each column (`18027` and `60`). Apply these values only to the isolated internal load process, never as an undocumented production rate-limit change.

```bash
export LOAD_TEST_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
k6 run load/k6/smoke.js
export LOAD_TEST_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
k6 run load/k6/baseline.js
export LOAD_TEST_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
k6 run load/k6/spike.js
node backend/api/src/seeds/load-seed.js verify
```

- Smoke: 1 VU for 1 minute.
- Baseline: 2-minute warmup, then 20 requests/second for 15 minutes with at most 25 VUs.
- Spike: ramp 20 to 50 requests/second over 2 minutes.

The harness writes its summary through `handleSummary`. Validate it before upload:

```bash
node load/validate-summary.js "$LOAD_TEST_ARTIFACT_DIR/$LOAD_TEST_RUN_ID-baseline-summary.json"
```

## Pass Criteria

- measured global error rate below 1%; warmup is tagged separately;
- read p95 below 500 ms and write p95 below 1,000 ms;
- catalog p95 below 500 ms;
- auth p95 below 800 ms;
- consultation create p95 below 1,000 ms;
- chat p95 below 500 ms;
- checkout sandbox p95 below 1,000 ms;
- duplicate checkout business objects exactly zero;
- post-run verification and cleanup failures exactly zero.
- live application attestation, seed connection, k6 preflight, and post-load verification report the same nonce-bound database fingerprint.

Archive only the validated summary, commit SHA, environment label, timestamps, seed version, run ID, approval reference, and sanitized runner logs. Do not archive credentials, tokens, manifests, response bodies, or user data.

## Cleanup

Normal k6 teardown verifies duplicate business objects and deletes only pending sandbox mutations owned by `LOAD_TEST_RUN_ID`; it refuses provider-confirmed or non-sandbox rows. Seed cleanup is broader: it removes the entire reserved `@load.test` dataset described above.

Wrap seed, server, and k6 orchestration in an interruption-safe shell flow. This fallback runs on normal exit and on `INT`/`TERM` even if k6 teardown did not execute:

```bash
cleanup_seed() {
  node backend/api/src/seeds/load-seed.js cleanup
}

cleanup_all() {
  if [ -n "${LOAD_SERVER_PID:-}" ]; then
    kill "$LOAD_SERVER_PID" 2>/dev/null || true
    wait "$LOAD_SERVER_PID" 2>/dev/null || true
  fi
  cleanup_seed
}

on_exit() {
  run_status=$?
  trap - EXIT INT TERM
  cleanup_status=0
  cleanup_all || cleanup_status=$?
  if [ "$run_status" -ne 0 ]; then exit "$run_status"; fi
  exit "$cleanup_status"
}

on_interrupt() {
  trap - EXIT INT TERM
  cleanup_all || true
  exit 130
}

trap on_exit EXIT
trap on_interrupt INT TERM

node backend/api/src/seeds/load-seed.js seed "$LOAD_TEST_MANIFEST"
node load/internal-server.js &
LOAD_SERVER_PID=$!
# Wait for the approved HTTPS proxy/readiness check before invoking k6.
export LOAD_TEST_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
k6 run load/k6/baseline.js
```

If orchestration was not wrapped, run the fallback explicitly with the same guarded environment:

```bash
node backend/api/src/seeds/load-seed.js cleanup
```

If cleanup fails, block further runs, retain the run ID, and investigate manually. Never broaden deletion criteria, improvise SQL deletion, or run this dataset-wide fallback outside its dedicated isolated database.

## Current Status

Static/local contract tests do not satisfy this runbook. Until an approved isolated staging run produces validated artifacts, smoke, baseline, and spike remain externally blocked.
