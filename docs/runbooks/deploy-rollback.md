# Pilot Deploy And Rollback Runbook

This runbook records the release procedure and evidence boundary. It does not authorize a deploy, payment cutover, capability cutover, production migration, or destructive rollback.

## Required Roles

- Release operator: executes the approved Railway deployment.
- Database operator: confirms migration and backup evidence.
- Reviewer: verifies the change record and smoke results independently.
- Approver: gives explicit production deploy and rollback approval.

One person may not both execute and independently approve the same production change.

## Release Evidence

Create a change record with these fields before requesting approval:

```text
release_id:
commit_sha:
branch:
staging_backend_deployment:
staging_frontend_deployment:
migration_head:
pre_backup_applied_migration_count_digest:
packaged_target_migration_count_digest:
empty_migration_workflow_url:
representative_migration_workflow_url:
backup_id:
backup_finalizer_evidence_artifact:
backup_evidence_key_id:
backup_source_cluster_sha256:
restore_drill_workflow_url:
playwright_artifact_url:
k6_artifact_url:
real_device_evidence_url:
sentry_evidence_url:
r2_reconciliation_artifact_url:
dependency_audit_artifact_url:
reviewer:
review_verdict:
deploy_approver:
approved_at_utc:
```

Do not put credentials, tokens, database URLs, private file names, user data, legal content, or signed URLs in the record.

## Pre-deploy Gate

- [ ] Exact commit SHA reviewed; working tree artifacts are not substituted for the release commit.
- [ ] Session A migration, payment, and capability gates have their own approved evidence. This runbook does not change their modes.
- [ ] Empty and representative PostgreSQL migration checks passed for the exact image.
- [ ] Backend image/toolchain inspection passed.
- [ ] Staging `/api/live` and dependency-aware `/api/ready` are green.
- [ ] Full staging Playwright matrix passed and failure-only artifacts were reviewed.
- [ ] Approved staging k6 baseline passed; duplicate checkout business objects equal zero.
- [ ] Private R2 upload/download/delete and reconciliation passed without exposing data.
- [ ] Sanitized Sentry events and required alerts were verified.
- [ ] A fresh encrypted backup triplet from the exact release SHA is complete; independently signed
      predeploy evidence matches production cluster and is at most 3,600 seconds old.
- [ ] A successful isolated restore drill is approved.
- [ ] Real-device checklist is complete, including required TURN call pairs.
- [ ] Exact release lockfiles were audited and unresolved findings have explicit acceptance.
- [ ] Rollback owner, previous compatible SHA, and rollback limits are recorded.
- [ ] Explicit production deploy approval is recorded.

Any missing checkbox blocks deployment. Local mocks, dry runs, test discovery, and static checks do not satisfy staging or production gates.

## Deployment

1. Freeze unrelated production changes and record the start time.
2. Confirm backup ID, exact applied prefix count/digest/head, exact packaged target
   count/digest/head, finalizer key ID, source-cluster binding, release SHA, and freshness.
   Materialize only that approved signed evidence tuple.
3. Deploy the approved backend SHA through the reviewed Railway configuration. `npm run db:predeploy`
   validates static evidence before connection, then validates actual `DATABASE_URL` cluster and
   applied prefix under the migration advisory lock before spawning `sequelize-cli`. Missing,
   unreadable, or rejected live identity is a stop condition, not a reason to bypass the gate.
4. Wait for backend liveness and readiness. Stop if readiness does not become green within the approved window.
5. Run backend smoke: synthetic login, catalog, socket connection, and one small private upload/download/delete cycle.
6. Deploy the frontend built from the same approved SHA.
7. Verify `sw.js`, `index.html`, and `manifest.json` revalidate; verify hashed `/static` assets are immutable.
8. Run the approved production smoke matrix. Provider transactions, SMTP, TURN, and push require their separately approved real checks.
9. Record deployment IDs, timestamps, smoke results, and reviewer verdict. Do not label the release production-verified until every required result has evidence.

## Stop And Roll Back

Stop rollout and request rollback approval for any of these conditions:

- readiness remains red or dependencies flap;
- migration status differs from the approved head;
- authentication, authorization, private-file access, or socket isolation regresses;
- payment reconciliation, ledger balance, or provider idempotency reports a mismatch;
- elevated 5xx, background-job, or client crash alerts breach the approved threshold;
- the frontend cannot load after a service-worker update;
- smoke checks expose private data or fail repeatedly.

Rollback procedure:

1. Stop further rollout and preserve logs, request IDs, deployment IDs, and alert timestamps.
2. Disable traffic to the unhealthy release using provider-native controls.
3. Obtain explicit rollback approval and redeploy the recorded previous compatible application SHA.
4. Do not run destructive migration undo. Additive schema, legacy role compatibility, and retained local storage exist for application rollback; follow Session A-owned migration/cutover rulings.
5. If data integrity is uncertain, stop writes and follow `docs/runbooks/backup-restore.md`. Restore into an isolated database first; these scripts do not cut production over.
6. Verify backend readiness before restoring frontend traffic.
7. Purge or update only MaslaXat application caches through the supported service-worker lifecycle. Never instruct users to clear unrelated browser data as the primary rollback.
8. Repeat synthetic login, catalog, socket, private-file, and affected-feature smoke checks.

## Rollback Evidence

```text
incident_id:
failed_release_sha:
previous_compatible_sha:
rollback_approver:
rollback_started_at_utc:
rollback_completed_at_utc:
trigger:
railway_deployment_ids:
migration_head_before:
migration_head_after:
backup_id:
readiness_result:
smoke_result:
data_reconciliation_result:
sentry_or_log_links:
open_followups:
reviewer:
review_verdict:
```

Mark rollback verified only after the previous release is serving traffic, readiness is green, affected smoke checks pass, and the independent reviewer signs the record.
