const os = require('os');
const path = require('path');
const {
  parseLinkedinPdf,
  PdfImportError,
  PdfImportUnavailableError,
} = require('../src/services/linkedinPdfParser');

const PDF = Buffer.from('%PDF-1.7\nsynthetic');
const NOW = Date.UTC(2026, 7, 16, 12);

function options(overrides = {}) {
  return {
    now: () => NOW,
    definitions: {
      path: '/defs',
      files: ['/defs/main.cvd', '/defs/daily.cvd'],
      freshnessFile: '/defs/daily.cvd',
    },
    tempRoot: os.tmpdir(),
    sandboxReady: true,
    execute: async (command, args) => {
      const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
      const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
      if (boundedBinary === 'sigtool' && boundedArgs.includes('--verify-cvd')) {
        return { code: 0, stdout: 'Verification OK', stderr: '' };
      }
      if (boundedBinary === 'sigtool' && boundedArgs.includes('--info')) {
        return {
          code: 0,
          stdout: 'File: daily.cvd\nBuild time: 16 Aug 2026 11:30 +0000\nVersion: 27800\n',
          stderr: '',
        };
      }
      if (boundedBinary === 'clamscan') return { code: 0, stdout: '', stderr: '' };
      if (boundedBinary === 'qpdf' && boundedArgs.includes('--show-encryption')) return { code: 0, stdout: 'File is not encrypted', stderr: '' };
      if (boundedBinary === 'qpdf' && boundedArgs.includes('--show-npages')) return { code: 0, stdout: '1', stderr: '' };
      if (boundedBinary === 'qpdf' && boundedArgs.includes('--list-attachments')) return { code: 0, stdout: '', stderr: '' };
      if (boundedBinary === 'qpdf' && boundedArgs.includes('--json')) {
        return { code: 0, stdout: JSON.stringify({ qpdf: [{ jsonversion: 2 }] }), stderr: '' };
      }
      if (boundedBinary === 'qpdf') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: JSON.stringify({ text: 'Headline\nSafe lawyer' }), stderr: '' };
    },
    ...overrides,
  };
}

async function expectGenericFailure(buffer, parserOptions) {
  await expect(parseLinkedinPdf(buffer, parserOptions)).rejects.toEqual(expect.objectContaining({
    name: 'PdfImportError', code: 'PDF_IMPORT_FAILED', message: 'PDF import failed',
  }));
}

test('rejects oversized input before invoking any tool', async () => {
  const execute = jest.fn();
  const oversized = Buffer.alloc((10 * 1024 * 1024) + 1);
  oversized.write('%PDF-');
  await expectGenericFailure(oversized, options({ execute }));
  expect(execute).not.toHaveBeenCalled();
});

test.each([
  ['unsigned definitions', { execute: async () => ({ code: 1, stdout: '', stderr: 'invalid signature' }) }],
  ['failed startup sandbox self-test', { sandboxReady: false }],
])('fails closed for %s', async (_label, override) => {
  await expect(parseLinkedinPdf(PDF, options(override))).rejects.toEqual(expect.objectContaining({
    name: 'PdfImportUnavailableError', code: 'PDF_IMPORT_UNAVAILABLE', status: 503,
  }));
});

test('rejects stale signed definitions from embedded build metadata even when files were touched', async () => {
  const base = options();
  const execute = async (command, args, commandOptions) => {
    const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
    const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
    if (boundedBinary === 'sigtool' && boundedArgs.includes('--info') && boundedArgs.includes('/defs/daily.cvd')) {
      return {
        code: 0,
        stdout: 'File: daily.cvd\nBuild time: 14 Aug 2026 11:59 +0000\nVersion: 27700\n',
        stderr: '',
      };
    }
    return base.execute(command, args, commandOptions);
  };
  const definitions = {
    ...base.definitions,
    mtimeMs: NOW + (365 * 24 * 60 * 60 * 1000),
  };

  await expect(parseLinkedinPdf(PDF, options({ execute, definitions }))).rejects.toMatchObject({
    code: 'PDF_IMPORT_UNAVAILABLE', status: 503,
  });
});

test('rejects signed definitions with missing or malformed embedded build metadata', async () => {
  const base = options();
  const execute = async (command, args, commandOptions) => {
    const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
    const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
    if (boundedBinary === 'sigtool' && boundedArgs.includes('--info')) {
      return { code: 0, stdout: 'File: daily.cvd\nVersion: not-a-number\n', stderr: '' };
    }
    return base.execute(command, args, commandOptions);
  };

  await expect(parseLinkedinPdf(PDF, options({ execute }))).rejects.toMatchObject({
    code: 'PDF_IMPORT_UNAVAILABLE', status: 503,
  });
});

