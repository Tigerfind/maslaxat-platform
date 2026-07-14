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

const qaBtn = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '13px 16px',
  background: 'var(--canvas)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text)',
  cursor: 'pointer',
  textAlign: 'left',
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
    { icon: <GavelOutlined />, value: stats?.activeConsultations ?? 0, label: 'Активные', bg: 'rgba(184,149,110,0.14)', color: '#B8956E' },
    { icon: <DescriptionOutlined />, value: stats?.documents ?? 0, label: 'Документы', bg: 'rgba(106,138,154,0.14)', color: '#6A8A9A' },
    { icon: <CheckCircleOutline />, value: stats?.completedConsultations ?? 0, label: 'Завершено', bg: 'rgba(122,154,107,0.14)', color: '#7A9A6B' },
    { icon: <ChatBubbleOutline />, value: stats?.aiChats ?? 0, label: 'AI-чаты', bg: 'rgba(196,163,90,0.14)', color: '#C4A35A' },
  ];

  const quickChips = ['Трудовые споры', 'Аренда', 'Семья', 'Бизнес', 'Штрафы'];

  // free-tier upsell numbers (only shown when we actually have subscription data)
  const plan = sub?.plan || 'free';
  const aiLimit = sub?.aiLimit ?? 3;
  const aiUsed = sub?.aiUsedToday ?? 0;
  const aiLeft = Math.max(0, aiLimit - aiUsed);

  const greeting = `${t('dashboard.welcome') || 'Добро пожаловать'}, ${user?.name?.split(' ')[0] || 'Клиент'}`;

  return (
    <GlassShell active="/dashboard" title="Дашборд" subtitle={greeting}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20, marginBottom: 24 }}>
          {statCards.map((s, i) => (
            <div key={i} style={{ ...glassCard, padding: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius)', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, marginBottom: 18 }}>{s.icon}</div>
              <div style={{ fontSize: 32, fontWeight: 300, color: 'var(--text)', letterSpacing: '0.01em' }}>{loading ? '—' : s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Middle row: QuickAIChat + (actions / free-tier) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 20 }} className="dash-mid">
          {/* QuickAIChat widget */}
          <div style={{ ...glassCard, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(140deg,var(--accent),var(--accent-dark))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', boxShadow: '0 3px 10px rgba(184,149,110,0.35)' }}><AutoAwesome sx={{ fontSize: 18 }} /></div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Юридический AI-помощник</div>
                  <div style={{ fontSize: 11, color: '#7A9A6B', letterSpacing: '0.04em' }}>● Онлайн · отвечает мгновенно</div>
                </div>
              </div>
              <button onClick={() => navigate('/ai-chat')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Открыть чат →</button>
            </div>
            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              <div style={{ alignSelf: 'flex-end', maxWidth: '78%', background: 'var(--accent)', color: '#FFFFFF', padding: '12px 16px', borderRadius: '12px 12px 4px 12px', fontSize: 14, lineHeight: 1.5 }}>Могу ли я расторгнуть договор аренды раньше срока?</div>
              <div style={{ alignSelf: 'flex-start', maxWidth: '82%', background: 'var(--canvas)', color: 'var(--text2)', padding: '12px 16px', borderRadius: '12px 12px 12px 4px', fontSize: 14, lineHeight: 1.55 }}>Да. По ст. 415 ГК РУз наниматель вправе досрочно расторгнуть договор, письменно предупредив наймодателя за 3 месяца, если иное не указано в договоре.</div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {quickChips.map((c) => (
                <button key={c} onClick={() => navigate('/ai-chat')} style={{ background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 20, padding: '8px 14px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit' }}>{c}</button>
              ))}
            </div>
          </div>

          {/* Actions + free tier */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ ...glassCard, padding: '22px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', marginBottom: 4 }}>Быстрые действия</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18 }}>С чего начнём сегодня?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => navigate('/ai-chat')} style={qaBtn}><span style={{ color: 'var(--accent)', display: 'flex' }}><AutoAwesome sx={{ fontSize: 20 }} /></span>Спросить AI-помощника</button>
                <button onClick={() => navigate('/lawyers')} style={qaBtn}><span style={{ color: 'var(--accent)', display: 'flex' }}><SearchOutlined sx={{ fontSize: 20 }} /></span>Найти юриста</button>
                <button onClick={() => navigate('/consultations')} style={qaBtn}><span style={{ color: 'var(--accent)', display: 'flex' }}><CalendarMonthOutlined sx={{ fontSize: 20 }} /></span>Мои консультации</button>
              </div>
            </div>

            {plan === 'free' && (
              <div style={{ background: 'linear-gradient(150deg,#1A1A1A,#2D2D2D)', borderRadius: 'var(--radius)', padding: 24, color: '#FFFFFF' }}>
                <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9A980', marginBottom: 10 }}>Тариф Free</div>
                <div style={{ fontSize: 15, lineHeight: 1.5, color: '#E8DFD5', marginBottom: 18 }}>Осталось <strong style={{ color: '#FFFFFF' }}>{aiLeft} из {aiLimit}</strong> бесплатных AI-запросов сегодня.</div>
                <button onClick={() => navigate('/settings')} style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>Перейти на Basic</button>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming consultations */}
        <div style={{ ...glassCard, marginTop: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.02em', color: 'var(--text)' }}>Предстоящие консультации</div>
            <button onClick={() => navigate('/consultations')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Все →</button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Загрузка…</div>
          ) : upcoming.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 300, color: 'var(--text)', marginBottom: 6 }}>Ещё нет консультаций</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Найдите юриста и запишитесь на консультацию</div>
              <button onClick={() => navigate('/lawyers')} style={{ background: 'var(--accent)', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>Найти юриста →</button>
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
                    {isVideo ? <VideocamOutlined sx={{ fontSize: 15 }} /> : <ChatBubbleOutline sx={{ fontSize: 15 }} />}{isVideo ? 'Видео' : 'Чат'}
                  </div>
                  <button onClick={() => join(u)} style={{ background: '#1A1A1A', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '11px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>Присоединиться</button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style>{`@media (max-width: 900px){ .dash-mid { grid-template-columns: 1fr !important; } }`}</style>
    </GlassShell>
  );
};

export default DashboardPageGlass;
