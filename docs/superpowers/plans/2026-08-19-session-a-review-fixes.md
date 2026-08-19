# Session A Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are prohibited for this task.

**Goal:** Close all six Session A review findings with fail-closed local contracts and covering tests.

**Architecture:** Reuse small executable validators for complete R2 discovery and signed migration-backup evidence. Extend the existing canonical backup manifest and representative fixture rather than introducing parallel backup or migration systems.

**Tech Stack:** Bash, Node.js 22, Jest, PostgreSQL 16, GitHub Actions, Railway

**Spec:** `docs/superpowers/specs/2026-08-19-session-a-review-fixes-design.md`

## Global Constraints

- Work only in `.worktrees/lawyer-growth` and preserve all existing uncommitted work.
- Do not access external services or production in tests.
- Security-sensitive parsing, identity, signature, freshness, pagination, and liveness failures fail closed.
- Use test-first changes and one final selective commit after complete verification.

---

### Task 1: Restore Shell And Complete R2 Discovery

**Files:**
- Create: `deployment/scripts/list-r2-backup-objects.js`
- Modify: `.github/workflows/restore-drill.yml`
- Modify: `deployment/scripts/prune-backups.sh`
- Modify: `backend/api/tests/backup-scripts.test.js`

**Interfaces:**
- Produces: `list-r2-backup-objects.js <bucket> <endpoint> <prefix>` writing one validated canonical key per line.
- Consumes: AWS CLI `s3api list-objects-v2` JSON pages and explicit continuation tokens.

- [ ] Add failing tests asserting both container jobs use `bash --noprofile --norc -eo pipefail {0}`, a Bash-only command executes through that exact shell, newest selection sees a second-page signature, pruning sees all pages, and malformed/truncated/token-loop pages fail nonzero.
- [ ] Run `npm --prefix backend/api test -- --runInBand tests/backup-scripts.test.js` and confirm the new assertions fail.
- [ ] Implement explicit page iteration with strict `Contents`, `KeyCount`, `IsTruncated`, and `NextContinuationToken` validation, token progress checks, duplicate-key rejection, and canonical key output.
- [ ] Set job-level shell defaults on `restore` and `finalize-evidence`; replace inline newest selection and prune's single listing with the executable paginator.
- [ ] Re-run the focused suite and confirm it passes.

### Task 2: Signed Fresh Predeploy Backup Gate

**Files:**
- Create: `backend/api/src/scripts/validateMigrationBackupEvidence.js`
- Create: `backend/api/tests/migration-backup-evidence.test.js`
- Modify: `backend/api/package.json`
- Modify: `backend/api/railway.json`
- Modify: `backend/api/tests/release-foundation-contract.test.js`
- Modify: `.env.example`
- Modify: `backend/api/.env.example`

**Interfaces:**
- Consumes: canonical evidence and detached signature files, configured public key/key ID, `RAILWAY_GIT_COMMIT_SHA`, expected source cluster ID, and current time.
- Produces: exit zero only for fresh successful evidence bound to the exact cluster and release; `npm run db:predeploy` validates before invoking `db:migrate:locked`.

- [ ] Add failing unit/CLI tests for valid evidence and missing, malformed, stale, future, bad-signature, wrong-key, wrong-cluster, wrong-release, unsuccessful, and incomplete evidence.
- [ ] Add a failing Railway contract asserting `preDeployCommand` is `npm run db:predeploy` and the script orders validation before migration.
- [ ] Run the two focused suites and confirm failures.
- [ ] Implement exact canonical field parsing, public-key signature verification through local Node crypto, bounded freshness, and timing-safe exact bindings without database access.
- [ ] Wire package/Railway commands and document the required environment names in both examples.
- [ ] Re-run the focused suites and confirm they pass.

### Task 3: Complete Migration Set In Signed Backup Contract

