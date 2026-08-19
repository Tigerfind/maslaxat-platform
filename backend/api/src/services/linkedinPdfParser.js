const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PARSER_VERSION = 'linkedin-pdf-v1';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 25;
const MAX_TEXT_CHARS = 100000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_DEFINITION_AGE_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_FILE = process.env.PDF_IMPORT_AVAILABILITY_FILE || '/tmp/pdf-import-availability.json';

const SECTION_ALIASES = new Map(Object.entries({
  headline: ['headline', 'заголовок', 'sarlavha'],
  summary: ['about', 'summary', 'о себе', 'men haqimda'],
  positions: ['experience', 'опыт', 'ish tajribasi'],
  education: ['education', 'образование', "ta'lim"],
  skills: ['skills', 'навыки', "ko'nikmalar"],
  languages: ['languages', 'языки', 'tillar'],
  certificates: ['certifications', 'certificates', 'сертификаты', 'sertifikatlar'],
}).flatMap(([section, aliases]) => aliases.map((alias) => [alias, section])));
const UNKNOWN_SECTIONS = new Set([
  'honors & awards', 'honors and awards', 'honours & awards', 'honours and awards',
  'awards', 'publications', 'publication', 'projects', 'project',
  'volunteer experience', 'volunteer experiences', 'volunteering experience', 'volunteering',
  'courses', 'coursework', 'organizations', 'organization', 'organisations', 'organisation',
  'interests', 'recommendations', 'recommendation',
  'проекты', 'loyihalar', 'волонтерство',
]);
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d[\d ()-]{7,}\d)/g;
const FORBIDDEN_FIELD = /^\s*(?:admin|role|accounttype|payment|paymentstatus|balance|pendingbalance|withdrawal|verificationstatus|isverified|isavailable)\s*[:=]/i;
const PUBLIC_WARNING_MESSAGES = Object.freeze({
  MALFORMED_ENTRY: 'Some profile entries could not be imported.',
  UNKNOWN_SECTION: 'Some unsupported profile sections were skipped.',
});
const MAX_WARNINGS = 20;

class PdfImportError extends Error {
  constructor() {
    super('PDF import failed');
    this.name = 'PdfImportError';
    this.code = 'PDF_IMPORT_FAILED';
    this.status = 422;
  }
}

class PdfImportUnavailableError extends Error {
  constructor() {
    super('PDF import unavailable');
    this.name = 'PdfImportUnavailableError';
    this.code = 'PDF_IMPORT_UNAVAILABLE';
    this.status = 503;
  }
}

function normalizeUntrustedText(value, maxLength = 2000) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeText(value, maxLength = 2000) {
  return normalizeUntrustedText(value, maxLength)
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanLine(line) {
  const normalized = normalizeUntrustedText(line);
  if (FORBIDDEN_FIELD.test(normalized)) return '';
  return sanitizeText(normalized);
}

function sanitizeParserWarnings(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const warning of value.slice(0, MAX_WARNINGS)) {
    const code = typeof warning?.code === 'string' ? warning.code : '';
    if (!Object.hasOwn(PUBLIC_WARNING_MESSAGES, code) || seen.has(code)) continue;
    seen.add(code);
    result.push({ code, message: PUBLIC_WARNING_MESSAGES[code] });
  }
  return result;
}

function isGenericUnknownHeading(lines, index, sectionHasContent) {
  if (!sectionHasContent || index === 0 || index === lines.length - 1) return false;
  const value = normalizeUntrustedText(lines[index], 100);
  if (!value
    || value.length > 80
    || /[|;:.!?@]/.test(value)
    || /^[-*•▪◦]\s*/u.test(value)
    || /\b(?:19|20)\d{2}\b/.test(value)
    || /^\d+(?:\s*[-–—/]\s*\d+)*$/u.test(value)
    || /^\p{L}[\p{L}\s_-]{0,30}\s*[:=]/u.test(value)) return false;
  const words = value.split(/\s+/);
  if (words.length > 8) return false;
  const letters = value.match(/\p{L}/gu) || [];
  const allCaps = letters.length >= 2
    && value === value.toLocaleUpperCase()
    && value !== value.toLocaleLowerCase();
  const connectors = new Set([
    '&', 'and', 'or', 'of', 'the', 'for', 'in', 'va', 'и', 'ёки', 'ҳамда',
  ]);
  const significant = words.filter((word) => !connectors.has(word.toLocaleLowerCase('en')));
  const titleCase = significant.length >= 2 && significant.every((word) => {
    const firstLetter = word.match(/\p{L}/u)?.[0];
    return firstLetter
      && firstLetter === firstLetter.toLocaleUpperCase()
      && firstLetter !== firstLetter.toLocaleLowerCase();
  });
  const hasConnector = words.some((word) => connectors.has(word.toLocaleLowerCase('en')));
  const connectorHeading = hasConnector
    && significant.length >= 2
    && /^\p{Lu}/u.test(significant[0])
    && /s$/i.test(significant[0])
    && /s$/i.test(significant.at(-1));
  return allCaps || titleCase || connectorHeading;
}

