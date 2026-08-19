#!/usr/bin/env bash
set -euo pipefail

EX_CONFIG=64
EX_SAFETY=65
EX_INTEGRITY=66
EX_OPERATION=70
DATABASE_TIMEOUT_SECONDS=600
CRYPTO_TIMEOUT_SECONDS=300
R2_TIMEOUT_SECONDS=300
phase_file="${BACKUP_PHASE_STATE_FILE:-}"

record_phase() {
  local phase="$1" committed="${2:-false}"
  [[ -z "$phase_file" ]] || printf 'last_successful_phase=%s\ncommitted_triplet=%s\n' "$phase" "$committed" > "$phase_file"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'last_phase=%s\ncommitted_triplet=%s\n' "$phase" "$committed" >> "$GITHUB_OUTPUT"
  fi
}

record_phase initialized false

die() {
  local code="$1"
  shift
  printf 'backup-postgres: %s\n' "$*" >&2
  exit "$code"
}

require_env() {
  [[ -n "${!1:-}" ]] || die "$EX_CONFIG" "required environment variable $1 is missing"
}

for name in DATABASE_URL BACKUP_AGE_RECIPIENT BACKUP_MANIFEST_SIGNING_KEY_FILE BACKUP_BUCKET BACKUP_R2_ENDPOINT \
  BACKUP_EXPECTED_SERVER_ADDR BACKUP_EXPECTED_SERVER_PORT BACKUP_EXPECTED_DATABASE BACKUP_EXPECTED_CLUSTER_ID; do
  require_env "$name"