**Files:**
- Modify: `deployment/scripts/backup-postgres.sh`
- Modify: `deployment/scripts/restore-drill.sh`
- Modify: `deployment/scripts/validate-backup-manifest.js`
- Modify: `.github/scripts/backup-evidence-finalizer.sh`
- Modify: `.github/workflows/database-backup.yml`
- Modify: `backend/api/tests/backup-scripts.test.js`
- Modify: `backend/api/tests/backup-evidence-finalizer.test.js`

**Interfaces:**
- Produces: manifest v5 applied and packaged-target migration count/digest/head fields, computed from sorted newline-delimited exact filenames.
- Consumes: packaged `backend/api/migrations/*.js`, snapshot-applied `SequelizeMeta`, and restored `SequelizeMeta`.

- [ ] Add failing tests for exact set success, missing/unknown/duplicate applied migrations, deterministic count/digest, restored set mismatch, and evidence propagation.
- [ ] Run focused backup/finalizer tests and confirm failures.
- [ ] Before dump, require snapshot-applied names to be an exact ordered prefix of packaged target names, then emit both identities in manifest v5.
- [ ] Verify the restored applied set and include applied/target identities in finalizer evidence.
- [ ] Re-run focused tests and confirm they pass.

### Task 4: Snapshot Holder Lifecycle

**Files:**
- Modify: `deployment/scripts/backup-postgres.sh`
- Modify: `backend/api/tests/backup-scripts.test.js`

**Interfaces:**
- Produces: controlled holder startup, `assert_snapshot_holder_alive`, and deterministic rollback/wait termination.

- [ ] Add failing harness tests proving no `pg_sleep(3600)` hard expiry remains, premature holder exit fails before publication, and successful backup explicitly rolls back and waits.
- [ ] Run the focused backup suite and confirm failures.
- [ ] Replace the sleeping `psql -c` process with an interactive holder, monitor it around every snapshot-dependent operation, and require clean explicit termination.
- [ ] Re-run the focused suite and confirm it passes without delayed tests.

### Task 5: Deterministic Representative Scale Lane

**Files:**
- Modify: `backend/api/tests/fixtures/representative-db.js`
- Create: `backend/api/tests/representative-db-scale.test.js`
- Modify: `.github/workflows/ci.yml`
- Modify: `backend/api/tests/release-foundation-contract.test.js`

**Interfaces:**
- Produces: `createRepresentativeScaleData(name)` with exactly 50 generated lawyers, 200 generated clients, and 1,000 generated consultations in addition to edge fixtures.

- [ ] Add a failing PostgreSQL test that generates scale data, asserts minimum pre-migration counts, migrates, and verifies exact generated identities/counts remain.
- [ ] Add a failing CI contract requiring the deterministic scale test in the representative lane.
- [ ] Run focused tests and confirm failures.
- [ ] Implement set-based deterministic `generate_series` inserts and post-migration count/digest reads while retaining existing edge fixtures.
- [ ] Re-run focused tests and confirm they pass within the existing 120-second lane budget.

### Task 6: Runbooks And Final Verification

**Files:**
- Modify: `docs/runbooks/backup-restore.md`
- Modify: `docs/runbooks/deploy-rollback.md`
- Modify: `DEPLOY.md` only if its canonical production contract requires the new variables.

**Interfaces:**
- Documents exact evidence production, Railway secret provisioning, freshness, live cluster/release bindings, manifest v5, complete pagination, and operator stop conditions.

- [ ] Update runbooks and contract tests with exact commands/variables and explicit statement that local test evidence never authorizes production.
- [ ] Run focused Jest suites for backup scripts, finalizer, release contract, evidence validator, and representative migration.
- [ ] Run `bash -n` on every changed shell script and `node --check` on every changed JavaScript executable.
- [ ] Run `graphify update .`, inspect `git diff --check`, `git diff`, and `git status --short`.
- [ ] Stage only the intentional files listed by the final diff, verify `git diff --cached`, and commit with a concise Session A review-fix message.
