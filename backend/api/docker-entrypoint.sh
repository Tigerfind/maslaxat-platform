#!/bin/sh
set -eu

node /app/src/scripts/verifyPdfToolchain.js
node /app/src/scripts/verifyPdfDockerContract.js

if [ "$#" -eq 0 ]; then
  set -- node src/server.js
fi

mark_imports_unavailable() {
  node -e "require('/app/src/workers/pdfSandboxSelfTest').writeAvailability(false).catch(() => process.exit(1))"
}

bounded_freshclam() {
  timeout --signal=KILL 60s \
    prlimit --as=536870912 --cpu=30 --nproc=32 -- \
    /usr/bin/freshclam --quiet
}

refresh_and_probe() {
  if bounded_freshclam && node /app/src/scripts/checkPdfDefinitions.js; then
    node /app/src/workers/pdfSandboxSelfTest.js
  else
    mark_imports_unavailable
  fi
}

# Definitions are runtime state, never image-build state. Only API startup owns
# refresh scheduling; migration and inspection commands are forwarded directly.
case "${1:-}:${2:-}" in
  node:src/server.js|node:/app/src/server.js|npm:start)
    refresh_and_probe || mark_imports_unavailable
    (
      while sleep 21600; do
        refresh_and_probe || mark_imports_unavailable
      done
    ) &
    ;;
esac

exec "$@"
