const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runPdfSandboxSelfTest,
  insideProbe,
  writeAvailability,
} = require('../src/workers/pdfSandboxSelfTest');

test('inside probe can run with only built-ins mounted in the empty jail', async () => {
  const result = await insideProbe({
    hostNetNamespace: 'net:[100]',
    getuid: () => 65534,
    lookup: (_host, callback) => callback(new Error('network denied')),
    connect: () => {
      const { EventEmitter } = require('events');
      const socket = new EventEmitter();
      socket.destroy = jest.fn();
      process.nextTick(() => socket.emit('error', new Error('network denied')));
      return socket;
    },
    readFile: (target) => {
      if (target === '/proc/self/status') return 'CapEff:\t0000000000000000\n';
      if (target === '/input/probe') return 'probe';
      throw new Error(`unexpected read ${target}`);
    },
    readlink: () => 'net:[200]',
    exists: (target) => [
      '/usr/local/bin/node',
      '/usr/bin/pdftotext',
      '/app/src/workers/pdfSandboxSelfTest.js',
    ].includes(target),
    writeFile: () => { throw new Error('filesystem denied'); },
    removeFile: jest.fn(),
  });

  expect(result).toEqual({
    dnsBlocked: true,
    tcpBlocked: true,
    filesystemBlocked: true,
    nonRoot: true,
    capabilitiesDropped: true,
    networkNamespaceIsolated: true,
    readOnlyBindEnforced: true,
    runtimeRootRestricted: true,
  });
});

test('requires DNS, TCP, and out-of-temp filesystem denial inside an empty chroot', async () => {
  let invocation;
  const execute = async (command, args, options) => {
    invocation = { command, args, options };
    return {
      code: 0,
      signal: null,
      stdout: JSON.stringify({
        dnsBlocked: true,
        tcpBlocked: true,
        filesystemBlocked: true,
        nonRoot: true,
        capabilitiesDropped: true,
        networkNamespaceIsolated: true,
        readOnlyBindEnforced: true,
        runtimeRootRestricted: true,
      }),
      stderr: '',
    };
  };

  await expect(runPdfSandboxSelfTest({
    execute, tempRoot: os.tmpdir(), hostNetNamespace: 'net:[100]',
  })).resolves.toBe(true);
  expect(invocation.command).toBe('nsjail');
  expect(invocation.args).toEqual(expect.arrayContaining([
    '--iface_no_lo', '--chroot', '/opt/pdf-runtime-root', '--tmpfsmount', '/tmp',
    '--user', '65534', '--group', '65534',
    '--bindmount_ro', expect.stringMatching(/probe:\/input\/probe$/),
  ]));
  expect(invocation.args).not.toContain('--disable_clone_newnet');
  expect(invocation.args.join(' ')).not.toMatch(/--bindmount_ro \/usr(?::|\/|\s)/);
  expect(invocation.args.join(' ')).not.toMatch(/--bindmount_ro \/lib(?:64)?(?::|\/|\s)/);
});

test.each([
  'dnsBlocked', 'tcpBlocked', 'filesystemBlocked', 'nonRoot',
  'capabilitiesDropped', 'networkNamespaceIsolated', 'readOnlyBindEnforced',
  'runtimeRootRestricted',
])(
  'marks the sandbox unavailable when %s is not denied',
  async (failedProbe) => {
    const probe = {
      dnsBlocked: true,
      tcpBlocked: true,
      filesystemBlocked: true,
      nonRoot: true,
      capabilitiesDropped: true,
      networkNamespaceIsolated: true,
      readOnlyBindEnforced: true,
      runtimeRootRestricted: true,
      [failedProbe]: false,
    };
    const execute = async () => ({ code: 0, signal: null, stdout: JSON.stringify(probe), stderr: '' });
    await expect(runPdfSandboxSelfTest({
      execute, hostNetNamespace: 'net:[100]',
    })).resolves.toBe(false);
  }
);

test('writes a private startup availability record', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'availability-test-'));
  const availabilityPath = path.join(directory, 'state.json');
  try {
    await writeAvailability(true, availabilityPath);
    expect(JSON.parse(await fs.promises.readFile(availabilityPath, 'utf8'))).toEqual({ available: true });
    expect((await fs.promises.stat(availabilityPath)).mode & 0o777).toBe(0o600);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
