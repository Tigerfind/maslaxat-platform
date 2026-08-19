const fs = require('fs');
const os = require('os');
const path = require('path');
const { FIXTURES } = require('./fixtures/generate-linkedin-fixtures');
const {
  parseLinkedinPdf,
  parseLinkedinText,
  PARSER_VERSION,
} = require('../src/services/linkedinPdfParser');
const UNKNOWN_WARNING = {
  code: 'UNKNOWN_SECTION',
  message: 'Some unsupported profile sections were skipped.',
};

const EXPECTED = {
  ru: {
    headline: 'Юрист по договорному праву',
    summary: 'Помогаю бизнесу безопасно заключать договоры.',
    positions: [{ title: 'Старший юрист', company: 'Пример Консалтинг', location: 'Ташкент', startDate: '2022', endDate: 'настоящее время', description: 'Договорная работа' }],
    education: [{ institution: 'Ташкентский юридический институт', degree: 'Магистр права', endDate: '2020' }],
    skills: ['Договорное право', 'Переговоры'],
    languages: ['Русский', "O'zbekcha"],
    certificates: [{ name: 'Медиация', issuer: 'Учебный центр', issuedAt: '2023' }],
  },
  uz: {
    headline: "Shartnoma huquqi bo'yicha yurist",
    summary: 'Tadbirkorlarga huquqiy xavflarni kamaytirishda yordam beraman.',
    positions: [{ title: 'Yetakchi yurist', company: 'Namuna Maslahat', location: 'Toshkent', startDate: '2021', endDate: 'hozirgacha', description: 'Shartnomalar tahlili' }],
    education: [{ institution: 'Toshkent davlat yuridik universiteti', degree: 'Huquq magistri', endDate: '2019' }],
    skills: ['Shartnoma huquqi', 'Muzokara'],
    languages: ["O'zbekcha", 'English'],
    certificates: [{ name: 'Mediator', issuer: "O'quv markazi", issuedAt: '2022' }],
  },
  en: {
    headline: 'Commercial contracts lawyer',
    summary: 'I help small companies manage legal risk.',
    positions: [{ title: 'Legal Counsel', company: 'Example Advisory', location: 'Tashkent', startDate: '2020', endDate: 'Present', description: 'Commercial agreements' }],
    education: [{ institution: 'Sample School of Law', degree: 'LLM', endDate: '2018' }],
    skills: ['Contract Law', 'Negotiation'],
    languages: ['English', 'Russian'],
    certificates: [{ name: 'Compliance Foundations', issuer: 'Training Institute', issuedAt: '2021' }],
  },
};

function successfulExecutor(extractedText, calls = []) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    const boundedBinary = command === 'prlimit' ? path.basename(args[4]) : command;
    const boundedArgs = command === 'prlimit' ? args.slice(5) : args;
    if (boundedBinary === 'sigtool' && boundedArgs.includes('--verify-cvd')) {
      return { code: 0, stdout: 'Verification OK\n', stderr: '' };
    }
    if (boundedBinary === 'sigtool' && boundedArgs.includes('--info')) {
      return {
        code: 0,
        stdout: 'File: daily.cvd\nBuild time: 16 Aug 2026 00:00 +0000\nVersion: 27800\n',
        stderr: '',
      };
    }
    if (boundedBinary === 'clamscan') return { code: 0, stdout: '', stderr: '' };
    if (boundedBinary === 'qpdf' && boundedArgs.includes('--show-encryption')) return { code: 0, stdout: 'File is not encrypted\n', stderr: '' };
    if (boundedBinary === 'qpdf' && boundedArgs.includes('--show-npages')) return { code: 0, stdout: '1\n', stderr: '' };
    if (boundedBinary === 'qpdf' && boundedArgs.includes('--list-attachments')) return { code: 0, stdout: '', stderr: '' };
    if (boundedBinary === 'qpdf' && boundedArgs.includes('--json')) {
      return { code: 0, stdout: JSON.stringify({ qpdf: [{ jsonversion: 2 }] }), stderr: '' };
    }
    if (boundedBinary === 'qpdf') return { code: 0, stdout: '', stderr: '' };
    if (command === 'nsjail') return { code: 0, stdout: JSON.stringify({ text: extractedText }), stderr: '' };
    throw new Error(`Unexpected command ${command}`);
  };
}

function parserOptions(extractedText, calls) {
  return {
    execute: successfulExecutor(extractedText, calls),
    now: () => Date.UTC(2026, 7, 16, 12),
    definitions: {
      path: '/defs',
      files: ['/defs/main.cvd', '/defs/daily.cvd'],
      freshnessFile: '/defs/daily.cvd',
    },
    tempRoot: os.tmpdir(),
    sandboxReady: true,
  };
}