function parseDelimited(lines, fields, warnings, section, maxItems = 50) {
  const values = [];
  for (const line of lines.slice(0, maxItems)) {
    const parts = line.split('|').map((part) => sanitizeText(part, 500));
    if (parts.length !== fields.length || parts.some((part) => !part)) {
      warnings.push({ code: 'MALFORMED_ENTRY', section });
      continue;
    }
    values.push(Object.fromEntries(fields.map((field, index) => [field, parts[index]])));
  }
  return values;
}

function parseList(lines) {
  const seen = new Set();
  const values = [];
  for (const item of lines.join(';').split(';')) {
    const value = sanitizeText(item, 200);
    const key = value.toLocaleLowerCase('en');
    if (value && !seen.has(key) && values.length < 100) {
      seen.add(key);
      values.push(value);
    }
  }
  return values;
}

function parseLinkedinText(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) throw new PdfImportError();
  const sections = Object.fromEntries([
    'headline', 'summary', 'positions', 'education', 'skills', 'languages', 'certificates',
  ].map((name) => [name, []]));
  const warnings = [];
  let section = null;
  let ignoringUnknown = false;

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const normalizedHeading = normalizeUntrustedText(rawLine, 100);
    const heading = normalizedHeading.toLocaleLowerCase('en');
    if (SECTION_ALIASES.has(heading)) {
      section = SECTION_ALIASES.get(heading);
      ignoringUnknown = false;
      continue;
    }
    if (UNKNOWN_SECTIONS.has(heading)
      || (!ignoringUnknown && isGenericUnknownHeading(
        lines, index, Boolean(section && sections[section].length)
      ))) {
      warnings.push({ code: 'UNKNOWN_SECTION', section: normalizedHeading });
      section = null;
      ignoringUnknown = true;
      continue;
    }
    if (!section || ignoringUnknown) continue;
    const line = cleanLine(rawLine);
    if (line) sections[section].push(line);
  }

  const data = {
    headline: sanitizeText(sections.headline[0] || '', 300),
    summary: sanitizeText(sections.summary.join(' '), 2000),
    positions: parseDelimited(
      sections.positions,
      ['title', 'company', 'location', 'startDate', 'endDate', 'description'],
      warnings,
      'positions'
    ),
    education: parseDelimited(
      sections.education,
      ['institution', 'degree', 'endDate'],
      warnings,
      'education'
    ),
    skills: parseList(sections.skills),
    languages: parseList(sections.languages),
    certificates: parseDelimited(
      sections.certificates,
      ['name', 'issuer', 'issuedAt'],
      warnings,
      'certificates'
    ),
  };

  return { data, warnings: sanitizeParserWarnings(warnings), parserVersion: PARSER_VERSION };
}

