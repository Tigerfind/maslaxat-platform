# PostgreSQL Backup and Restore Runbook

## Objectives

- Pilot RPO: 24 hours. Take an additional manual snapshot immediately before every production migration or destructive maintenance operation.
- Pilot RTO: 2 hours from incident declaration to an application smoke-tested isolated restore.
- Retention: 14 daily, 8 weekly, and 12 monthly logical backups. Every backup is protected from pruning for at least 48 hours.
- Railway managed backups: enable daily, weekly, and monthly retention in Railway and verify it monthly. Managed snapshots are a second recovery mechanism, not the off-site copy described here.

## Security Model

The daily publisher receives the production read-capable database URL, public `age` recipient, manifest signing private key, allowlisted public verification keyring, and write/list credentials scoped to the private backup bucket and `postgres/` prefix. It has no delete permission and never receives the `age` identity. Destructive retention runs in the separate protected `production-backup-retention` environment with list/read/delete credentials and no database URL, age identity, or signing private key.

The restore workflow receives read-only bucket credentials, the `age` identity, and an explicitly allowlisted verification keyring. It never receives the manifest signing private key. Primary restore evidence and independent finalizer evidence use separate signing keys in separate protected environments. Add a new public key and key ID to every keyring before rotating the publisher signer. Remove an old key only after `prune-backups.sh --check-key-retirement <key-id>` proves no signed backup references it. Retain old age identities until all dependent backups expire.

Each backup is a triplet:

1. `<id>.dump.age`: an `age`-encrypted PostgreSQL custom archive.
2. `<id>.manifest`: plaintext metadata, exact 64-hex SHA-256 checksums, source timestamp,
   complete migration count/digest/head, and source counts for users, consultations, payments,
   documents, and reviews.
3. `<id>.manifest.sig`: detached signature over the exact manifest bytes.

Manifest v5 has exactly these ordered fields and no others: `manifest_version`, `backup_id`,
`created_at`, `signing_key_id`, `encrypted_object`, both SHA-256 fields, `postgres_version`, complete
sorted applied migration count/digest/head, complete sorted packaged-target migration
count/digest/head, and the five core table counts. The applied list must be an exact ordered prefix
of the packaged target; only an ordered pending suffix is allowed.
`created_at` is canonical second-resolution UTC (`YYYY-MM-DDTHH:MM:SSZ`) and
must equal the timestamp embedded in `backup_id`.

The signature uploads last and acts as the commit marker. Every object is created with conditional
`If-None-Match: *`; a backup ID is immutable and cannot overwrite any existing triplet member. HEAD
must match local size and the `backupid`, `artifact`, and `sha256` metadata for all three objects.
Restore verifies the signature before trusting fields or downloading/decrypting the archive, then
verifies both exact checksums, migration head, and every signed source count.

## Required Configuration

Shared immutable execution inputs:

- Protected variable `BACKUP_TOOL_IMAGE_DIGEST`: reviewed tool image containing exact Node, PostgreSQL client, age, OpenSSL, AWS CLI, GitHub CLI, and core shell utilities.
- Protected variables `RESTORE_POSTGRES_IMAGE_DIGEST` and `RESTORE_REDIS_IMAGE_DIGEST`: reviewed service images. All three values must use exact `name@sha256:<64-hex>` syntax; mutable tags are refused.

Backup environment:

- Secret `BACKUP_DATABASE_URL`: least-privilege PostgreSQL backup role URL.
- Variables `BACKUP_EXPECTED_SERVER_ADDR`, `BACKUP_EXPECTED_SERVER_PORT`, and `BACKUP_EXPECTED_DATABASE`, plus secret `BACKUP_EXPECTED_CLUSTER_ID` from `pg_control_system()`. Libpq destination override parameters are rejected and all effective values are checked before snapshot work.
- Variable `BACKUP_AGE_RECIPIENT`: public `age1...` recipient.
- Secret `BACKUP_MANIFEST_SIGNING_KEY_B64`: base64 PEM signing private key.
- Variables `BACKUP_MANIFEST_SIGNING_KEY_ID` and `BACKUP_MANIFEST_ALLOWED_KEY_IDS`, plus secret JSON map `BACKUP_MANIFEST_VERIFY_KEYRING_JSON` containing base64 public PEM values.
- Variables `BACKUP_BUCKET` and `BACKUP_R2_ENDPOINT`.
- Secrets `BACKUP_R2_PUBLISH_ACCESS_KEY_ID` and `BACKUP_R2_PUBLISH_SECRET_ACCESS_KEY`: prefix-scoped write/list credentials with delete denied.
- Separate `RETENTION_R2_DELETE_ACCESS_KEY_ID` and `RETENTION_R2_DELETE_SECRET_ACCESS_KEY` in `production-backup-retention`.
- Separate retention-finalizer signing key/key ID in `production-backup-retention-finalization`.
- Separate backup-finalizer signing key/key ID in `production-backup-finalization`.