describe('deterministic LinkedIn text parser', () => {
  test.each(['ru', 'uz', 'en'])('normalizes the sanitized %s fixture into the exact schema', (language) => {
    const result = parseLinkedinText(FIXTURES[language]);
    expect(result).toEqual({
      data: EXPECTED[language],
      warnings: language === 'ru' ? [UNKNOWN_WARNING] : [],
      parserVersion: PARSER_VERSION,
    });
  });

  test('removes contact, privileged fields, HTML/script content, and bidi controls from all output', () => {
    const serialized = JSON.stringify(parseLinkedinText(FIXTURES.ru));
    expect(serialized).not.toMatch(/test@example|\+998|admin|paymentStatus|onerror|<script|alert|[\u202A-\u202E\u2066-\u2069]/i);
  });

  test('normalizes bidi, controls, and HTML before forbidden-field matching', () => {
    const result = parseLinkedinText(`About
pay\u202EmentStatus: paid
<strong>admin</strong>: true
Safe summary.`);

    expect(result.data.summary).toBe('Safe summary.');
    expect(JSON.stringify(result)).not.toMatch(/paymentStatus|admin|paid/i);
  });

  test('warns and isolates a generic unknown heading instead of absorbing its content', () => {
    const result = parseLinkedinText(`About
Safe public summary.

Awards and Honors

Secret award payload

Skills
Contract Law`);

    expect(result.data.summary).toBe('Safe public summary.');
    expect(result.data.skills).toEqual(['Contract Law']);
    expect(JSON.stringify(result.data)).not.toContain('Secret award payload');
    expect(result.warnings).toEqual([UNKNOWN_WARNING]);
  });

  test.each(['Awards and Honors', 'PROFESSIONAL AWARDS'])(
    'isolates heading-like unknown section without blank lines: %s',
    (unknownHeading) => {
      const result = parseLinkedinText(`About
Safe public summary.
${unknownHeading}
Secret award payload
Skills
Contract Law`);

      expect(result.data.summary).toBe('Safe public summary.');
      expect(result.data.skills).toEqual(['Contract Law']);
      expect(JSON.stringify(result.data)).not.toContain('Secret award payload');
      expect(result.warnings).toEqual([UNKNOWN_WARNING]);
    }
  );

  test.each([
    'Honors & awards',
    'AWARDS',
    'Publications',
    'Projects',
    'Volunteer experience',
    'Courses',
    'Organizations',
    'Interests',
    'Recommendations',
  ])('isolates common LinkedIn unknown heading case-insensitively: %s', (unknownHeading) => {
    const result = parseLinkedinText(`About
Safe public summary.
${unknownHeading}
Secret section payload
Skills
Contract Law`);

    expect(result.data.summary).toBe('Safe public summary.');
    expect(result.data.skills).toEqual(['Contract Law']);
    expect(JSON.stringify(result.data)).not.toContain('Secret section payload');
    expect(result.warnings).toEqual([UNKNOWN_WARNING]);
  });

  test('isolates a conservative connector/lowercase generic heading without blanks', () => {
    const result = parseLinkedinText(`About
Safe public summary.
Projects and publications
Secret section payload
Skills
Contract Law`);

    expect(result.data.summary).toBe('Safe public summary.');
    expect(result.warnings).toEqual([UNKNOWN_WARNING]);
  });

  test('keeps a short connector summary sentence in the summary', () => {
    const result = parseLinkedinText(`About
Existing summary.
Legal advice for businesses
Skills
Contract Law`);

    expect(result.data.summary).toBe('Existing summary. Legal advice for businesses');
    expect(result.warnings).toEqual([]);
  });

  test.each([
    ['short summary', 'Legal advice', 'Legal advice'],
    ['sentence', 'Works with business clients.', 'Works with business clients.'],
    ['list', '- Contract drafting', 'Contract drafting'],
    ['date', '2020 - 2024', null],
    ['field', 'Location: Tashkent', 'Location: Tashkent'],
  ])('does not classify obvious %s content as an unknown heading', (_label, content, expectedContent) => {
    const result = parseLinkedinText(`About
Existing summary.
${content}
Skills
Contract Law`);

    if (expectedContent) expect(result.data.summary).toContain(expectedContent);
    expect(result.warnings).toEqual([]);
  });
});

describe('fail-closed PDF pipeline', () => {
  test.each(['ru', 'uz', 'en'])('parses the fixed %s PDF through the bounded command pipeline', async (language) => {
    const calls = [];
    const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', `linkedin-${language}.pdf`));
    const result = await parseLinkedinPdf(buffer, parserOptions(FIXTURES[language], calls));

    expect(result.data).toEqual(EXPECTED[language]);
    expect(calls.map(({ command }) => command)).toEqual([
      'prlimit', 'prlimit', 'prlimit', 'prlimit', 'prlimit',
      'prlimit', 'prlimit', 'prlimit', 'prlimit', 'prlimit', 'nsjail',
    ]);
    const boundedCalls = calls.filter(({ command }) => command === 'prlimit');
    expect(boundedCalls).toHaveLength(10);
    for (const call of boundedCalls) {
      expect(call.args.slice(0, 4)).toEqual([
        '--as=268435456', '--cpu=10', '--nproc=64', '--',
      ]);
    }
    expect(boundedCalls.find(({ args }) => args[4] === '/usr/bin/clamscan').args.slice(5)).toEqual([
      '--no-summary', '--infected',
      '--database=/defs/main.cvd', '--database=/defs/daily.cvd',
      expect.stringMatching(/profile\.pdf$/),
    ]);
    const sandbox = calls.find(({ command }) => command === 'nsjail');
    expect(sandbox.args).toEqual(expect.arrayContaining([
      '--iface_no_lo', '--rlimit_as', '256',
      '--rlimit_cpu', '10', '--rlimit_nproc', '64', '--',
    ]));
    expect(sandbox.args).not.toContain('--disable_clone_newnet');
    expect(sandbox.options).toMatchObject({ timeoutMs: 15000, maxOutputBytes: 20 * 1024 * 1024 });
  });
});

test('parser warnings expose only bounded generic codes/messages without document text', () => {
  const secretHeading = '<script>alert(1)</script> +998 90 123 45 67 \u202eSECRET PROJECTS';
  const result = parseLinkedinText([
    'Headline',
    'Lawyer',
    secretHeading,
    'private@example.test',
    'Summary',
    'Safe summary',
  ].join('\n'));

  expect(result.warnings).toEqual([{
    code: 'UNKNOWN_SECTION',
    message: 'Some unsupported profile sections were skipped.',
  }]);
  expect(JSON.stringify(result.warnings)).not.toMatch(/SECRET|998|example|script/i);
});
