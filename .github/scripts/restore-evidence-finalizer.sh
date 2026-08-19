#!/usr/bin/env bash
set -euo pipefail

for name in RESTORE_INCIDENT_EPOCH RESTORE_JOB_RESULT RESTORE_RUN_ID RESTORE_RUN_ATTEMPT RESTORE_REPOSITORY \
  RESTORE_GIT_REF RESTORE_COMMIT_SHA RESTORE_BACKUP_ID RESTORE_EVIDENCE_DIR \
  RESTORE_FINALIZER_SIGNING_KEY_FILE RESTORE_FINALIZER_SIGNING_KEY_ID; do
  [[ -n "${!name:-}" ]] || { printf 'restore-finalizer: missing %s\n' "$name" >&2; exit 64; }
done
[[ "$RESTORE_INCIDENT_EPOCH" =~ ^[0-9]+$ ]] || { printf 'restore-finalizer: invalid incident epoch\n' >&2; exit 64; }
[[ "$RESTORE_RUN_ID" =~ ^[0-9]+$ ]] || { printf 'restore-finalizer: invalid run ID\n' >&2; exit 64; }
[[ "$RESTORE_JOB_RESULT" =~ ^(success|failure|cancelled|skipped)$ ]] || {
  printf 'restore-finalizer: invalid restore job result\n' >&2; exit 64;
}

final_epoch="${RESTORE_FINAL_EPOCH:-$(date -u +%s)}"
[[ "$final_epoch" =~ ^[0-9]+$ && "$final_epoch" -ge "$RESTORE_INCIDENT_EPOCH" ]] || {
  printf 'restore-finalizer: invalid final epoch\n' >&2; exit 64;
}
duration=$((final_epoch - RESTORE_INCIDENT_EPOCH))
primary_evidence_sha256=unknown
primary_evidence_verified=false
manifest_sha256=unknown
manifest_signature_sha256=unknown
signing_key_id=unknown
primary_evidence_signing_key_id=unknown
if [[ -n "${RESTORE_PRIMARY_EVIDENCE_FILE:-}" ]]; then
  [[ -f "${RESTORE_PRIMARY_EVIDENCE_FILE:-}" && -f "${RESTORE_PRIMARY_EVIDENCE_FILE:-}.sig" \
    && -f "${RESTORE_PRIMARY_EVIDENCE_VERIFY_KEY_FILE:-}" ]] || { printf 'restore-finalizer: incomplete primary evidence\n' >&2; exit 66; }
  openssl dgst -sha256 -verify "$RESTORE_PRIMARY_EVIDENCE_VERIFY_KEY_FILE" \
    -signature "$RESTORE_PRIMARY_EVIDENCE_FILE.sig" "$RESTORE_PRIMARY_EVIDENCE_FILE" >/dev/null 2>&1 || {
      printf 'restore-finalizer: primary evidence signature invalid\n' >&2; exit 66;
    }
  evidence_field() { awk -F= -v key="$1" '$1 == key { value=substr($0,index($0,"=")+1); count++ } END { if(count != 1) exit 1; print value }' "$RESTORE_PRIMARY_EVIDENCE_FILE"; }
  [[ "$(evidence_field workflow_run_id)" == "$RESTORE_RUN_ID" \
    && "$(evidence_field evidence_version)" == 3 \
    && "$(evidence_field workflow_run_attempt)" == "$RESTORE_RUN_ATTEMPT" \
    && "$(evidence_field repository)" == "$RESTORE_REPOSITORY" \
    && "$(evidence_field git_ref)" == "$RESTORE_GIT_REF" \
    && "$(evidence_field commit_sha)" == "$RESTORE_COMMIT_SHA" \
    && "$(evidence_field backup_id)" == "$RESTORE_BACKUP_ID" ]] || {
      printf 'restore-finalizer: primary evidence provenance mismatch\n' >&2; exit 66;
    }
  manifest_sha256="$(evidence_field manifest_sha256)"
  manifest_signature_sha256="$(evidence_field manifest_signature_sha256)"
  signing_key_id="$(evidence_field signing_key_id)"
  primary_evidence_signing_key_id="$(evidence_field evidence_signing_key_id)"
  [[ "$manifest_sha256" =~ ^[a-fA-F0-9]{64}$ && "$manifest_signature_sha256" =~ ^[a-fA-F0-9]{64}$ \
    && "$signing_key_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ \
    && "$primary_evidence_signing_key_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
      printf 'restore-finalizer: primary evidence digest or key identity invalid\n' >&2; exit 66;
    }
  primary_evidence_sha256="$(sha256sum "$RESTORE_PRIMARY_EVIDENCE_FILE" | cut -d ' ' -f1)"
  primary_evidence_verified=true
fi
rto_pass=false
if [[ "$RESTORE_JOB_RESULT" == success && "$duration" -le 7200 && "$primary_evidence_verified" == true ]]; then
  [[ "$(evidence_field result)" == success && "$(evidence_field rto_pass)" == true ]] && rto_pass=true
fi

mkdir -p "$RESTORE_EVIDENCE_DIR"
evidence="$RESTORE_EVIDENCE_DIR/restore-finalizer-$RESTORE_RUN_ID.evidence"
cat > "$evidence" <<EOF
evidence_version=2
workflow_run_id=$RESTORE_RUN_ID
workflow_run_attempt=$RESTORE_RUN_ATTEMPT
repository=$RESTORE_REPOSITORY
git_ref=$RESTORE_GIT_REF
commit_sha=$RESTORE_COMMIT_SHA
backup_id=$RESTORE_BACKUP_ID
incident_epoch=$RESTORE_INCIDENT_EPOCH
final_epoch=$final_epoch
duration_seconds=$duration
restore_job_result=$RESTORE_JOB_RESULT
rto_target_seconds=7200
rto_pass=$rto_pass
primary_evidence_sha256=$primary_evidence_sha256
primary_evidence_verified=$primary_evidence_verified
manifest_sha256=$manifest_sha256
manifest_signature_sha256=$manifest_signature_sha256
signing_key_id=$signing_key_id
primary_evidence_signing_key_id=$primary_evidence_signing_key_id
evidence_signing_key_id=$RESTORE_FINALIZER_SIGNING_KEY_ID
EOF
openssl dgst -sha256 -sign "$RESTORE_FINALIZER_SIGNING_KEY_FILE" -out "$evidence.sig" "$evidence"
if [[ "$RESTORE_JOB_RESULT" == success && "$rto_pass" != true ]]; then
  exit 66
fi
