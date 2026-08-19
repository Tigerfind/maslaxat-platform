const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  SECURITY_FIXTURES,
  generateSecurityFixtures,
} = require('./fixtures/generate-linkedin-fixtures');

const apiRoot = path.resolve(__dirname, '..');
const fixtureGenerator = path.join(apiRoot, 'tests/fixtures/generate-linkedin-fixtures.js');

beforeAll(() => {
  const generated = spawnSync(process.execPath, [fixtureGenerator], { encoding: 'utf8' });
  expect(generated).toMatchObject({ status: 0, stderr: '' });
});

function parseManifest(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => {
    const match = /^([0-9a-f]{64})  (\d+)  (PDF-\d+\.\d+(?:,\d+-pages?)?)  (.+\.pdf)$/.exec(line);
    if (!match) throw new Error(`Invalid fixture manifest line: ${line}`);
    return { sha256: match[1], size: Number(match[2]), type: match[3], name: match[4] };
  });
}

function derivePdfType(content) {
  const source = content.toString('latin1');
  const version = /^%PDF-(\d+\.\d+)/.exec(source)?.[1];
  if (!version) return null;
  const pages = source.match(/\/Type\s*\/Page\b/g)?.length || 0;
  return `PDF-${version}${pages ? `,${pages}-${pages === 1 ? 'page' : 'pages'}` : ''}`;
}

test('generates deterministic malformed, attachment, and compression-limit PDFs', () => {
  expect(Object.keys(SECURITY_FIXTURES).sort()).toEqual([
    'attachment', 'compression-limit', 'malformed',
  ]);
  const generated = generateSecurityFixtures();
  for (const [name, expected] of Object.entries(generated)) {
    const stored = fs.readFileSync(path.join(apiRoot, 'pdf-toolchain', 'fixtures', `${name}.pdf`));
    expect(stored.equals(expected)).toBe(true);
    expect(stored.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }
  expect(generated.attachment.toString('latin1')).toMatch(/\/EmbeddedFile|\/FileAttachment|\/AF/);
  expect(generated['compression-limit'].length).toBeLessThan(100000);
});

test('P3.5 smoke scripts are shell/Node syntax-valid and importable without execution', () => {
  const shellPath = path.join(apiRoot, 'pdf-toolchain/p3.5-smoke.sh');
  const nodePath = path.join(apiRoot, 'src/scripts/runPdfP35Smoke.js');
  expect(spawnSync('sh', ['-n', shellPath], { encoding: 'utf8' })).toMatchObject({ status: 0 });
  expect(spawnSync(process.execPath, ['--check', nodePath], { encoding: 'utf8' })).toMatchObject({ status: 0 });
  const smoke = require(nodePath);
  expect(smoke).toEqual(expect.objectContaining({ runPdfP35Smoke: expect.any(Function) }));
  const shell = fs.readFileSync(shellPath, 'utf8');
  expect(shell).toMatch(/prlimit[^\n]*\\?[\s\S]*\/usr\/bin\/qpdf/);
  expect(shell).not.toMatch(/^\s*qpdf\b/m);
});

test.each([
  ['tests/fixtures/linkedin-SHA256SUMS', path.join(apiRoot, 'tests/fixtures')],
  ['pdf-toolchain/fixtures/SHA256SUMS', path.join(apiRoot, 'pdf-toolchain/fixtures')],
])('manifest %s covers every generated PDF hash, size, and type', (relativeManifest, directory) => {
  const crypto = require('crypto');
  const manifest = parseManifest(path.join(apiRoot, relativeManifest));
  const generatedPdfs = fs.readdirSync(directory).filter((name) => name.endsWith('.pdf')).sort();

  expect(manifest.map(({ name }) => name).sort()).toEqual(generatedPdfs);
  for (const entry of manifest) {
    const content = fs.readFileSync(path.join(directory, entry.name));
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    expect(hash).toBe(entry.sha256);
    expect(content.length).toBe(entry.size);
    expect(content.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(entry.type).toBe(derivePdfType(content));
  }
});