function executeCommand(command, args, {
  cwd,
  timeoutMs = 15000,
  maxOutputBytes = MAX_OUTPUT_BYTES,
  env = process.env,
  spawnImpl = spawn,
  killImpl = process.kill,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let exceeded = false;
    let timedOut = false;
    let aborted = false;
    let terminationRequested = false;
    const killGroup = () => {
      if (terminationRequested) return;
      terminationRequested = true;
      try {
        if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
          killImpl(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        exceeded = true;
        killGroup();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const onAbort = () => {
      aborted = true;
      killGroup();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    timer.unref();
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        killGroup();
      } catch (_killError) {
        // Preserve the spawn error while still attempting group termination.
      }
      reject(error);
    });
    child.once('close', (code, processSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code !== 0 || processSignal) {
        try {
          killGroup();
        } catch (_killError) {
          // The process already exited; ESRCH and race failures do not change its result.
        }
      }
      resolve({
        code: exceeded ? null : code,
        signal: aborted ? 'ABORTED' : exceeded ? 'OUTPUT_LIMIT' : processSignal,
        timedOut,
        aborted,
        outputExceeded: exceeded,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function runBoundedTool(execute, binary, args, options = {}) {
  return execute('prlimit', [
    '--as=268435456', '--cpu=10', '--nproc=64', '--', binary, ...args,
  ], options);
}

function successful(result) {
  return Boolean(result
    && result.code === 0
    && !result.signal
    && result.timedOut !== true
    && result.aborted !== true
    && result.outputExceeded !== true);
}

function productionSandboxReady() {
  try {
    const value = JSON.parse(fs.readFileSync(AVAILABILITY_FILE, 'utf8'));
    return value.available === true;
  } catch (_error) {
    return false;
  }
}

function resolveDefinitions(definitions) {
  if (definitions) return definitions;
  const directory = process.env.CLAMAV_DEFINITION_DIRECTORY || '/var/lib/clamav';
  const files = fs.readdirSync(directory)
    .filter((name) => /^(?:main|daily|bytecode)\.(?:cvd|cld)$/i.test(name))
    .sort()
    .map((name) => path.join(directory, name));
  const daily = files.find((name) => /\/daily\.(?:cvd|cld)$/i.test(name));
  const main = files.find((name) => /\/main\.(?:cvd|cld)$/i.test(name));
  if (!daily || !main) throw new PdfImportUnavailableError();
  return { path: directory, files, freshnessFile: daily };
}

function allowlistedDefinitions(definitions) {
  const byKind = new Map();
  for (const file of definitions.files || []) {
    if (!path.isAbsolute(file)) continue;
    const match = /^(main|daily|bytecode)\.(cvd|cld)$/i.exec(path.basename(file));
    if (!match) continue;
    const kind = match[1].toLowerCase();
    if (byKind.has(kind)) throw new PdfImportUnavailableError();
    byKind.set(kind, file);
  }
  if (!byKind.has('main') || !byKind.has('daily')) throw new PdfImportUnavailableError();
  const files = ['main', 'daily', 'bytecode'].flatMap((kind) => (
    byKind.has(kind) ? [byKind.get(kind)] : []
  ));
  return {
    path: definitions.path,
    files,
    freshnessFile: byKind.get('daily'),
  };
}

function parseClamDefinitionInfo(output) {
  const buildValue = /^Build time:\s*(.+)$/im.exec(String(output || ''))?.[1]?.trim();
  const versionValue = /^Version:\s*(\d+)\s*$/im.exec(String(output || ''))?.[1];
  if (!buildValue || !versionValue) return null;
  const normalizedBuild = buildValue.replace(/(\d{1,2})-(\d{2})(?=\s|$)/, '$1:$2');
  const builtAtMs = Date.parse(normalizedBuild);
  const version = Number(versionValue);
  if (!Number.isFinite(builtAtMs) || !Number.isSafeInteger(version) || version < 1) return null;
  return { builtAtMs, version };
}

async function verifyClamDefinitions({
  execute = executeCommand,
  now = Date.now,
  definitions,
  signal,
} = {}) {
  let defs;
  try {
    defs = allowlistedDefinitions(resolveDefinitions(definitions));
  } catch (_error) {
    throw new PdfImportUnavailableError();
  }
  if (!defs.path || !Array.isArray(defs.files) || !defs.files.length
    || !defs.freshnessFile || !defs.files.includes(defs.freshnessFile)) {
    throw new PdfImportUnavailableError();
  }
  let freshnessInfo;
  for (const definitionFile of defs.files) {
    const signature = await runBoundedTool(
      execute,
      '/usr/bin/sigtool',
      ['--verify-cvd', definitionFile],
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024, signal }
    );
    if (!successful(signature)) throw new PdfImportUnavailableError();
    const info = await runBoundedTool(
      execute,
      '/usr/bin/sigtool',
      ['--info', definitionFile],
      { timeoutMs: 5000, maxOutputBytes: 1024 * 1024, signal }
    );
    const metadata = successful(info) ? parseClamDefinitionInfo(info.stdout) : null;
    if (!metadata) throw new PdfImportUnavailableError();
    if (definitionFile === defs.freshnessFile) freshnessInfo = metadata;
  }
  const definitionAge = freshnessInfo ? now() - freshnessInfo.builtAtMs : NaN;
  if (!Number.isFinite(definitionAge)
    || definitionAge < 0
    || definitionAge > MAX_DEFINITION_AGE_MS) throw new PdfImportUnavailableError();
  return defs;
}

function containsForbiddenPdfStructure(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenPdfStructure);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string'
      && ['/EmbeddedFile', '/FileAttachment'].includes(value);
  }
  return Object.entries(value).some(([key, child]) => (
    ['/EmbeddedFiles', '/FileAttachment', '/AF', '/AFRelationship'].includes(key)
      || containsForbiddenPdfStructure(child)
  ));
}

function nsjailArguments(inputPath) {
  return [
    '--quiet', '--mode', 'o', '--iface_no_lo',
    '--chroot', '/opt/pdf-runtime-root',
    '--user', '65534', '--group', '65534', '--cwd', '/tmp',
    '--bindmount_ro', `${inputPath}:/input/profile.pdf`,
    '--tmpfsmount', '/tmp',
    '--rlimit_as', '256', '--rlimit_cpu', '10', '--rlimit_nproc', '64',
    '--time_limit', '14', '--',
    '/usr/local/bin/node', '/app/src/workers/parseLinkedinPdf.js', '/input/profile.pdf',
  ];
}

async function parseLinkedinPdf(buffer, {
  execute = executeCommand,
  now = Date.now,
  definitions,
  tempRoot = os.tmpdir(),
  sandboxReady,
  signal,
} = {}) {
  let directory;
  try {
    if (!Buffer.isBuffer(buffer)
      || buffer.length < 5
      || buffer.length > MAX_PDF_BYTES
      || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('invalid input');
    const ready = sandboxReady === undefined ? productionSandboxReady() : sandboxReady;
    if (!ready) throw new PdfImportUnavailableError();

    const defs = await verifyClamDefinitions({ execute, now, definitions, signal });

    directory = await fs.promises.mkdtemp(path.join(tempRoot, 'profile-import-'));
    await fs.promises.chmod(directory, 0o700);
    const inputPath = path.join(directory, 'profile.pdf');
    await fs.promises.writeFile(inputPath, buffer, { mode: 0o600, flag: 'wx' });

    const commandOptions = {
      cwd: directory, timeoutMs: 15000, maxOutputBytes: MAX_OUTPUT_BYTES, signal,
    };
    const scan = await runBoundedTool(execute, '/usr/bin/clamscan', [
      '--no-summary', '--infected',
      ...defs.files.map((file) => `--database=${file}`),
      inputPath,
    ], commandOptions);
    if (!successful(scan)) throw new Error('scan failed');

    const checked = await runBoundedTool(
      execute, '/usr/bin/qpdf', ['--check', '--password=', inputPath], commandOptions
    );
    if (!successful(checked)) throw new Error('invalid PDF');
    const encryption = await runBoundedTool(
      execute, '/usr/bin/qpdf', ['--show-encryption', '--password=', inputPath], commandOptions
    );
    if (!successful(encryption)
      || !/^File is not encrypted\s*$/i.test(String(encryption.stdout || ''))) {
      throw new Error('encrypted PDF');
    }
    const pageResult = await runBoundedTool(
      execute, '/usr/bin/qpdf', ['--show-npages', '--password=', inputPath], commandOptions
    );
    const pages = Number(String(pageResult.stdout || '').trim());
    if (!successful(pageResult) || !Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
      throw new Error('page limit');
    }
    const attachments = await runBoundedTool(
      execute, '/usr/bin/qpdf', ['--list-attachments', '--password=', inputPath], commandOptions
    );
    if (!successful(attachments) || String(attachments.stdout || '').trim()) throw new Error('attachments');
    const structure = await runBoundedTool(execute, '/usr/bin/qpdf', [
      '--json', '--json-stream-data=none', '--password=', inputPath,
    ], commandOptions);
    if (!successful(structure)) throw new Error('invalid PDF structure');
    const structureData = JSON.parse(structure.stdout);
    if (containsForbiddenPdfStructure(structureData)) throw new Error('attachments');

    const parsed = await execute('nsjail', nsjailArguments(inputPath), commandOptions);
    if (!successful(parsed) || Buffer.byteLength(parsed.stdout || '') > MAX_OUTPUT_BYTES) {
      throw new Error('parser failed');
    }
    const workerResult = JSON.parse(parsed.stdout);
    if (!workerResult || typeof workerResult.text !== 'string' || workerResult.text.length > MAX_TEXT_CHARS) {
      throw new Error('invalid parser output');
    }
    return parseLinkedinText(workerResult.text);
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
      const aborted = new Error('PDF import aborted');
      aborted.name = 'AbortError';
      aborted.code = 'ABORT_ERR';
      throw aborted;
    }
    if (error instanceof PdfImportUnavailableError) throw error;
    throw new PdfImportError();
  } finally {
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

module.exports = {
  parseLinkedinPdf,
  parseLinkedinText,
  parseClamDefinitionInfo,
  allowlistedDefinitions,
  verifyClamDefinitions,
  containsForbiddenPdfStructure,
  executeCommand,
  runBoundedTool,
  successful,
  nsjailArguments,
  productionSandboxReady,
  sanitizeParserWarnings,
  PdfImportError,
  PdfImportUnavailableError,
  PARSER_VERSION,
  MAX_PDF_BYTES,
  MAX_PAGES,
  MAX_TEXT_CHARS,
  MAX_OUTPUT_BYTES,
};
