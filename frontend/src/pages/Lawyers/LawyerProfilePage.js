import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  SchoolOutlined,
  TranslateOutlined,
  WorkspacePremiumOutlined,
  ChevronRightOutlined,
} from '@mui/icons-material';
import { Rating } from '@mui/material';
import clientService, { resolvePublicAssetUrl } from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';
import BookingModal from '../../components/BookingModal';
import { useTranslation } from '../../i18n';

/*
  ─────────────────────────────────────────────────────────────
  CLIENT — LAWYER PROFILE  (/lawyers/:lawyerId)
  Ported 1:1 from ClaudeDesign → client/05_LAWYER_PROFILE.html.
  Data: clientService.lawyers.getLawyerDetails(lawyerId)
        → { lawyer: { …, profile, receivedReviews } }
  Anti-bypass: lawyer phone/email are NEVER rendered (backend also
  strips them from this endpoint).
  Chrome (sidebar + topbar) = <GlassShell>.
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
  'linear-gradient(135deg,#9A6A8A,#7A4A6A)',
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const tabBtnStyle = (active) => ({
  flex: 1,
  padding: '11px 14px',
  background: active ? 'var(--accent)' : 'transparent',
  border: 'none',
  borderRadius: 'var(--radius)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: active ? 500 : 400,
  letterSpacing: '0.04em',
  color: active ? '#FFFFFF' : 'var(--text2)',
  cursor: 'pointer',
  transition: 'background 0.2s, color 0.2s',
});

const outlineBtn = {
  flex: 1,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 12,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  padding: 12,
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const LawyerProfilePage = () => {
  const { lawyerId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const LANG_NAMES = t('lawyerProfile.langNames');

  const [lawyer, setLawyer] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('about');
  const [bookingOpen, setBookingOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const latestPresenceRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(false);
        setAvatarFailed(false);
        latestPresenceRef.current = null;
        const data = await clientService.lawyers.getLawyerDetails(lawyerId);
        if (!alive) return;
        const l = data?.lawyer || data || {};
        const p = l.profile || {};
        const normalized = {
          id: l.id,
          name: l.name || t('lawyerProfile.lawyerFallback'),
          avatar: resolvePublicAssetUrl(l.avatar || l.photo || p.avatar || p.photo),
          // Публичный профиль существует только для одобренного юриста.
          verified: true,
          rating: p.rating || 0,
          reviewsCount: p.reviewsCount || 0,
          completedConsultations: p.completedCases || 0,
          specializations: Array.isArray(p.specializations) && p.specializations.length
            ? p.specializations
            : (p.specialization ? [p.specialization] : []),
          experience: p.experience || 0,
          region: p.location || '',
          priceFrom: p.price || 0,
          bio: p.description || '',
          education: Array.isArray(p.education) ? p.education : [],
          certifications: Array.isArray(p.certificates) ? p.certificates : [],
          languages: Array.isArray(p.languages) ? p.languages : [],
          isAvailable: p.isAvailable === true,
          online: l.presence?.online == null ? null : l.presence.online === true,
          lastSeenAt: l.presence?.lastSeenAt || null,
          presenceObservedAt: l.presence?.observedAt || null,
        };
        const latestPresence = latestPresenceRef.current;
        const normalizedWithPresence = latestPresence
          && Date.parse(latestPresence.observedAt || 0) > Date.parse(normalized.presenceObservedAt || 0)
          ? {
            ...normalized,
            online: latestPresence.online === true,
            lastSeenAt: latestPresence.lastSeenAt || null,
            presenceObservedAt: latestPresence.observedAt,
          }
          : normalized;
        setLawyer(normalizedWithPresence);
        const rv = (l.receivedReviews || []).map((r) => ({
          id: r.id,
          name: r.client?.name || t('lawyerProfile.clientFallback'),
          rating: r.rating || 0,
          text: r.text || r.comment || '',
        }));
        setReviews(rv);
      } catch (e) {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [lawyerId, t]);

  useEffect(() => {
    const handlePresence = ({ detail }) => {
      if (detail?.userId !== lawyerId || detail.role !== 'lawyer') return;
      const update = { ...detail, observedAt: detail.observedAt || new Date().toISOString() };
      if (latestPresenceRef.current
        && Date.parse(latestPresenceRef.current.observedAt || 0) >= Date.parse(update.observedAt || 0)) return;
      latestPresenceRef.current = update;
      setLawyer((current) => current && ({
        ...current,
        online: detail.online === true,
        lastSeenAt: detail.lastSeenAt || null,
        presenceObservedAt: update.observedAt,
      }));
    };
    window.addEventListener('maslaxat:presence', handlePresence);
    return () => window.removeEventListener('maslaxat:presence', handlePresence);
  }, [lawyerId]);

  useEffect(() => {
    let timer;
    let stopped = false;
    const poll = async () => {
      if (!stopped && document.visibilityState === 'visible') {
        try {
          const data = await clientService.lawyers.getLawyerDetails(lawyerId);
          const presence = data?.lawyer?.presence;
          if (presence) {
            window.dispatchEvent(new CustomEvent('maslaxat:presence', {
              detail: { userId: lawyerId, role: 'lawyer', ...presence },
            }));
          }
        } catch (pollError) {
          console.error('Presence refresh failed:', pollError);
        }
      }
      if (!stopped) timer = setTimeout(poll, 25000 + Math.random() * 10000);
    };
    timer = setTimeout(poll, 25000 + Math.random() * 10000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [lawyerId]);

  const goAiChat = () => navigate('/ai-chat');
  // Видеозвонок возможен только по забронированной консультации — открываем бронь
  // (раньше кнопка вела на /consultations/video/<lawyerId> с id юриста вместо
  // consultationId → экран звонка не находил консультацию и не работал).

  // ── loading / error states (inside the shell so chrome persists) ──
  if (loading) {
    return (
      <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={t('lawyerProfile.loading')}>
        <div style={{ ...glassCard, maxWidth: 1120, margin: '0 auto', padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
          {t('lawyerProfile.loadingProfile')}
        </div>
      </GlassShell>
    );
  }

  if (error || !lawyer) {
    return (
      <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={t('lawyerProfile.notFoundSub')}>
        <div style={{ ...glassCard, maxWidth: 1120, margin: '0 auto', padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 300, color: 'var(--text)', marginBottom: 8 }}>{t('lawyerProfile.notFound')}</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 22 }}>{t('lawyerProfile.notFoundDesc')}</div>
          <button type="button" onClick={() => navigate('/lawyers')} style={{ minHeight: 44, background: 'var(--accent)', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {t('lawyerProfile.backToCatalog')}
          </button>
        </div>
      </GlassShell>
    );
  }

  const specText = lawyer.specializations.join(', ');
  const langText = lawyer.languages.map((c) => LANG_NAMES[c] || c).join(', ');

  const profileMetrics = [
    { value: lawyer.experience, label: t('lawyerProfile.mExperience') },
    { value: lawyer.completedConsultations, label: t('lawyerProfile.mConsultations') },
    { value: lawyer.rating ? lawyer.rating.toFixed(1) : '—', label: t('lawyerProfile.mRating') },
    { value: lawyer.region || '—', label: t('lawyerProfile.mRegion') },
  ];

  const portfolioMetrics = [
    { value: lawyer.completedConsultations, label: t('lawyerProfile.pCompleted') },
    { value: lawyer.rating ? lawyer.rating.toFixed(1) : '—', label: t('lawyerProfile.pAvgRating') },
    { value: lawyer.experience, label: t('lawyerProfile.pYears') },
    { value: lawyer.reviewsCount, label: t('lawyerProfile.pReviews') },
  ];

  const subtitle = specText || t('lawyerProfile.lawyerFallback');
  const profileTabs = [
    { key: 'about', label: t('lawyerProfile.tabAbout') },
    { key: 'reviews', label: t('lawyerProfile.tabReviews') },
    { key: 'portfolio', label: t('lawyerProfile.tabPortfolio') },
  ];
  const handleTabKeyDown = (event, index) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % profileTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + profileTabs.length) % profileTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = profileTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = profileTabs[nextIndex].key;
    setTab(nextTab);
    document.getElementById(`lawyer-tab-${nextTab}`)?.focus();
  };

  return (
    <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={subtitle}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <button
          type="button"
          aria-label={t('lawyerProfile.backToCatalog')}
          onClick={() => navigate('/lawyers')}
          style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--accent-dark)', fontSize: 13, letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 22 }}
        >
          {t('lawyerProfile.backToCatalog')}
        </button>

        <div className="lp-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, alignItems: 'start' }}>
          {/* ── LEFT ── (закреплена, чтобы цена и «Записаться» были на виду при прокрутке) */}
          <div className="lp-left" style={{ ...glassCard, padding: 30, textAlign: 'center', position: 'sticky', top: 12, alignSelf: 'start' }}>
            <div style={{ width: 100, height: 100, margin: '0 auto 18px', borderRadius: '50%', background: AV_BG[0], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 34, fontWeight: 300, position: 'relative' }}>
              {initialsOf(lawyer.name)}
              {lawyer.avatar && !avatarFailed && (
                <img
                  src={lawyer.avatar}
                  alt={t('lawyerProfile.photoAlt').replace('{name}', lawyer.name)}
                  onError={() => setAvatarFailed(true)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                />
              )}
              {lawyer.verified && (
                <span title={t('lawyerProfile.verified')} aria-label={t('lawyerProfile.verified')} style={{ position: 'absolute', bottom: 2, right: 8, width: 26, height: 26, borderRadius: '50%', background: '#7A9A6B', border: '3px solid #FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 14 }}>✓</span>
              )}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 400, color: 'var(--text)', margin: 0 }}>{lawyer.name}</h1>
            {specText && (
              <div style={{ fontSize: 13, color: 'var(--text3)', letterSpacing: '0.04em', marginTop: 4 }}>{specText}</div>
            )}
            {lawyer.online === true && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#5AA06A', fontSize: 12, fontWeight: 600, marginTop: 8 }}>
                <span className="online-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#5AA06A' }} />
                {t('lawyerProfile.onlineNow')}
              </div>
            )}
            <div aria-label={lawyer.rating ? t('lawyerProfile.ratingAria').replace('{rating}', lawyer.rating.toFixed(1)).replace('{count}', lawyer.reviewsCount) : t('lawyerProfile.noRating')} style={{ color: 'var(--accent)', fontSize: 17, margin: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, flexWrap: 'wrap' }}>
              {lawyer.rating ? (
                <>
                  <Rating value={lawyer.rating} precision={0.5} readOnly size="small" aria-hidden="true" sx={{ '& .MuiRating-iconFilled': { color: 'var(--accent)' }, '& .MuiRating-iconEmpty': { color: 'var(--border)' } }} />
                  <span>{lawyer.rating.toFixed(1)}</span>
                </>
              ) : <span style={{ color: 'var(--text3)', fontSize: 13 }}>{t('lawyerProfile.noRating')}</span>}
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>({t('lawyerProfile.reviewsLabel')}: {lawyer.reviewsCount})</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '22px 0', textAlign: 'left' }}>
              {profileMetrics.map((pm, i) => (
                <div key={i} style={{ background: 'var(--canvas)', borderRadius: 'var(--radius)', padding: '13px 15px' }}>
                  <div style={{ fontSize: 18, fontWeight: 400, color: 'var(--text)' }}>{pm.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.03em', marginTop: 3 }}>{pm.label}</div>
                </div>
              ))}
            </div>

            <div style={{ textAlign: 'left', padding: '16px 0', borderTop: '1px solid var(--canvas)', marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t('lawyerProfile.priceLabel')}</div>
              <div style={{ fontSize: 26, fontWeight: 300, color: 'var(--text)', marginTop: 4 }}>
                {lawyer.priceFrom.toLocaleString()} <span style={{ fontSize: 14, color: 'var(--text3)' }}>{t('lawyerProfile.sum')}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setBookingOpen(true)}
              disabled={!lawyer.isAvailable}
              style={{ width: '100%', minHeight: 44, background: lawyer.isAvailable ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))' : 'var(--border-strong)', color: '#FFFFFF', border: 'none', fontSize: 13, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', padding: 15, borderRadius: 'var(--radius)', cursor: lawyer.isAvailable ? 'pointer' : 'not-allowed', fontFamily: 'inherit', marginBottom: 10 }}
            >
              {lawyer.isAvailable ? t('lawyerProfile.book') : t('lawyerProfile.unavailable')}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={goAiChat} style={{ ...outlineBtn, minHeight: 44 }}>{t('lawyerProfile.askAi')}</button>
              <button type="button" disabled={!lawyer.isAvailable} onClick={() => setBookingOpen(true)} style={{ ...outlineBtn, minHeight: 44, opacity: lawyer.isAvailable ? 1 : 0.5, cursor: lawyer.isAvailable ? 'pointer' : 'not-allowed' }}>{t('lawyerProfile.video')}</button>
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div>
            <div role="tablist" aria-label={t('lawyerProfile.profileSections')} className="lp-tabs" style={{ ...glassCard, display: 'flex', gap: 4, padding: 5, marginBottom: 20 }}>
              {profileTabs.map((pt, index) => (
                <button key={pt.key} id={`lawyer-tab-${pt.key}`} type="button" role="tab" tabIndex={tab === pt.key ? 0 : -1} aria-selected={tab === pt.key} aria-controls={`lawyer-panel-${pt.key}`} onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => setTab(pt.key)} style={{ ...tabBtnStyle(tab === pt.key), minHeight: 44 }}>
                  {pt.label}
                </button>
              ))}
            </div>

            {/* About */}
            {tab === 'about' && (
              <div id="lawyer-panel-about" role="tabpanel" aria-labelledby="lawyer-tab-about" style={{ ...glassCard, padding: 28 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>{t('lawyerProfile.aboutHeading')}</div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text2)', marginBottom: 24 }}>
                  {lawyer.bio || t('lawyerProfile.noBio')}
                </p>

                {(lawyer.education.length > 0 || langText) && (
                  <div className="lp-about-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    {lawyer.education.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <SchoolOutlined sx={{ fontSize: 15 }} /> {t('lawyerProfile.education')}
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
                          {lawyer.education.map((edu, i) => (
                            <div key={i}>{typeof edu === 'string' ? edu : (edu.title || edu.name || '')}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {langText && (
                      <div>
                        <div style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <TranslateOutlined sx={{ fontSize: 15 }} /> {t('lawyerProfile.languages')}
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>{langText}</div>
                      </div>
                    )}
                  </div>
                )}

                {lawyer.certifications.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--card-brd)', margin: '24px 0' }} />
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 16 }}>
                      {t('lawyerProfile.achievements')}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }} className="lp-ach">
                      {lawyer.certifications.map((ach, i) => {
                        const title = typeof ach === 'string' ? ach : (ach.title || ach.name || '');
                        const sub = typeof ach === 'string' ? '' : (ach.sub || ach.description || '');
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 13, background: 'rgba(184,149,110,0.06)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(184,149,110,0.22), rgba(154,123,90,0.14))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent)' }}>
                              <WorkspacePremiumOutlined sx={{ fontSize: 20 }} />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>{title}</div>
                              {sub && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>{sub}</div>}
                            </div>
                            <ChevronRightOutlined sx={{ fontSize: 18, color: 'var(--text3)', flexShrink: 0, mt: '2px' }} />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Reviews — list only (rating/count live in the left column) */}
            {tab === 'reviews' && (
              reviews.length === 0 ? (
                <div id="lawyer-panel-reviews" role="tabpanel" aria-labelledby="lawyer-tab-reviews" style={{ ...glassCard, padding: 48, textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 300, color: 'var(--text)', marginBottom: 6 }}>{t('lawyerProfile.noReviews')}</div>
                  <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('lawyerProfile.noReviewsSub')}</div>
                </div>
              ) : (
                <div id="lawyer-panel-reviews" role="tabpanel" aria-labelledby="lawyer-tab-reviews" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {reviews.map((rv, i) => (
                    <div key={rv.id || i} style={{ ...glassCard, padding: '20px 22px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: AV_BG[i % AV_BG.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 13 }}>
                            {initialsOf(rv.name)}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflowWrap: 'anywhere' }}>{rv.name}</div>
                        </div>
                        <Rating value={Number(rv.rating) || 0} precision={0.5} readOnly size="small" aria-label={t('lawyerProfile.reviewRatingAria').replace('{rating}', Number(rv.rating || 0).toFixed(1))} sx={{ '& .MuiRating-iconFilled': { color: 'var(--accent)' }, '& .MuiRating-iconEmpty': { color: 'var(--border)' } }} />
                      </div>
                      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)' }}>{rv.text}</p>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Portfolio */}
            {tab === 'portfolio' && (
              <div id="lawyer-panel-portfolio" role="tabpanel" aria-labelledby="lawyer-tab-portfolio" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }} className="lp-port">
                {portfolioMetrics.map((po, i) => (
                  <div key={i} style={{ ...glassCard, padding: 24 }}>
                    <div style={{ fontSize: 30, fontWeight: 300, color: 'var(--accent)' }}>{po.value}</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6 }}>{po.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <BookingModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        lawyer={lawyer}
      />

      <style>{`@media (max-width: 900px){
        .lp-grid { grid-template-columns: 1fr !important; }
        .lp-ach, .lp-port { grid-template-columns: 1fr !important; }
        .lp-left { position: static !important; }
      }
      @media (max-width: 600px){
        .lp-about-grid { grid-template-columns: 1fr !important; }
        .lp-tabs { overflow-x: auto; }
        .lp-tabs [role="tab"] { min-width: max-content; }
      }`}</style>
    </GlassShell>
  );
};

export default LawyerProfilePage;
