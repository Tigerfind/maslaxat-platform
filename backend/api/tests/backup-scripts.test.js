const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const scriptsDir = path.join(repoRoot, 'deployment/scripts');
const workflowsDir = path.join(repoRoot, '.github/workflows');
const A_SHA = 'a'.repeat(64);
const B_SHA = 'b'.repeat(64);
const SOURCE_DATE = new Date(Math.floor((Date.now() - 3600000) / 1000) * 1000);
const SOURCE_CREATED_AT = SOURCE_DATE.toISOString().replace('.000Z', 'Z');
const BACKUP_TIMESTAMP = SOURCE_CREATED_AT.replace(/[-:]/g, '');
const BACKUP_ID = `${BACKUP_TIMESTAMP}-${'a'.repeat(12)}`;
const MIGRATIONS = fs.readdirSync(path.join(repoRoot, 'backend/api/migrations'))
  .filter((name) => name.endsWith('.js')).sort();
const MIGRATION_TEXT = `${MIGRATIONS.join('\n')}\n`;
const MIGRATION_DIGEST = crypto.createHash('sha256').update(MIGRATION_TEXT).digest('hex');

const readScript = (name) => fs.readFileSync(path.join(scriptsDir, name), 'utf8');

const writeTool = (binDir, name, body) => {
  const toolPath = path.join(binDir, name);
  fs.writeFileSync(toolPath, `#!/bin/bash\nset -euo pipefail\nprintf '%s\\n' "${name} $*" >> "$FAKE_LOG"\n${body}\n`);
  fs.chmodSync(toolPath, 0o755);
};

