#!/usr/bin/env bash
set -euo pipefail

for name in RETENTION_JOB_RESULT RETENTION_RUN_ID RETENTION_RUN_ATTEMPT RETENTION_REPOSITORY \
  RETENTION_GIT_REF RETENTION_COMMIT_SHA RETENTION_FINALIZER_EVIDENCE_DIR \
  RETENTION_FINALIZER_SIGNING_KEY_FILE RETENTION_FINALIZER_SIGNING_KEY_ID; do
  [[ -n "${!name:-}" ]] || { printf 'retention-finalizer: missing %s\n' "$name" >&2; exit 64; }
done
[[ "$RETENTION_JOB_RESULT" =~ ^(success|failure|cancelled|skipped)$ ]] || { printf 'retention-finalizer: invalid job result\n' >&2; exit 64; }
[[ "$RETENTION_RUN_ID" =~ ^[0-9]+$ && "$RETENTION_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || { printf 'retention-finalizer: invalid run identity\n' >&2; exit 64; }

mkdir -p "$RETENTION_FINALIZER_EVIDENCE_DIR"
evidence="$RETENTION_FINALIZER_EVIDENCE_DIR/retention-finalizer-$RETENTION_RUN_ID.evidence"
cat > "$evidence" <<EOF
evidence_version=1
workflow_run_id=$RETENTION_RUN_ID
workflow_run_attempt=$RETENTION_RUN_ATTEMPT
repository=$RETENTION_REPOSITORY
git_ref=$RETENTION_GIT_REF
commit_sha=$RETENTION_COMMIT_SHA
retention_job_result=$RETENTION_JOB_RESULT
evidence_signing_key_id=$RETENTION_FINALIZER_SIGNING_KEY_ID
EOF
openssl dgst -sha256 -sign "$RETENTION_FINALIZER_SIGNING_KEY_FILE" -out "$evidence.sig" "$evidence"
[[ "$RETENTION_JOB_RESULT" == success ]] || exit 1
