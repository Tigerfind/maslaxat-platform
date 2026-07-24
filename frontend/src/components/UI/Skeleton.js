import React from 'react';

/**
 * Лёгкие скелетоны загрузки в фирменном стиле (кремово-золотой shimmer).
 * <SkeletonLine/> — строка текста, <SkeletonCard/> — карточка-заглушка.
 * Стили shimmer инжектятся один раз.
 */
let injected = false;
const injectStyles = () => {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes skShimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    .sk {
      background: linear-gradient(90deg,
        color-mix(in srgb, var(--border, #E8E4DE) 55%, transparent) 25%,
        color-mix(in srgb, var(--border, #E8E4DE) 90%, transparent) 37%,
        color-mix(in srgb, var(--border, #E8E4DE) 55%, transparent) 63%);
      background-size: 200% 100%;
      animation: skShimmer 1.4s ease-in-out infinite;
      border-radius: 6px;
    }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none } }
  `;
  document.head.appendChild(el);
};

export const SkeletonLine = ({ width = '100%', height = 12, style = {} }) => {
  injectStyles();
  return <div className="sk" style={{ width, height, borderRadius: 6, ...style }} />;
};

const glassCard = {
  background: 'var(--card-glass)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

// Карточка-заглушка каталога/списка
export const SkeletonCard = ({ avatar = true, lines = 3, padding = 20 }) => {
  injectStyles();
  return (
    <div style={{ ...glassCard, padding }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {avatar && <div className="sk" style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />}
        <div style={{ flex: 1 }}>
          <SkeletonLine width="55%" height={14} style={{ marginBottom: 8 }} />
          <SkeletonLine width="35%" height={11} />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? '70%' : '100%'} height={11} style={{ marginBottom: 9 }} />
      ))}
    </div>
  );
};

// Сетка скелетон-карточек
export const SkeletonGrid = ({ count = 6, minWidth = 280, ...cardProps }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 16 }}>
    {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} {...cardProps} />)}
  </div>
);

export default SkeletonCard;