test.each([
  ['malware/scanner error', 'clamscan', () => ({ code: 2, stdout: '', stderr: 'scanner error' })],
  ['encrypted PDF', 'qpdf-encryption', () => ({ code: 0, stdout: 'R = 6', stderr: '' })],
  ['malformed PDF', 'qpdf-check', () => ({ code: 2, stdout: '', stderr: 'damaged file' })],
  ['too many pages', 'qpdf-pages', () => ({ code: 0, stdout: '26', stderr: '' })],
  ['embedded attachment', 'qpdf-attachments', () => ({ code: 0, stdout: 'payload.zip -> 1,0', stderr: '' })],
  ['decompression-heavy text', 'nsjail', () => ({ code: 0, stdout: JSON.stringify({ text: 'x'.repeat(100001) }), stderr: '' })],
  ['parser timeout', 'nsjail', () => ({ code: 124, stdout: '', stderr: '' })],
  ['parser signal', 'nsjail', () => ({ code: null, signal: 'SIGKILL', stdout: '', stderr: '' })],
  ['malformed worker JSON', 'nsjail', () => ({ code: 0, stdout: '{no', stderr: '' })],
])('rejects %s and removes its private temp directory', async (_label, target, result) => {
  let privateDirectory;
  const base = options();
  const execute = async (command, args, commandOptions) => {
    if (commandOptions?.cwd) privateDirectory = commandOptions.cwd;
    const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
    const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
    const kind = boundedBinary === 'qpdf' && boundedArgs.includes('--show-encryption') ? 'qpdf-encryption'
      : boundedBinary === 'qpdf' && boundedArgs.includes('--show-npages') ? 'qpdf-pages'
      : boundedBinary === 'qpdf' && boundedArgs.includes('--list-attachments') ? 'qpdf-attachments'
      : boundedBinary === 'qpdf' && boundedArgs.includes('--json') ? 'qpdf-json'
        : boundedBinary === 'qpdf' ? 'qpdf-check' : boundedBinary;
    return kind === target ? result() : base.execute(command, args, commandOptions);
  };

  await expectGenericFailure(PDF, options({ execute }));
  expect(privateDirectory).toBeTruthy();
  const fs = require('fs');
  expect(fs.existsSync(privateDirectory)).toBe(false);
});

test.each([
  ['EmbeddedFile stream', { objects: { '7 0 R': { value: { '/Type': '/EmbeddedFile' } } } }],
  ['FileAttachment annotation', { objects: { '8 0 R': { value: { '/Subtype': '/FileAttachment' } } } }],
  ['associated file array', { objects: { '9 0 R': { value: { '/AF': ['10 0 R'] } } } }],
  ['EmbeddedFiles name tree', { objects: { '11 0 R': { value: { '/EmbeddedFiles': {} } } } }],
])('rejects %s found structurally in qpdf JSON when list output is empty', async (_label, structure) => {
  const base = options();
  const execute = async (command, args, commandOptions) => {
    const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
    const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
    if (boundedBinary === 'qpdf' && boundedArgs.includes('--json')) {
      return { code: 0, stdout: JSON.stringify(structure), stderr: '' };
    }
    return base.execute(command, args, commandOptions);
  };

  await expectGenericFailure(PDF, options({ execute }));
});

test('exports only the generic public error contract', () => {
  const error = new PdfImportError(new Error('sensitive scanner path and PDF text'));
  expect(error).toMatchObject({ code: 'PDF_IMPORT_FAILED', message: 'PDF import failed' });
  expect(JSON.stringify(error)).not.toContain('sensitive');
});

test('exports only the generic unavailable contract', () => {
  const error = new PdfImportUnavailableError(new Error('sensitive tool path'));
  expect(error).toMatchObject({
    code: 'PDF_IMPORT_UNAVAILABLE', message: 'PDF import unavailable', status: 503,
  });
  expect(JSON.stringify(error)).not.toContain('sensitive');
});

test('verifies every bundled signed definition and scans with the definition directory', async () => {
  const calls = [];
  const base = options();
  const execute = async (command, args, commandOptions) => {
    calls.push([command, args]);
    return base.execute(command, args, commandOptions);
  };
  await parseLinkedinPdf(PDF, options({
    execute,
    definitions: {
      path: '/var/lib/clamav',
      files: ['/var/lib/clamav/main.cvd', '/var/lib/clamav/daily.cld'],
      freshnessFile: '/var/lib/clamav/daily.cld',
    },
  }));

  expect(calls.filter(([command, args]) => (
    command === 'prlimit' && args[4] === '/usr/bin/sigtool'
  )).map(([, args]) => args.slice(5))).toEqual([
    ['--verify-cvd', '/var/lib/clamav/main.cvd'],
    ['--info', '/var/lib/clamav/main.cvd'],
    ['--verify-cvd', '/var/lib/clamav/daily.cld'],
    ['--info', '/var/lib/clamav/daily.cld'],
  ]);
  const scanner = calls.find(([command, args]) => (
    command === 'prlimit' && args[4] === '/usr/bin/clamscan'
  ));
  expect(scanner[1]).toEqual(expect.arrayContaining([
    '--database=/var/lib/clamav/main.cvd',
    '--database=/var/lib/clamav/daily.cld',
  ]));
  expect(scanner[1]).not.toContain('--database=/var/lib/clamav');
});

test('never verifies or loads an unsigned extra ClamAV database file', async () => {
  const calls = [];
  const base = options();
  const execute = async (command, args, commandOptions) => {
    calls.push([command, args]);
    return base.execute(command, args, commandOptions);
  };
  await parseLinkedinPdf(PDF, options({
    execute,
    definitions: {
      path: '/defs',
      files: ['/defs/main.cvd', '/defs/daily.cvd', '/defs/unsigned.ndb', '/defs/extra.ldb'],
      freshnessFile: '/defs/daily.cvd',
    },
  }));

  const serialized = JSON.stringify(calls);
  expect(serialized).not.toMatch(/unsigned\.ndb|extra\.ldb/);
  const scanner = calls.find(([command, args]) => (
    command === 'prlimit' && args[4] === '/usr/bin/clamscan'
  ));
  expect(scanner[1].filter((value) => value.startsWith('--database='))).toEqual([
    '--database=/defs/main.cvd', '--database=/defs/daily.cvd',
  ]);
});