Restore environment:

- Secret `BACKUP_AGE_IDENTITY_B64`: base64 age identity, unavailable to the backup environment.
- Secret JSON map `BACKUP_MANIFEST_VERIFY_KEYRING_JSON` plus variable `BACKUP_MANIFEST_ALLOWED_KEY_IDS`.
- Primary restore-evidence signing key/key ID and separate finalizer signing key/key ID plus the primary evidence verification public key.
- Secrets `RESTORE_R2_ACCESS_KEY_ID` and `RESTORE_R2_SECRET_ACCESS_KEY`: read/list-only credentials.
- Secret `PRODUCTION_DATABASE_URL`: comparison-only production URL required by the restore guard.
- `RESTORE_ALLOWED_HOSTS`: explicit isolated-target host allowlist; the workflow uses only loopback.
- The same non-secret bucket and endpoint variables.

Do not print or upload database URLs, credentials, or private keys. Signed evidence contains only provenance, digests, counts, migration state, timing, result, key IDs, and recorded tool versions.

## Normal Operation

`.github/workflows/database-backup.yml` runs daily with a concurrency lock. It validates the generated manifest before signing, creates the encrypted triplet, verifies each object with HEAD, and records a fail-on-quarantine dry run. It cannot delete. `.github/workflows/database-backup-retention.yml` is the separately approved deletion boundary. Both workflows use the same non-cancelling `production-backup-mutation` concurrency group, so GitHub-enforced exclusion, rather than a self-asserted environment flag, prevents publisher/delete overlap.

`list-r2-backup-objects.js` follows explicit ListObjectsV2 continuation tokens to a terminal page.
Malformed truncation state, absent/repeated tokens, duplicate keys, key-count disagreement, malformed
JSON, or a failed page aborts before any inventory is returned. `prune-backups.sh` treats that
complete object listing only as discovery. A complete triplet enters retention
selection only after downloading its manifest/signature, verifying the detached signature, validating
the exact manifest v5 contract, and matching allowlisted key ID, manifest ID, and signed `created_at`. GFS buckets
use only that authenticated `created_at`. Invalid complete triplets print `QUARANTINE` and cannot
cause another backup to be retained or pruned. The script retains the newest backup in each selected
UTC day/week/month bucket, unions the 14/8/12 sets, and always retains verified triplets younger than
48 hours. It is dry-run by default. Apply rejects caller-supplied `RETENTION_NOW`; signed timestamps later than the trusted runner clock are quarantined and cannot consume GFS buckets.
Every listed key must exactly match `${BACKUP_PREFIX}/<backup-id>.(dump.age|manifest|manifest.sig)` with no nested directory or control character. Unknown, nested, tabbed, incomplete, unreadable, or quarantined inventory makes key retirement fail closed. A key may be retired only when its ID is absent from every successfully authenticated retained manifest and the complete inventory is readable.
Before complete-triplet deletion, apply re-downloads and re-verifies the signature and exact manifest, then HEAD-verifies size, backup ID, artifact type, and exact digest for all three objects. It deletes the signature first so an interrupted prune
cannot expose a partial triplet as restorable. Incomplete triplets are reported as `ORPHAN_PROTECTED`
until 48 hours old and `ORPHAN` afterward. They are never removed by normal GFS apply. After operator
review, old incomplete artifacts can be removed only with:

`prune-backups.sh --apply-orphans --reviewed-id <backup-id> [--reviewed-id <backup-id> ...] --confirm DELETE-INCOMPLETE-BACKUPS`