const createHarness = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-scripts-'));
  const binDir = path.join(root, 'bin');
  const objectsDir = path.join(root, 'objects');
  fs.mkdirSync(binDir);
  fs.mkdirSync(objectsDir);
  const log = path.join(root, 'commands.log');
  fs.writeFileSync(log, '');

  writeTool(binDir, 'pg_dump', `
for arg in "$@"; do case "$arg" in --file=*) output="${'${arg#--file=}'}";; esac; done
[[ "${'${FAKE_PG_DUMP_FAIL:-0}'}" == 1 ]] && exit 7
printf 'PGDMP fake custom dump' > "$output"`);
  writeTool(binDir, 'psql', `
has_command=0
for arg in "$@"; do [[ "$arg" == '-c' ]] && has_command=1; done
if [[ "$has_command" == 0 ]]; then
  IFS= read -r holder_query
  printf 'snapshot-holder-input %s\\n' "$holder_query" >> "$FAKE_LOG"
  printf '00000003-0000001B-1\\n'
  [[ "${'${FAKE_SNAPSHOT_HOLDER_EXIT:-0}'}" == 1 ]] && exit 19
  while IFS= read -r holder_query; do
    printf 'snapshot-holder-input %s\\n' "$holder_query" >> "$FAKE_LOG"
    [[ "$holder_query" == 'ROLLBACK;' ]] && exit 0
  done
  exit 20
fi
query="${'${*: -1}'}"
is_restore=0
[[ " $* " == *"emaslaxat_restore_drill_"* ]] && is_restore=1
case "$query" in
  *pg_control_system*)
    if [[ "$is_restore" == 1 ]]; then printf '%s\\t%s\\t%s\\t%s\\n' "${'${FAKE_RESTORE_SERVER_ADDR:-10.0.0.2}'}" "${'${FAKE_RESTORE_SERVER_PORT:-5432}'}" "${'${FAKE_RESTORE_DATABASE:-emaslaxat_restore_drill_20260818}'}" "${'${FAKE_RESTORE_CLUSTER_ID:-restore-cluster-1}'}"
    else printf '%s\\t%s\\t%s\\t%s\\n' "${'${FAKE_BACKUP_SERVER_ADDR:-10.0.0.1}'}" "${'${FAKE_BACKUP_SERVER_PORT:-5432}'}" "${'${FAKE_BACKUP_DATABASE:-emaslaxat}'}" "${'${FAKE_BACKUP_CLUSTER_ID:-production-cluster-1}'}"; fi;;
  *pg_export_snapshot*) printf '00000003-0000001B-1\\n';;
  *information_schema.tables*) printf '%s\\n' "${'${FAKE_TABLE_COUNT:-0}'}";;
  *server_version*) printf '%s\\n' "${'${FAKE_POSTGRES_VERSION:-16.4}'}";;
  *restore_drill_marker*) printf '%s\\n' "${'${FAKE_MARKER:-EMASLAXAT_RESTORE_DRILL_EMPTY_V1}'}";;
  *SequelizeMeta*)
    if [[ "$query" == *'ORDER BY name;'* ]]; then
      if [[ "$is_restore" == 1 ]]; then printf '%s' "${'${FAKE_RESTORED_MIGRATIONS}'}"
      else printf '%s' "${'${FAKE_SOURCE_MIGRATIONS}'}"; fi
    elif [[ "$is_restore" == 1 ]]; then printf '%s\\n' "${'${FAKE_RESTORED_MIGRATION_HEAD:-20260822000000-add-storage-metadata.js}'}"
    else printf '%s\\n' "${'${FAKE_SOURCE_MIGRATION_HEAD:-20260822000000-add-storage-metadata.js}'}"; fi;;
  *'FROM "users"'*) [[ "$is_restore" == 1 ]] && printf '%s\\n' "${'${FAKE_RESTORED_USERS_COUNT:-11}'}" || printf '%s\\n' "${'${FAKE_SOURCE_USERS_COUNT:-11}'}";;
  *'FROM "consultations"'*) [[ "$is_restore" == 1 ]] && printf '%s\\n' "${'${FAKE_RESTORED_CONSULTATIONS_COUNT:-12}'}" || printf '%s\\n' "${'${FAKE_SOURCE_CONSULTATIONS_COUNT:-12}'}";;
  *'FROM "payments"'*) [[ "$is_restore" == 1 ]] && printf '%s\\n' "${'${FAKE_RESTORED_PAYMENTS_COUNT:-13}'}" || printf '%s\\n' "${'${FAKE_SOURCE_PAYMENTS_COUNT:-13}'}";;
  *'FROM "documents"'*) [[ "$is_restore" == 1 ]] && printf '%s\\n' "${'${FAKE_RESTORED_DOCUMENTS_COUNT:-14}'}" || printf '%s\\n' "${'${FAKE_SOURCE_DOCUMENTS_COUNT:-14}'}";;
  *'FROM "reviews"'*) [[ "$is_restore" == 1 ]] && printf '%s\\n' "${'${FAKE_RESTORED_REVIEWS_COUNT:-15}'}" || printf '%s\\n' "${'${FAKE_SOURCE_REVIEWS_COUNT:-15}'}";;
esac`);
  writeTool(binDir, 'age', `
output=''; input=''
while (($#)); do
  case "$1" in -o) output="$2"; shift 2;; -i|-r) shift 2;; --decrypt|--encrypt) shift;; *) input="$1"; shift;; esac
done
if [[ "${'${FAKE_AGE_FAIL:-0}'}" == 1 ]]; then exit 9; fi
if [[ "$input" == *.age ]]; then printf 'PGDMP fake custom dump' > "$output"; else printf 'encrypted dump' > "$output"; fi`);
  writeTool(binDir, 'openssl', `
if [[ " $* " == *" -verify "* && "${'${FAKE_SIGNATURE_FAIL:-0}'}" == 1 ]]; then exit 8; fi
if [[ " $* " == *" -verify "* && -n "${'${FAKE_SIGNATURE_FAIL_ID:-}'}" && " $* " == *"${'${FAKE_SIGNATURE_FAIL_ID}'}"* ]]; then exit 8; fi
if [[ " $* " == *" -sign "* && " $* " == *".evidence"* && "${'${FAKE_EVIDENCE_SIGN_FAIL:-0}'}" == 1 ]]; then exit 8; fi
for ((i=1; i<=$#; i++)); do
  if [[ "${'${!i}'}" == '-out' ]]; then j=$((i + 1)); printf 'signature' > "${'${!j}'}"; fi
done`);
  writeTool(binDir, 'sha256sum', `
if [[ $# == 0 ]]; then
  if [[ -x /usr/bin/sha256sum ]]; then /usr/bin/sha256sum; else /usr/bin/shasum -a 256; fi
elif [[ "$1" == *migrations.txt ]]; then
  if [[ -x /usr/bin/sha256sum ]]; then /usr/bin/sha256sum "$1"; else /usr/bin/shasum -a 256 "$1"; fi
elif [[ "${'${FAKE_SHA_MODE:-ok}'}" == plaintext-bad && "$1" != *.age ]]; then printf '${'c'.repeat(64)}  %s\\n' "$1"
elif [[ "${'${FAKE_SHA_MODE:-ok}'}" == encrypted-bad && "$1" == *.age ]]; then printf '${'c'.repeat(64)}  %s\\n' "$1"
elif [[ "$1" == *.age ]]; then printf '${B_SHA}  %s\\n' "$1"
else printf '${A_SHA}  %s\\n' "$1"; fi`);
  writeTool(binDir, 'pg_restore', `
if [[ " $* " == *" --list "* && "${'${FAKE_PG_RESTORE_LIST_FAIL:-0}'}" == 1 ]]; then exit 7; fi
[[ "${'${FAKE_PG_RESTORE_FAIL:-0}'}" == 1 ]] && exit 7 || exit 0`);
  writeTool(binDir, 'timeout', `shift; exec "$@"`);
  writeTool(binDir, 'node', `
if [[ "${'${1:-}'}" == *restoreBackendSmoke.js ]]; then
  [[ "${'${FAKE_BACKEND_SMOKE_FAIL:-0}'}" == 1 ]] && exit 6
  printf 'migration_state=ok\\nreadiness=ok\\napi_smoke=ok\\n'
  exit 0
fi
exec "${process.execPath}" "$@"`);
  writeTool(binDir, 'aws', `
if [[ "${'${1:-}'}" == '--endpoint-url' ]]; then shift 2; fi
if [[ "$1 $2" == 's3api put-object' ]]; then
  body=''; key=''; metadata=''
  while (($#)); do case "$1" in --body) body="$2"; shift 2;; --key) key="$2"; shift 2;; --metadata) metadata="$2"; shift 2;; *) shift;; esac; done
  destination="$FAKE_OBJECT_ROOT/$key"
  [[ -e "$destination" ]] && exit 12
  artifact=$(printf '%s' "$metadata" | tr ',' '\\n' | sed -n 's/^artifact=//p')
  [[ "${'${FAKE_PUT_COLLISION_ARTIFACT:-}'}" == "$artifact" ]] && exit 12
  mkdir -p "$(dirname "$destination")"
  cp "$body" "$destination"
  size=$(wc -c < "$body" | tr -d ' ')
  printf '%s\\n%s\\n%s\\n' "$size" "$metadata" "${'${FAKE_LAST_MODIFIED:-2020-01-01T00:00:00Z}'}" > "$destination.head"
  exit 0
fi
if [[ "$1 $2" == 's3api head-object' ]]; then
  request="$*"
  key=''
  while (($#)); do case "$1" in --key) key="$2"; shift 2;; *) shift;; esac; done
  object="$FAKE_OBJECT_ROOT/$key"
  [[ -f "$object" && -f "$object.head" ]] || exit 44
  size=$(sed -n '1p' "$object.head")
  metadata=$(sed -n '2p' "$object.head")
  last_modified=$(sed -n '3p' "$object.head")
  backupid=$(printf '%s' "$metadata" | tr ',' '\\n' | sed -n 's/^backupid=//p')
  artifact=$(printf '%s' "$metadata" | tr ',' '\\n' | sed -n 's/^artifact=//p')
  sha=$(printf '%s' "$metadata" | tr ',' '\\n' | sed -n 's/^sha256=//p')
  [[ "${'${FAKE_HEAD_BAD_ARTIFACT:-}'}" == "$artifact" ]] && size=$((size + 1))
  [[ "${'${FAKE_HEAD_OVERSIZE_ARTIFACT:-}'}" == "$artifact" ]] && size=1099511627776
  [[ "${'${FAKE_HEAD_BAD_METADATA_ARTIFACT:-}'}" == "$artifact" ]] && sha='${'d'.repeat(64)}'
  if [[ "$request" == *LastModified* ]]; then
    printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$size" "$backupid" "$artifact" "$sha" "$last_modified"
  else
    printf '%s\\t%s\\t%s\\t%s\\n' "$size" "$backupid" "$artifact" "$sha"
  fi
  exit 0
fi
if [[ "$1 $2" == 's3api list-objects-v2' ]]; then
  if [[ " $* " == *" KeyCount "* ]]; then
    prefix=''; while (($#)); do case "$1" in --prefix) prefix="$2"; shift 2;; *) shift;; esac; done
    if [[ -n "${'${FAKE_SIGNATURE_APPEARS_ID:-}'}" && "$prefix" == *"${'${FAKE_SIGNATURE_APPEARS_ID}'}.manifest.sig" ]]; then printf '1\\n'
    elif [[ -n "${'${FAKE_EXISTING_KEY:-}'}" || -f "$FAKE_OBJECT_ROOT/$prefix" ]]; then printf '1\\n'; else printf '0\\n'; fi
  elif [[ " $* " == *" --output json "* ]]; then
    if [[ -n "${'${FAKE_OBJECT_LIST_PAGES_JSON:-}'}" ]]; then
      token=''; while (($#)); do case "$1" in --continuation-token) token="$2"; shift 2;; *) shift;; esac; done
      index=0
      [[ -z "$token" ]] || index="${'${token#page-}'}"
      printf '%s' "$FAKE_OBJECT_LIST_PAGES_JSON" | node -e '
        const fs = require("fs");
        const pages = JSON.parse(fs.readFileSync(0, "utf8"));
        const page = pages[Number(process.argv[1])];
        if (page === undefined) process.exit(45);
        process.stdout.write(JSON.stringify(page));
      ' "$index"
    else
      printf '%s\\n' "${'${FAKE_OBJECT_LIST_JSON}'}"
    fi
  else printf '%s\\n' "${'${FAKE_OBJECT_LIST:-}'}"; fi
  exit 0
fi
if [[ "$1 $2" == 's3 cp' && "$3" == s3://* ]]; then
  key="${'${3#s3://*/}'}"; cp "$FAKE_OBJECT_ROOT/$key" "$4"; exit 0
fi
if [[ "$1 $2" == 's3api delete-object' ]]; then
  key=''; while (($#)); do case "$1" in --key) key="$2"; shift 2;; *) shift;; esac; done
  rm -f "$FAKE_OBJECT_ROOT/$key" "$FAKE_OBJECT_ROOT/$key.head"; exit 0
fi
exit 2`);

  return { root, binDir, objectsDir, log };
};

