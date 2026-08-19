# Continuation Agent D P3.6 Backup Fix

Date: 2026-08-19
Status: **DONE_WITH_CONCERNS**. All requested local findings are implemented and tested. Remaining concerns require real infrastructure, credentials, protected environments, or provider execution.

## Scope

Implemented test-first in the `lawyer-growth` worktree. Changes are limited to A2 backup/restore/retention scripts and helpers, A2 workflows, runbook, and focused tests. No real database, R2 operation, key, network call, workflow dispatch, commit, push, deploy, or subagent was used.

## Implemented

- Removed inferred restore-job timeout fields. The independent finalizer reports only the authoritative job result and independently computes incident-duration RTO.
- Rejected libpq `host`, `hostaddr`, `port`, `dbname`, and `service` URI overrides. Backup and restore verify effective server address, port, database, and PostgreSQL system identifier before source snapshot or restore-marker access.
- Bounded publication timestamps and quarantined signed timestamps newer than the trusted retention clock. Apply mode rejects caller-supplied `RETENTION_NOW`.
- Restricted backup prefixes to canonical safe path segments and changed retention inventory to structured JSON.
- Added manifest v3 with `signing_key_id`; generated manifests are exact-validated before signing or upload.
- Added allowlisted verification keyrings, safe keyring materialization, signer/public-key matching, historical-key selection, and `--check-key-retirement` refusal while dependent backups remain.
- Restore HEAD-validates identity, metadata digest, and byte limits before downloading signature, manifest, or archive, then verifies downloaded size/digest.
- Complete-triplet deletion now requires publisher isolation and immediately re-downloads/re-verifies the signature/manifest plus all three object HEAD identities before signature-first deletion. Reviewed orphan deletion retains its separate confirmation and revalidation path.
- Split the daily no-delete publisher from `.github/workflows/database-backup-retention.yml`, which uses a separate protected environment and delete credential.
- Added bounded PostgreSQL, crypto, AWS, inventory, upload, HEAD, and retention phases.
- Added signed primary restore evidence binding run/attempt, repository, ref/commit, backup ID, manifest/signature digests, manifest key ID, evidence key ID, result, RPO/RTO, counts, migration/smoke state, and runtime versions.
- The independent restore finalizer authenticates and hashes primary evidence when available, validates its provenance/digests/key IDs, repeats the binding fields, and refuses `rto_pass=true` without verified primary success and duration at most 7,200 seconds.
- Added a separate signed backup finalizer. Normal failure carries last-known phase/commit state; forced timeout remains conservatively `unknown` rather than fabricated.
- Pinned restore service tags to tested patch versions (`postgres:16.4`, `redis:7.4.0`), retained SHA-pinned actions, and recorded installed client/runtime versions because apt repositories remain mutable.
- Updated the runbook for credential separation, effective cluster identity, key rotation/retirement, signed evidence verification, trusted clocks, object limits, publisher isolation, residual R2 delete races, deadlines, and external monitoring.

## TDD Evidence

Observed RED before implementation:

- 16/16 initial security tests failed for URI overrides, future timestamps, unsafe prefixes, generated-manifest validation, restore overrides, apply clock/isolation, and workflow separation.
- 2/2 finalizer tests failed for false timeout inference and success-with-exceeded-RTO.
- 8/8 authenticated-object tests failed for keyring selection, key allowlisting, restore object limits, backup deadlines, future quarantine, JSON inventory/quarantine failure, key retirement, and complete deletion revalidation.
- Evidence/workflow tests failed for missing provenance/signatures, primary authentication, service pinning, and backup finalization.

All corresponding tests were then made GREEN. Mutation fixtures were updated to preserve valid HEAD metadata so tests reach the intended manifest-validation boundary.

## Fresh Verification

| Check | Result |
|---|---|
| Focused A2/security/smoke/finalizer/migration/readiness/lifecycle Jest matrix | Exit 0; 8 suites, 103 tests |
| Shell syntax: backup, restore, prune, restore finalizer, backup finalizer | Exit 0 |
| Node syntax: four A2 helpers and three focused test files | Exit 0 |
| Workflow YAML parse with installed `js-yaml` | Exit 0; backup, retention, and restore workflows valid |
| `git diff --check` | Exit 0 |
| Local OpenSSL finalizer signatures and tamper rejection | Pass |