The command only acts on the explicitly reviewed IDs. Immediately before deletion it requires the
signature to remain absent, HEAD-verifies object `backupid`/artifact/SHA identity and provider
`LastModified` age, then rechecks signature absence before every object delete. Cloudflare R2 does
not support conditional `DeleteObject`, so an external writer with bucket credentials can still race
the final check and ordinary delete for both normal retention and orphan cleanup. Keep credentials isolated and stop publishers during every apply operation. Investigate upload or interrupted-prune failures first. Preserve a legal hold
or incident copy when required.

Review every daily workflow result. Alert if no successful signed triplet has been produced within 26 hours. Review R2 storage growth and the prune report weekly.

## Pre-Migration Snapshot

1. Dispatch `Encrypted database backup` manually before migration approval.
2. Record its `backup_id` in the change ticket.
3. Confirm all three HEAD checks succeeded and the signature object was uploaded last.
4. Do not begin migration until the workflow succeeds.
5. Keep the snapshot under the normal GFS policy; create a separately governed legal hold only when required.

The successful independent finalizer also emits `migration-backup-<run>.evidence` and its detached
signature. Evidence v3 binds backup time/ID, exact workflow release SHA, SHA-256 of the verified
PostgreSQL system identifier, committed success, artifact digests, exact pre-migration applied
count/digest/head, intended packaged-target count/digest/head, and key IDs.
Materialize evidence, signature, and finalizer public key as canonical base64 Railway secrets
`MIGRATION_BACKUP_EVIDENCE_B64`, `MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64`, and
`MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64`. Set `MIGRATION_BACKUP_EVIDENCE_KEY_ID` and
`MIGRATION_BACKUP_MAX_AGE_SECONDS` from 1 through 3600.
Dispatch backup from the exact release SHA exposed by Railway as `RAILWAY_GIT_COMMIT_SHA`.
Before DB access, predeploy validates signature, freshness, release, and the local image's exact
packaged target. After taking the migration advisory lock, it derives `system_identifier` and the
ordered applied `SequelizeMeta` set from the actual `DATABASE_URL`; both must match signed evidence,
and applied must remain an exact target prefix. Identity/meta query failure, absent/malformed evidence,
or any mismatch blocks `sequelize-cli`. Do not configure an operator-supplied expected cluster ID.
`DATABASE_URL` must be present and nonblank before evidence validation; this gate never falls back to
`DB_*` or localhost. Separate explicit non-production commands may retain their own DB configuration.
The migration role needs only its existing lock/schema privileges, `SELECT` on `SequelizeMeta`, and
permission to execute `pg_control_system()`; do not grant backup-table read access for this gate.
Local test evidence never authorizes it.

## Restore Drill

The monthly workflow creates a fresh PostgreSQL 16.4 database named `emaslaxat_restore_drill_<run>_<attempt>`. Before download, it records the expected server address, port, database, and PostgreSQL system identifier, then creates the marker. The restore script rejects libpq destination override parameters and verifies those effective values before marker access. It also requires the exact marker, no other public tables, the database-name prefix and allowlisted host, and a target unequal to and on a different host from production.

1. Dispatch `Monthly database restore drill`; optionally provide an exact signed `backup_id` and the
   incident declaration Unix epoch. If omitted, the workflow uses the GitHub workflow-run
   `created_at`, not restore-runner admission time.
2. The workflow completely paginates the prefix and selects only the newest canonical
   `.manifest.sig` commit marker; any malformed page fails the job.
3. Approve access to the separate `restore-drill` environment.
4. Confirm manifest/signature/archive HEAD identity and size limits, allowlisted key-ID selection, signature verification, encrypted checksum, decryption, plaintext checksum, and `pg_restore --list` all pass.
5. Confirm `pg_restore --exit-on-error --no-owner --no-acl` succeeds.
6. Confirm restored sorted migration count, digest, and head exactly match the signed applied source
   set. The signed packaged target may have a pending ordered suffix because this is a pre-migration
   backup; the restored snapshot must not claim that suffix was already applied.
