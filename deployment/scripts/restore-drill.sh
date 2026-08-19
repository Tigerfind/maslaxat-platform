#!/usr/bin/env bash
set -euo pipefail

EX_CONFIG=64
EX_SAFETY=65
EX_INTEGRITY=66
EX_OPERATION=70
MARKER_VALUE=EMASLAXAT_RESTORE_DRILL_EMPTY_V1
RPO_TARGET_SECONDS=86400
RTO_TARGET_SECONDS=7200
DOWNLOAD_TIMEOUT_SECONDS=300
CRYPTO_TIMEOUT_SECONDS=300
DATABASE_TIMEOUT_SECONDS=3600
SMOKE_TIMEOUT_SECONDS=600

started_epoch="${RESTORE_STARTED_EPOCH:-$(date -u +%s)}"
[[ "$started_epoch" =~ ^[0-9]+$ ]] || started_epoch="$(date -u +%s)"
started_at="$(date -u -r "$started_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$started_epoch" +%Y-%m-%dT%H:%M:%SZ)"
result=failure
failure_code=$EX_OPERATION
failure_reason=unexpected_exit
source_created_at=unknown
source_age_seconds=-1
rpo_pass=false
rto_pass=false
expected_encrypted_sha=unknown
expected_plaintext_sha=unknown
manifest_sha256=unknown
manifest_signature_sha256=unknown
signing_key_id=unknown
migration_head=unknown
migration_count=unknown
migration_digest=unknown
migration_match=false
counts_match=false
backend_smoke_pass=false
users_count=unknown
consultations_count=unknown
payments_count=unknown
documents_count=unknown
reviews_count=unknown
work_dir=''

