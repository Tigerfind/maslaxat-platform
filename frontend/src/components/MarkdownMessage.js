import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Безопасный рендер markdown из ответа AI (жирный, курсив, заголовки, вложенные
 * списки, ссылки, код, таблицы GFM). Заменяет самописный renderRichText, который
 * покрывал только **жирный**+списки и «ломал» остальной markdown в литеральные
 * символы — критично для реальных ответов Claude.
 *
 * БЕЗОПАСНОСТЬ: сырой HTML НЕ рендерится — rehype-raw не подключён, плюс skipHtml
 * (HTML-теги из текста модели отбрасываются, не исполняются как разметка).
 * URL санитайзятся react-markdown по умолчанию (javascript:/data: блокируются).
 */
const components = {
  p: (props) => <p style={{ margin: '4px 0', lineHeight: 1.6 }} {...props} />,
  strong: (props) => <strong style={{ fontWeight: 600, color: 'var(--text)' }} {...props} />,
  ul: (props) => <ul style={{ margin: '6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }} {...props} />,
  ol: (props) => <ol style={{ margin: '6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }} {...props} />,
  li: (props) => <li style={{ lineHeight: 1.55 }} {...props} />,
  h1: (props) => <h3 style={{ fontSize: 16, fontWeight: 700, margin: '10px 0 4px' }} {...props} />,
  h2: (props) => <h3 style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 4px' }} {...props} />,
  h3: (props) => <h4 style={{ fontSize: 14.5, fontWeight: 700, margin: '8px 0 4px' }} {...props} />,
  h4: (props) => <h4 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0 4px' }} {...props} />,
  a: ({ href, ...props }) => {
    // react-markdown уже нейтрализует опасные протоколы (javascript:void(0)); на всякий
    // случай полностью убираем href с javascript:/data:/vbscript: — ссылка становится
    // инертной, без предупреждения React о javascript:-URL.
    const safe = href && !/^\s*(javascript|data|vbscript):/i.test(href) ? href : undefined;
    return <a href={safe} style={{ color: 'var(--accent-dark)', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" {...props} />;
  },
  blockquote: (props) => <blockquote style={{ borderLeft: '3px solid var(--border)', margin: '6px 0', padding: '2px 0 2px 12px', color: 'var(--text2)' }} {...props} />,
  code: ({ inline, ...props }) => (inline
    ? <code style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 4, padding: '1px 5px', fontSize: '0.9em', fontFamily: 'monospace' }} {...props} />
    : <code style={{ display: 'block', background: 'rgba(0,0,0,0.06)', borderRadius: 8, padding: '10px 12px', overflowX: 'auto', fontSize: '0.9em', fontFamily: 'monospace' }} {...props} />),
  table: (props) => <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0' }} {...props} /></div>,
  th: (props) => <th style={{ border: '1px solid var(--border)', padding: '6px 9px', textAlign: 'left', background: 'rgba(0,0,0,0.03)' }} {...props} />,
  td: (props) => <td style={{ border: '1px solid var(--border)', padding: '6px 9px' }} {...props} />,
};

export default function MarkdownMessage({ text }) {
  if (!text) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {String(text)}
    </ReactMarkdown>
  );
}