7. Confirm restored counts exactly match all five signed source counts.
8. Confirm the lifecycle-owned HTTP/Socket application starts against the restore database without
   production jobs, reaches ready only after PostgreSQL, Redis, R2, and migration probes pass, and
   returns the current `/api/live`, `/api/ready`, and `/api/lawyers?limit=1` contracts.
9. Download and cryptographically verify the primary restore artifact and separate finalizer artifact. Both bind run/attempt, repository, ref/commit, backup ID, manifest/signature digests, and key IDs. The finalizer authenticates and hashes primary evidence when available and independently requires duration at most 7,200 seconds; absent primary evidence cannot produce `rto_pass=true`. Restore evidence
   must contain exact checksums, source timestamp/age, full start/completion timestamps,
   migration/count/smoke results, `rpo_pass=true`, `rto_pass=true`, and `result=success`. The finalizer
    artifact independently records incident epoch, known restore job result, elapsed duration, and RTO result even when the restore job itself times out. It never infers timeout from the earlier incident clock.
10. Record reviewer, workflow URL, source backup age, result, end-to-end duration, count comparison, migration head, and follow-up issue IDs in the operations log.

The RPO clock compares signed `created_at` with restore time and fails above 86,400 seconds. The RTO
clock begins at the operator-supplied incident epoch or immutable workflow dispatch `created_at`,
before environment admission, service provisioning, checkout, installation, and target creation.
Backup, retention, download, cryptographic, database, and smoke phases have explicit deadlines below job timeouts. The restore job times out after 115 minutes. Separate `if: always()` finalizers upload signed known-only evidence for backup, retention, and restore. Backup phase state advances to `snapshot_dump_complete` only after dump, complete migration/count assertions, explicit snapshot rollback, and clean holder termination. The holder has no fixed sleep expiry and its liveness is checked around every snapshot consumer. Retention failure/cancellation produces signed evidence and a nonzero finalizer result. A nominally successful restore fails if signed primary evidence cannot be produced, and its finalizer is nonzero without verified successful primary evidence. GitHub does not guarantee finalizer execution during whole-workflow cancellation, repository disablement, Actions control-plane outage, account suspension, or artifact-service failure; those require an external monitor.

All A2 jobs execute inside the reviewed `BACKUP_TOOL_IMAGE_DIGEST`, and restore services use `RESTORE_POSTGRES_IMAGE_DIGEST` and `RESTORE_REDIS_IMAGE_DIGEST`. Each protected repository variable must be a full lowercase `name@sha256:<64-hex>` reference; tags are rejected by `validate-image-reference.js`. Runtime apt installation is prohibited. Build and review the tool image separately with exact locked client versions, publish it immutably, update these protected digest variables through change control, and retain its SBOM/provenance with the release evidence.

Never weaken the production comparison, host allowlist, marker, name, or emptiness checks to make a
drill pass. `PRODUCTION_DATABASE_URL` is mandatory, not an optional safety hint. Create a new isolated
target instead. Never run `restore-drill.sh` against production, a replica, a developer database, or
a database containing application tables.

## Incident Recovery

1. Declare the incident and stop writes if corruption is ongoing.
2. Record incident start, expected recovery point, and incident commander.
3. Select the newest signed triplet before the corruption point; do not select an unsigned manifest or orphan archive.
4. Restore into a newly created isolated empty marker database and complete the standard drill checks.
5. Compare critical counts and business reconciliation totals with the last known-good evidence.
6. Have a second operator approve promotion/cutover using provider-native procedures. The scripts intentionally do not perform production cutover.
7. Preserve affected databases and logs according to incident and legal-hold policy.
8. After service recovery, rotate compromised credentials and run another independent restore drill.

Railway snapshots alone are not sufficient: provider/account failure can affect both the live database and managed snapshots. The encrypted R2 copy must remain in a separate account/security boundary where practical.

## Exit Codes

- `64`: missing or malformed configuration; correct variables or arguments.
- `65`: safety guard refused an operation; do not bypass it.
- `66`: signature, checksum, manifest, archive, or restored-data integrity failure; quarantine the triplet and investigate.
- `70`: external operation failed, including PostgreSQL, age, OpenSSL, R2, or backend smoke; retain logs and rerun only after diagnosis.

Any nonzero result fails the workflow. A failed restore drill is an operational incident and must have an owner and due date.