const runScript = (name, harness, env = {}, args = []) => {
  const keys = String(env.FAKE_OBJECT_LIST || '').split(/\s+/).filter(Boolean);
  return spawnSync('bash', [path.join(scriptsDir, name), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH}`,
      FAKE_LOG: harness.log,
      FAKE_OBJECT_ROOT: harness.objectsDir,
      FAKE_SOURCE_MIGRATIONS: MIGRATION_TEXT,
      FAKE_RESTORED_MIGRATIONS: MIGRATION_TEXT,
      FAKE_OBJECT_LIST_JSON: JSON.stringify({
        Contents: keys.map((Key) => ({ Key })),
        KeyCount: keys.length,
        IsTruncated: false,
      }),
      ...env,
    },
  });
};

const backupEnv = (harness, overrides = {}) => ({
  DATABASE_URL: 'postgres://backup@source.internal/emaslaxat',
  BACKUP_AGE_RECIPIENT: 'age1publicrecipient',
  BACKUP_MANIFEST_SIGNING_KEY_FILE: path.join(harness.root, 'signing.key'),
  BACKUP_MANIFEST_SIGNING_KEY_ID: 'release-2026q3',
  BACKUP_BUCKET: 'private-backups',
  BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  BACKUP_EXPECTED_SERVER_ADDR: '10.0.0.1',
  BACKUP_EXPECTED_SERVER_PORT: '5432',
  BACKUP_EXPECTED_DATABASE: 'emaslaxat',
  BACKUP_EXPECTED_CLUSTER_ID: 'production-cluster-1',
  BACKUP_TIMESTAMP,
  GITHUB_SHA: 'a'.repeat(40),
  ...overrides,
});

const manifestText = (overrides = {}) => {
  const values = {
    manifest_version: '4', backup_id: BACKUP_ID, created_at: SOURCE_CREATED_AT,
    signing_key_id: 'release-2026q3',
    encrypted_object: `${BACKUP_ID}.dump.age`, encrypted_sha256: B_SHA, plaintext_sha256: A_SHA,
    postgres_version: '16.4', migration_count: String(MIGRATIONS.length), migration_digest: MIGRATION_DIGEST,
    migration_head: MIGRATIONS.at(-1),
    users_count: '11', consultations_count: '12', payments_count: '13', documents_count: '14', reviews_count: '15',
    ...overrides,
  };
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
};

const verificationEnv = (harness) => {
  const keyring = path.join(harness.root, 'verify-keyring');
  fs.mkdirSync(keyring, { recursive: true });
  fs.writeFileSync(path.join(keyring, 'release-2026q3.pem'), 'public key');
  return {
    BACKUP_MANIFEST_VERIFY_KEYRING_DIR: keyring,
    BACKUP_MANIFEST_ALLOWED_KEY_IDS: 'release-2026q3,release-2026q2',
  };
};

const seedRestoreTriplet = (harness, overrides = {}) => {
  const directory = path.join(harness.objectsDir, 'postgres');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.manifest.sig`), 'signature');
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.manifest`), manifestText(overrides));
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.dump.age`), 'encrypted dump');
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.manifest.sig.head`), '9\nbackupid=' + BACKUP_ID + ',artifact=manifest-signature,sha256=' + A_SHA + '\n2026-08-19T00:00:00Z\n');
  const manifestSize = fs.statSync(path.join(directory, `${BACKUP_ID}.manifest`)).size;
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.manifest.head`), `${manifestSize}\nbackupid=${BACKUP_ID},artifact=manifest,sha256=${A_SHA}\n2026-08-19T00:00:00Z\n`);
  fs.writeFileSync(path.join(directory, `${BACKUP_ID}.dump.age.head`), `14\nbackupid=${BACKUP_ID},artifact=encrypted-dump,sha256=${B_SHA}\n2026-08-19T00:00:00Z\n`);
};

const refreshRestoreManifestHead = (harness) => {
  const manifest = path.join(harness.objectsDir, 'postgres', `${BACKUP_ID}.manifest`);
  fs.writeFileSync(`${manifest}.head`, `${fs.statSync(manifest).size}\nbackupid=${BACKUP_ID},artifact=manifest,sha256=${A_SHA}\n2026-08-19T00:00:00Z\n`);
};

const restoreEnv = (harness, overrides = {}) => ({
  RESTORE_DATABASE_URL: 'postgres://restore@isolated/emaslaxat_restore_drill_20260818',
  PRODUCTION_DATABASE_URL: 'postgres://production@primary/emaslaxat',
  RESTORE_ALLOWED_HOSTS: 'isolated,127.0.0.1',
  RESTORE_DATABASE_MARKER: 'EMASLAXAT_RESTORE_DRILL_EMPTY_V1',
  RESTORE_EVIDENCE_DIR: harness.root,
  RESTORE_STARTED_EPOCH: String(Math.floor(Date.now() / 1000) - 60),
  BACKUP_ID,
  BACKUP_BUCKET: 'private-backups',
  BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  BACKUP_AGE_IDENTITY_FILE: path.join(harness.root, 'age.key'),
  ...verificationEnv(harness),
  RESTORE_EXPECTED_SERVER_ADDR: '10.0.0.2',
  RESTORE_EXPECTED_SERVER_PORT: '5432',
  RESTORE_EXPECTED_DATABASE: 'emaslaxat_restore_drill_20260818',
  RESTORE_EXPECTED_CLUSTER_ID: 'restore-cluster-1',
  RESTORE_EVIDENCE_SIGNING_KEY_FILE: path.join(harness.root, 'restore-evidence-signing.pem'),
  RESTORE_EVIDENCE_SIGNING_KEY_ID: 'restore-evidence-2026q3',
  GITHUB_RUN_ID: '98765',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_REPOSITORY: 'emaslaxat/platform',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  ...overrides,
});

const triplet = (id) => [
  `postgres/${id}.dump.age`, `postgres/${id}.manifest`, `postgres/${id}.manifest.sig`,
];

const seedObject = (harness, key, {
  backupId,
  artifact,
  sha = A_SHA,
  lastModified = '2020-01-01T00:00:00Z',
  body = artifact,
} = {}) => {
  const file = path.join(harness.objectsDir, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body || 'object');
  fs.writeFileSync(`${file}.head`, `${fs.statSync(file).size}\nbackupid=${backupId},artifact=${artifact},sha256=${sha}\n${lastModified}\n`);
};

const seedRetentionTriplet = (harness, id, createdAt, overrides = {}) => {
  seedObject(harness, `postgres/${id}.dump.age`, { backupId: id, artifact: 'encrypted-dump', sha: B_SHA });
  seedObject(harness, `postgres/${id}.manifest`, {
    backupId: id,
    artifact: 'manifest',
    body: manifestText({
      backup_id: id,
      created_at: createdAt,
      encrypted_object: `${id}.dump.age`,
      ...overrides,
    }),
  });
  seedObject(harness, `postgres/${id}.manifest.sig`, { backupId: id, artifact: 'manifest-signature' });
};

const createdAtFromId = (id) => {
  const raw = id.slice(0, 16);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
};

