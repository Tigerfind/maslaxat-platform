# Database baseline and production reconciliation

## Current production audit

Current deployment invariant: production has 56 `SequelizeMeta` entries and includes the exact
anchor `20260829000005-fix-reminder-column-names.js`. This anchor is guaranteed for the existing
production database; it is not a baseline capable of creating a new database.

Read-only audit on 2026-08-18:

- 23 expected tables, no missing or extra tables.
- `SequelizeMeta` exists and contains all 32 historical delta migrations through
  `20260823000000-add-legal-consents.js`.
- No duplicate reviews, phones, Payme transaction IDs, lawyer profiles or subscriptions.
- No non-positive withdrawals.
- 3,376 indexes were present because attribute-level `unique: true` had repeatedly created
  suffixed constraints during historical `sync({ alter: true })` runs.
- Nine historical consultations had a non-empty `question` and an empty `problems` array.

The repository contains three reconciliation migrations:

- `20260824000001-cleanup-duplicate-unique-indexes.js`
- `20260824000002-backfill-consultation-problems.js`
- `20260824000003-cleanup-duplicate-legal-indexes.js`

All three were applied to the development database. A subsequent `sync({ alter: true })` did not
recreate duplicate unique indexes. They were then applied to production during the 2026-08-18
maintenance window after a verified custom-format backup. Production post-audit reported 40
indexes, no duplicate sets, no drift and no unsafe data; `SequelizeMeta` contains 35 entries.

## Production reconciliation

The following procedure is retained for future environments and disaster recovery.

1. Create and verify a PostgreSQL backup.
2. Deploy the model changes that replace anonymous `unique: true` declarations with named indexes.
3. Stop API instances and background jobs.
4. Run `npm run db:audit` with read-only production credentials and retain the report.
5. Apply `20260824000001` first. It uses preflight checks, a 3-second lock timeout and preserves
   one verified canonical unique index per affected column.
6. Apply `20260824000002` to backfill `problems = [question]` only for empty historical rows.
7. Apply `20260824000003` to remove two duplicate Legal RAG indexes after verifying their canonical equivalents.
8. Run `npm run db:audit` again. Required result: no drift and no unsafe data.
9. Start one API instance, run smoke checks, then restore normal capacity.

Do not manually drop suffixed indexes. Most are constraint-backed and require
`ALTER TABLE ... DROP CONSTRAINT`, not `DROP INDEX`.

## Clean database baseline

`db:audit` is an operational drift/data guard, not a complete baseline proof. Before stamping a
baseline, a separate reviewed contract must compare every column type/nullability/default, enum,
foreign key action, CHECK constraint and index definition against the explicit baseline DDL.

The historical files are deltas over a schema historically created by `sequelize.sync()` and
cannot initialize an empty database. After production reconciliation:

1. Generate an explicit reviewed baseline that creates all 23 tables, enums, foreign keys,
    checks and the reviewed canonical index set. The baseline must not call `sequelize.sync()`.
2. Move the historical delta files to a non-executed `migrations/legacy/` directory while retaining
   them for audit history.
3. Test the baseline against a completely empty PostgreSQL database.
4. Run `db:audit` against both the clean baseline database and a restored production backup.
5. Define a reviewed transition from the current anchor to that baseline. Any `SequelizeMeta`
   change requires a maintenance window and verified production contract; do not stamp blindly.
6. Replace production `sequelize.sync()` with `sequelize.authenticate()`.
7. Update the runtime runner anchor only after both empty-DB and restored-production paths pass.

## Anchored forward runner

`src/scripts/runMigrations.js` is the production deploy runner. It deliberately solves only the
forward path for the known production lineage:

- The immutable anchor is `20260829000005-fix-reminder-column-names.js`.
- Only migration filenames lexicographically after that anchor are considered.
- Missing `migrations/`, missing `SequelizeMeta`, missing anchor file, or missing applied anchor all
  fail closed. The runner never creates or stamps a baseline.
- `up` uses a PostgreSQL session advisory lock, rechecks metadata after locking, executes migrations
  in filename order, and records each name only after its `up` succeeds.
- `status` is observational; `check` fails when forward migrations are pending; repeated `up` is a no-op.
- Railway runs `node src/scripts/runMigrations.js up` as predeploy. A failure prevents the candidate
  deployment from becoming active. Production startup independently checks that no forward migration
  is pending before `sync()`, jobs, or `listen`.

This does not make a clean database deployable. A clean database has no historical schema and no
anchor record, so both predeploy and startup refuse it until the explicit baseline above exists.

## Rollout and rollback

1. Back up production and restore it into a disposable PostgreSQL database.
2. On the clone, run runtime `status`, `up`, audit, and `up` again; the second `up` must apply nothing.
3. Deploy normally. Review predeploy output and then readiness/runtime `check`.
4. If predeploy fails before metadata insertion, fix the migration or data and retry. Migration files
   should be idempotent because DDL may have succeeded before an interrupted metadata insert.
5. The runner is forward-only and never calls `down`. Roll back application code only when it remains
   compatible with the applied schema; otherwise use a separately reviewed restore/repair procedure.

## Safety rules

- Never run `sync({ alter: true })` against production.
- Never replay historical delta migrations on an existing production database.
- Never run an audit through `server.js`; startup performs writes and index checks.
- Use a read-only PostgreSQL role and `PGOPTIONS` statement/lock timeouts for audits.
- Never move the runtime anchor or stamp a baseline merely to make a failed deployment pass.
