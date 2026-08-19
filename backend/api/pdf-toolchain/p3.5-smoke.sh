#!/bin/sh
set -eu

# P3.5 only: run inside the built API image with the production runtime
# capabilities. This performs real freshclam/qpdf/ClamAV/nsjail/Poppler calls.
if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'P3.5 smoke must run as the nonroot image user' >&2
  exit 1
fi

node /app/src/scripts/verifyPdfToolchain.js
node /app/src/scripts/verifyPdfDockerContract.js
timeout --signal=KILL 60s \
  prlimit --as=536870912 --cpu=30 --nproc=32 -- \
  /usr/bin/freshclam --quiet
node /app/src/scripts/checkPdfDefinitions.js
node /app/src/workers/pdfSandboxSelfTest.js
node -e "if (!require('/app/src/services/linkedinPdfParser').productionSandboxReady()) process.exit(1)"

smoke_tmp="$(mktemp -d /tmp/pdf-p35-smoke.XXXXXX)"
chmod 700 "$smoke_tmp"
trap 'rm -rf "$smoke_tmp"' EXIT HUP INT TERM

prlimit --as=268435456 --cpu=10 --nproc=64 -- \
  /usr/bin/qpdf --deterministic-id --static-aes-iv \
  --encrypt fixture-user fixture-owner 256 -- \
  /app/pdf-toolchain/fixtures/linkedin-en.pdf "$smoke_tmp/encrypted.pdf"
chmod 600 "$smoke_tmp/encrypted.pdf"

node /app/src/scripts/runPdfP35Smoke.js "$smoke_tmp/encrypted.pdf"
