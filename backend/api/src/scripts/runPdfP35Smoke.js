const fs = require('fs');
const path = require('path');
const { parseLinkedinPdf } = require('../services/linkedinPdfParser');

async function runPdfP35Smoke({
  fixtureRoot = '/app/pdf-toolchain/fixtures',
  encryptedPath = process.argv[2],
} = {}) {
  if (!encryptedPath) throw new Error('Encrypted P3.5 fixture path is required');
  const safe = await parseLinkedinPdf(fs.readFileSync(path.join(fixtureRoot, 'linkedin-en.pdf')));
  if (safe.data.headline !== 'Commercial contracts lawyer') {
    throw new Error('Safe fixture parser result mismatch');
  }
  const rejected = [
    path.join(fixtureRoot, 'attachment.pdf'),
    path.join(fixtureRoot, 'malformed.pdf'),
    path.join(fixtureRoot, 'compression-limit.pdf'),
    encryptedPath,
  ];
  for (const fixture of rejected) {
    try {
      await parseLinkedinPdf(fs.readFileSync(fixture));
      throw new Error(`Unsafe fixture accepted: ${path.basename(fixture)}`);
    } catch (error) {
      if (!['PDF_IMPORT_FAILED', 'PDF_IMPORT_UNAVAILABLE'].includes(error.code)) throw error;
      if (error.code === 'PDF_IMPORT_UNAVAILABLE') {
        throw new Error(`Runtime prerequisite unavailable while testing ${path.basename(fixture)}`);
      }
    }
  }
  return { safe: 1, rejected: rejected.length };
}

if (require.main === module) {
  runPdfP35Smoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { runPdfP35Smoke };
