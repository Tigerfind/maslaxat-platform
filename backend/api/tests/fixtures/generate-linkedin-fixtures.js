const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const FIXTURES = {
  ru: `Заголовок
Юрист по договорному праву <img src=x onerror=alert(1)>
О себе
Помогаю бизнесу безопасно заключать договоры. test@example.com
Опыт
Старший юрист | Пример Консалтинг | Ташкент | 2022 | настоящее время | Договорная работа
Образование
Ташкентский юридический институт | Магистр права | 2020
Навыки
Договорное право; Переговоры; <script>alert(1)</script>
Языки
Русский; O'zbekcha
Сертификаты
Медиация | Учебный центр | 2023
Проекты
Скрытый проект
admin: true
paymentStatus: paid
+998 90 123 45 67
опасный\u202Eтекст`,
  uz: `Sarlavha
Shartnoma huquqi bo'yicha yurist
Men haqimda
Tadbirkorlarga huquqiy xavflarni kamaytirishda yordam beraman.
Ish tajribasi
Yetakchi yurist | Namuna Maslahat | Toshkent | 2021 | hozirgacha | Shartnomalar tahlili
Ta'lim
Toshkent davlat yuridik universiteti | Huquq magistri | 2019
Ko'nikmalar
Shartnoma huquqi; Muzokara
Tillar
O'zbekcha; English
Sertifikatlar
Mediator | O'quv markazi | 2022`,
  en: `Headline
Commercial contracts lawyer
About
I help small companies manage legal risk.
Experience
Legal Counsel | Example Advisory | Tashkent | 2020 | Present | Commercial agreements
Education
Sample School of Law | LLM | 2018
Skills
Contract Law; Negotiation
Languages
English; Russian
Certifications
Compliance Foundations | Training Institute | 2021`,
};

function utf16Hex(value) {
  const bytes = [0xfe, 0xff];
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0xffff) bytes.push(code >> 8, code & 0xff);
  }
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function buildPdf(objects) {
  const chunks = [Buffer.from('%PDF-1.7\n% deterministic synthetic profile fixture\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'ascii');
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, 'utf8');
    const suffix = Buffer.from('\nendobj\n', 'ascii');
    chunks.push(prefix, body, suffix);
    length += prefix.length + body.length + suffix.length;
  });
  const xref = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, 'ascii'));
  chunks.push(Buffer.from(
    offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''),
    'ascii'
  ));
  chunks.push(Buffer.from(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    'ascii'
  ));
  return Buffer.concat(chunks);
}

