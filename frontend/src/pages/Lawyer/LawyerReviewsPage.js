import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';
import { lawyerReviewsService } from '../../services/lawyerService';

/*
  ─────────────────────────────────────────────────────────────
  LAWYER REVIEWS  (/lawyer/reviews)
  Ported 1:1 from ClaudeDesign → lawyer/03_REVIEWS.html.
  What it shows / how it works:
   • Left sticky card: average rating + star distribution bars.
       Clicking a distribution row filters the list by that rating.
   • Right column: tabs (Все / Положительные / С комментариями)
       + review cards (avatar, stars, comment, your-reply block, reply / like).
   • Data  ← lawyerReviewsService.getReviews()  { reviews, stats }
   • Reply → lawyerReviewsService.replyToReview(id, text)
   • Like  → lawyerReviewsService.markHelpful(id)
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  ─────────────────────────────────────────────────────────────
*/

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const AV_BG = [
  'linear-gradient(135deg,#B8956E,#8B7355)',
  'linear-gradient(135deg,#6A8A9A,#4A6A7A)',
  'linear-gradient(135deg,#7A9A6B,#5A7A4B)',
  'linear-gradient(135deg,#9A6A6A,#7A4E4E)',
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const stars = (n) => '★★★★★'.slice(0, Math.max(0, Math.min(5, Math.round(n))));

const fmtDate = (d) => {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(d);
  }
};

const TABS = [
  { key: 'all', lk: 'tabAll' },
  { key: 'positive', lk: 'tabPositive' },
  { key: 'commented', lk: 'tabCommented' },
];

const tabBtnStyle = (active) => ({
  border: 'none',
  borderRadius: '6px',
  padding: '11px 18px',
  fontFamily: 'inherit',
  fontSize: 13,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#FFFFFF' : 'var(--text2)',
  fontWeight: active ? 500 : 400,
  transition: 'background 0.2s, color 0.2s',
});

