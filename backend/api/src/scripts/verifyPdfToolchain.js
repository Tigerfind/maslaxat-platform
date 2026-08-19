const fs = require('fs');
const path = require('path');
const { executeCommand, runBoundedTool } = require('../services/linkedinPdfParser');

const DEFAULT_LOCK = path.resolve(__dirname, '../../pdf-toolchain/packages.lock');

function loadPackageLock(lockPath = DEFAULT_LOCK) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const safeVersion = /^[0-9A-Za-z.+:~_-]+$/;
  const safeDigest = /^sha256:[0-9a-f]{64}$/;
  if (!/^\d{8}T\d{6}Z$/.test(lock.snapshot || '')
    || !lock.buildPackages
    || !lock.runtimePackages
    || !safeDigest.test(lock.images?.builder?.digest || '')
    || !safeDigest.test(lock.images?.runtime?.digest || '')
    || !/^\d+\.\d+$/.test(lock.nsjail?.version || '')
    || !/^[0-9a-f]{40}$/.test(lock.nsjail?.commit || '')) {
    throw new Error('Invalid PDF toolchain lock');
  }
  for (const [groupName, packages] of Object.entries({
    buildPackages: lock.buildPackages,
    runtimePackages: lock.runtimePackages,
  })) {
    for (const [name, version] of Object.entries(packages)) {
      if (!name || typeof version !== 'string' || !safeVersion.test(version)) {
        throw new Error(`Invalid PDF toolchain lock: ${groupName}.${name}`);
      }
    }
  }
  for (const name of ['clamscan', 'qpdf', 'pdftotext']) {
    if (typeof lock.tools?.[name] !== 'string' || !safeVersion.test(lock.tools[name])) {
      throw new Error(`Invalid PDF toolchain lock: tools.${name}`);
    }
  }
  return lock;
}

async function verifyPdfToolchain({ lockPath = DEFAULT_LOCK, execute = executeCommand } = {}) {
  const lock = loadPackageLock(lockPath);
  for (const [name, expected] of Object.entries(lock.runtimePackages)) {
    const result = await execute('dpkg-query', ['-W', '-f=${Version}', name], {
      timeoutMs: 5000,
      maxOutputBytes: 64 * 1024,
    });
    if (result.code !== 0 || result.signal || result.stdout.trim() !== expected) {
      throw new Error(`${name} version mismatch`);
    }
  }
  const versionCommands = [
    ['clamscan', '/usr/bin/clamscan', ['--version']],
    ['qpdf', '/usr/bin/qpdf', ['--version']],
    ['pdftotext', '/usr/bin/pdftotext', ['-v']],
  ];
  for (const [command, binary, args] of versionCommands) {
    const result = await runBoundedTool(execute, binary, args, {
      timeoutMs: 5000,
      maxOutputBytes: 64 * 1024,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const expected = lock.tools[command].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (result.code !== 0 || result.signal || !new RegExp(`(?:^|\\D)${expected}(?:\\D|$)`).test(output)) {
      throw new Error(`${command} version mismatch`);
    }
  }
  const nsjail = await execute('nsjail', ['--version'], {
    timeoutMs: 5000,
    maxOutputBytes: 64 * 1024,
  });
  if (nsjail.code !== 0 || nsjail.signal
    || !new RegExp(`(?:version[: ]+|v)${lock.nsjail.version.replace('.', '\\.')}(?:\\s|$)`, 'i')
      .test(`${nsjail.stdout}\n${nsjail.stderr}`)) {
    throw new Error('nsjail version mismatch');
  }
  return true;
}

if (require.main === module) {
  verifyPdfToolchain()
    .then(() => process.stdout.write('PDF toolchain verified\n'))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { loadPackageLock, verifyPdfToolchain };
