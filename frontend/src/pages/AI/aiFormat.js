/**
 * Утилиты для AI-ответов. Рендер markdown теперь делает components/MarkdownMessage
 * (react-markdown) — самописный renderRichText удалён как мёртвый код. Здесь остались:
 *  - stripMarkdown: плоский однострочный текст для заголовков бесед;
 *  - extractLaws: извлечение ссылок на законы РУз для карточки «Статьи закона».
 */

// Убирает markdown-разметку для мест, где нужен ПЛОСКИЙ однострочный текст
// (заголовки бесед в сайдбаре): маркеры **/*, _, `, ~, #, >, и [текст](url) → текст.
export const stripMarkdown = (raw) => {
  if (!raw) return '';
  return String(raw)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Извлекает ссылки на законы из текста ответа: номера статей и названия кодексов РУз.
 * Возвращает уникальный список коротких строк для карточки «Статьи закона».
 */
export const extractLaws = (raw) => {
  if (!raw) return [];
  const text = String(raw).replace(/\*\*/g, '');
  const found = [];

  const articleRe = /(?:стать[а-яё]+|ст\.)\s*№?\s*\d+(?:\s*[-–]\s*\d+)?/gi;
  const codeRe = /[А-ЯЁ][а-яё]*(?:\s+[а-яё]+)?\s+кодекс[а-яё]*/g;
  const abbrevRe = /(?:ГК|УК|УПК|ТК|СК|НК|ЗК)\s+РУз/g;

  for (const re of [articleRe, codeRe, abbrevRe]) {
    const matches = text.match(re) || [];
    matches.forEach((m) => {
      const clean = m.replace(/\s+/g, ' ').trim();
      if (clean && !found.some((f) => f.toLowerCase() === clean.toLowerCase())) {
        found.push(clean);
      }
    });
  }
  return found.slice(0, 8);
};
