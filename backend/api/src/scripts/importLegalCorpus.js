require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sequelize, LegalDocument, LegalChunk } = require('../models');

function readCorpus(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  if (filePath.endsWith('.jsonl')) return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function validateDocument(document) {
  if (!document.title || !document.sourceUrl || !document.version || !Array.isArray(document.articles)) {
    throw new Error('Each document needs title, sourceUrl, version and articles[]');
  }
  const url = new URL(document.sourceUrl);
  if (!['lex.uz', 'www.lex.uz'].includes(url.hostname)) {
    throw new Error(`Only official lex.uz sources are accepted: ${document.sourceUrl}`);
  }
  const articles = document.articles
    .map((article, ordinal) => ({
      ordinal,
      articleNumber: article.number ? String(article.number).trim() : null,
      heading: article.heading ? String(article.heading).trim() : null,
      content: String(article.text || '').trim(),
      metadata: article.metadata || {},
    }))
    .filter((article) => article.content.length >= 20);
  if (!articles.length) throw new Error(`No non-empty articles in ${document.title}`);
  return articles;
}

async function importCorpus(filePath) {
  const documents = readCorpus(filePath);
  let imported = 0;

  for (const input of documents) {
    const articles = validateDocument(input);
    const checksum = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    await sequelize.transaction(async (transaction) => {
      const [document] = await LegalDocument.findOrCreate({
        where: { sourceUrl: input.sourceUrl, version: String(input.version) },
        defaults: {
          title: input.title,
          code: input.code || null,
          language: input.language || 'ru',
          sourceUrl: input.sourceUrl,
          version: String(input.version),
          effectiveFrom: input.effectiveFrom || null,
          effectiveTo: input.effectiveTo || null,
          isActive: input.isActive !== false,
          checksum,
          metadata: input.metadata || {},
        },
        transaction,
      });
      await document.update({
        title: input.title,
        code: input.code || null,
        language: input.language || 'ru',
        effectiveFrom: input.effectiveFrom || null,
        effectiveTo: input.effectiveTo || null,
        isActive: input.isActive !== false,
        checksum,
        metadata: input.metadata || {},
      }, { transaction });
      await LegalChunk.destroy({ where: { documentId: document.id }, transaction });
      await LegalChunk.bulkCreate(articles.map((article) => ({ ...article, documentId: document.id })), { transaction });
    });
    imported += 1;
  }
  return { imported };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run legal:import -- /absolute/path/corpus.json');
    process.exit(1);
  }
  const filePath = path.resolve(input);
  sequelize.authenticate()
    .then(() => sequelize.sync())
    .then(() => importCorpus(filePath))
    .then((result) => { console.log(result); process.exit(0); })
    .catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = { importCorpus, readCorpus, validateDocument };