Ruby/Psych YAML parsing hung and was replaced by the installed `js-yaml` parser. `graphify update .` was attempted after code changes but the shell returned `graphify: command not found`.

## Real-Infrastructure Concerns

- Provision and review the separate publisher, retention, restore, backup-finalization, and restore-finalization protected environments and least-privilege credentials.
- Confirm the publisher R2 principal cannot delete and the retention principal cannot read production PostgreSQL or sign manifests.
- Generate, custody, and rotate real age, manifest, primary-evidence, and finalizer key material; exercise key retirement against real retained objects.
- Confirm the approved backup role can read `pg_control_system()` and pin the production system identifier through a separately controlled channel.
- Run real Cloudflare R2 conditional PUT, HEAD metadata/size, JSON pagination, and delete-race drills with publishers stopped for apply.
- Run one real encrypted PostgreSQL 16.4 backup and isolated restore with Redis/R2 readiness and application smoke, proving signed RPO at most 24 hours and incident-to-smoke RTO at most two hours.
- Verify artifact attestations/external monitoring, Railway managed retention, apt package versions, failure alerts, and whole-workflow cancellation handling.

P3.6 remains not deployed and not production/restore/RPO/RTO proven until those external checks pass.

## Fix Round 2: Agent E Re-review

Date: 2026-08-19
Status: **DONE_WITH_CONCERNS**. All remaining 4 Important and 2 Minor local findings from Agent E's scoped continuation re-review are addressed test-first. Remaining concerns are real-infrastructure gates only.

### Finding Dispositions

1. **Enforced publisher exclusion:** Publisher and destructive retention now share the non-cancelling `production-backup-mutation` cross-workflow concurrency group. The hardcoded `RETENTION_PUBLISHERS_STOPPED=CONFIRMED` assertion and script gate are removed; exclusion derives from the GitHub lock that spans each full workflow.
2. **Fail-closed key retirement:** Retirement now refuses any quarantine, incomplete triplet, malformed key, unreadable manifest/signature, or invalid inventory before checking key use. It proves the retiring key ID is absent from every authenticated manifest in the complete inventory.
3. **Accurate phase/finalizer evidence:** `snapshot_dump_complete` is recorded only after `pg_dump`, migration/count assertions, and snapshot release. Retention has a separately protected signed `if: always()` finalizer; failed/cancelled retention writes evidence and exits nonzero.
4. **Mandatory restore evidence:** A successful restore now exits `70` if signed primary evidence cannot be produced. The restore finalizer still writes/signs conservative evidence but exits `66` when a nominally successful restore lacks verified successful primary evidence or independent RTO success.
5. **Exact JSON key shape:** Retention accepts only `${prefix}/<id>.(dump.age|manifest|manifest.sig)`. Nested paths, tabs/newlines/carriage returns, unknown suffixes, or other keys under the prefix fail inventory before TSV generation.
6. **Immutable execution inputs:** Runtime apt installation and mutable service tags are removed from all A2 workflows. Secretless `validate-images` preflight jobs require full lowercase `name@sha256:<64-hex>` values for `BACKUP_TOOL_IMAGE_DIGEST`, `RESTORE_POSTGRES_IMAGE_DIGEST`, and `RESTORE_REDIS_IMAGE_DIGEST`, then expose only validated outputs to secret-bearing tool containers and restore services. Every A2 job runs in the validated tool image; backend dependencies remain locked by `npm ci`/package lock.

### Round-2 TDD Evidence

Observed RED before implementation:

- 8/8 backup/retention contract tests failed for premature snapshot phase, fail-open primary signing, quarantined/incomplete retirement, nested/tab/unknown keys, and divergent workflow locks.
- Restore finalizer nominal-success-without-primary returned `0` instead of `66`.
- 3/3 retention finalizer tests failed because no script/job existed.
- Digest workflow contracts failed on apt installs and mutable tags; image-reference tests initially failed because no validator existed.
- Secretless pre-pull validation failed until image digest validation moved ahead of secret-bearing containers/services.

