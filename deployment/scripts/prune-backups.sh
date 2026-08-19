#!/usr/bin/env bash
set -euo pipefail

EX_CONFIG=64
EX_SAFETY=65
EX_INTEGRITY=66
EX_OPERATION=70
DAILY_KEEP=14
WEEKLY_KEEP=8
MONTHLY_KEEP=12
MIN_AGE_HOURS=48

die() {
  local code="$1"
  shift
  printf 'prune-backups: %s\n' "$*" >&2
  exit "$code"
}

require_env() {
  [[ -n "${!1:-}" ]] || die "$EX_CONFIG" "required environment variable $1 is missing"
}

for name in BACKUP_BUCKET BACKUP_R2_ENDPOINT BACKUP_MANIFEST_VERIFY_KEYRING_DIR BACKUP_MANIFEST_ALLOWED_KEY_IDS; do require_env "$name"; done

mode=dry-run
confirmed=false
reviewed_ids=()
retiring_key_id=''
if [[ "${1:-}" == '--apply' ]]; then
  [[ $# == 3 && "$2" == '--confirm' && "$3" == 'DELETE-PRUNED-BACKUPS' ]] ||
    die "$EX_SAFETY" 'apply requires: --apply --confirm DELETE-PRUNED-BACKUPS'
  mode=apply-pruned
elif [[ "${1:-}" == '--apply-orphans' ]]; then
  mode=apply-orphans
  shift
  while (($#)); do
    case "$1" in
      --reviewed-id)
        [[ -n "${2:-}" && "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] ||
          die "$EX_CONFIG" 'invalid reviewed backup ID'
        reviewed_ids+=("$2")
        shift 2
        ;;
      --confirm)
        [[ "${2:-}" == 'DELETE-INCOMPLETE-BACKUPS' ]] || die "$EX_SAFETY" 'invalid orphan confirmation'
        confirmed=true
        shift 2
        ;;
      *) die "$EX_CONFIG" 'unknown orphan apply argument';;
    esac
  done
  [[ "$confirmed" == true && ${#reviewed_ids[@]} -gt 0 ]] ||
    die "$EX_SAFETY" 'orphan apply requires explicit --reviewed-id values and confirmation'
elif [[ "${1:-}" == '--check-key-retirement' ]]; then
  [[ $# == 2 && "$2" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || die "$EX_CONFIG" 'invalid retirement key ID'
  mode=check-key-retirement
  retiring_key_id="$2"
elif [[ $# -ne 0 ]]; then
  die "$EX_CONFIG" 'usage: prune-backups.sh [--apply --confirm DELETE-PRUNED-BACKUPS | --apply-orphans --reviewed-id ID... --confirm DELETE-INCOMPLETE-BACKUPS]'
fi

if [[ "$mode" =~ ^apply- && -n "${RETENTION_NOW:-}" ]]; then
  die "$EX_SAFETY" 'RETENTION_NOW is test-only and forbidden in apply mode'
fi
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prefix="$(node "$script_dir/validate-backup-config.js" prefix "${BACKUP_PREFIX:-postgres}" 2>&1)" ||
  die "$EX_CONFIG" "$prefix"
now="${RETENTION_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
work_dir="$(mktemp -d)" || die "$EX_OPERATION" 'could not create temporary directory'
trap 'rm -rf "$work_dir"' EXIT
listing="$work_dir/objects.txt"
inventory="$work_dir/inventory.tsv"
verified="$work_dir/verified.tsv"
actions="$work_dir/actions.tsv"
quarantine="$work_dir/quarantine.tsv"
: > "$verified"
: > "$quarantine"

aws_r2() { timeout 300 aws --endpoint-url "$BACKUP_R2_ENDPOINT" "$@"; }

set +e
timeout 300 node "$script_dir/list-r2-backup-objects.js" \
  "$BACKUP_BUCKET" "$BACKUP_R2_ENDPOINT" "$prefix/" > "$listing"
list_status=$?
set -e
[[ "$list_status" == 0 ]] || {
  [[ "$list_status" == "$EX_INTEGRITY" ]] && die "$EX_INTEGRITY" 'backup bucket inventory is malformed'
  die "$EX_OPERATION" 'could not list backup bucket'
}

BACKUP_PREFIX_CANONICAL="$prefix" node - "$listing" > "$inventory" <<'NODE' || die "$EX_INTEGRITY" 'could not inventory backup objects'
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
if (text.includes('\r') || (text && !text.endsWith('\n'))) throw new Error('noncanonical inventory output');
const keys = text.split('\n').filter(Boolean);
const prefix = process.env.BACKUP_PREFIX_CANONICAL;
const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keyPattern = new RegExp(`^${escapedPrefix}/(\\d{8}T\\d{6}Z-[A-Za-z0-9._-]+)\\.(dump\\.age|manifest|manifest\\.sig)$`);
const entries = new Map();
for (const key of keys) {
  if (typeof key !== 'string' || key.includes('\t') || key.includes('\n') || key.includes('\r')) throw new Error('noncanonical inventory key');
  const match = key.match(keyPattern);
  if (!match) throw new Error('noncanonical inventory key');
  const [, id, suffix] = match;
  const entry = entries.get(id) || { id, suffixes: new Set() };
  entry.suffixes.add(suffix);
  entries.set(id, entry);
}
const required = ['dump.age', 'manifest', 'manifest.sig'];
for (const entry of entries.values()) {
  const complete = required.every((suffix) => entry.suffixes.has(suffix));
  process.stdout.write(`${complete ? 'COMPLETE' : 'INCOMPLETE'}\t${prefix}/${entry.id}\t${entry.id}\t${[...entry.suffixes].sort().join(',')}\n`);
}
NODE

while IFS=$'\t' read -r kind base id suffixes; do
  [[ "$kind" == COMPLETE ]] || continue
  manifest="$work_dir/$id.manifest"
  signature="$work_dir/$id.manifest.sig"
  reason=''
  aws_r2 s3 cp "s3://$BACKUP_BUCKET/$base.manifest" "$manifest" --only-show-errors >/dev/null 2>&1 || reason=manifest-download
  if [[ -z "$reason" ]]; then
    aws_r2 s3 cp "s3://$BACKUP_BUCKET/$base.manifest.sig" "$signature" --only-show-errors >/dev/null 2>&1 || reason=signature-download
  fi
  validation=''
  if [[ -z "$reason" ]]; then
    signing_key_id="$(node "$script_dir/validate-backup-manifest.js" "$manifest" '' key-id 2>/dev/null)" || reason=signing-key-invalid
  fi
  if [[ -z "$reason" ]]; then
    verify_key="$(node "$script_dir/resolve-backup-verify-key.js" "$signing_key_id" \
      "$BACKUP_MANIFEST_VERIFY_KEYRING_DIR" "$BACKUP_MANIFEST_ALLOWED_KEY_IDS" 2>/dev/null)" || reason=signing-key-invalid
  fi
  if [[ -z "$reason" ]] && ! timeout 300 openssl dgst -sha256 -verify "$verify_key" \
    -signature "$signature" "$manifest" >/dev/null 2>&1; then reason=signature-invalid; fi
  if [[ -z "$reason" ]] && ! validation="$(node "$script_dir/validate-backup-manifest.js" "$manifest" "$id" 2>&1)"; then
    reason=manifest-invalid
  fi
  if [[ -n "$reason" ]]; then
    printf 'QUARANTINE\t%s\t%s\n' "$base" "$reason" >> "$quarantine"
    continue
  fi
  IFS=$'\t' read -r _version manifest_id created_at signing_key_id _rest <<< "$validation"
  future="$(node -e 'const created=Date.parse(process.argv[1]);const now=Date.parse(process.argv[2]);process.stdout.write(created>now?"yes":"no")' "$created_at" "$now")"
  if [[ "$future" == yes ]]; then
    printf 'QUARANTINE\t%s\t%s\n' "$base" future-created-at >> "$quarantine"
    continue
  fi
  printf '%s\t%s\t%s\t%s\n' "$base" "$manifest_id" "$created_at" "$signing_key_id" >> "$verified"
done < "$inventory"

if [[ "$mode" == check-key-retirement ]]; then
  if [[ -s "$quarantine" ]] || grep -q '^INCOMPLETE' "$inventory"; then
    die "$EX_INTEGRITY" 'key retirement inventory contains quarantine or incomplete backups'
  fi
  if awk -F '\t' -v key="$retiring_key_id" '$4 == key { found=1 } END { exit !found }' "$verified"; then
    die "$EX_SAFETY" "verification key $retiring_key_id is still referenced by retained backup manifests"
  fi
  printf 'verification_key_retirement_safe=%s\n' "$retiring_key_id"
  exit 0
fi

if [[ "${FAIL_ON_QUARANTINE:-0}" == 1 && -s "$quarantine" ]]; then
  die "$EX_INTEGRITY" 'backup quarantine is nonempty'
fi

if ! RETENTION_NOW="$now" DAILY_KEEP="$DAILY_KEEP" WEEKLY_KEEP="$WEEKLY_KEEP" \
  MONTHLY_KEEP="$MONTHLY_KEEP" MIN_AGE_HOURS="$MIN_AGE_HOURS" \
  node - "$verified" "$inventory" > "$actions" <<'NODE'
const fs = require('fs');
const now = new Date(process.env.RETENTION_NOW);
if (Number.isNaN(now.getTime())) process.exit(2);
const verified = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map((line) => {
  const [base, id, createdAt, signingKeyId] = line.split('\t');
  return { base, id, time: new Date(createdAt), signingKeyId };
}).sort((a, b) => b.time - a.time);
const inventory = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean).map((line) => {
  const [kind, base, id, suffixes] = line.split('\t');
  return { kind, base, id, suffixes, time: new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`) };
});
const isoWeek = (date) => {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return `${value.getUTCFullYear()}-W${String(Math.ceil((((value - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
};
const retain = new Set();
for (const entry of verified) if ((now - entry.time) / 3600000 < Number(process.env.MIN_AGE_HOURS)) retain.add(entry.id);
const retainBuckets = (keyFor, limit) => {
  const seen = new Set();
  for (const entry of verified) {
    const key = keyFor(entry.time);
    if (!seen.has(key) && seen.size < limit) { seen.add(key); retain.add(entry.id); }
  }
};
retainBuckets((date) => date.toISOString().slice(0, 10), Number(process.env.DAILY_KEEP));
retainBuckets(isoWeek, Number(process.env.WEEKLY_KEEP));
retainBuckets((date) => date.toISOString().slice(0, 7), Number(process.env.MONTHLY_KEEP));
for (const entry of verified) if (!retain.has(entry.id)) process.stdout.write(`PRUNE\t${entry.base}\t${entry.id}\tdump.age,manifest,manifest.sig\n`);
for (const entry of inventory.filter((value) => value.kind === 'INCOMPLETE')) {
  const ageHours = (now - entry.time) / 3600000;
  const action = ageHours < Number(process.env.MIN_AGE_HOURS) ? 'ORPHAN_PROTECTED' : 'ORPHAN';
  process.stdout.write(`${action}\t${entry.base}\t${entry.id}\t${entry.suffixes}\n`);
}
NODE
then
  die "$EX_INTEGRITY" 'could not calculate retention set'
fi

case "$mode" in
  dry-run) printf 'DRY-RUN: GFS daily=%s weekly=%s monthly=%s minimum_age_hours=%s\n' "$DAILY_KEEP" "$WEEKLY_KEEP" "$MONTHLY_KEEP" "$MIN_AGE_HOURS";;
  apply-pruned) printf 'APPLY: deleting verified pruned backup triplets\n';;
  apply-orphans) printf 'APPLY-ORPHANS: deleting reviewed incomplete backups older than %s hours\n' "$MIN_AGE_HOURS";;
esac
printf 'runtime_versions=%s\n' "${RETENTION_RUNTIME_VERSIONS:-unknown}"

while IFS=$'\t' read -r action base detail; do
  [[ -n "$action" ]] && printf '%s %s reason=%s\n' "$action" "$base" "$detail"
done < "$quarantine"

is_reviewed() {
  local id="$1" candidate
  for candidate in "${reviewed_ids[@]:-}"; do [[ "$candidate" == "$id" ]] && return 0; done
  return 1
}

signature_absent() {
  local base="$1" count
  count="$(aws_r2 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$base.manifest.sig" \
    --query 'KeyCount' --output text)" || die "$EX_OPERATION" 'could not revalidate signature absence'
  [[ "$count" == 0 ]] || die "$EX_SAFETY" "signature appeared for ${base##*/}; aborting orphan deletion"
}

validate_orphan_object() {
  local base="$1" id="$2" suffix="$3" expected_artifact actual_size actual_id actual_artifact actual_sha last_modified age_seconds
  case "$suffix" in dump.age) expected_artifact=encrypted-dump;; manifest) expected_artifact=manifest;; manifest.sig) die "$EX_SAFETY" 'signature object cannot be orphan-deleted';; *) die "$EX_INTEGRITY" 'unknown orphan suffix';; esac
  read -r actual_size actual_id actual_artifact actual_sha last_modified < <(
    aws_r2 s3api head-object --bucket "$BACKUP_BUCKET" --key "$base.$suffix" \
      --query '[ContentLength,Metadata.backupid,Metadata.artifact,Metadata.sha256,LastModified]' --output text
  ) || die "$EX_OPERATION" "could not HEAD orphan $base.$suffix"
  [[ "$actual_size" =~ ^[0-9]+$ && "$actual_id" == "$id" && "$actual_artifact" == "$expected_artifact" \
    && "$actual_sha" =~ ^[a-fA-F0-9]{64}$ ]] || die "$EX_INTEGRITY" "orphan identity mismatch for $base.$suffix"
  age_seconds="$(node -e 'const age=Date.parse(process.argv[1]);const now=Date.parse(process.argv[2]);if(!Number.isFinite(age)||!Number.isFinite(now)||now<age)process.exit(1);process.stdout.write(String(Math.floor((now-age)/1000)))' "$last_modified" "$now")" ||
    die "$EX_INTEGRITY" "orphan age is invalid for $base.$suffix"
  ((age_seconds >= MIN_AGE_HOURS * 3600)) || die "$EX_SAFETY" "orphan is younger than $MIN_AGE_HOURS hours"
}

revalidate_complete() {
  local base="$1" id="$2" manifest="$work_dir/revalidate-$id.manifest" signature="$work_dir/revalidate-$id.manifest.sig"
  local validation key_id verify_key expected_dump_sha manifest_sha signature_sha suffix artifact expected_sha
  local size actual_id actual_artifact actual_sha
  aws_r2 s3 cp "s3://$BACKUP_BUCKET/$base.manifest" "$manifest" --only-show-errors >/dev/null || die "$EX_OPERATION" 'complete manifest re-download failed'
  aws_r2 s3 cp "s3://$BACKUP_BUCKET/$base.manifest.sig" "$signature" --only-show-errors >/dev/null || die "$EX_OPERATION" 'complete signature re-download failed'
  key_id="$(node "$script_dir/validate-backup-manifest.js" "$manifest" '' key-id 2>&1)" || die "$EX_INTEGRITY" 'complete signing key ID revalidation failed'
  verify_key="$(node "$script_dir/resolve-backup-verify-key.js" "$key_id" "$BACKUP_MANIFEST_VERIFY_KEYRING_DIR" "$BACKUP_MANIFEST_ALLOWED_KEY_IDS")" || die "$EX_INTEGRITY" 'complete signing key revalidation failed'
  timeout 300 openssl dgst -sha256 -verify "$verify_key" -signature "$signature" "$manifest" >/dev/null 2>&1 || die "$EX_INTEGRITY" 'complete signature revalidation failed'
  validation="$(node "$script_dir/validate-backup-manifest.js" "$manifest" "$id" 2>&1)" || die "$EX_INTEGRITY" 'complete manifest revalidation failed'
  expected_dump_sha="$(printf '%s' "$validation" | cut -f6)"
  manifest_sha="$(sha256sum "$manifest" | cut -d ' ' -f1)"
  signature_sha="$(sha256sum "$signature" | cut -d ' ' -f1)"
  for suffix in dump.age manifest manifest.sig; do
    case "$suffix" in
      dump.age) artifact=encrypted-dump; expected_sha="$expected_dump_sha";;
      manifest) artifact=manifest; expected_sha="$manifest_sha";;
      manifest.sig) artifact=manifest-signature; expected_sha="$signature_sha";;
    esac
    read -r size actual_id actual_artifact actual_sha < <(
      aws_r2 s3api head-object --bucket "$BACKUP_BUCKET" --key "$base.$suffix" \
        --query '[ContentLength,Metadata.backupid,Metadata.artifact,Metadata.sha256]' --output text
    ) || die "$EX_OPERATION" 'complete HEAD revalidation failed'
    [[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 && "$actual_id" == "$id" \
      && "$actual_artifact" == "$artifact" && "$actual_sha" == "$expected_sha" ]] ||
      die "$EX_INTEGRITY" 'complete object identity changed before deletion'
  done
}

while IFS=$'\t' read -r action base id suffixes; do
  [[ -n "$action" ]] || continue
  case "$action" in
    PRUNE)
      printf '%s %s\n' "$([[ "$mode" == apply-pruned ]] && printf DELETE || printf WOULD_DELETE)" "$base"
      if [[ "$mode" == apply-pruned ]]; then
        revalidate_complete "$base" "$id"
        for suffix in manifest.sig manifest dump.age; do
          aws_r2 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$base.$suffix" >/dev/null ||
            die "$EX_OPERATION" "failed deleting $base.$suffix"
        done
      fi
      ;;
    ORPHAN|ORPHAN_PROTECTED)
      printf '%s %s artifacts=%s\n' "$action" "$base" "$suffixes"
      if [[ "$action" == ORPHAN && "$mode" == apply-orphans ]]; then
        if is_reviewed "$id"; then
          signature_absent "$base"
          IFS=',' read -r -a existing_suffixes <<< "$suffixes"
          for suffix in "${existing_suffixes[@]}"; do validate_orphan_object "$base" "$id" "$suffix"; done
          for suffix in "${existing_suffixes[@]}"; do
            signature_absent "$base"
            aws_r2 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$base.$suffix" >/dev/null ||
              die "$EX_OPERATION" "failed deleting orphan $base.$suffix"
          done
        fi
      fi
      ;;
    *) die "$EX_INTEGRITY" 'retention calculator returned an unknown action';;
  esac
done < "$actions"