const LawyerReviewsPage = () => {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ average: 0, total: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [filterRating, setFilterRating] = useState(null);
  const [replyingId, setReplyingId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [savingReply, setSavingReply] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await lawyerReviewsService.getReviews({ limit: 100 });
      setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
      if (data?.stats) setStats(data.stats);
    } catch (err) {
      toast.error(err.response?.data?.error || t('lawyerPanel.loadReviewsError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // «Полезно» юрист не ставит на СВОИ отзывы (бэкенд всегда 403), поэтому в кабинете
  // показываем счётчик только для чтения — кнопка handleLike убрана как всегда-ошибка.

  const openReply = (r) => {
    setReplyingId(r.id);
    setReplyText(r.reply || r.replyText || '');
  };

  const submitReply = async (id) => {
    if (!replyText.trim()) return;
    setSavingReply(true);
    try {
      await lawyerReviewsService.replyToReview(id, replyText.trim());
      setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, reply: replyText.trim() } : r)));
      setReplyingId(null);
      setReplyText('');
      toast.success(t('lawyerPanel.replyAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('lawyerPanel.genericError'));
    } finally {
      setSavingReply(false);
    }
  };

  const filtered = reviews.filter((r) => {
    if (filterRating && r.rating !== filterRating) return false;
    if (tab === 'positive' && r.rating < 4) return false;
    if (tab === 'commented' && !(r.comment && r.comment.trim())) return false;
    return true;
  });

  return (
    <GlassShell active="/lawyer/reviews" title={t('lawyerPanel.reviewsTitle')} role="lawyer">
      <div style={{ maxWidth: 1060, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Left: summary + distribution ── */}
        <div style={{ ...glassCard, padding: 28, textAlign: 'center', position: 'sticky', top: 0 }}>
          <div style={{ fontSize: 52, fontWeight: 200, color: 'var(--text)', lineHeight: 1 }}>
            {Number(stats.average || 0).toFixed(1)}
          </div>
          <div style={{ color: 'var(--accent)', fontSize: 18, margin: '10px 0', letterSpacing: '0.04em' }}>
            {stars(stats.average)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 24 }}>
            {stats.total || 0} {t('lawyerPanel.reviewsCount')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.distribution?.[star] || 0;
              const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
              const active = filterRating === star;
              return (
                <div
                  key={star}
                  onClick={() => setFilterRating(active ? null : star)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    borderRadius: 'var(--radius)', padding: '2px 4px',
                    background: active ? 'rgba(184,149,110,0.12)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text2)', width: 10 }}>{star}</span>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text3)', width: 28, textAlign: 'right' }}>{count}</span>
                </div>
              );
            })}
          </div>
          {filterRating && (
            <button
              onClick={() => setFilterRating(null)}
              style={{
                marginTop: 18, width: '100%', padding: '10px', background: 'transparent',
                border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12,
                fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {t('lawyerPanel.resetFilter')}
            </button>
          )}
        </div>

        {/* ── Right: tabs + review list ── */}
        <div>
          <div style={{ display: 'flex', gap: 4, ...glassCard, padding: 5, marginBottom: 20, width: 'fit-content' }}>
            {TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)} style={tabBtnStyle(tab === tb.key)}>
                {t('lawyerPanel.' + tb.lk)}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ ...glassCard, padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
              {t('lawyerPanel.loadingReviews')}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ ...glassCard, padding: 48, textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: 'var(--text2)', marginBottom: 6 }}>{t('lawyerPanel.noReviews')}</div>
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                {t('lawyerPanel.reviewsAppear')}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {filtered.map((rv, i) => {
                const reply = rv.reply || rv.replyText;
                return (
                  <div key={rv.id} style={{ ...glassCard, padding: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%', background: AV_BG[i % AV_BG.length],
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 14, fontWeight: 500,
                        }}>
                          {initialsOf(rv.clientName)}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{rv.clientName || t('lawyerPanel.clientFallback')}</div>
                          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fmtDate(rv.date)}</div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--accent)', fontSize: 14, letterSpacing: '0.04em' }}>{stars(rv.rating)}</div>
                    </div>

                    {rv.comment && (
                      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)', margin: '0 0 14px' }}>
                        {rv.comment}
                      </p>
                    )}

                    {reply && (
                      <div style={{ background: 'var(--canvas)', borderRadius: 'var(--radius)', padding: 14, borderLeft: '3px solid var(--accent)', marginBottom: 14 }}>
                        <div style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
                          {t('lawyerPanel.yourReply')}
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.55 }}>{reply}</div>
                      </div>
                    )}

                    {replyingId === rv.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <textarea
                          autoFocus
                          rows={3}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={t('lawyerPanel.replyPlaceholder')}
                          style={{
                            width: '100%', padding: '12px 14px', borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)', background: 'var(--canvas)',
                            fontSize: 14, color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button
                            onClick={() => submitReply(rv.id)}
                            disabled={savingReply || !replyText.trim()}
                            style={{
                              padding: '9px 18px', background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
                              border: 'none', color: '#FFFFFF', fontSize: 12, fontWeight: 600,
                              letterSpacing: '0.05em', textTransform: 'uppercase', borderRadius: 'var(--radius)',
                              cursor: savingReply ? 'default' : 'pointer', fontFamily: 'inherit', opacity: savingReply ? 0.7 : 1,
                            }}
                          >
                            {savingReply ? t('lawyerPanel.sending') : t('lawyerPanel.send')}
                          </button>
                          <button
                            onClick={() => { setReplyingId(null); setReplyText(''); }}
                            style={{
                              padding: '9px 18px', background: 'transparent', border: '1px solid var(--border)',
                              color: 'var(--text2)', fontSize: 12, fontWeight: 500, letterSpacing: '0.05em',
                              textTransform: 'uppercase', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            {t('lawyerPanel.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {!reply && (
                          <button
                            onClick={() => openReply(rv)}
                            style={{
                              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
                              fontSize: 12, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                              padding: '9px 18px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            {t('lawyerPanel.reply')}
                          </button>
                        )}
                        {(rv.helpful ?? rv.helpfulCount ?? 0) > 0 && (
                          <span
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text3)',
                              fontSize: 12, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                              padding: '9px 0',
                            }}
                          >
                            ♥ {rv.helpful ?? rv.helpfulCount ?? 0}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </GlassShell>
  );
};

export default LawyerReviewsPage;