describe('PostgreSQL backup scripts', () => {
  test('restore container jobs execute run steps with robust Bash pipefail semantics', () => {
    const workflow = fs.readFileSync(path.join(workflowsDir, 'restore-drill.yml'), 'utf8');
    const restore = workflow.slice(workflow.indexOf('  restore:'), workflow.indexOf('  finalize-evidence:'));
    const finalizer = workflow.slice(workflow.indexOf('  finalize-evidence:'));
    const shell = 'bash --noprofile --norc -eo pipefail {0}';
    expect(restore).toContain(`shell: ${shell}`);
    expect(finalizer).toContain(`shell: ${shell}`);

    const executable = spawnSync('bash', [
      '--noprofile', '--norc', '-eo', 'pipefail', '-c',
      'values=(one two); [[ "${values[1]}" == two ]]; false | true',
    ], { encoding: 'utf8' });
    expect(executable.status).not.toBe(0);
  });

  test('R2 inventory follows every explicit continuation token and returns all keys once', () => {
    const harness = createHarness();
    const script = path.join(scriptsDir, 'list-r2-backup-objects.js');
    const pages = [
      {
        Contents: [{ Key: 'postgres/20260818T000000Z-old.manifest.sig' }],
        KeyCount: 1,
        IsTruncated: true,
        NextContinuationToken: 'page-1',
      },
      {
        Contents: [{ Key: 'postgres/20260819T000000Z-new.manifest.sig' }],
        KeyCount: 1,
        IsTruncated: false,
      },
    ];
    const result = spawnSync(process.execPath, [
      script, 'private-backups', 'https://r2.example.test', 'postgres/',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${harness.binDir}:${process.env.PATH}`,
        FAKE_LOG: harness.log,
        FAKE_OBJECT_ROOT: harness.objectsDir,
        FAKE_OBJECT_LIST_PAGES_JSON: JSON.stringify(pages),
      },
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout.trim().split('\n')).toEqual([
      'postgres/20260818T000000Z-old.manifest.sig',
      'postgres/20260819T000000Z-new.manifest.sig',
    ]);
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).toContain('--no-paginate');
    expect(commands).toContain('--continuation-token page-1');
  });

  test.each([
    ['truncated page without a token', [{ Contents: [], KeyCount: 0, IsTruncated: true }]],
    ['continuation token loop', [
      { Contents: [], KeyCount: 0, IsTruncated: true, NextContinuationToken: 'page-1' },
      { Contents: [], KeyCount: 0, IsTruncated: true, NextContinuationToken: 'page-1' },
    ]],
    ['KeyCount disagreement', [{ Contents: [], KeyCount: 1, IsTruncated: false }]],
    ['malformed truncation flag', [{ Contents: [], KeyCount: 0, IsTruncated: 'false' }]],
  ])('R2 inventory fails closed on %s', (_label, pages) => {
    const harness = createHarness();
    const result = spawnSync(process.execPath, [
      path.join(scriptsDir, 'list-r2-backup-objects.js'),
      'private-backups', 'https://r2.example.test', 'postgres/',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${harness.binDir}:${process.env.PATH}`,
        FAKE_LOG: harness.log,
        FAKE_OBJECT_ROOT: harness.objectsDir,
        FAKE_OBJECT_LIST_PAGES_JSON: JSON.stringify(pages),
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  test('retention inventories complete triplets split across ListObjectsV2 pages', () => {
    const harness = createHarness();
    seedRetentionTriplet(harness, BACKUP_ID, SOURCE_CREATED_AT);
    const pages = triplet(BACKUP_ID).map((Key, index, keys) => ({
      Contents: [{ Key }],
      KeyCount: 1,
      IsTruncated: index < keys.length - 1,
      ...(index < keys.length - 1 ? { NextContinuationToken: `page-${index + 1}` } : {}),
    }));
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups',
      BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-08-20T00:00:00Z',
      FAKE_OBJECT_LIST_PAGES_JSON: JSON.stringify(pages),
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).not.toContain('ORPHAN');
    expect(fs.readFileSync(harness.log, 'utf8')).toContain('--continuation-token page-2');
  });

  test.each(['backup-postgres.sh', 'restore-drill.sh', 'prune-backups.sh'])(
    '%s uses strict shell mode and documented exit classes',
    (name) => {
      const source = readScript(name);
      expect(source).toMatch(/^#!\/usr\/bin\/env bash\nset -euo pipefail/m);
      expect(source).toContain('EX_CONFIG=64');
      expect(source).toContain('EX_SAFETY=65');
      expect(source).toContain('EX_INTEGRITY=66');
      expect(source).toContain('EX_OPERATION=70');
    },
  );

  test('backup atomically publishes an immutable signed triplet and validates every HEAD field', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness));
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const commands = fs.readFileSync(harness.log, 'utf8').trim().split('\n');
    const puts = commands.filter((line) => line.startsWith('aws ') && line.includes('s3api put-object'));
    expect(puts).toHaveLength(3);
    expect(puts.every((line) => line.includes('--if-none-match *'))).toBe(true);
    expect(puts[2]).toContain('.manifest.sig');
    expect(commands.filter((line) => line.startsWith('aws ') && line.includes('s3api head-object'))).toHaveLength(3);
    expect(commands.find((line) => line.startsWith('pg_dump '))).toContain('--snapshot=00000003-0000001B-1');
    expect(commands.filter((line) => line.startsWith('psql ') && line.includes('SET TRANSACTION SNAPSHOT'))).toHaveLength(6);
    const manifest = fs.readFileSync(path.join(harness.objectsDir, 'postgres', `${BACKUP_ID}.manifest`), 'utf8');
    expect(manifest).toContain(`plaintext_sha256=${A_SHA}`);
    expect(manifest).toContain(`encrypted_sha256=${B_SHA}`);
    expect(manifest).toContain('manifest_version=4');
    expect(manifest).toContain(`migration_count=${MIGRATIONS.length}`);
    expect(manifest).toContain(`migration_digest=${MIGRATION_DIGEST}`);
    expect(manifest).toContain(`migration_head=${MIGRATIONS.at(-1)}`);
    expect(manifest).toContain('users_count=11');
    expect(manifest).toContain('reviews_count=15');
  });

  test.each([
    ['missing applied migration', `${MIGRATIONS.slice(1).join('\n')}\n`],
    ['unknown applied migration', `${MIGRATION_TEXT}99999999999999-unknown.js\n`],
    ['duplicate applied migration', `${MIGRATION_TEXT}${MIGRATIONS.at(-1)}\n`],
  ])('backup refuses a %s before pg_dump', (_label, applied) => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_SOURCE_MIGRATIONS: applied,
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toMatch(/migration set/i);
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('pg_dump ');
  });

  test('restore refuses a different complete migration set even when the head still matches', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const different = [...MIGRATIONS.slice(0, -2), '20260823999999-different.js', MIGRATIONS.at(-1)];
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
      FAKE_RESTORED_MIGRATIONS: `${different.join('\n')}\n`,
      FAKE_RESTORED_MIGRATION_HEAD: MIGRATIONS.at(-1),
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toMatch(/migration set/i);
  });

  test('backup refuses an existing backup ID before publishing any object', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_EXISTING_KEY: `postgres/${BACKUP_ID}.manifest.sig`,
    }));
    expect(result.status).toBe(65);
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('put-object');
  });

  test('backup fails when R2 HEAD metadata or size differs from the local artifact', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_HEAD_BAD_ARTIFACT: 'manifest',
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('HEAD verification');
  });

  test('backup rejects a conditional write collision without publishing the signature marker', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_PUT_COLLISION_ARTIFACT: 'manifest',
    }));
    expect(result.status).toBe(70);
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).toContain('put-object');
    expect(commands).not.toContain(`${BACKUP_ID}.manifest.sig --body`);
  });

  test('backup rejects HEAD checksum metadata that does not match the local artifact', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_HEAD_BAD_METADATA_ARTIFACT: 'encrypted-dump',
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('HEAD verification mismatch');
  });

  test.each([
    ['option-like value', '-h attacker', 'postgres URL'],
    ['local database name', 'emaslaxat', 'postgres URL'],
    ['non-PostgreSQL URL', 'https://source.internal/emaslaxat', 'postgres URL'],
  ])('backup rejects %s before opening a source connection', (_name, databaseUrl, message) => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, { DATABASE_URL: databaseUrl }));
    expect(result.status).toBe(64);
    expect(result.stderr).toContain(message);
    expect(fs.readFileSync(harness.log, 'utf8')).not.toMatch(/^(psql|pg_dump) /m);
  });

  test('backup passes the validated source URL only through explicit --dbname options', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness));
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const databaseCommands = fs.readFileSync(harness.log, 'utf8').split('\n')
      .filter((line) => /^(psql|pg_dump) /.test(line));
    expect(databaseCommands.length).toBeGreaterThan(0);
    expect(databaseCommands.every((line) => line.includes('--dbname=postgres://backup@source.internal/emaslaxat'))).toBe(true);
  });

  test.each(['host=attacker.internal', 'hostaddr=203.0.113.9', 'port=6543', 'dbname=other']) (
    'backup rejects libpq URI destination override %s before source access',
    (parameter) => {
      const harness = createHarness();
      const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
        DATABASE_URL: `postgres://backup@source.internal/emaslaxat?${parameter}`,
      }));
      expect(result.status).toBe(64);
      expect(result.stderr).toContain('override');
      expect(fs.readFileSync(harness.log, 'utf8')).not.toMatch(/^(psql|pg_dump) /m);
    },
  );

  test('backup rejects a future publication timestamp before source access', () => {
    const harness = createHarness();
    const future = new Date(Math.floor((Date.now() + 3600000) / 1000) * 1000)
      .toISOString().replace(/[-:]/g, '').replace('.000', '');
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, { BACKUP_TIMESTAMP: future }));
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('future');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toMatch(/^(psql|pg_dump) /m);
  });

  test.each(['../postgres', 'post gres', 'postgres//daily', 'postgres/..'])(
    'backup rejects unsafe prefix %s',
    (prefix) => {
      const harness = createHarness();
      const result = runScript('backup-postgres.sh', harness, backupEnv(harness, { BACKUP_PREFIX: prefix }));
      expect(result.status).toBe(64);
      expect(result.stderr).toContain('BACKUP_PREFIX');
      expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('put-object');
    },
  );

  test('backup validates its generated key-identified manifest before signing or upload', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      BACKUP_MANIFEST_SIGNING_KEY_ID: 'release-2026q3',
      FAKE_POSTGRES_VERSION: 'invalid version',
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('generated manifest');
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).not.toContain('openssl dgst');
    expect(commands).not.toContain('put-object');
  });

  test('restore selects the signed allowlisted verification key from the keyring', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(0);
    expect(fs.readFileSync(harness.log, 'utf8')).toContain('verify-keyring/release-2026q3.pem');
  });

  test('restore rejects a signed key ID outside the explicit allowlist before decrypting', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness, { signing_key_id: 'retired-key' });
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('signing key');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('age --decrypt');
  });

  test('restore HEAD-checks object identity and refuses an oversized encrypted object before download', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
      FAKE_HEAD_OVERSIZE_ARTIFACT: 'encrypted-dump',
    }));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('size');
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).toContain(`head-object --bucket private-backups --key postgres/${BACKUP_ID}.dump.age`);
    expect(commands).not.toContain(`s3 cp s3://private-backups/postgres/${BACKUP_ID}.dump.age`);
  });

  test('backup bounds PostgreSQL, encryption, signing, upload, and HEAD phases', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness));
    expect(result.status).toBe(0);
    const deadlines = fs.readFileSync(harness.log, 'utf8').split('\n').filter((line) => line.startsWith('timeout '));
    expect(deadlines.some((line) => line.includes('psql '))).toBe(true);
    expect(deadlines.some((line) => line.includes('pg_dump '))).toBe(true);
    expect(deadlines.some((line) => line.includes('age '))).toBe(true);
    expect(deadlines.some((line) => line.includes('openssl '))).toBe(true);
    expect(deadlines.some((line) => line.includes('aws '))).toBe(true);
  });

  test('backup records snapshot completion only after dump and snapshot assertions finish', () => {
    const harness = createHarness();
    const phaseFile = path.join(harness.root, 'phase.evidence');
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      BACKUP_PHASE_STATE_FILE: phaseFile,
      FAKE_PG_DUMP_FAIL: '1',
    }));
    expect(result.status).toBe(70);
    expect(fs.readFileSync(phaseFile, 'utf8')).toContain('last_successful_phase=source_identity_verified');
    expect(fs.readFileSync(phaseFile, 'utf8')).not.toContain('snapshot_dump_complete');
  });

  test('backup keeps a controlled snapshot holder alive and rolls it back deterministically', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness));
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).not.toContain('pg_sleep');
    expect(commands).toContain('snapshot-holder-input BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();');
    expect(commands).toContain('snapshot-holder-input ROLLBACK;');
  });

  test('backup aborts without publication when the snapshot holder exits prematurely', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_SNAPSHOT_HOLDER_EXIT: '1',
    }));
    expect(result.status).toBe(70);
    expect(result.stderr).toMatch(/snapshot holder/i);
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('put-object');
  });

  test('backup verifies effective source address, port, database, and cluster identity', () => {
    const harness = createHarness();
    const result = runScript('backup-postgres.sh', harness, backupEnv(harness, {
      FAKE_BACKUP_CLUSTER_ID: 'unexpected-cluster',
    }));
    expect(result.status).toBe(65);
    expect(result.stderr).toContain('effective source identity');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('pg_dump');
  });

  test('restore validates the signed source contract and writes complete RPO/RTO evidence', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('result=success');
    expect(evidence).toContain(`encrypted_sha256=${B_SHA}`);
    expect(evidence).toMatch(/source_created_at=\d{4}-\d{2}-\d{2}T/);
    expect(evidence).toContain('migration_match=true');
    expect(evidence).toContain('counts_match=true');
    expect(evidence).toContain('backend_smoke_pass=true');
    expect(evidence).toContain('workflow_run_id=98765');
    expect(evidence).toContain('workflow_run_attempt=2');
    expect(evidence).toContain('repository=emaslaxat/platform');
    expect(evidence).toContain('git_ref=refs/heads/main');
    expect(evidence).toContain('signing_key_id=release-2026q3');
    expect(evidence).toContain(`manifest_sha256=${A_SHA}`);
    expect(evidence).toContain(`manifest_signature_sha256=${A_SHA}`);
    expect(evidence).toContain('evidence_signing_key_id=restore-evidence-2026q3');
    expect(fs.existsSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence.sig`))).toBe(true);
    expect(evidence).toContain('rpo_target_seconds=86400');
    expect(evidence).toContain('rpo_pass=true');
    expect(evidence).toContain('rto_target_seconds=7200');
    expect(evidence).toContain('rto_pass=true');
    expect(evidence).toMatch(/started_at=.*Z/);
    expect(evidence).toMatch(/completed_at=.*Z/);
    expect(evidence).not.toContain('postgres://');
    expect(fs.readFileSync(harness.log, 'utf8')).toContain('restoreBackendSmoke.js');
  });

  test('restore bounds download, cryptographic, database, and application smoke phases', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(0);
    const deadlines = fs.readFileSync(harness.log, 'utf8').split('\n').filter((line) => line.startsWith('timeout '));
    expect(deadlines.some((line) => line.includes('aws '))).toBe(true);
    expect(deadlines.some((line) => line.includes('openssl '))).toBe(true);
    expect(deadlines.some((line) => line.includes('age '))).toBe(true);
    expect(deadlines.some((line) => line.includes('pg_restore '))).toBe(true);
    expect(deadlines.some((line) => line.includes('restoreBackendSmoke.js'))).toBe(true);
  });

  test.each([
    ['missing production comparison', { PRODUCTION_DATABASE_URL: '' }, 64, 'PRODUCTION_DATABASE_URL'],
    ['host outside allowlist', { RESTORE_ALLOWED_HOSTS: '127.0.0.1' }, 65, 'allowlist'],
    ['production destination equality', { PRODUCTION_DATABASE_URL: 'postgres://restore@isolated/emaslaxat_restore_drill_20260818' }, 65, 'production'],
  ])('restore refuses %s and emits failure evidence', (_name, overrides, status, message) => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, overrides));
    expect(result.status).toBe(status);
    expect(result.stderr.toLowerCase()).toContain(message.toLowerCase());
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('result=failure');
  });

  test.each(['host=primary', 'hostaddr=203.0.113.9', 'port=6543', 'dbname=production'])(
    'restore rejects libpq URI destination override %s before marker access',
    (parameter) => {
      const harness = createHarness();
      seedRestoreTriplet(harness);
      const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
        RESTORE_DATABASE_URL: `postgres://restore@isolated/emaslaxat_restore_drill_20260818?${parameter}`,
      }));
      expect(result.status).toBe(65);
      expect(result.stderr).toContain('destination');
      expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('restore_drill_marker');
    },
  );

  test('restore verifies effective server address, port, database, and cluster identity before marker access', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
      FAKE_RESTORE_CLUSTER_ID: 'unexpected-cluster',
    }));
    expect(result.status).toBe(65);
    expect(result.stderr).toContain('effective restore identity');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('restore_drill_marker');
  });

  test('restore sanitizes an invalid backup ID before choosing the failure evidence path', () => {
    const harness = createHarness();
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, { BACKUP_ID: '../../escape' }));
    expect(result.status).toBe(64);
    const evidence = path.join(harness.root, 'restore-invalid.evidence');
    expect(fs.existsSync(evidence)).toBe(true);
    expect(fs.readFileSync(evidence, 'utf8')).toContain('backup_id=invalid');
  });

  test.each([
    ['wrong marker', { FAKE_MARKER: 'WRONG' }, 65, 'isolated restore marker'],
    ['nonempty target', { FAKE_TABLE_COUNT: '1' }, 65, 'not empty'],
    ['unreadable custom archive', { FAKE_PG_RESTORE_LIST_FAIL: '1' }, 66, 'readable PostgreSQL custom archive'],
  ])('restore rejects %s before an unsafe restore', (_name, overrides, status, message) => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, overrides));
    expect(result.status).toBe(status);
    expect(result.stderr).toContain(message);
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('result=failure');
  });

  test.each([
    ['signature failure', {}, { FAKE_SIGNATURE_FAIL: '1' }, 'manifest signature'],
    ['short SHA-256', { plaintext_sha256: 'aaaaaaaa' }, {}, 'checksum format'],
    ['encrypted checksum mismatch', { encrypted_sha256: 'c'.repeat(64) }, {}, 'encrypted dump checksum'],
    ['plaintext checksum mismatch', { plaintext_sha256: 'c'.repeat(64) }, {}, 'plaintext dump checksum'],
    ['migration mismatch', {}, {
      FAKE_RESTORED_MIGRATIONS: `${MIGRATIONS.slice(1).join('\n')}\n`,
    }, 'migration set mismatch'],
    ['source count mismatch', {}, { FAKE_RESTORED_USERS_COUNT: '99' }, 'row count mismatch'],
    ['backend smoke failure', {}, { FAKE_BACKEND_SMOKE_FAIL: '1' }, 'backend startup'],
  ])('restore rejects %s with integrity failure evidence', (_name, manifest, env, message) => {
    const harness = createHarness();
    seedRestoreTriplet(harness, manifest);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, env));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain(message);
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('result=failure');
    expect(evidence).toContain('failure_code=66');
  });

  test('restore rejects duplicated manifest fields before decrypting', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    fs.appendFileSync(path.join(harness.objectsDir, 'postgres', `${BACKUP_ID}.manifest`), 'users_count=11\n');
    refreshRestoreManifestHead(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('missing or duplicated');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('age --decrypt');
  });

  test.each([
    ['unknown field', `${manifestText()}unexpected=value\n`, 'field set'],
    ['noncanonical timestamp', manifestText({ created_at: SOURCE_CREATED_AT.replace('Z', '.000Z') }), 'created_at'],
    ['backup timestamp disagreement', manifestText({ created_at: '2020-01-01T00:00:00Z' }), 'backup timestamp'],
    ['invalid postgres version', manifestText({ postgres_version: 'unknown version' }), 'postgres_version'],
  ])('restore rejects manifest v2 with %s', (_name, manifest, message) => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    fs.writeFileSync(path.join(harness.objectsDir, 'postgres', `${BACKUP_ID}.manifest`), manifest);
    refreshRestoreManifestHead(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(66);
    expect(result.stderr).toContain(message);
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('age --decrypt');
  });

  test('restore records and fails an RPO breach before restoring', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness, { created_at: new Date(Date.now() - 25 * 3600000).toISOString() });
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness));
    expect(result.status).toBe(66);
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('rpo_pass=false');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('pg_restore --exit-on-error');
  });

  test('restore records and fails an end-to-end RTO breach', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
      RESTORE_STARTED_EPOCH: String(Math.floor(Date.now() / 1000) - 7201),
    }));
    expect(result.status).toBe(66);
    const evidence = fs.readFileSync(path.join(harness.root, `restore-${BACKUP_ID}.evidence`), 'utf8');
    expect(evidence).toContain('rto_pass=false');
  });

  test('successful restore fails when signed primary evidence cannot be produced', () => {
    const harness = createHarness();
    seedRestoreTriplet(harness);
    const result = runScript('restore-drill.sh', harness, restoreEnv(harness, {
      FAKE_EVIDENCE_SIGN_FAIL: '1',
    }));
    expect(result.status).toBe(70);
    expect(result.stderr).toContain('primary evidence');
  });

  test('prune behavior keeps GFS selections, protects the 48-hour boundary, and identifies exact candidates', () => {
    const harness = createHarness();
    const ids = [];
    for (let day = 1; day <= 16; day += 1) ids.push(`202607${String(day).padStart(2, '0')}T030000Z-d${day}`);
    ids.push('20260818T120000Z-young');
    ids.push('20260818T000000Z-exact48');
    ids.forEach((id) => seedRetentionTriplet(harness, id, createdAtFromId(id)));
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-08-20T00:00:00Z', FAKE_OBJECT_LIST: ids.flatMap(triplet).join('\t'),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WOULD_DELETE postgres/20260701T030000Z-d1');
    expect(result.stdout).not.toContain('WOULD_DELETE postgres/20260704T030000Z-d4');
    expect(result.stdout).not.toContain('WOULD_DELETE postgres/20260818T120000Z-young');
    expect(result.stdout).toContain('WOULD_DELETE postgres/20260818T000000Z-exact48');
  });

  test('retention apply refuses a caller-controlled clock', () => {
    const harness = createHarness();
    const baseEnv = {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
    };
    const controlledClock = runScript('prune-backups.sh', harness, {
      ...baseEnv, RETENTION_NOW: '2026-08-20T00:00:00Z',
    }, ['--apply', '--confirm', 'DELETE-PRUNED-BACKUPS']);
    expect(controlledClock.status).toBe(65);
    expect(controlledClock.stderr).toContain('RETENTION_NOW');

  });

  test('prune weekly and monthly buckets extend retention beyond the newest 14 daily buckets', () => {
    const harness = createHarness();
    const dailyIds = [];
    for (let offset = 0; offset < 70; offset += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + offset, 3));
      const stamp = date.toISOString().replace(/[-:]/g, '').replace('.000', '');
      dailyIds.push(`${stamp}-day${offset}`);
    }
    dailyIds.forEach((id) => seedRetentionTriplet(harness, id, createdAtFromId(id)));
    const weekly = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-03-12T12:00:00Z', FAKE_OBJECT_LIST: dailyIds.flatMap(triplet).join('\t'),
    });
    expect(weekly.status).toBe(0);
    expect(weekly.stdout).not.toContain('WOULD_DELETE postgres/20260125T030000Z-day24');
    expect(weekly.stdout).toContain('WOULD_DELETE postgres/20260124T030000Z-day23');

    const monthlyIds = [];
    for (let offset = 0; offset < 14; offset += 1) {
      const year = 2025 + Math.floor(offset / 12);
      const month = (offset % 12) + 1;
      monthlyIds.push(`${year}${String(month).padStart(2, '0')}01T030000Z-month${offset}a`);
      monthlyIds.push(`${year}${String(month).padStart(2, '0')}15T030000Z-month${offset}b`);
    }
    monthlyIds.forEach((id) => seedRetentionTriplet(harness, id, createdAtFromId(id)));
    const monthly = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-03-01T00:00:00Z', FAKE_OBJECT_LIST: monthlyIds.flatMap(triplet).join('\t'),
    });
    expect(monthly.status).toBe(0);
    expect(monthly.stdout).not.toContain('WOULD_DELETE postgres/20250315T030000Z-month2b');
    expect(monthly.stdout).toContain('WOULD_DELETE postgres/20250215T030000Z-month1b');
  });

  test('retention quarantines signed timestamps newer than its trusted clock', () => {
    const harness = createHarness();
    const id = '20260821T030000Z-future';
    seedRetentionTriplet(harness, id, '2026-08-21T03:00:00Z');
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_NOW: '2026-08-20T00:00:00Z',
      FAKE_OBJECT_LIST: triplet(id).join('\t'),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`QUARANTINE postgres/${id}`);
    expect(result.stdout).not.toContain(`WOULD_DELETE postgres/${id}`);
  });

  test('retention uses JSON inventory and can fail the workflow on quarantine', () => {
    const harness = createHarness();
    const id = '20260101T030000Z-badsig';
    seedRetentionTriplet(harness, id, '2026-01-01T03:00:00Z');
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_NOW: '2026-08-20T00:00:00Z', FAIL_ON_QUARANTINE: '1',
      FAKE_OBJECT_LIST: triplet(id).join('\t'), FAKE_SIGNATURE_FAIL_ID: id,
    });
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('quarantine');
    expect(fs.readFileSync(harness.log, 'utf8')).toContain('--output json');
  });

  test('retirement refuses removal of a verification key still referenced by signed backups', () => {
    const harness = createHarness();
    seedRetentionTriplet(harness, BACKUP_ID, SOURCE_CREATED_AT);
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_NOW: '2026-08-20T00:00:00Z',
      FAKE_OBJECT_LIST: triplet(BACKUP_ID).join('\t'),
    }, ['--check-key-retirement', 'release-2026q3']);
    expect(result.status).toBe(65);
    expect(result.stderr).toContain('still referenced');
  });

  test.each([
    ['quarantined manifest', triplet(BACKUP_ID), { FAKE_SIGNATURE_FAIL_ID: BACKUP_ID }],
    ['incomplete triplet', [`postgres/${BACKUP_ID}.manifest`], {}],
  ])('retirement fails closed on %s', (_name, keys, extraEnv) => {
    const harness = createHarness();
    seedRetentionTriplet(harness, BACKUP_ID, SOURCE_CREATED_AT);
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_NOW: '2026-08-20T00:00:00Z',
      FAKE_OBJECT_LIST: keys.join('\t'), ...extraEnv,
    }, ['--check-key-retirement', 'release-2026q2']);
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('retirement inventory');
  });

  test.each([
    `postgres/nested/${BACKUP_ID}.manifest`,
    `postgres/bad\tdir/${BACKUP_ID}.manifest`,
    `postgres/${BACKUP_ID}.manifest.extra`,
  ])('retention rejects noncanonical JSON inventory key %s', (key) => {
    const harness = createHarness();
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_NOW: '2026-08-20T00:00:00Z', FAKE_OBJECT_LIST: key,
    });
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('inventory');
  });

  test('complete-triplet apply revalidates all metadata and signature under publisher isolation', () => {
    const harness = createHarness();
    const ids = [];
    for (let day = 1; day <= 16; day += 1) ids.push(`202606${String(day).padStart(2, '0')}T030000Z-d${day}`);
    ids.forEach((id) => seedRetentionTriplet(harness, id, createdAtFromId(id)));
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness), RETENTION_PUBLISHERS_STOPPED: 'CONFIRMED',
      FAKE_OBJECT_LIST: ids.flatMap(triplet).join('\t'),
    }, ['--apply', '--confirm', 'DELETE-PRUNED-BACKUPS']);
    expect(result.status).toBe(0);
    const commands = fs.readFileSync(harness.log, 'utf8');
    const candidate = 'postgres/20260601T030000Z-d1';
    expect(commands).toContain(`head-object --bucket private-backups --key ${candidate}.dump.age`);
    expect(commands).toContain(`head-object --bucket private-backups --key ${candidate}.manifest`);
    expect(commands).toContain(`head-object --bucket private-backups --key ${candidate}.manifest.sig`);
    expect((commands.match(/openssl dgst -sha256 -verify/g) || []).length).toBeGreaterThan(ids.length);
  });

  test('prune reports incomplete triplets and only removes old orphans with separate confirmation', () => {
    const harness = createHarness();
    const objects = [
      'postgres/20240101T030000Z-orphan.dump.age',
      'postgres/20260819T030000Z-young.manifest',
    ].join('\t');
    const env = {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-08-20T12:00:00Z', FAKE_OBJECT_LIST: objects,
    };
    seedObject(harness, 'postgres/20240101T030000Z-orphan.dump.age', {
      backupId: '20240101T030000Z-orphan', artifact: 'encrypted-dump',
    });
    seedObject(harness, 'postgres/20260819T030000Z-young.manifest', {
      backupId: '20260819T030000Z-young', artifact: 'manifest', lastModified: '2026-08-19T03:00:00Z',
    });
    const dryRun = runScript('prune-backups.sh', harness, env);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain('ORPHAN postgres/20240101T030000Z-orphan');
    expect(dryRun.stdout).toContain('ORPHAN_PROTECTED postgres/20260819T030000Z-young');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('delete-object');

    fs.writeFileSync(harness.log, '');
    const refused = runScript('prune-backups.sh', harness, env, ['--apply-orphans']);
    expect(refused.status).toBe(65);
    const applied = runScript('prune-backups.sh', harness, env, ['--apply-orphans', '--confirm', 'DELETE-INCOMPLETE-BACKUPS']);
    expect(applied.status).toBe(65);
  });

  test.each([
    ['invalid detached signature', '20260101T030000Z-badsig', '2026-01-01T03:00:00Z', {}, { FAKE_SIGNATURE_FAIL_ID: '20260101T030000Z-badsig' }],
    ['manifest backup identity mismatch', '20260102T030000Z-badid', '2026-01-02T03:00:00Z', { backup_id: '20260102T030000Z-other' }, {}],
    ['manifest timestamp/key mismatch', '20260103T030000Z-badtime', '2026-01-04T03:00:00Z', {}, {}],
  ])('prune quarantines %s and excludes it from GFS decisions', (_name, id, createdAt, manifest, extraEnv) => {
    const harness = createHarness();
    seedRetentionTriplet(harness, id, createdAt, manifest);
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_NOW: '2026-08-20T00:00:00Z', FAKE_OBJECT_LIST: triplet(id).join('\t'), ...extraEnv,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`QUARANTINE postgres/${id}`);
    expect(result.stdout).not.toContain(`WOULD_DELETE postgres/${id}`);
    expect(fs.readFileSync(harness.log, 'utf8')).toContain('openssl dgst -sha256 -verify');
  });

  test('orphan apply requires explicit reviewed IDs and revalidates identity and signature absence', () => {
    const harness = createHarness();
    const reviewed = '20240101T030000Z-reviewed';
    const unreviewed = '20240102T030000Z-unreviewed';
    seedObject(harness, `postgres/${reviewed}.dump.age`, { backupId: reviewed, artifact: 'encrypted-dump' });
    seedObject(harness, `postgres/${unreviewed}.dump.age`, { backupId: unreviewed, artifact: 'encrypted-dump' });
    const env = {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_PUBLISHERS_STOPPED: 'CONFIRMED',
      FAKE_OBJECT_LIST: [`postgres/${reviewed}.dump.age`, `postgres/${unreviewed}.dump.age`].join('\t'),
    };
    const refused = runScript('prune-backups.sh', harness, env, ['--apply-orphans', '--confirm', 'DELETE-INCOMPLETE-BACKUPS']);
    expect(refused.status).toBe(65);

    fs.writeFileSync(harness.log, '');
    const applied = runScript('prune-backups.sh', harness, env, [
      '--apply-orphans', '--reviewed-id', reviewed, '--confirm', 'DELETE-INCOMPLETE-BACKUPS',
    ]);
    expect(applied.status).toBe(0);
    const commands = fs.readFileSync(harness.log, 'utf8');
    expect(commands).toContain(`head-object --bucket private-backups --key postgres/${reviewed}.dump.age`);
    expect(commands).toContain(`delete-object --bucket private-backups --key postgres/${reviewed}.dump.age`);
    expect(commands).not.toContain(`delete-object --bucket private-backups --key postgres/${unreviewed}.dump.age`);
  });

  test('orphan apply aborts without deleting if a detached signature appears during revalidation', () => {
    const harness = createHarness();
    const id = '20240101T030000Z-raced';
    seedObject(harness, `postgres/${id}.dump.age`, { backupId: id, artifact: 'encrypted-dump' });
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_PUBLISHERS_STOPPED: 'CONFIRMED', FAKE_OBJECT_LIST: `postgres/${id}.dump.age`,
      FAKE_SIGNATURE_APPEARS_ID: id,
    }, ['--apply-orphans', '--reviewed-id', id, '--confirm', 'DELETE-INCOMPLETE-BACKUPS']);
    expect(result.status).toBe(65);
    expect(result.stderr).toContain('signature appeared');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('delete-object');
  });

  test('orphan apply aborts on object metadata identity mismatch', () => {
    const harness = createHarness();
    const id = '20240101T030000Z-wrongidentity';
    seedObject(harness, `postgres/${id}.dump.age`, { backupId: 'different-id', artifact: 'encrypted-dump' });
    const result = runScript('prune-backups.sh', harness, {
      BACKUP_BUCKET: 'private-backups', BACKUP_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      ...verificationEnv(harness),
      RETENTION_PUBLISHERS_STOPPED: 'CONFIRMED', FAKE_OBJECT_LIST: `postgres/${id}.dump.age`,
    }, ['--apply-orphans', '--reviewed-id', id, '--confirm', 'DELETE-INCOMPLETE-BACKUPS']);
    expect(result.status).toBe(66);
    expect(result.stderr).toContain('identity mismatch');
    expect(fs.readFileSync(harness.log, 'utf8')).not.toContain('delete-object');
  });

  test('backup and restore workflows preserve key separation and complete evidence inputs', () => {
    const backupWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup.yml'), 'utf8');
    const restoreWorkflow = fs.readFileSync(path.join(workflowsDir, 'restore-drill.yml'), 'utf8');
    expect(backupWorkflow).toContain('BACKUP_AGE_RECIPIENT');
    expect(backupWorkflow).not.toContain('BACKUP_AGE_IDENTITY');
    expect(backupWorkflow).toContain('BACKUP_MANIFEST_VERIFY_KEYRING_DIR');
    expect(backupWorkflow).toContain('openssl pkey -pubout');
    expect(restoreWorkflow).toContain('BACKUP_AGE_IDENTITY_B64');
    expect(restoreWorkflow).not.toContain('BACKUP_MANIFEST_SIGNING_KEY');
    expect(restoreWorkflow).toContain('PRODUCTION_DATABASE_URL');
    expect(restoreWorkflow).toContain('RESTORE_ALLOWED_HOSTS');
    expect(restoreWorkflow).toContain('RESTORE_STARTED_EPOCH');
    expect(restoreWorkflow).toContain('if: always()');
    expect(restoreWorkflow).toContain('BACKUP_MANIFEST_VERIFY_KEYRING_JSON');
    expect(restoreWorkflow).toContain('RESTORE_EVIDENCE_SIGNING_KEY_B64');
    expect(restoreWorkflow).toContain('image: ${{ needs.validate-images.outputs.postgres_image }}');
    expect(restoreWorkflow).toContain('image: ${{ needs.validate-images.outputs.redis_image }}');
  });

  test('daily publisher cannot delete and retention runs under a separate protected workflow', () => {
    const backupWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup.yml'), 'utf8');
    const retentionPath = path.join(workflowsDir, 'database-backup-retention.yml');
    expect(backupWorkflow).not.toContain('prune-backups.sh --apply');
    expect(backupWorkflow).not.toContain('BACKUP_R2_DELETE');
    expect(fs.existsSync(retentionPath)).toBe(true);
    const retentionWorkflow = fs.readFileSync(retentionPath, 'utf8');
    expect(retentionWorkflow).toContain('environment: production-backup-retention');
    expect(retentionWorkflow).toContain('group: production-backup-mutation');
    expect(retentionWorkflow).toContain('--apply --confirm DELETE-PRUNED-BACKUPS');
    expect(retentionWorkflow).toContain('BACKUP_MANIFEST_VERIFY_KEYRING_JSON');
  });

  test('publisher and retention share one enforced cross-workflow exclusion group', () => {
    const backupWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup.yml'), 'utf8');
    const retentionWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup-retention.yml'), 'utf8');
    expect(backupWorkflow).toContain('group: production-backup-mutation');
    expect(retentionWorkflow).toContain('group: production-backup-mutation');
    expect(retentionWorkflow).not.toContain('RETENTION_PUBLISHERS_STOPPED: CONFIRMED');
  });

  test('backup workflow has an independent always-running signed finalizer', () => {
    const source = fs.readFileSync(path.join(workflowsDir, 'database-backup.yml'), 'utf8');
    expect(source).toMatch(/finalize-evidence:[\s\S]*needs: \[validate-images, backup\][\s\S]*if: \$\{\{ always\(\) \}\}/);
    expect(source).toContain('backup-evidence-finalizer.sh');
    expect(source).toContain('BACKUP_FINALIZER_SIGNING_KEY_B64');
    expect(source).toContain('backup-finalizer-evidence-');
  });

  test('A2 workflows use only reviewed digest-pinned tool and service image inputs', () => {
    const names = ['database-backup.yml', 'database-backup-retention.yml', 'restore-drill.yml'];
    for (const name of names) {
      const source = fs.readFileSync(path.join(workflowsDir, name), 'utf8');
      expect(source).not.toContain('apt-get');
      expect(source).toContain('image: ${{ needs.validate-images.outputs.tool_image }}');
      expect(source).toContain('validate-image-reference.js');
    }
    const restoreWorkflow = fs.readFileSync(path.join(workflowsDir, 'restore-drill.yml'), 'utf8');
    expect(restoreWorkflow).not.toMatch(/image:\s+(postgres|redis):/);
    expect(restoreWorkflow).toContain('RESTORE_POSTGRES_IMAGE_DIGEST');
    expect(restoreWorkflow).toContain('RESTORE_REDIS_IMAGE_DIGEST');
  });

  test('secretless preflight validates image digests before secret-bearing containers are pulled', () => {
    const backupWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup.yml'), 'utf8');
    const retentionWorkflow = fs.readFileSync(path.join(workflowsDir, 'database-backup-retention.yml'), 'utf8');
    const restoreWorkflow = fs.readFileSync(path.join(workflowsDir, 'restore-drill.yml'), 'utf8');
    for (const source of [backupWorkflow, retentionWorkflow, restoreWorkflow]) {
      expect(source).toMatch(/validate-images:[\s\S]*runs-on: ubuntu-24\.04/);
      expect(source).toContain('image: ${{ needs.validate-images.outputs.tool_image }}');
      expect(source).toContain('needs: validate-images');
    }
    expect(restoreWorkflow).toContain('image: ${{ needs.validate-images.outputs.postgres_image }}');
    expect(restoreWorkflow).toContain('image: ${{ needs.validate-images.outputs.redis_image }}');
  });
});