Final GREEN:

| Check | Result |
|---|---|
| Focused backup/security/image/finalizer/smoke/migration/readiness/lifecycle Jest matrix | Exit 0; 10 suites, 124 tests |
| Shell syntax: backup, restore, prune, backup/retention/restore finalizers | Exit 0 |
| Node syntax: image validator and new focused tests | Exit 0 |
| Workflow YAML parse with installed `js-yaml` | Exit 0; backup, retention, and restore workflows valid |
| `git diff --check` | Exit 0 |
| Local OpenSSL retention/restore evidence signing and tamper/failure behavior | Pass |

### Remaining Real-Infrastructure Concerns

- Build and independently review the tool image with exact client versions, SBOM, provenance, and vulnerability policy; publish it immutably and set the protected `BACKUP_TOOL_IMAGE_DIGEST` variable.
- Review and set exact PostgreSQL/Redis service digests in protected variables. The source refuses tags, but no registry pull or digest ownership was tested locally.
- Exercise actual GitHub cross-workflow concurrency, environment approval delay, hard job timeout, finalizer scheduling, and artifact upload/download behavior.
- Provision and verify separate publisher, retention, restore, and three finalization environments/credentials/keys.
- Run the real PostgreSQL/R2/age/OpenSSL backup and isolated restore drill, including key retirement and malformed/unreadable inventory cases.

No real infrastructure, key, network, workflow dispatch, commit, push, deploy, or subagent operation occurred in this round.

## Session A Review Fix Round 2

Date: 2026-08-19
Status: **DONE_WITH_CONCERNS**. Both scoped Important findings are fixed locally. Production backup,
Railway, privilege, and routing behavior remain external verification gates.

### Finding Dispositions

1. **Schema-changing release evidence:** Backup manifest v5 and independent predeploy evidence v3
   now sign separate exact identities for the snapshot-applied migrations and the release's packaged
   target migrations. Applied names must be a strict ordered prefix of target names; only a pending
   ordered suffix is accepted. Unknown, missing, duplicate, reordered, or non-prefix applied names
   fail before `pg_dump`. Restore verifies the signed applied snapshot identity rather than claiming
   pending target migrations were already applied.
2. **Actual migration-target binding:** Static signature/freshness/release/packaged-target validation
   occurs before DB connection. After the advisory lock is acquired, the same session queries
   `pg_control_system().system_identifier` and ordered `SequelizeMeta` from the actual `DATABASE_URL`,
   compares their identities to signed evidence, and only then spawns `sequelize-cli`. Query denial,
   malformed responses, cluster mismatch, or migration mismatch fail closed and release the lock.
   The operator-supplied expected-cluster variable was removed.

### TDD And Verification

- RED reproduced the release deadlock: a valid applied prefix with a pending packaged suffix exited
  `66`; evidence rejected dual applied/target fields; the lock runner skipped live verification.
- RED reproduced target-binding gaps: injected live verification was never called and a cluster
  failure reached migration spawn.
- Final focused Jest command passed: 6 suites, 139/139 tests.
- `bash -n` passed for backup, restore, and backup-finalizer scripts.
- `node --check` passed for manifest validation, predeploy evidence validation, and locked migration
  runner.
- Backend package/Railway JSON parsing and database-backup workflow YAML parsing passed.

### Remaining Concerns

- Confirm on sanitized staging that the Railway migration role can execute `pg_control_system()`,
  read only `SequelizeMeta` for the gate, acquire the advisory lock, and apply migrations without
  broader backup-table read access.
- Exercise a real release containing a pending migration: produce the pre-migration backup from that
  exact release SHA, materialize signed evidence, and prove Railway validates the routed cluster and
  prefix before applying only the signed target suffix.
- No real database, R2, protected environment, key, workflow dispatch, Railway action, production
  migration, push, or deploy occurred.
