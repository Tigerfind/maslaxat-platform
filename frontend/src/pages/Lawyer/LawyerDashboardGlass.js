import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  PaymentsOutlined,
  PeopleAltOutlined,
  CheckCircleOutline,
  SavingsOutlined,
  VideocamOutlined,
  CallOutlined,
  ChatBubbleOutline,
  StarOutlined,
  StarBorderOutlined,
  PowerSettingsNewOutlined,
} from '@mui/icons-material';
import lawyerService from '../../services/lawyerService';
import OnboardingWizard from '../../components/Lawyer/OnboardingWizard';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';

/*
  ─────────────────────────────────────────────────────────────
  LAWYER DASHBOARD  (/lawyer/dashboard)
  Ported 1:1 from ClaudeDesign → design/lawyer/01_DASHBOARD.html.
  Layout:
   • 4 glass stat cards        ← lawyerService.dashboard.getStats()
   • Row: incoming requests    ← lawyerService.consultation.getConsultationRequests('pending')
          (1.4fr) + weekly     accept/reject → accept/rejectConsultationRequest
          activity (1fr)       ← stats.weeklyActivity + responseRate/rating footer
   • Upcoming consultations    ← lawyerService.dashboard.getPendingConsultations()
          "Начать" → video/chat, "Календарь →" → /lawyer/schedule
   • Recent reviews (kept —    ← lawyerService.dashboard.getRecentReviews(3)
          not in mockup, see report)
  Online/offline toggle kept as an in-content pill (no home in mockup).
  Chrome (sidebar + topbar + dark + lang + bell) = <GlassShell role="lawyer">.
  New lawyers (0 cases & 0 reviews) → <OnboardingWizard/>.
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
  'linear-gradient(135deg,#C4A35A,#9A7B3A)',
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'К';

const LawyerDashboardGlass = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const DAYS = t('lawyerPanel.days');

  const [stats, setStats] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [consultationRequests, setConsultationRequests] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusOnline, setStatusOnline] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, consultationsData, requestsData, reviewsData] = await Promise.all([
        lawyerService.dashboard.getStats(),
        lawyerService.dashboard.getPendingConsultations(),
        lawyerService.consultation.getConsultationRequests('pending'),
        lawyerService.dashboard.getRecentReviews(3),
      ]);

      setStats(statsData);
      // Пилюля статуса отражает реальный isAvailable (раньше всегда «онлайн» после загрузки)
      if (statsData && typeof statsData.isAvailable === 'boolean') setStatusOnline(statsData.isAvailable);
      setConsultations(Array.isArray(consultationsData) ? consultationsData : []);
      setConsultationRequests(Array.isArray(requestsData) ? requestsData : []);
      setReviews(Array.isArray(reviewsData) ? reviewsData : []);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error(t('lawyerPanel.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId) => {
    try {
      await lawyerService.consultation.acceptConsultationRequest(requestId);
      toast.success(t('lawyerPanel.requestAccepted'));
      loadDashboardData();
    } catch (error) {
      toast.error(t('lawyerPanel.acceptError'));
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await lawyerService.consultation.rejectConsultationRequest(requestId);
      toast.success(t('lawyerPanel.requestRejected'));
      loadDashboardData();
    } catch (error) {
      toast.error(t('lawyerPanel.rejectError'));
    }
  };

  const handleStatusToggle = async () => {
    try {
      const newStatus = statusOnline ? 'offline' : 'online';
      await lawyerService.dashboard.updateStatus(newStatus);
      setStatusOnline(!statusOnline);
      toast.success(`${t('lawyerPanel.statusChanged')} ${newStatus === 'online' ? t('lawyerPanel.online') : t('lawyerPanel.offline')}`);
    } catch (error) {
      toast.error(t('lawyerPanel.statusError'));
    }
  };

  const handleStartConsultation = (consultation) => {
    if (consultation.type === 'video') {
      navigate(`/consultations/video/${consultation.id}`);
    } else {
      navigate(`/consultations/chat/${consultation.id}`);
    }
  };

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('uz-UZ', { style: 'decimal', minimumFractionDigits: 0 }).format(amount || 0);

  const formatWhen = (dateVal) => {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  };

  // Показываем онбординг, пока профиль юриста не заполнен (нет описания). Раньше
  // сверялись поля stats.completedCases/reviewsCount, которых бэкенд НЕ отдаёт
  // (он шлёт completedConsultations/totalReviews) → условие было всегда false и
  // мастер не показывался никому. Теперь ориентируемся на серверный profileComplete.
  const isNewLawyer = !onboardingDone && stats && !stats.profileComplete;
  if (isNewLawyer) {
    return <OnboardingWizard onComplete={() => { setOnboardingDone(true); loadDashboardData(); }} />;
  }

  const statCards = [
    { icon: <PaymentsOutlined />, value: `${formatCurrency(stats?.monthlyEarnings)} ${t('lawyerPanel.sum')}`, label: t('lawyerPanel.statMonthEarned'), bg: 'rgba(122,154,107,0.14)', color: '#7A9A6B' },
    { icon: <PeopleAltOutlined />, value: stats?.activeClients ?? 0, label: t('lawyerPanel.statActiveClients'), bg: 'rgba(184,149,110,0.14)', color: '#B8956E' },
    { icon: <CheckCircleOutline />, value: stats?.completedConsultations ?? 0, label: t('lawyerPanel.statCompleted'), bg: 'rgba(106,138,154,0.14)', color: '#6A8A9A' },
    { icon: <SavingsOutlined />, value: `${formatCurrency(stats?.totalEarnings)} ${t('lawyerPanel.sum')}`, label: t('lawyerPanel.statTotalIncome'), bg: 'rgba(196,163,90,0.14)', color: '#C4A35A' },
  ];

  const weeklyData = Array.isArray(stats?.weeklyActivity) && stats.weeklyActivity.length
    ? stats.weeklyActivity
    : [0, 0, 0, 0, 0, 0, 0];
  const maxWeekly = Math.max(...weeklyData, 1);

  // Подписи столбцов соответствуют РЕАЛЬНЫМ дням: бэкенд шлёт активность за
  // [сегодня-6 … сегодня], а раньше подписи были статичные Пн…Вс (сдвиг). DAYS[0]=Пн…
  // DAYS[6]=Вс; JS getDay(): 0=Вс..6=Сб → индекс (getDay()+6)%7.
  const weekDayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return DAYS[(d.getDay() + 6) % 7];
  });

  const typeChip = (isVideo) => ({
    color: isVideo ? 'var(--accent)' : 'var(--info)',
    bg: isVideo ? 'rgba(184,149,110,0.14)' : 'rgba(106,138,154,0.14)',
    label: isVideo ? t('lawyerPanel.typeVideo') : t('lawyerPanel.typeChat'),
  });

  const subtitle = statusOnline ? t('lawyerPanel.subOnline') : t('lawyerPanel.subOffline');

  return (
    <GlassShell active="/lawyer/dashboard" title={t('lawyerPanel.title')} subtitle={subtitle} role="lawyer">
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* Status toggle pill (no home in mockup — kept functional) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
          <button
            onClick={handleStatusToggle}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: 'var(--card-glass)', border: '1px solid var(--card-brd)',
              boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)',
              padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 500, color: 'var(--text)',
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusOnline ? '#7A9A6B' : 'var(--text3)' }} />
            {statusOnline ? t('lawyerPanel.online') : t('lawyerPanel.offline')}
            <PowerSettingsNewOutlined sx={{ fontSize: 17, color: 'var(--text3)' }} />
          </button>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20, marginBottom: 24 }}>
          {statCards.map((s, i) => (
            <div key={i} style={{ ...glassCard, padding: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius)', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, marginBottom: 18 }}>{s.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 300, color: 'var(--text)', letterSpacing: '0.01em' }}>{loading ? '—' : s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Row: incoming requests + weekly activity */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 20 }} className="ld-row">
          {/* Incoming requests */}
          <div style={{ ...glassCard, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.02em', color: 'var(--text)' }}>{t('lawyerPanel.incomingRequests')}</div>
              <span style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(184,149,110,0.12)', padding: '5px 11px', borderRadius: 'var(--radius)' }}>{consultationRequests.length} {t('lawyerPanel.newCount')}</span>
            </div>

            {consultationRequests.length > 0 ? (
              <div style={{ padding: 8 }}>
                {consultationRequests.map((r, i) => {
                  const name = r.client?.name || t('lawyerPanel.clientFallback');
                  const chip = typeChip(r.consultationType === 'video');
                  return (
                    <div key={r.id} style={{ padding: 18, borderRadius: 'var(--radius)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: '50%', background: AV_BG[i % AV_BG.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 14, flexShrink: 0 }}>{initialsOf(name)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{name}</div>
                            <span style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: chip.color, background: chip.bg, padding: '3px 9px', borderRadius: 'var(--radius)' }}>{chip.label}</span>
                          </div>
                          {Array.isArray(r.problems) && r.problems.length > 1 ? (
                            <ol style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5, margin: '8px 0', paddingLeft: 20 }}>
                              {r.problems.map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p}</li>)}
                            </ol>
                          ) : (
                            <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, margin: '8px 0' }}>«{r.question}»</p>
                          )}
                          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{formatWhen(r.createdAt)} · <span style={{ color: 'var(--text)' }}>{formatCurrency(r.price)} {t('lawyerPanel.sum')}</span></div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 14, paddingLeft: 58 }}>
                        <button onClick={() => handleAcceptRequest(r.id)} style={{ background: '#1A1A1A', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('lawyerPanel.accept')}</button>
                        <button onClick={() => handleRejectRequest(r.id)} style={{ background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>{t('lawyerPanel.reject')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: '50%', background: 'rgba(122,154,107,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A9A6B' }}>
                  <CheckCircleOutline sx={{ fontSize: 26 }} />
                </div>
                <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>{loading ? t('common.loading') : t('lawyerPanel.allProcessed')}</div>
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('lawyerPanel.newAutoAppear')}</div>
              </div>
            )}
          </div>

          {/* Weekly activity */}
          <div style={{ ...glassCard, padding: 24, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{t('lawyerPanel.weeklyActivity')}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>{t('lawyerPanel.consultationsDone')}</div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, minHeight: 150 }}>
              {weekDayLabels.map((day, i) => {
                const val = weeklyData[i] || 0;
                const isMax = val === maxWeekly && val > 0;
                const heightPct = Math.max((val / maxWeekly) * 100, 4);
                return (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      title={`${val}`}
                      style={{
                        width: '100%', height: `${heightPct}%`,
                        background: isMax ? 'var(--accent)' : 'rgba(184,149,110,0.22)',
                        borderRadius: '6px 6px 0 0', transformOrigin: 'bottom',
                        animation: 'growBar .5s cubic-bezier(.4,0,.2,1)',
                      }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{day}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--text)' }}>{stats?.responseRate ? `${stats.responseRate}%` : '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.03em' }}>{t('lawyerPanel.responseRate')}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--accent)' }}>{stats?.rating ? `★ ${stats.rating}` : '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.03em' }}>{t('lawyerPanel.rating')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming consultations */}
        <div style={{ ...glassCard, marginTop: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{t('lawyerPanel.upcoming')}</div>
            <button onClick={() => navigate('/lawyer/schedule')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{t('lawyerPanel.calendar')} →</button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t('common.loading')}</div>
          ) : consultations.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 300, color: 'var(--text)', marginBottom: 6 }}>{t('lawyerPanel.noUpcoming')}</div>
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('lawyerPanel.whenBooked')}</div>
            </div>
          ) : (
            consultations.map((c, i) => {
              const isVideo = c.type === 'video';
              const chip = typeChip(isVideo);
              return (
                <div key={c.id || i} style={{ padding: '16px 24px', borderBottom: '1px solid var(--canvas)', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: AV_BG[i % AV_BG.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 14, flexShrink: 0 }}>{initialsOf(c.clientName)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{c.clientName}</div>
                    <div style={{ fontSize: 13, color: 'var(--text3)' }}>{c.topic}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{[c.date, c.time].filter(Boolean).join(' · ')}</div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: chip.color, background: chip.bg, padding: '6px 12px', borderRadius: 'var(--radius)' }}>
                    {isVideo ? <VideocamOutlined sx={{ fontSize: 15 }} /> : <ChatBubbleOutline sx={{ fontSize: 15 }} />}{chip.label}
                  </span>
                  <button onClick={() => handleStartConsultation(c)} style={{ background: '#1A1A1A', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {isVideo && <CallOutlined sx={{ fontSize: 15 }} />}{isVideo ? t('call.callBtn') : t('lawyerPanel.start')}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Recent reviews (kept — not in mockup, see report) */}
        <div style={{ ...glassCard, marginTop: 20, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{t('lawyerPanel.recentReviews')}</div>
            <button onClick={() => navigate('/lawyer/reviews')} style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{t('lawyerPanel.allReviews')} →</button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t('common.loading')}</div>
          ) : reviews.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--text3)' }}>{t('lawyerPanel.noReviews')}</div>
            </div>
          ) : (
            reviews.map((rv, i) => (
              <div key={rv.id || i} style={{ padding: '18px 24px', borderBottom: '1px solid var(--canvas)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{rv.clientName}</div>
                  <div style={{ display: 'flex', gap: 2, color: 'var(--accent)' }}>
                    {[...Array(5)].map((_, s) => (
                      s < (rv.rating || 0)
                        ? <StarOutlined key={s} sx={{ fontSize: 15 }} />
                        : <StarBorderOutlined key={s} sx={{ fontSize: 15, color: 'var(--text3)' }} />
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, margin: '0 0 6px' }}>{rv.comment}</p>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{rv.date}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`@media (max-width: 900px){ .ld-row { grid-template-columns: 1fr !important; } }`}</style>
    </GlassShell>
  );
};

export default LawyerDashboardGlass;
