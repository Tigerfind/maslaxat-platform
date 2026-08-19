#!/usr/bin/env bash
set -euo pipefail

for name in BACKUP_JOB_RESULT BACKUP_RUN_ID BACKUP_RUN_ATTEMPT BACKUP_REPOSITORY BACKUP_GIT_REF \
  BACKUP_COMMIT_SHA BACKUP_FINALIZER_EVIDENCE_DIR BACKUP_FINALIZER_SIGNING_KEY_FILE \
  BACKUP_FINALIZER_SIGNING_KEY_ID; do
  [[ -n "${!name:-}" ]] || { printf 'backup-finalizer: missing %s\n' "$name" >&2; exit 64; }
done
[[ "$BACKUP_JOB_RESULT" =~ ^(success|failure|cancelled|skipped)$ ]] || { printf 'backup-finalizer: invalid job result\n' >&2; exit 64; }
[[ "$BACKUP_RUN_ID" =~ ^[0-9]+$ && "$BACKUP_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || { printf 'backup-finalizer: invalid run identity\n' >&2; exit 64; }

mkdir -p "$BACKUP_FINALIZER_EVIDENCE_DIR"
evidence="$BACKUP_FINALIZER_EVIDENCE_DIR/backup-finalizer-$BACKUP_RUN_ID.evidence"
cat > "$evidence" <<EOF
evidence_version=1
workflow_run_id=$BACKUP_RUN_ID
workflow_run_attempt=$BACKUP_RUN_ATTEMPT
repository=$BACKUP_REPOSITORY
git_ref=$BACKUP_GIT_REF
commit_sha=$BACKUP_COMMIT_SHA
backup_job_result=$BACKUP_JOB_RESULT
last_successful_phase=${BACKUP_LAST_SUCCESSFUL_PHASE:-unknown}
committed_triplet=${BACKUP_COMMITTED_TRIPLET:-unknown}
backup_id=${BACKUP_FINALIZED_ID:-unknown}
manifest_sha256=${BACKUP_FINALIZED_MANIFEST_SHA256:-unknown}
manifest_signature_sha256=${BACKUP_FINALIZED_SIGNATURE_SHA256:-unknown}
signing_key_id=${BACKUP_FINALIZED_SIGNING_KEY_ID:-unknown}
evidence_signing_key_id=$BACKUP_FINALIZER_SIGNING_KEY_ID
EOF
openssl dgst -sha256 -sign "$BACKUP_FINALIZER_SIGNING_KEY_FILE" -out "$evidence.sig" "$evidence"

if [[ "$BACKUP_JOB_RESULT" == success && "${BACKUP_COMMITTED_TRIPLET:-}" == true ]]; then
  for name in BACKUP_FINALIZED_ID BACKUP_FINALIZED_CREATED_AT BACKUP_FINALIZED_SOURCE_CLUSTER_SHA256 \
    BACKUP_FINALIZED_MANIFEST_SHA256 BACKUP_FINALIZED_SIGNATURE_SHA256 BACKUP_FINALIZED_SIGNING_KEY_ID \
    BACKUP_FINALIZED_APPLIED_MIGRATION_COUNT BACKUP_FINALIZED_APPLIED_MIGRATION_DIGEST \
    BACKUP_FINALIZED_APPLIED_MIGRATION_HEAD BACKUP_FINALIZED_TARGET_MIGRATION_COUNT \
    BACKUP_FINALIZED_TARGET_MIGRATION_DIGEST BACKUP_FINALIZED_TARGET_MIGRATION_HEAD; do
    [[ -n "${!name:-}" ]] || { printf 'backup-finalizer: missing successful evidence field %s\n' "$name" >&2; exit 66; }
  done
  migration_evidence="$BACKUP_FINALIZER_EVIDENCE_DIR/migration-backup-$BACKUP_RUN_ID.evidence"
  cat > "$migration_evidence" <<EOF
evidence_version=3
created_at=$BACKUP_FINALIZED_CREATED_AT
backup_id=$BACKUP_FINALIZED_ID
release_sha=$BACKUP_COMMIT_SHA
source_cluster_sha256=$BACKUP_FINALIZED_SOURCE_CLUSTER_SHA256
backup_job_result=$BACKUP_JOB_RESULT
committed_triplet=$BACKUP_COMMITTED_TRIPLET
manifest_sha256=$BACKUP_FINALIZED_MANIFEST_SHA256
manifest_signature_sha256=$BACKUP_FINALIZED_SIGNATURE_SHA256
backup_signing_key_id=$BACKUP_FINALIZED_SIGNING_KEY_ID
applied_migration_count=$BACKUP_FINALIZED_APPLIED_MIGRATION_COUNT
applied_migration_digest=$BACKUP_FINALIZED_APPLIED_MIGRATION_DIGEST
applied_migration_head=$BACKUP_FINALIZED_APPLIED_MIGRATION_HEAD
target_migration_count=$BACKUP_FINALIZED_TARGET_MIGRATION_COUNT
target_migration_digest=$BACKUP_FINALIZED_TARGET_MIGRATION_DIGEST
target_migration_head=$BACKUP_FINALIZED_TARGET_MIGRATION_HEAD
evidence_signing_key_id=$BACKUP_FINALIZER_SIGNING_KEY_ID
EOF
  openssl dgst -sha256 -sign "$BACKUP_FINALIZER_SIGNING_KEY_FILE" \
    -out "$migration_evidence.sig" "$migration_evidence"
fi