write_evidence() {
  local status="$1"
  local finished_epoch completed_at duration evidence_dir evidence backup_label
  finished_epoch="$(date -u +%s)"
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$((finished_epoch - started_epoch))
  ((duration >= 0 && duration <= RTO_TARGET_SECONDS)) && rto_pass=true || rto_pass=false
  evidence_dir="${RESTORE_EVIDENCE_DIR:-$PWD}"
  mkdir -p "$evidence_dir" 2>/dev/null || return
  backup_label="${BACKUP_ID:-unknown}"
  [[ "$backup_label" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] || backup_label=invalid
  evidence="$evidence_dir/restore-$backup_label.evidence"
  cat > "$evidence" <<EOF
evidence_version=3
backup_id=$backup_label
workflow_run_id=${GITHUB_RUN_ID:-unknown}
workflow_run_attempt=${GITHUB_RUN_ATTEMPT:-unknown}
repository=${GITHUB_REPOSITORY:-unknown}
git_ref=${GITHUB_REF:-unknown}
commit_sha=${GITHUB_SHA:-unknown}
result=$result
failure_code=$([[ "$result" == success ]] && printf 0 || printf '%s' "$failure_code")
failure_reason=$([[ "$result" == success ]] && printf none || printf '%s' "$failure_reason")
started_at=$started_at
completed_at=$completed_at
duration_seconds=$duration
source_created_at=$source_created_at
source_age_seconds=$source_age_seconds
rpo_target_seconds=$RPO_TARGET_SECONDS
rpo_pass=$rpo_pass
rto_target_seconds=$RTO_TARGET_SECONDS
rto_pass=$rto_pass
encrypted_sha256=$expected_encrypted_sha
plaintext_sha256=$expected_plaintext_sha
manifest_sha256=$manifest_sha256
manifest_signature_sha256=$manifest_signature_sha256
signing_key_id=$signing_key_id
evidence_signing_key_id=$RESTORE_EVIDENCE_SIGNING_KEY_ID
runtime_versions=${RESTORE_RUNTIME_VERSIONS:-unknown}
migration_head=$migration_head
migration_count=$migration_count
migration_digest=$migration_digest
migration_match=$migration_match
counts_match=$counts_match
backend_smoke_pass=$backend_smoke_pass
users_count=$users_count
consultations_count=$consultations_count
payments_count=$payments_count
documents_count=$documents_count
reviews_count=$reviews_count
EOF
  openssl dgst -sha256 -sign "$RESTORE_EVIDENCE_SIGNING_KEY_FILE" -out "$evidence.sig" "$evidence" 2>/dev/null || return
  [[ "$status" == 0 ]] && printf 'evidence=%s\nresult=success\n' "$evidence"
}

on_exit() {
  local status=$? evidence_status=0
  trap - EXIT
  [[ -z "$work_dir" ]] || rm -rf "$work_dir"
  write_evidence "$status" || evidence_status=$?
  if [[ "$status" == 0 && "$evidence_status" != 0 ]]; then
    printf 'restore-drill: signed primary evidence could not be produced\n' >&2
    exit "$EX_OPERATION"
  fi
  exit "$status"
}
trap on_exit EXIT

die() {
  local code="$1"
  shift
  failure_code="$code"
  failure_reason="$(printf '%s' "$*" | tr '[:space:]' '_' | tr -cd 'A-Za-z0-9._-')"
  printf 'restore-drill: %s\n' "$*" >&2
  exit "$code"
}

require_env() {
  [[ -n "${!1:-}" ]] || die "$EX_CONFIG" "required environment variable $1 is missing"
}

bounded() {
  local seconds="$1"
  shift
  timeout "$seconds" "$@"
}

for name in RESTORE_DATABASE_URL PRODUCTION_DATABASE_URL RESTORE_ALLOWED_HOSTS RESTORE_DATABASE_MARKER \
  RESTORE_EVIDENCE_DIR BACKUP_ID BACKUP_BUCKET BACKUP_R2_ENDPOINT BACKUP_AGE_IDENTITY_FILE \
  BACKUP_MANIFEST_VERIFY_KEYRING_DIR BACKUP_MANIFEST_ALLOWED_KEY_IDS RESTORE_EXPECTED_SERVER_ADDR RESTORE_EXPECTED_SERVER_PORT \
  RESTORE_EXPECTED_DATABASE RESTORE_EXPECTED_CLUSTER_ID RESTORE_EVIDENCE_SIGNING_KEY_FILE \
  RESTORE_EVIDENCE_SIGNING_KEY_ID; do
  require_env "$name"
done

[[ "$RESTORE_DATABASE_MARKER" == "$MARKER_VALUE" ]] || die "$EX_SAFETY" 'invalid restore marker confirmation'
[[ "$BACKUP_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] || die "$EX_CONFIG" 'invalid BACKUP_ID'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! node -e '
  const [targetRaw, productionRaw, allowRaw] = process.argv.slice(1);
  const parse = (raw) => {
    const value = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(value.protocol)) throw new Error("protocol");
    for (const key of value.searchParams.keys()) {
      if (["host", "hostaddr", "port", "dbname", "service"].includes(key.toLowerCase())) throw new Error("override");
    }
    return value;
  };
  const target = parse(targetRaw);
  const production = parse(productionRaw);
  const allowed = allowRaw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!allowed.includes(target.hostname.toLowerCase())) throw new Error("allowlist");
  if (!database.startsWith("emaslaxat_restore_drill_")) throw new Error("database-name");
  if (target.href === production.href) throw new Error("production-equality");
  if (target.hostname.toLowerCase() === production.hostname.toLowerCase()) throw new Error("production-host");
' "$RESTORE_DATABASE_URL" "$PRODUCTION_DATABASE_URL" "$RESTORE_ALLOWED_HOSTS"; then
  die "$EX_SAFETY" 'restore destination failed explicit nonproduction allowlist/production comparison'
fi

identity="$(bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 -c \
  "SELECT host(inet_server_addr()), inet_server_port(), current_database(), system_identifier::text FROM pg_control_system();")" ||
  die "$EX_OPERATION" 'could not verify effective restore identity'
IFS=$'\t' read -r actual_addr actual_port actual_database actual_cluster <<< "$identity"
[[ "$actual_addr" == "$RESTORE_EXPECTED_SERVER_ADDR" && "$actual_port" == "$RESTORE_EXPECTED_SERVER_PORT" \
  && "$actual_database" == "$RESTORE_EXPECTED_DATABASE" && "$actual_cluster" == "$RESTORE_EXPECTED_CLUSTER_ID" ]] ||
  die "$EX_SAFETY" 'effective restore identity does not match approved address, port, database, and cluster'

marker="$(bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
  'SELECT marker FROM restore_drill_marker WHERE id = 1;')" || die "$EX_OPERATION" 'could not verify restore marker'
