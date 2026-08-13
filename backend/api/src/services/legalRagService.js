const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const MAX_QUERY_WORDS = 16;
const MAX_EXCERPT = 1800;

function normalizeQuery(raw) {
  return (String(raw || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => word.length >= 3 || /^\d+$/.test(word))
    .slice(0, MAX_QUERY_WORDS)
    .join(' ');
}

async function searchLegalSources(rawQuery, { limit = 6 } = {}) {
  const query = normalizeQuery(rawQuery);
  if (!query) return [];

  const articleMatch = String(rawQuery).match(/(?:стать[а-яё]*|ст\.?|modda)\s*№?\s*([\d-]+)/i);
  const article = articleMatch ? articleMatch[1] : null;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 10));
  const today = new Date().toISOString().slice(0, 10);

  const rows = await sequelize.query(`
    SELECT
      c.id AS "chunkId",
      c.document_id AS "documentId",
      c.article_number AS article,
      c.heading,
      c.content,
      d.title,
      d.code,
      d.language,
      d.source_url AS url,
      d.version,
      d.effective_from AS "effectiveFrom",
      ts_rank_cd(
        to_tsvector('simple', coalesce(c.article_number, '') || ' ' || coalesce(c.heading, '') || ' ' || c.content),
        plainto_tsquery('simple', :query)
      ) + CASE WHEN :article IS NOT NULL AND c.article_number = :article THEN 2 ELSE 0 END AS score
    FROM legal_chunks c
    JOIN legal_documents d ON d.id = c.document_id
    WHERE d.is_active = true
      AND (d.effective_from IS NULL OR d.effective_from <= :today)
      AND (d.effective_to IS NULL OR d.effective_to >= :today)
      AND (
        to_tsvector('simple', coalesce(c.article_number, '') || ' ' || coalesce(c.heading, '') || ' ' || c.content)
          @@ plainto_tsquery('simple', :query)
        OR (:article IS NOT NULL AND c.article_number = :article)
      )
    ORDER BY score DESC, d.updated_at DESC, c.ordinal ASC
    LIMIT :candidateLimit
  `, {
    replacements: { query, article, today, candidateLimit: safeLimit * 4 },
    type: QueryTypes.SELECT,
  });

  const perDocument = new Map();
  const selected = [];
  for (const row of rows) {
    const count = perDocument.get(row.documentId) || 0;
    if (count >= 2) continue;
    perDocument.set(row.documentId, count + 1);
    selected.push({
      citation: `S${selected.length + 1}`,
      chunkId: row.chunkId,
      documentId: row.documentId,
      title: row.title,
      code: row.code,
      language: row.language,
      article: row.article,
      heading: row.heading,
      url: row.url,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      excerpt: String(row.content).slice(0, MAX_EXCERPT),
      score: Number(row.score) || 0,
    });
    if (selected.length >= safeLimit) break;
  }
  return selected;
}

function citedSources(answer, sources) {
  const used = new Set();
  for (const match of String(answer || '').matchAll(/\[S(\d+)\]/g)) used.add(`S${match[1]}`);
  return (sources || []).filter((source) => used.has(source.citation));
}

module.exports = { searchLegalSources, citedSources, normalizeQuery };