done
require_env BACKUP_MANIFEST_SIGNING_KEY_ID
[[ "$BACKUP_MANIFEST_SIGNING_KEY_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
  die "$EX_CONFIG" 'BACKUP_MANIFEST_SIGNING_KEY_ID is invalid'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
url_error="$(node "$script_dir/validate-backup-config.js" url "$DATABASE_URL" 2>&1)" ||
  die "$EX_CONFIG" "$url_error"

[[ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]] || die "$EX_SAFETY" 'backup jobs must not receive BACKUP_AGE_IDENTITY_FILE'
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] || die "$EX_CONFIG" 'BACKUP_AGE_RECIPIENT must be an age public recipient'

timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
created_at="$(node "$script_dir/validate-backup-config.js" timestamp "$timestamp" 2>&1)" ||
  die "$EX_CONFIG" "$created_at"
revision="${GITHUB_SHA:-manual}"
revision="${revision:0:12}"
[[ "$revision" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EX_CONFIG" 'GITHUB_SHA contains unsupported characters'
backup_id="${timestamp}-${revision}"
prefix="$(node "$script_dir/validate-backup-config.js" prefix "${BACKUP_PREFIX:-postgres}" 2>&1)" ||
  die "$EX_CONFIG" "$prefix"

identity="$(timeout "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$DATABASE_URL" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 -c \
  "SELECT host(inet_server_addr()), inet_server_port(), current_database(), system_identifier::text FROM pg_control_system();")" ||
  die "$EX_OPERATION" 'could not verify effective source identity'
IFS=$'\t' read -r actual_addr actual_port actual_database actual_cluster <<< "$identity"
[[ "$actual_addr" == "$BACKUP_EXPECTED_SERVER_ADDR" && "$actual_port" == "$BACKUP_EXPECTED_SERVER_PORT" \
  && "$actual_database" == "$BACKUP_EXPECTED_DATABASE" && "$actual_cluster" == "$BACKUP_EXPECTED_CLUSTER_ID" ]] ||
  die "$EX_SAFETY" 'effective source identity does not match approved address, port, database, and cluster'
record_phase source_identity_verified false
source_cluster_sha256="$(printf '%s' "$actual_cluster" | sha256sum | cut -d ' ' -f 1)"
[[ "$source_cluster_sha256" =~ ^[a-f0-9]{64}$ ]] || die "$EX_INTEGRITY" 'source cluster digest is malformed'

aws_r2() {
  timeout "$R2_TIMEOUT_SECONDS" aws --endpoint-url "$BACKUP_R2_ENDPOINT" "$@"
}

object_exists() {
  local object="$1"
  local count
  count="$(aws_r2 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$prefix/$object" \
    --query 'KeyCount' --output text)" || die "$EX_OPERATION" "could not check object uniqueness for $object"
  [[ "$count" =~ ^[0-9]+$ ]] || die "$EX_INTEGRITY" "invalid uniqueness response for $object"
  [[ "$count" == 0 ]]
}

for suffix in dump.age manifest manifest.sig; do
  object_exists "$backup_id.$suffix" || die "$EX_SAFETY" "backup ID already exists: $backup_id"
done

work_dir="$(mktemp -d)" || die "$EX_OPERATION" 'could not create temporary directory'
snapshot_pid=''
cleanup() {
  if [[ -n "$snapshot_pid" ]]; then
    printf '\\q\n' >&8 2>/dev/null || true
    exec 8>&- 2>/dev/null || true
    exec 9<&- 2>/dev/null || true
    kill "$snapshot_pid" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT
dump_file="$work_dir/$backup_id.dump"
encrypted_file="$work_dir/$backup_id.dump.age"
manifest_file="$work_dir/$backup_id.manifest"
signature_file="$work_dir/$backup_id.manifest.sig"
snapshot_input="$work_dir/snapshot-input.pipe"
snapshot_output="$work_dir/snapshot-output.pipe"
mkfifo "$snapshot_input" "$snapshot_output" || die "$EX_OPERATION" 'could not create snapshot channels'

# Keep the exporting transaction open while pg_dump and signed source counts use one snapshot.
psql --dbname="$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 < "$snapshot_input" > "$snapshot_output" &
snapshot_pid=$!
exec 8> "$snapshot_input"
exec 9< "$snapshot_output"
printf '%s\n' 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();' \
  >&8 || die "$EX_OPERATION" 'could not start PostgreSQL backup snapshot'
if ! IFS= read -r -t "$DATABASE_TIMEOUT_SECONDS" -u 9 database_snapshot; then
  die "$EX_OPERATION" 'could not export PostgreSQL backup snapshot'
fi
database_snapshot="$(printf '%s' "$database_snapshot" | tr -d '[:space:]')"
[[ "$database_snapshot" =~ ^[A-Za-z0-9:-]+$ ]] || die "$EX_INTEGRITY" 'exported PostgreSQL snapshot is malformed'

assert_snapshot_holder_alive() {
  local running_pid
  while IFS= read -r running_pid; do
    [[ "$running_pid" == "$snapshot_pid" ]] && return 0
  done < <(jobs -pr)
  wait "$snapshot_pid" 2>/dev/null || true
  snapshot_pid=''
  die "$EX_OPERATION" 'PostgreSQL snapshot holder exited prematurely'
}
assert_snapshot_holder_alive

packaged_migrations="$work_dir/target-migrations.txt"
applied_migrations="$work_dir/applied-migrations.txt"
expected_applied_migrations="$work_dir/expected-applied-migrations.txt"
migrations_dir="$(cd "$script_dir/../../backend/api/migrations" && pwd)"
shopt -s nullglob
migration_files=("$migrations_dir"/*.js)
shopt -u nullglob
((${#migration_files[@]} > 0)) || die "$EX_INTEGRITY" 'packaged migration set is empty'
printf '%s\n' "${migration_files[@]##*/}" | LC_ALL=C sort > "$packaged_migrations"
while IFS= read -r migration; do
  [[ "$migration" =~ ^[A-Za-z0-9._-]+\.js$ ]] || die "$EX_INTEGRITY" 'packaged migration set is malformed'
done < "$packaged_migrations"
if ! timeout "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$database_snapshot'; SELECT name FROM \"SequelizeMeta\" ORDER BY name; COMMIT;" \
  | tr -d '\r' > "$applied_migrations"; then
  die "$EX_OPERATION" 'could not read complete applied migration set'
fi
assert_snapshot_holder_alive
[[ -s "$applied_migrations" ]] || die "$EX_INTEGRITY" 'applied migration set is empty'
while IFS= read -r migration; do
  [[ "$migration" =~ ^[A-Za-z0-9._-]+\.js$ ]] || die "$EX_INTEGRITY" 'applied migration set is malformed'
done < "$applied_migrations"
LC_ALL=C sort -c "$applied_migrations" >/dev/null 2>&1 || die "$EX_INTEGRITY" 'applied migration set is not sorted'
[[ "$(LC_ALL=C uniq -d "$applied_migrations" | wc -l | tr -d '[:space:]')" == 0 ]] ||
  die "$EX_INTEGRITY" 'applied migration set contains duplicates'
applied_migration_count="$(wc -l < "$applied_migrations" | tr -d '[:space:]')"
target_migration_count="$(wc -l < "$packaged_migrations" | tr -d '[:space:]')"
((applied_migration_count <= target_migration_count)) || die "$EX_INTEGRITY" 'applied migration set exceeds packaged target'
head -n "$applied_migration_count" "$packaged_migrations" > "$expected_applied_migrations"
cmp -s "$expected_applied_migrations" "$applied_migrations" ||
  die "$EX_INTEGRITY" 'applied migration set is not an exact ordered prefix of packaged target'
applied_migration_digest="$(sha256sum "$applied_migrations" | cut -d ' ' -f 1)"
applied_migration_head="$(tail -n 1 "$applied_migrations")"
target_migration_digest="$(sha256sum "$packaged_migrations" | cut -d ' ' -f 1)"
target_migration_head="$(tail -n 1 "$packaged_migrations")"
[[ "$applied_migration_count" =~ ^[0-9]+$ && "$applied_migration_count" -gt 0 \
  && "$target_migration_count" =~ ^[0-9]+$ && "$target_migration_count" -gt 0 \
  && "$applied_migration_digest" =~ ^[a-f0-9]{64}$ && "$target_migration_digest" =~ ^[a-f0-9]{64}$ ]] ||
  die "$EX_INTEGRITY" 'migration plan identity is malformed'

if ! timeout "$DATABASE_TIMEOUT_SECONDS" pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  --snapshot="$database_snapshot" --file="$dump_file"; then
  die "$EX_OPERATION" 'pg_dump failed'
fi
assert_snapshot_holder_alive

postgres_version="$(timeout "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT split_part(current_setting('server_version'), ' ', 1);" | tr -d '[:space:]')" ||
  die "$EX_OPERATION" 'could not read PostgreSQL server version'
[[ -n "$postgres_version" ]] || die "$EX_INTEGRITY" 'empty PostgreSQL version'

count_source_table() {
  local table="$1"
  local count
  assert_snapshot_holder_alive
  count="$(timeout "$DATABASE_TIMEOUT_SECONDS" psql --dbname="$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$database_snapshot'; SELECT COUNT(*) FROM \"$table\"; COMMIT;" \
    | tr -d '[:space:]')" ||
    die "$EX_OPERATION" "could not count source table $table"
  [[ "$count" =~ ^[0-9]+$ ]] || die "$EX_INTEGRITY" "invalid source count for $table"
  assert_snapshot_holder_alive
  printf '%s' "$count"
}

users_count="$(count_source_table users)"
consultations_count="$(count_source_table consultations)"
payments_count="$(count_source_table payments)"
documents_count="$(count_source_table documents)"
reviews_count="$(count_source_table reviews)"

# The archive and every signed source assertion are now fixed; release the exported snapshot.
assert_snapshot_holder_alive
printf '%s\n' 'ROLLBACK;' >&8 || die "$EX_OPERATION" 'could not roll back snapshot holder'
exec 8>&-
if ! wait "$snapshot_pid"; then
  snapshot_pid=''
  die "$EX_OPERATION" 'PostgreSQL snapshot holder did not terminate cleanly'
fi
snapshot_pid=''
exec 9<&-
record_phase snapshot_dump_complete false

plaintext_sha256="$(sha256sum "$dump_file" | cut -d ' ' -f 1)" || die "$EX_OPERATION" 'could not checksum dump'
[[ "$plaintext_sha256" =~ ^[a-fA-F0-9]{64}$ ]] || die "$EX_INTEGRITY" 'plaintext SHA-256 is malformed'
if ! timeout "$CRYPTO_TIMEOUT_SECONDS" age --encrypt -r "$BACKUP_AGE_RECIPIENT" -o "$encrypted_file" "$dump_file"; then
  die "$EX_OPERATION" 'age encryption failed'
fi
encrypted_sha256="$(sha256sum "$encrypted_file" | cut -d ' ' -f 1)" || die "$EX_OPERATION" 'could not checksum encrypted dump'
[[ "$encrypted_sha256" =~ ^[a-fA-F0-9]{64}$ ]] || die "$EX_INTEGRITY" 'encrypted SHA-256 is malformed'

cat > "$manifest_file" <<EOF
manifest_version=5
backup_id=$backup_id
created_at=$created_at
signing_key_id=$BACKUP_MANIFEST_SIGNING_KEY_ID
encrypted_object=$backup_id.dump.age
encrypted_sha256=$encrypted_sha256
plaintext_sha256=$plaintext_sha256
postgres_version=$postgres_version
applied_migration_count=$applied_migration_count
applied_migration_digest=$applied_migration_digest
applied_migration_head=$applied_migration_head
target_migration_count=$target_migration_count
target_migration_digest=$target_migration_digest
target_migration_head=$target_migration_head
users_count=$users_count
consultations_count=$consultations_count
payments_count=$payments_count
documents_count=$documents_count
reviews_count=$reviews_count
EOF

if ! node "$script_dir/validate-backup-manifest.js" "$manifest_file" "$backup_id" >/dev/null 2>&1; then
  die "$EX_INTEGRITY" 'generated manifest failed exact validation'
fi
record_phase manifest_validated false

if ! timeout "$CRYPTO_TIMEOUT_SECONDS" openssl dgst -sha256 -sign "$BACKUP_MANIFEST_SIGNING_KEY_FILE" -out "$signature_file" "$manifest_file"; then
  die "$EX_OPERATION" 'manifest signing failed'
fi

put_immutable() {
  local file="$1"
  local object="$2"
  local artifact="$3"
  local sha="$4"
  if ! aws_r2 s3api put-object --bucket "$BACKUP_BUCKET" --key "$prefix/$object" --body "$file" \
    --metadata "backupid=$backup_id,artifact=$artifact,sha256=$sha" --if-none-match '*' >/dev/null; then
    die "$EX_OPERATION" "immutable upload failed for $object"
  fi
}

head_verify() {
  local file="$1"
  local object="$2"
  local artifact="$3"
  local expected_sha="$4"
  local expected_size actual_size actual_id actual_artifact actual_sha
  expected_size="$(wc -c < "$file" | tr -d '[:space:]')"
  read -r actual_size actual_id actual_artifact actual_sha < <(
    aws_r2 s3api head-object --bucket "$BACKUP_BUCKET" --key "$prefix/$object" \
      --query '[ContentLength,Metadata.backupid,Metadata.artifact,Metadata.sha256]' --output text
  ) || die "$EX_INTEGRITY" "HEAD verification failed for $object"
  [[ "$actual_size" == "$expected_size" && "$actual_id" == "$backup_id" \
    && "$actual_artifact" == "$artifact" && "$actual_sha" == "$expected_sha" ]] ||
    die "$EX_INTEGRITY" "HEAD verification mismatch for $object"
}

manifest_sha256="$(sha256sum "$manifest_file" | cut -d ' ' -f 1)"
signature_sha256="$(sha256sum "$signature_file" | cut -d ' ' -f 1)"
[[ "$manifest_sha256" =~ ^[a-fA-F0-9]{64}$ && "$signature_sha256" =~ ^[a-fA-F0-9]{64}$ ]] ||
  die "$EX_INTEGRITY" 'artifact SHA-256 is malformed'

# The detached signature is the commit marker and is always published last.
put_immutable "$encrypted_file" "$backup_id.dump.age" encrypted-dump "$encrypted_sha256"
head_verify "$encrypted_file" "$backup_id.dump.age" encrypted-dump "$encrypted_sha256"
put_immutable "$manifest_file" "$backup_id.manifest" manifest "$manifest_sha256"
head_verify "$manifest_file" "$backup_id.manifest" manifest "$manifest_sha256"
put_immutable "$signature_file" "$backup_id.manifest.sig" manifest-signature "$signature_sha256"
head_verify "$signature_file" "$backup_id.manifest.sig" manifest-signature "$signature_sha256"
record_phase triplet_committed true
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'backup_id=%s\ncreated_at=%s\nsource_cluster_sha256=%s\nmanifest_sha256=%s\nmanifest_signature_sha256=%s\nsigning_key_id=%s\napplied_migration_count=%s\napplied_migration_digest=%s\napplied_migration_head=%s\ntarget_migration_count=%s\ntarget_migration_digest=%s\ntarget_migration_head=%s\n' \
    "$backup_id" "$created_at" "$source_cluster_sha256" "$manifest_sha256" "$signature_sha256" \
    "$BACKUP_MANIFEST_SIGNING_KEY_ID" "$applied_migration_count" "$applied_migration_digest" \
    "$applied_migration_head" "$target_migration_count" "$target_migration_digest" \
    "$target_migration_head" >> "$GITHUB_OUTPUT"
fi

printf 'backup_id=%s\ncreated_at=%s\nsource_cluster_sha256=%s\nmanifest_sha256=%s\nmanifest_signature_sha256=%s\nsigning_key_id=%s\napplied_migration_count=%s\napplied_migration_digest=%s\napplied_migration_head=%s\ntarget_migration_count=%s\ntarget_migration_digest=%s\ntarget_migration_head=%s\nresult=success\n' \
  "$backup_id" "$created_at" "$source_cluster_sha256" "$manifest_sha256" "$signature_sha256" \
  "$BACKUP_MANIFEST_SIGNING_KEY_ID" "$applied_migration_count" "$applied_migration_digest" \
  "$applied_migration_head" "$target_migration_count" "$target_migration_digest" "$target_migration_head"
printf 'runtime_versions=%s\n' "${BACKUP_RUNTIME_VERSIONS:-unknown}"