marker="$(printf '%s' "$marker" | tr -d '[:space:]')"
[[ "$marker" == "$MARKER_VALUE" ]] || die "$EX_SAFETY" 'target is missing the isolated restore marker'

table_count="$(bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'restore_drill_marker';")" ||
  die "$EX_OPERATION" 'could not verify target emptiness'
table_count="$(printf '%s' "$table_count" | tr -d '[:space:]')"
[[ "$table_count" == 0 ]] || die "$EX_SAFETY" 'restore target is not empty'

prefix="$(node "$script_dir/validate-backup-config.js" prefix "${BACKUP_PREFIX:-postgres}" 2>&1)" ||
  die "$EX_CONFIG" "$prefix"
work_dir="$(mktemp -d)" || die "$EX_OPERATION" 'could not create temporary directory'
manifest="$work_dir/$BACKUP_ID.manifest"
signature="$work_dir/$BACKUP_ID.manifest.sig"
encrypted="$work_dir/$BACKUP_ID.dump.age"
dump="$work_dir/$BACKUP_ID.dump"
MAX_MANIFEST_BYTES=65536
MAX_SIGNATURE_BYTES=16384
MAX_ENCRYPTED_BYTES="${RESTORE_MAX_ENCRYPTED_BYTES:-107374182400}"

head_object() {
  local object="$1" artifact="$2" maximum="$3"
  local size object_id actual_artifact object_sha
  read -r size object_id actual_artifact object_sha < <(
    bounded "$DOWNLOAD_TIMEOUT_SECONDS" aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3api head-object \
      --bucket "$BACKUP_BUCKET" --key "$prefix/$object" \
      --query '[ContentLength,Metadata.backupid,Metadata.artifact,Metadata.sha256]' --output text
  ) || die "$EX_OPERATION" "HEAD failed for $object"
  [[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 && "$size" -le "$maximum" ]] || die "$EX_INTEGRITY" "object size is invalid for $object"
  [[ "$object_id" == "$BACKUP_ID" && "$actual_artifact" == "$artifact" && "$object_sha" =~ ^[a-fA-F0-9]{64}$ ]] ||
    die "$EX_INTEGRITY" "object identity is invalid for $object"
  printf '%s\t%s' "$size" "$object_sha"
}

download() {
  local object="$1"
  local destination="$2"
  bounded "$DOWNLOAD_TIMEOUT_SECONDS" aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3 cp \
    "s3://$BACKUP_BUCKET/$prefix/$object" "$destination" --only-show-errors ||
    die "$EX_OPERATION" "download failed for $object"
}

IFS=$'\t' read -r signature_size signature_metadata_sha <<< "$(head_object "$BACKUP_ID.manifest.sig" manifest-signature "$MAX_SIGNATURE_BYTES")"
IFS=$'\t' read -r manifest_size manifest_metadata_sha <<< "$(head_object "$BACKUP_ID.manifest" manifest "$MAX_MANIFEST_BYTES")"
download "$BACKUP_ID.manifest.sig" "$signature"
download "$BACKUP_ID.manifest" "$manifest"
[[ "$(wc -c < "$signature" | tr -d '[:space:]')" == "$signature_size" \
  && "$(sha256sum "$signature" | cut -d ' ' -f 1)" == "$signature_metadata_sha" ]] || die "$EX_INTEGRITY" 'signature download identity mismatch'
