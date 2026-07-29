import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  GavelOutlined,
  DescriptionOutlined,
  CheckCircleOutline,
  ChatBubbleOutline,
  AutoAwesome,
  SearchOutlined,
  CalendarMonthOutlined,
  VideocamOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import AILimitUpsell from '../../components/AILimitUpsell';

/*
  ─────────────────────────────────────────────────────────────
  CLIENT DASHBOARD  (/dashboard)
  Ported 1:1 from ClaudeDesign → ClientApp.dc.html "DASHBOARD".
  What it shows / how it works:
   • 4 glass stat cards  ← clientService.dashboard.getStats()
   • QuickAIChat teaser  → navigates to /ai-chat
   • Quick actions       → navigate to ai-chat / lawyers / consultations
   • Free-tier upsell    ← clientService.subscription.getMy() (aiUsedToday/limit)
   • Upcoming list       ← clientService.dashboard.getUpcomingConsultations()
                          "Присоединиться" → joinConsultation → video/chat
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

const qaHero = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: 20,
  background: 'linear-gradient(150deg,#1A1A1A,#2D2D2D)',
  border: 'none',
  borderRadius: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  position: 'relative',
  overflow: 'hidden',
};

const qaHeroGlow = {
  position: 'absolute', right: -30, top: -30, width: 120, height: 120,
  background: 'radial-gradient(circle,rgba(201,169,128,0.28),transparent 70%)',
  pointerEvents: 'none',
};

const qaHeroIc = {
  width: 46, height: 46, borderRadius: 12, flexShrink: 0, zIndex: 1,
  background: 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#FFFFFF',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 14px rgba(184,149,110,0.4)',
};

const qaMini = {
  flex: 1,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9,
  padding: '15px 14px', cursor: 'pointer', fontFamily: 'inherit',
  background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 12,
};

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const AV_BG = ['linear-gradient(135deg,#B8956E,#8B7355)', 'linear-gradient(135deg,#6A8A9A,#4A6A7A)', 'linear-gradient(135deg,#7A9A6B,#5A7A4B)'];

const DashboardPageGlass = () => {
  const navigate = useNavigate();
  const { user } = useSelector((s) => s.auth);
  const { t } = useTranslation();

  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [sub, setSub] = useState(null);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [s, u, sb] = await Promise.all([
        clientService.dashboard.getStats(),
        clientService.dashboard.getUpcomingConsultations(),
        clientService.subscription.getMy(),
      ]);
      setStats(s);
      setUpcoming(Array.isArray(u) ? u : []);
      setSub(sb);
    } catch (e) {
      toast.error(t('common.error') || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  const join = async (c) => {
    try {
      await clientService.consultations.joinConsultation(c.id);
      navigate(c.type === 'video' ? `/consultations/video/${c.id}` : `/consultations/chat/${c.id}`);
    } catch {
      toast.error(t('common.error') || 'Ошибка');
    }
  };

  const statCards = [
    { icon: <GavelOutlined />, value: stats?.activeConsultations ?? 0, label: t('dashboard.statActive'), bg: 'rgba(184,149,110,0.14)', color: '#B8956E', to: '/consultations' },
    { icon: <DescriptionOutlined />, value: stats?.documents ?? 0, label: t('dashboard.statDocuments'), bg: 'rgba(106,138,154,0.14)', color: '#6A8A9A', to: '/documents' },
    { icon: <CheckCircleOutline />, value: stats?.completedConsultations ?? 0, label: t('dashboard.statCompleted'), bg: 'rgba(122,154,107,0.14)', color: '#7A9A6B', to: '/consultations' },
    { icon: <ChatBubbleOutline />, value: stats?.aiChats ?? 0, label: t('dashboard.statAiChats'), bg: 'rgba(196,163,90,0.14)', color: '#C4A35A', to: '/ai-chat' },
  ];

  const quickChips = [t('dashboard.chipLabor'), t('dashboard.chipRent'), t('dashboard.chipFamily'), t('dashboard.chipBusiness'), t('dashboard.chipFines')];

  // free-tier upsell numbers (only shown when we actually have subscription data)
  const plan = sub?.plan || 'free';
  const aiLimit = sub?.aiLimit ?? 3;
  const aiUsed = sub?.aiUsedToday ?? 0;
  const aiLeft = Math.max(0, aiLimit - aiUsed);

  const greeting = `${t('dashboard.welcome') || 'Добро пожаловать'}, ${user?.name?.split(' ')[0] || 'Клиент'}`;

  return (
    <GlassShell active="/dashboard" title={t('dashboard.title')} subtitle={greeting}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18, marginBottom: 24 }}>
          {statCards.map((s, i) => (
            <div
              key={i}
              className="stat-card"
              onClick={() => navigate(s.to)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(s.to); }}
              style={{ ...glassCard, padding: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: '50%', background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>{s.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--text)', letterSpacing: '0.01em', lineHeight: 1 }}>{loading ? '—' : s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 5 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Middle row: QuickAIChat + (actions / free-tier) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 20 }} className="dash-mid">
          {/* QuickAIChat widget — тёмное стекло */}
          <div style={{
            position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            borderRadius: 'var(--radius)',
            background: 'rgba(28,24,19,0.62)',
            backdropFilter: 'blur(26px) saturate(180%)', WebkitBackdropFilter: 'blur(26px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 16px 46px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.14)',
          }}>
            {/* цветные свечения внутри стекла */}
            <div style={{ position: 'absolute', top: -60, right: -40, width: 210, height: 210, borderRadius: '50%', background: '#C9A36E', opacity: 0.5, filter: 'blur(45px)', pointerEvents: 'none', zIndex: 0 }} />
            <div style={{ position: 'absolute', bottom: -50, left: -30, width: 180, height: 180, borderRadius: '50%', background: '#7A9A6B', opacity: 0.38, filter: 'blur(45px)', pointerEvents: 'none', zIndex: 0 }} />

            <div style={{ position: 'relative', zIndex: 1, padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(140deg,#C9A980,#8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}><AutoAwesome sx={{ fontSize: 19 }} /></div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: '#F3EDE2' }}>{t('dashboard.aiAssistantTitle')}</div>
                  <div style={{ fontSize: 11, color: '#9FBF8E', letterSpacing: '0.04em' }}>● {t('dashboard.aiOnline')}</div>
                </div>
              </div>
              <button onClick={() => navigate('/ai-chat')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#D4B483', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{t('dashboard.openChat')} →</button>
            </div>

            <div style={{ position: 'relative', zIndex: 1, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              <div style={{ alignSelf: 'flex-end', maxWidth: '78%', background: 'linear-gradient(135deg, #C9A980, #8B7355)', color: '#FFFFFF', padding: '12px 16px', borderRadius: '14px 14px 4px 14px', fontSize: 14, lineHeight: 1.5, boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}>{t('dashboard.demoQuestion')}</div>
              <div style={{ alignSelf: 'flex-start', maxWidth: '82%', background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)', color: '#E6DDCE', padding: '12px 16px', borderRadius: '14px 14px 14px 4px', fontSize: 14, lineHeight: 1.55 }}>{t('dashboard.demoAnswer')}</div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.10)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {quickChips.map((c) => (
                <button key={c} onClick={() => navigate('/ai-chat')} className="ai-chip-dark" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20, padding: '8px 14px', fontSize: 13, color: '#D8CDBA', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s ease' }}>{c}</button>
              ))}
            </div>
          </div>

          {/* Actions + free tier */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ ...glassCard, padding: '22px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', marginBottom: 4 }}>{t('dashboard.quickActions')}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18 }}>{t('dashboard.quickActionsSub')}</div>
              <button onClick={() => navigate('/ai-chat')} className="qa-hero" style={qaHero}>
                <span style={qaHeroGlow} />
                <span style={qaHeroIc}><AutoAwesome sx={{ fontSize: 22 }} /></span>
                <span style={{ zIndex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#F5EFE6' }}>{t('dashboard.askAssistant')}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#C9A980', marginTop: 1 }}>{t('dashboard.aiHeroSub')}</span>
                </span>
              </button>
              <div style={{ display: 'flex', gap: 11, marginTop: 11 }}>
                <button onClick={() => navigate('/lawyers')} className="qa-mini" style={qaMini}>
                  <span style={{ color: 'var(--accent)', display: 'flex' }}><SearchOutlined sx={{ fontSize: 20 }} /></span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{t('dashboard.findLawyer')}</span>
                </button>
                <button onClick={() => navigate('/consultations')} className="qa-mini" style={qaMini}>
                  <span style={{ color: 'var(--accent)', display: 'flex' }}><CalendarMonthOutlined sx={{ fontSize: 20 }} /></span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{t('dashboard.myConsultations')}</span>
                </button>
              </div>
            </div>

            {plan === 'free' && (
              <div style={{ background: 'linear-gradient(150deg,#1A1A1A,#2D2D2D)', borderRadius: 'var(--radius)', padding: 24, color: '#FFFFFF' }}>
                <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A980', marginBottom: 10 }}>{t('dashboard.tariffFree')}</div>
                <div style={{ fontSize: 15, lineHeight: 1.5, color: '#E8DFD5', marginBottom: 18 }}>{t('dashboard.freeLeft', { left: aiLeft, limit: aiLimit })}</div>
                <button onClick={() => setUpsellOpen(true)} style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('dashboard.upgradeBasic')}</button>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming consultations */}
        <div style={{ ...glassCard, marginTop: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.02em', color: 'var(--text)' }}>{t('dashboard.upcomingTitle')}</div>
            <button onClick={() => navigate('/consultations')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{t('dashboard.seeAll')} →</button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t('common.loading')}</div>
          ) : upcoming.length === 0 ? (
            <div style={{ position: 'relative', overflow: 'hidden', padding: '46px 24px', textAlign: 'center', background: 'radial-gradient(120% 100% at 50% 0%, rgba(184,149,110,0.10), transparent 60%)' }}>
              {/* парящие точки */}
              <span style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', opacity: 0.5, top: 40, left: '22%' }} />
              <span style={{ position: 'absolute', width: 7, height: 7, borderRadius: '50%', background: '#7A9A6B', opacity: 0.5, top: 70, right: '26%' }} />
              <span style={{ position: 'absolute', width: 14, height: 14, borderRadius: '50%', background: '#C4A35A', opacity: 0.35, bottom: 50, left: '30%' }} />
              <span style={{ position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: 'var(--accent-dark)', opacity: 0.4, bottom: 70, right: '22%' }} />
              {/* веер карточек-встреч */}
              <div style={{ position: 'relative', width: 96, height: 80, margin: '0 auto 22px' }}>
                <div style={{ position: 'absolute', width: 70, height: 52, borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(140deg, rgba(184,149,110,0.18), var(--surface))', transform: 'rotate(-9deg)', left: 2, top: 14, boxShadow: '0 6px 18px rgba(60,45,30,0.10)' }} />
                <div style={{ position: 'absolute', width: 70, height: 52, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', transform: 'rotate(7deg)', right: 2, top: 8, boxShadow: '0 6px 18px rgba(60,45,30,0.10)' }} />
                <div style={{ position: 'absolute', width: 70, height: 52, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', left: '50%', top: 0, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', zIndex: 2, boxShadow: '0 8px 20px rgba(60,45,30,0.12)' }}>
                  <CalendarMonthOutlined sx={{ fontSize: 28 }} />
                </div>
              </div>
              <div style={{ position: 'relative', fontSize: 16, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>{t('dashboard.noConsultations')}</div>
              <div style={{ position: 'relative', fontSize: 13, color: 'var(--text3)', marginBottom: 22 }}>{t('dashboard.noConsultationsSub')}</div>
              <button onClick={() => navigate('/lawyers')} className="empty-cta" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '13px 24px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 18px rgba(184,149,110,0.30)', transition: 'transform .15s ease, box-shadow .15s ease' }}>{t('dashboard.findLawyer')} →</button>
            </div>
          ) : (
            upcoming.map((u, i) => {
              const name = u.lawyerName || u.name || 'Юрист';
              const isVideo = u.type === 'video';
              return (
                <div key={u.id || i} style={{ padding: '18px 24px', borderBottom: '1px solid var(--canvas)', display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: AV_BG[i % AV_BG.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 15, flexShrink: 0 }}>{initialsOf(name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text3)' }}>{[u.spec || u.topic, u.date && `${u.date}${u.time ? ' · ' + u.time : ''}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(184,149,110,0.12)', padding: '7px 12px', borderRadius: 'var(--radius)' }}>
                    {isVideo ? <VideocamOutlined sx={{ fontSize: 15 }} /> : <ChatBubbleOutline sx={{ fontSize: 15 }} />}{isVideo ? t('dashboard.typeVideo') : t('dashboard.typeChat')}
                  </div>
                  <button onClick={() => join(u)} style={{ background: '#1A1A1A', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '11px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('dashboard.join')}</button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px){ .dash-mid { grid-template-columns: 1fr !important; } }
        .stat-card{ transition: transform .16s ease, box-shadow .16s ease; }
        .stat-card:hover{ transform: translateY(-3px); box-shadow: 0 10px 28px rgba(139,115,85,0.16); }
        .ai-chip-dark:hover{ background: rgba(201,169,128,0.24) !important; border-color: #C9A980 !important; color: #FFFFFF !important; }
        .empty-cta:hover{ transform: translateY(-2px); box-shadow: 0 10px 26px rgba(184,149,110,0.4); }
        .qa-hero{ transition: transform .18s ease, box-shadow .18s ease; }
        .qa-hero:hover{ transform: translateY(-2px); box-shadow: 0 10px 30px rgba(139,115,85,0.28); }
        .qa-mini{ transition: transform .18s ease, border-color .18s ease; }
        .qa-mini:hover{ transform: translateY(-2px); border-color: var(--accent); }
      `}</style>

      {/* Апселл подписки: тот же модал, что на лимите AI (раньше кнопка вела в /settings,
          где нет выбора плана — тупик). onUpgraded обновляет тариф на дашборде. */}
      <AILimitUpsell
        open={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        onUpgraded={() => { setUpsellOpen(false); load(); }}
      />
    </GlassShell>
  );
};

export default DashboardPageGlass;
