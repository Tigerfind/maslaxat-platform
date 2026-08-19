const fs = require('fs');
const path = require('path');
const { loadPackageLock } = require('./verifyPdfToolchain');

function requireText(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(`PDF Docker contract: ${message}`);
}

function verifyPdfDockerContract({ apiRoot = path.resolve(__dirname, '../..') } = {}) {
  const dockerfile = fs.readFileSync(path.join(apiRoot, 'Dockerfile'), 'utf8');
  const entrypoint = fs.readFileSync(path.join(apiRoot, 'docker-entrypoint.sh'), 'utf8');
  const parser = fs.readFileSync(path.join(apiRoot, 'src/services/linkedinPdfParser.js'), 'utf8');
  const selfTest = fs.readFileSync(path.join(apiRoot, 'src/workers/pdfSandboxSelfTest.js'), 'utf8');
  const lock = loadPackageLock(path.join(apiRoot, 'pdf-toolchain/packages.lock'));
  const builderImage = `${lock.images.builder.reference}@${lock.images.builder.digest}`;
  const runtimeImage = `${lock.images.runtime.reference}@${lock.images.runtime.digest}`;

  requireText(dockerfile, new RegExp(`^FROM ${builderImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} AS nsjail-builder$`, 'm'), 'builder image is not digest-pinned');
  requireText(dockerfile, new RegExp(`^FROM ${runtimeImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'runtime image is not digest-pinned');
  for (const [name, version] of Object.entries(lock.buildPackages)) {
    if (!dockerfile.includes(`"${name}=${version}"`)) {
      throw new Error(`PDF Docker contract: unpinned build package ${name}`);
    }
  }
  for (const [name, version] of Object.entries(lock.runtimePackages)) {
    if (!dockerfile.includes(`"${name}=${version}"`)) {
      throw new Error(`PDF Docker contract: unpinned runtime package ${name}`);
    }
  }
  if (/&&\s*freshclam\b|RUN\s+freshclam\b/i.test(dockerfile)) {
    throw new Error('PDF Docker contract: mutable build-time freshclam is forbidden');
  }
  requireText(dockerfile, /\/opt\/pdf-runtime-root/, 'dedicated parser runtime root is missing');
  requireText(entrypoint, /freshclam[\s\S]*pdfSandboxSelfTest/, 'runtime definition refresh must precede self-test');
  requireText(entrypoint, /timeout --signal=KILL 60s[\s\S]*prlimit[\s\S]*\/usr\/bin\/freshclam --quiet/, 'freshclam must have a 60-second resource boundary');
  requireText(entrypoint, /freshclam[\s\S]*checkPdfDefinitions\.js[\s\S]*pdfSandboxSelfTest/, 'signed definition preflight must precede self-test');
  requireText(
    entrypoint,
    /node:src\/server\.js\|node:\/app\/src\/server\.js\|npm:start\)[\s\S]*refresh_and_probe \|\| mark_imports_unavailable[\s\S]*exec "\$@"/,
    'refresh failure must fail closed for API startup while commands are forwarded'
  );
  for (const source of [parser, selfTest]) {
    if (/--bindmount_ro['"],\s*['"]\/(?:usr|lib|lib64)(?:['"/:])/m.test(source)) {
      throw new Error('PDF Docker contract: broad system bind detected');
    }
  }
  const smokePath = path.join(apiRoot, 'pdf-toolchain/p3.5-smoke.sh');
  if (!fs.existsSync(smokePath)) throw new Error('PDF Docker contract: P3.5 smoke script is missing');

  return {
    builderImage,
    runtimeImage,
    buildPackages: Object.keys(lock.buildPackages).length,
    runtimePackages: Object.keys(lock.runtimePackages).length,
    parserRuntimeRoot: '/opt/pdf-runtime-root',
    smokeScript: 'pdf-toolchain/p3.5-smoke.sh',
    freshclamTimeoutSeconds: 60,
    definitionPreflight: 'src/scripts/checkPdfDefinitions.js',
  };
}

if (require.main === module) {
  try {
    verifyPdfDockerContract();
    process.stdout.write('PDF Docker contract verified\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { verifyPdfDockerContract };
