const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  executeCommand,
  runBoundedTool,
  nsjailArguments,
  successful,
} = require('../src/services/linkedinPdfParser');

function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn();
  return child;
}

test('detaches a native command and kills its whole process group on timeout', async () => {
  const child = fakeChild();
  let spawnOptions;
  const spawnImpl = (_command, _args, options) => {
    spawnOptions = options;
    return child;
  };
  const killImpl = jest.fn((pid, signal) => {
    expect(pid).toBe(-child.pid);
    expect(signal).toBe('SIGKILL');
    process.nextTick(() => child.emit('close', null, 'SIGKILL'));
  });

  await expect(executeCommand('native-tool', [], {
    spawnImpl, killImpl, timeoutMs: 5,
  })).resolves.toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true });
  expect(spawnOptions).toMatchObject({ detached: true, shell: false });
  expect(killImpl).toHaveBeenCalledTimes(1);
});

test('kills the process group on output overflow before resolving', async () => {
  const child = fakeChild();
  const killImpl = jest.fn(() => process.nextTick(() => child.emit('close', null, 'SIGKILL')));
  const promise = executeCommand('native-tool', [], {
    spawnImpl: () => child,
    killImpl,
    timeoutMs: 1000,
    maxOutputBytes: 4,
  });
  child.stdout.write(Buffer.from('12345'));

  await expect(promise).resolves.toMatchObject({ signal: 'OUTPUT_LIMIT' });
  expect(killImpl).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
});

test('AbortSignal kills the active process group immediately and is never successful', async () => {
  const child = fakeChild();
  const controller = new AbortController();
  const killImpl = jest.fn(() => process.nextTick(() => child.emit('close', null, 'SIGKILL')));
  const resultPromise = executeCommand('native-tool', [], {
    spawnImpl: () => child,
    killImpl,
    signal: controller.signal,
    timeoutMs: 1000,
  });

  controller.abort(new Error('heartbeat failed'));
  const result = await resultPromise;

  expect(killImpl).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
  expect(result).toMatchObject({ aborted: true, signal: 'ABORTED' });
  expect(successful(result)).toBe(false);
});

test('kills leftover group members after a nonzero leader exit', async () => {
  const child = fakeChild();
  const killImpl = jest.fn();
  const promise = executeCommand('native-tool', [], {
    spawnImpl: () => child,
    killImpl,
    timeoutMs: 1000,
  });
  child.emit('close', 2, null);

  await expect(promise).resolves.toMatchObject({ code: 2 });
  expect(killImpl).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
});

test('timeout wins a deterministic code-zero close race and can never be successful', async () => {
  const child = fakeChild();
  const resultPromise = executeCommand('native-tool', [], {
    spawnImpl: () => child,
    killImpl: () => child.emit('close', 0, null),
    timeoutMs: 5,
  });

  const result = await resultPromise;
  expect(result).toMatchObject({ code: 0, signal: null, timedOut: true, outputExceeded: false });
  expect(successful(result)).toBe(false);
});

test('output overflow remains unsuccessful even when close reports code zero', async () => {
  const child = fakeChild();
  const resultPromise = executeCommand('native-tool', [], {
    spawnImpl: () => child,
    killImpl: () => child.emit('close', 0, null),
    timeoutMs: 1000,
    maxOutputBytes: 4,
  });
  child.stdout.write('12345');

  const result = await resultPromise;
  expect(result).toMatchObject({ code: null, signal: 'OUTPUT_LIMIT', outputExceeded: true });
  expect(successful(result)).toBe(false);
});

test('wraps native scanners and PDF tools in exact prlimit resource limits', async () => {
  const execute = jest.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

  await runBoundedTool(execute, '/usr/bin/qpdf', ['--check', '/input/profile.pdf'], {
    cwd: '/private', timeoutMs: 15000, maxOutputBytes: 20 * 1024 * 1024,
  });

  expect(execute).toHaveBeenCalledWith('prlimit', [
    '--as=268435456', '--cpu=10', '--nproc=64', '--',
    '/usr/bin/qpdf', '--check', '/input/profile.pdf',
  ], expect.objectContaining({
    cwd: '/private', timeoutMs: 15000, maxOutputBytes: 20 * 1024 * 1024,
  }));
});

test('uses a prepared minimal jail root and never bind-mounts broad system trees', () => {
  const args = nsjailArguments('/private/profile.pdf');
  const serialized = args.join(' ');

  expect(args).toEqual(expect.arrayContaining([
    '--chroot', '/opt/pdf-runtime-root',
    '--bindmount_ro', '/private/profile.pdf:/input/profile.pdf',
    '--tmpfsmount', '/tmp', '--rlimit_as', '256', '--rlimit_cpu', '10',
  ]));
  expect(serialized).not.toMatch(/--bindmount_ro \/usr(?::|\/|\s)/);
  expect(serialized).not.toMatch(/--bindmount_ro \/lib(?:64)?(?::|\/|\s)/);
  expect(args.filter((value) => value === '--bindmount_ro')).toHaveLength(1);
});