[[ "$(wc -c < "$manifest" | tr -d '[:space:]')" == "$manifest_size" \
  && "$(sha256sum "$manifest" | cut -d ' ' -f 1)" == "$manifest_metadata_sha" ]] || die "$EX_INTEGRITY" 'manifest download identity mismatch'
manifest_sha256="$manifest_metadata_sha"
manifest_signature_sha256="$signature_metadata_sha"

signing_key_id="$(bounded "$CRYPTO_TIMEOUT_SECONDS" node "$script_dir/validate-backup-manifest.js" \
  "$manifest" '' key-id 2>&1)" || die "$EX_INTEGRITY" "$signing_key_id"
verify_key="$(node "$script_dir/resolve-backup-verify-key.js" "$signing_key_id" \
  "$BACKUP_MANIFEST_VERIFY_KEYRING_DIR" "$BACKUP_MANIFEST_ALLOWED_KEY_IDS" 2>&1)" ||
  die "$EX_INTEGRITY" "$verify_key"
if ! bounded "$CRYPTO_TIMEOUT_SECONDS" openssl dgst -sha256 -verify \
  "$verify_key" -signature "$signature" "$manifest"; then
  die "$EX_INTEGRITY" 'manifest signature verification failed'
fi
if ! validated_manifest="$(bounded "$CRYPTO_TIMEOUT_SECONDS" node "$script_dir/validate-backup-manifest.js" \
  "$manifest" "$BACKUP_ID" 2>&1)"; then
  die "$EX_INTEGRITY" "$validated_manifest"
fi
IFS=$'\t' read -r _manifest_version _manifest_backup_id source_created_at signing_key_id _encrypted_object \
  expected_encrypted_sha expected_plaintext_sha postgres_version expected_migration_count expected_migration_digest expected_migration_head \
  expected_users_count expected_consultations_count expected_payments_count expected_documents_count \
  expected_reviews_count <<< "$validated_manifest"

source_epoch="$(node -e '
  const value = Date.parse(process.argv[1]);
  if (!Number.isFinite(value)) process.exit(1);
  process.stdout.write(String(Math.floor(value / 1000)));
' "$source_created_at")" || die "$EX_INTEGRITY" 'manifest source timestamp is invalid'
now_epoch="$(date -u +%s)"
source_age_seconds=$((now_epoch - source_epoch))
((source_age_seconds >= 0)) || die "$EX_INTEGRITY" 'manifest source timestamp is in the future'
if ((source_age_seconds <= RPO_TARGET_SECONDS)); then rpo_pass=true; else rpo_pass=false; fi
[[ "$rpo_pass" == true ]] || die "$EX_INTEGRITY" 'RPO target exceeded'

IFS=$'\t' read -r encrypted_size encrypted_metadata_sha <<< "$(head_object "$BACKUP_ID.dump.age" encrypted-dump "$MAX_ENCRYPTED_BYTES")"
[[ "$encrypted_metadata_sha" == "$expected_encrypted_sha" ]] || die "$EX_INTEGRITY" 'encrypted dump checksum metadata mismatch'
download "$BACKUP_ID.dump.age" "$encrypted"
[[ "$(wc -c < "$encrypted" | tr -d '[:space:]')" == "$encrypted_size" ]] || die "$EX_INTEGRITY" 'encrypted object size changed during download'
actual_encrypted_sha="$(sha256sum "$encrypted" | cut -d ' ' -f 1)"
[[ "$actual_encrypted_sha" == "$expected_encrypted_sha" ]] || die "$EX_INTEGRITY" 'encrypted dump checksum mismatch'
if ! bounded "$CRYPTO_TIMEOUT_SECONDS" age --decrypt -i "$BACKUP_AGE_IDENTITY_FILE" -o "$dump" "$encrypted"; then
  die "$EX_INTEGRITY" 'backup decryption failed'