function streamObject(content, dictionary = '') {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return Buffer.concat([
    Buffer.from(`<< /Length ${body.length}${dictionary ? ` ${dictionary}` : ''} >>\nstream\n`, 'ascii'),
    body,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

function makePdf(text, { attachment = false, compressContent = false, cycleLines = false } = {}) {
  const content = text.split('\n').map((line, index) => (
    `BT /F1 4 Tf 40 ${800 - ((cycleLines ? index % 40 : index) * 18)} Td <${utf16Hex(line)}> Tj ET`
  )).join('\n');
  const pageExtras = attachment ? ' /Annots [12 0 R]' : '';
  const catalogExtras = attachment
    ? ' /Names << /EmbeddedFiles << /Names [(payload.txt) 10 0 R] >> >> /AF [10 0 R]'
    : '';
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FixtureIdentity def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const contentBody = compressContent ? zlib.deflateSync(Buffer.from(content, 'utf8')) : content;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${catalogExtras} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R${pageExtras} >>`,
    streamObject(contentBody, compressContent ? '/Filter /FlateDecode' : ''),
    '<< /Type /Font /Subtype /Type0 /BaseFont /FixtureUnicode /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureUnicode /CIDSystemInfo 7 0 R /FontDescriptor 9 0 R /CIDToGIDMap /Identity /DW 250 >>',
    '<< /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>',
    streamObject(cmap),
    '<< /Type /FontDescriptor /FontName /FixtureUnicode /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
  ];
  if (attachment) {
    objects.push(
      '<< /Type /Filespec /F (payload.txt) /UF (payload.txt) /EF << /F 11 0 R >> /AFRelationship /Data >>',
      streamObject('deterministic attachment payload', '/Type /EmbeddedFile /Subtype /text#2Fplain'),
      '<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 20 20] /FS 10 0 R >>'
    );
  }
  return buildPdf(objects);
}

function makeCompressionLimitPdf() {
  const pageCount = 25;
  const pageObjects = [];
  const contentObjects = [];
  for (let page = 0; page < pageCount; page += 1) {
    const pageObjectNumber = 3 + page;
    const contentObjectNumber = 3 + pageCount + page;
    pageObjects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + (pageCount * 2)} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    const content = Array.from({ length: 40 }, (_unused, line) => (
      `BT /F1 4 Tf 20 ${820 - (line * 20)} Td (${'A'.repeat(150)}) Tj ET`
    )).join('\n');
    contentObjects.push(streamObject(zlib.deflateSync(Buffer.from(content)), '/Filter /FlateDecode'));
    if (pageObjectNumber !== pageObjects.length + 2) throw new Error('fixture object numbering failed');
  }
  const kids = Array.from({ length: pageCount }, (_unused, page) => `${3 + page} 0 R`).join(' ');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    ...pageObjects,
    ...contentObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

const SECURITY_FIXTURES = {
  malformed: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n', 'ascii'),
  attachment: makePdf(FIXTURES.en, { attachment: true }),
  'compression-limit': makeCompressionLimitPdf(),
};

function generateSecurityFixtures() {
  return Object.fromEntries(
    Object.entries(SECURITY_FIXTURES).map(([name, value]) => [name, Buffer.from(value)])
  );
}

function writeFixtureManifest(filePath, fixtures, types) {
  const lines = Object.entries(fixtures)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, content]) => {
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      return `${hash}  ${content.length}  ${types[name]}  ${name}`;
    });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o644 });
}

if (require.main === module) {
  const smokeFixtureDirectory = path.resolve(__dirname, '../../pdf-toolchain/fixtures');
  fs.mkdirSync(smokeFixtureDirectory, { recursive: true, mode: 0o755 });
  const linkedinPdfs = {};
  for (const [language, text] of Object.entries(FIXTURES)) {
    const pdf = makePdf(text);
    const name = `linkedin-${language}.pdf`;
    linkedinPdfs[name] = pdf;
    fs.writeFileSync(path.join(__dirname, name), pdf, { mode: 0o644 });
    if (language === 'en') {
      fs.writeFileSync(path.join(smokeFixtureDirectory, 'linkedin-en.pdf'), pdf, { mode: 0o644 });
    }
  }
  const securityPdfs = generateSecurityFixtures();
  for (const [name, pdf] of Object.entries(securityPdfs)) {
    fs.writeFileSync(path.join(smokeFixtureDirectory, `${name}.pdf`), pdf, { mode: 0o644 });
  }
  writeFixtureManifest(
    path.join(__dirname, 'linkedin-SHA256SUMS'),
    linkedinPdfs,
    Object.fromEntries(Object.keys(linkedinPdfs).map((name) => [name, 'PDF-1.7,1-page']))
  );
  writeFixtureManifest(
    path.join(smokeFixtureDirectory, 'SHA256SUMS'),
    { 'linkedin-en.pdf': linkedinPdfs['linkedin-en.pdf'], ...Object.fromEntries(
      Object.entries(securityPdfs).map(([name, pdf]) => [`${name}.pdf`, pdf])
    ) },
    {
      'linkedin-en.pdf': 'PDF-1.7,1-page',
      'attachment.pdf': 'PDF-1.7,1-page',
      'malformed.pdf': 'PDF-1.7',
      'compression-limit.pdf': 'PDF-1.7,25-pages',
    }
  );
}

module.exports = {
  FIXTURES,
  SECURITY_FIXTURES,
  generateSecurityFixtures,
  makePdf,
  writeFixtureManifest,
};
