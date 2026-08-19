const fs = require('fs');
const dns = require('dns');
const net = require('net');
const path = require('path');
const os = require('os');

const AVAILABILITY_FILE = process.env.PDF_IMPORT_AVAILABILITY_FILE || '/tmp/pdf-import-availability.json';

function probeDns(lookup) {
  return new Promise((resolve) => lookup('example.com', (error) => resolve(Boolean(error))));
}

function probeTcp(connect) {
  return new Promise((resolve) => {
    const socket = connect({ host: '1.1.1.1', port: 53, timeout: 1000 });
    const finish = (blocked) => {
      socket.destroy();
      resolve(blocked);
    };
    socket.once('connect', () => finish(false));
    socket.once('timeout', () => finish(true));
    socket.once('error', () => finish(true));
  });
}

async function insideProbe({
  hostNetNamespace,
  getuid = process.getuid,
  lookup = dns.lookup,
  connect = net.connect,
  readFile = (target) => fs.readFileSync(target, 'utf8'),
  readlink = fs.readlinkSync,
  exists = fs.existsSync,
  writeFile = fs.writeFileSync,
  removeFile = fs.rmSync,
} = {}) {
  let filesystemBlocked = false;
  try {
    writeFile('/outside-profile-import-probe', 'unsafe');
    removeFile('/outside-profile-import-probe', { force: true });
  } catch (_error) {
    filesystemBlocked = true;
  }
  const [dnsBlocked, tcpBlocked] = await Promise.all([
    probeDns(lookup), probeTcp(connect),
  ]);
  let readOnlyBindEnforced = false;
  try {
    if (String(readFile('/input/probe')) === 'probe') {
      try {
        writeFile('/input/probe', 'unsafe');
      } catch (_error) {
        readOnlyBindEnforced = true;
      }
    }
  } catch (_error) {
    readOnlyBindEnforced = false;
  }
  let capabilitiesDropped = false;
  try {
    const capabilities = /^CapEff:\s*([0-9a-f]+)$/im.exec(String(readFile('/proc/self/status')))?.[1];
    capabilitiesDropped = Boolean(capabilities && /^0+$/.test(capabilities));
  } catch (_error) {
    capabilitiesDropped = false;
  }
  let networkNamespaceIsolated = false;
  try {
    networkNamespaceIsolated = Boolean(
      hostNetNamespace && readlink('/proc/self/ns/net') !== hostNetNamespace
    );
  } catch (_error) {
    networkNamespaceIsolated = false;
  }
  const requiredRuntime = [
    '/usr/local/bin/node',
    '/usr/bin/pdftotext',
    '/app/src/workers/pdfSandboxSelfTest.js',
  ];
  const forbiddenRuntime = ['/usr/bin/qpdf', '/usr/bin/clamscan', '/usr/bin/freshclam'];
  const runtimeRootRestricted = requiredRuntime.every(exists) && forbiddenRuntime.every((item) => !exists(item));
  return {
    dnsBlocked,
    tcpBlocked,
    filesystemBlocked,
    nonRoot: typeof getuid === 'function' && getuid() === 65534,
    capabilitiesDropped,
    networkNamespaceIsolated,
    readOnlyBindEnforced,
    runtimeRootRestricted,
  };
}

async function runPdfSandboxSelfTest({ execute, tempRoot = os.tmpdir(), hostNetNamespace } = {}) {
  const commandExecutor = execute || require('../services/linkedinPdfParser').executeCommand;
  const directory = await fs.promises.mkdtemp(path.join(tempRoot, 'pdf-self-test-'));
  try {
    await fs.promises.chmod(directory, 0o700);
    const probePath = path.join(directory, 'probe');
    await fs.promises.writeFile(probePath, 'probe', { mode: 0o400, flag: 'wx' });
    const expectedHostNetNamespace = hostNetNamespace || fs.readlinkSync('/proc/self/ns/net');
    const result = await commandExecutor('nsjail', [
      '--quiet', '--mode', 'o', '--iface_no_lo',
      '--chroot', '/opt/pdf-runtime-root',
      '--user', '65534', '--group', '65534', '--cwd', '/tmp',
      '--bindmount_ro', `${probePath}:/input/probe`,
      '--tmpfsmount', '/tmp', '--rlimit_as', '64', '--rlimit_cpu', '3', '--rlimit_nproc', '8',
      '--time_limit', '4', '--', '/usr/local/bin/node',
      '/app/src/workers/pdfSandboxSelfTest.js', '--inside', `--host-netns=${expectedHostNetNamespace}`,
    ], { cwd: directory, timeoutMs: 5000, maxOutputBytes: 1024 * 1024 });
    if (result.code !== 0 || result.signal) return false;
    const probe = JSON.parse(result.stdout);
    return [
      'dnsBlocked', 'tcpBlocked', 'filesystemBlocked', 'nonRoot',
      'capabilitiesDropped', 'networkNamespaceIsolated', 'readOnlyBindEnforced',
      'runtimeRootRestricted',
    ].every((name) => probe[name] === true);
  } catch (_error) {
    return false;
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function writeAvailability(available, targetPath = AVAILABILITY_FILE) {
  await fs.promises.writeFile(targetPath, JSON.stringify({ available }), { mode: 0o600 });
}

if (require.main === module) {
  if (process.argv.includes('--inside')) {
    const hostNetNamespace = process.argv
      .find((value) => value.startsWith('--host-netns='))
      ?.slice('--host-netns='.length);
    insideProbe({ hostNetNamespace })
      .then((probe) => {
        process.stdout.write(JSON.stringify(probe));
        process.exit(probe.dnsBlocked && probe.tcpBlocked && probe.filesystemBlocked ? 0 : 2);
      })
      .catch(() => process.exit(2));
  } else {
    runPdfSandboxSelfTest()
      .then(async (available) => {
        await writeAvailability(available);
        process.exit(0);
      })
      .catch(async () => {
        await writeAvailability(false).catch(() => {});
        process.exit(0);
      });
  }
}

module.exports = { runPdfSandboxSelfTest, insideProbe, writeAvailability };
