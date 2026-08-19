const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadPackageLock, verifyPdfToolchain } = require('../src/scripts/verifyPdfToolchain');

const lockPath = path.resolve(__dirname, '../pdf-toolchain/packages.lock');

test('loads exact Debian package versions and immutable nsjail source revision', () => {
  expect(loadPackageLock(lockPath)).toEqual({
    snapshot: '20260815T000000Z',
    images: {
      builder: {
        reference: 'debian:bookworm-slim',
        digest: 'sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241',
      },
      runtime: {
        reference: 'node:22.18.0-bookworm-slim',
        digest: 'sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e',
      },
    },
    buildPackages: {
      bison: '2:3.8.2+dfsg-1+b1',
      'build-essential': '12.9',
      'ca-certificates': '20250419~deb12u1',
      flex: '2.6.4-8.2',
      git: '1:2.39.5-0+deb12u3',
      'libcap-dev': '1:2.66-4+deb12u3+b1',
      'libnl-3-dev': '3.7.0-0.2+b1',
      'libnl-genl-3-dev': '3.7.0-0.2+b1',
      'libnl-route-3-dev': '3.7.0-0.2+b1',
      'libprotobuf-dev': '3.21.12-3+deb12u1',
      'libseccomp-dev': '2.5.4-1+deb12u1',
      'pkg-config': '1.8.1-1',
      'protobuf-compiler': '3.21.12-3+deb12u1',
    },
    runtimePackages: {
      'ca-certificates': '20250419~deb12u1',
      clamav: '1.4.3+dfsg-1~deb12u2',
      'clamav-freshclam': '1.4.3+dfsg-1~deb12u2',
      qpdf: '11.3.0-1+deb12u1',
      'poppler-utils': '22.12.0-2+deb12u3',
      'util-linux': '2.38.1-5+deb12u3',
      libcap2: '1:2.66-4+deb12u3+b1',
      'libnl-3-200': '3.7.0-0.2+b1',
      'libnl-genl-3-200': '3.7.0-0.2+b1',
      'libnl-route-3-200': '3.7.0-0.2+b1',
      libprotobuf32: '3.21.12-3+deb12u1',
      libseccomp2: '2.5.4-1+deb12u1',
    },
    tools: {
      clamscan: '1.4.3',
      qpdf: '11.3.0',
      pdftotext: '22.12.0',
    },
    nsjail: {
      version: '3.4',
      commit: '079d70dda4aa1edd9512cfd25ff1e47e316dc355',
    },
  });
});

test('executes every installed version check and accepts exact matches', async () => {
  const calls = [];
  const lock = loadPackageLock(lockPath);
  const execute = async (command, args) => {
    calls.push([command, args]);
    if (command === 'dpkg-query') {
      return { code: 0, stdout: lock.runtimePackages[args.at(-1)], stderr: '' };
    }
    const boundedCommand = command === 'prlimit' ? path.basename(args[4]) : command;
    const output = {
      clamscan: 'ClamAV 1.4.3/27800/Sun Aug 16 2026',
      qpdf: 'qpdf version 11.3.0',
      pdftotext: 'pdftotext version 22.12.0',
      nsjail: 'NsJail version: 3.4',
    };
    return boundedCommand === 'pdftotext'
      ? { code: 0, stdout: '', stderr: output[boundedCommand] }
      : { code: 0, stdout: output[boundedCommand], stderr: '' };
  };

  await expect(verifyPdfToolchain({ lockPath, execute })).resolves.toBe(true);
  expect(calls).toEqual([
    ...Object.keys(lock.runtimePackages).map((name) => (
      ['dpkg-query', ['-W', '-f=${Version}', name]]
    )),
    ['prlimit', ['--as=268435456', '--cpu=10', '--nproc=64', '--', '/usr/bin/clamscan', '--version']],
    ['prlimit', ['--as=268435456', '--cpu=10', '--nproc=64', '--', '/usr/bin/qpdf', '--version']],
    ['prlimit', ['--as=268435456', '--cpu=10', '--nproc=64', '--', '/usr/bin/pdftotext', '-v']],
    ['nsjail', ['--version']],
  ]);
});

test('fails the image verification on any package or nsjail mismatch', async () => {
  const lock = loadPackageLock(lockPath);
  const execute = async (command, args) => {
    const boundedCommand = command === 'prlimit' ? path.basename(args[4]) : command;
    const tools = {
      clamscan: 'ClamAV 1.4.3', qpdf: 'qpdf version 11.3.0',
      pdftotext: 'pdftotext version 22.12.0', nsjail: 'NsJail version: 3.3',
    };
    return {
      code: 0,
      stdout: command === 'dpkg-query' ? lock.runtimePackages[args.at(-1)] : tools[boundedCommand],
      stderr: '',
    };
  };
  await expect(verifyPdfToolchain({ lockPath, execute })).rejects.toThrow(/nsjail.*mismatch/i);
});

test('rejects executable metacharacters in locked native versions before invoking commands', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'toolchain-lock-'));
  const poisonedPath = path.join(directory, 'packages.lock');
  try {
    const lock = loadPackageLock(lockPath);
    lock.tools.qpdf = '11.3.0;touch /tmp/unsafe';
    await fs.promises.writeFile(poisonedPath, JSON.stringify(lock));
    const execute = jest.fn();

    await expect(verifyPdfToolchain({ lockPath: poisonedPath, execute }))
      .rejects.toThrow(/Invalid PDF toolchain lock/);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