fi
actual_plaintext_sha="$(sha256sum "$dump" | cut -d ' ' -f 1)"
[[ "$actual_plaintext_sha" == "$expected_plaintext_sha" ]] || die "$EX_INTEGRITY" 'plaintext dump checksum mismatch'
if ! bounded "$DATABASE_TIMEOUT_SECONDS" pg_restore --list "$dump" >/dev/null; then
  die "$EX_INTEGRITY" 'dump is not a readable PostgreSQL custom archive'
fi

bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'DROP TABLE restore_drill_marker;' >/dev/null ||
  die "$EX_OPERATION" 'could not consume restore marker'
if ! bounded "$DATABASE_TIMEOUT_SECONDS" pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$RESTORE_DATABASE_URL" "$dump"; then
  die "$EX_OPERATION" 'pg_restore failed'
fi

restored_migrations="$work_dir/restored-migrations.txt"
if ! bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT name FROM "SequelizeMeta" ORDER BY name;' | tr -d '\r' > "$restored_migrations"; then
  die "$EX_OPERATION" 'complete migration verification failed'
fi
[[ -s "$restored_migrations" ]] || die "$EX_INTEGRITY" 'restored migration set is empty'
while IFS= read -r migration; do
  [[ "$migration" =~ ^[A-Za-z0-9._-]+\.js$ ]] || die "$EX_INTEGRITY" 'restored migration set is malformed'
done < "$restored_migrations"
LC_ALL=C sort -c "$restored_migrations" >/dev/null 2>&1 || die "$EX_INTEGRITY" 'restored migration set is not sorted'
[[ "$(LC_ALL=C uniq -d "$restored_migrations" | wc -l | tr -d '[:space:]')" == 0 ]] ||
  die "$EX_INTEGRITY" 'restored migration set contains duplicates'
migration_count="$(wc -l < "$restored_migrations" | tr -d '[:space:]')"
migration_digest="$(sha256sum "$restored_migrations" | cut -d ' ' -f 1)"
migration_head="$(tail -n 1 "$restored_migrations")"
[[ "$migration_count" == "$expected_migration_count" && "$migration_digest" == "$expected_migration_digest" \
  && "$migration_head" == "$expected_migration_head" ]] || die "$EX_INTEGRITY" 'restored complete migration set mismatch'
migration_match=true

count_restored_table() {
  local table="$1"
  local count
  count="$(bounded "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT COUNT(*) FROM \"$table\";" | tr -d '[:space:]')" ||
    die "$EX_OPERATION" "count verification failed for $table"
  [[ "$count" =~ ^[0-9]+$ ]] || die "$EX_INTEGRITY" "invalid count for $table"
  printf '%s' "$count"
}

for table in users consultations payments documents reviews; do
  value="$(count_restored_table "$table")"
  printf -v "${table}_count" '%s' "$value"
  expected_variable="expected_${table}_count"
  [[ "$value" == "${!expected_variable}" ]] || die "$EX_INTEGRITY" "restored row count mismatch for $table"
done
counts_match=true

backend_dir="${RESTORE_BACKEND_DIR:-$(cd "$script_dir/../../backend/api" && pwd)}"
smoke_output="$(cd "$backend_dir" && NODE_ENV=test RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
  DATABASE_URL="$RESTORE_DATABASE_URL" bounded "$SMOKE_TIMEOUT_SECONDS" node src/scripts/restoreBackendSmoke.js)" ||
  die "$EX_INTEGRITY" 'backend startup/readiness/API smoke failed'
[[ "$smoke_output" == *'migration_state=ok'* && "$smoke_output" == *'readiness=ok'* \
  && "$smoke_output" == *'api_smoke=ok'* ]] || die "$EX_INTEGRITY" 'backend startup/readiness/API smoke output invalid'
backend_smoke_pass=true

finished_epoch="$(date -u +%s)"
duration_seconds=$((finished_epoch - started_epoch))
if ((duration_seconds >= 0 && duration_seconds <= RTO_TARGET_SECONDS)); then rto_pass=true; else rto_pass=false; fi
[[ "$rto_pass" == true ]] || die "$EX_INTEGRITY" 'RTO target exceeded'

result=success
failure_code=0
failure_reason=none
