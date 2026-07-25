import React from 'react';
import { Dialog, IconButton } from '@mui/material';
import { Close, StarRounded, CheckRounded } from '@mui/icons-material';

/*
  Модалка сравнения юристов (2–3 в ряд).
  Лучшее значение в числовых строках подсвечивается золотом:
  выше рейтинг / больше отзывов / больше опыт / больше завершённых / ниже цена.
*/

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const CompareModal = ({ open, onClose, lawyers = [], onBook, onViewProfile, t }) => {
  if (!lawyers.length) return null;

  // Индексы «лучших» для подсветки
  const best = (getter, dir = 'max') => {
    const vals = lawyers.map(getter);
    const target = dir === 'max' ? Math.max(...vals) : Math.min(...vals.filter((v) => v > 0));
    // Подсвечиваем только если значения реально различаются
    const allSame = vals.every((v) => v === vals[0]);
    return allSame ? new Set() : new Set(vals.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0));
  };

  const bestRating = best((l) => l.rating || 0, 'max');
  const bestReviews = best((l) => l.reviewsCount || 0, 'max');
  const bestExp = best((l) => l.experience || 0, 'max');
  const bestDone = best((l) => l.completedConsultations || 0, 'max');
  const bestPrice = best((l) => l.priceFrom || 0, 'min');

  const cellBase = { padding: '13px 14px', fontSize: 14, color: 'var(--text)', textAlign: 'center', borderBottom: '1px solid var(--border)' };
  const labelCell = { ...cellBase, textAlign: 'left', fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' };
  const hl = (on) => (on ? { background: 'rgba(184,149,110,0.14)', fontWeight: 700, color: 'var(--accent-dark)' } : {});

  const Row = ({ label, render, bestSet }) => (
    <tr>
      <td style={labelCell}>{label}</td>
      {lawyers.map((l, i) => (
        <td key={l.id} style={{ ...cellBase, ...hl(bestSet && bestSet.has(i)) }}>{render(l)}</td>
      ))}
    </tr>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '18px', background: 'var(--surface)', backgroundImage: 'none', overflow: 'hidden' } }}
    >
      <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{t('compare.title')}</div>
        <IconButton onClick={onClose} size="small"><Close sx={{ color: 'var(--text3)' }} /></IconButton>
      </div>

      <div style={{ overflowX: 'auto', padding: '4px 0 0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: lawyers.length > 2 ? 620 : 460 }}>
          <thead>
            <tr>
              <td style={{ ...labelCell, borderBottom: '1px solid var(--border)' }} />
              {lawyers.map((l, i) => {
                const grad = ['linear-gradient(135deg,#B8956E,#8B7355)', 'linear-gradient(135deg,#8B7355,#6B5745)', 'linear-gradient(135deg,#C9A36E,#A07E52)'][i % 3];
                return (
                  <td key={l.id} style={{ ...cellBase, verticalAlign: 'top', padding: '18px 14px' }}>
                    <div
                      onClick={() => { onViewProfile(l.id); onClose(); }}
                      style={{
                        width: 54, height: 54, borderRadius: '50%', margin: '0 auto 10px', cursor: 'pointer', position: 'relative',
                        background: l.avatar ? `center/cover url(${l.avatar})` : grad,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 18, fontWeight: 600,
                      }}
                    >
                      {!l.avatar && initialsOf(l.name)}
                      {l.isVerified && (
                        <span style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: '#5AA06A', border: '3px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CheckRounded sx={{ fontSize: 10, color: '#FFF' }} />
                        </span>
                      )}
                    </div>
                    <div
                      onClick={() => { onViewProfile(l.id); onClose(); }}
                      style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', lineHeight: 1.25 }}
                    >
                      {l.name}
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <Row label={t('compare.rating')} bestSet={bestRating} render={(l) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <StarRounded sx={{ fontSize: 16, color: '#C9A36E' }} />{l.rating || 0}
              </span>
            )} />
            <Row label={t('compare.reviews')} bestSet={bestReviews} render={(l) => l.reviewsCount || 0} />
            <Row label={t('compare.experience')} bestSet={bestExp} render={(l) => `${l.experience || 0} ${t('lawyers.years')}`} />
            <Row label={t('compare.completed')} bestSet={bestDone} render={(l) => l.completedConsultations || 0} />
            <Row label={t('compare.price')} bestSet={bestPrice} render={(l) => `${(l.priceFrom || 0).toLocaleString()} ${t('lawyers.sum')}`} />
            <Row label={t('compare.specialization')} render={(l) => (l.specializations && l.specializations[0]) || '—'} />
            <Row label={t('compare.region')} render={(l) => l.region || '—'} />
            <Row label={t('compare.languages')} render={(l) => (l.languages && l.languages.length ? l.languages.join(', ') : '—')} />
            <Row label={t('compare.online')} render={(l) => (
              l.isAvailable
                ? <span style={{ color: '#5AA06A', fontWeight: 600 }}>{t('compare.yes')}</span>
                : <span style={{ color: 'var(--text3)' }}>{t('compare.no')}</span>
            )} />
            <tr>
              <td style={labelCell} />
              {lawyers.map((l) => (
                <td key={l.id} style={{ ...cellBase, borderBottom: 'none', padding: '16px 14px' }}>
                  <button
                    onClick={() => { onBook(l); onClose(); }}
                    style={{
                      width: '100%', background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))', color: '#FFF',
                      border: 'none', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                      padding: '11px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {t('compare.book')}
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Dialog>
  );
};

export default CompareModal;
