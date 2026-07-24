import React from 'react';

/**
 * Лёгкий рендер AI-ответа: **жирный** текст, маркированные и нумерованные списки.
 * Работает и для «живых» ответов, и для истории — без изменений на бэкенде.
 * Не полноценный markdown: намеренно простой и предсказуемый.
 */

// Разбивает строку на JSX с учётом **жирного** текста.
const renderInline = (text, keyPrefix) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={`${keyPrefix}-b${i}`} style={{ fontWeight: 600, color: 'var(--text)' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{part}</React.Fragment>;
  });
};

const BULLET_RE = /^\s*[•\-–*]\s+(.*)$/;
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;

export const renderRichText = (raw) => {
  if (!raw) return null;
  const lines = String(raw).split('\n');
  const blocks = [];
  let list = null; // { ordered, items: [] }

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} style={{ margin: '6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {list.items.map((it, i) => (
          <li key={i} style={{ lineHeight: 1.55 }}>{renderInline(it, `li-${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  lines.forEach((line, idx) => {
    const bullet = line.match(BULLET_RE);
    const numbered = line.match(NUMBERED_RE);
    if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[2]);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p-${idx}`} style={{ margin: '4px 0', lineHeight: 1.6 }}>
          {renderInline(line, `p-${idx}`)}
        </p>
      );
    }
  });
  flushList();
  return blocks;
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
