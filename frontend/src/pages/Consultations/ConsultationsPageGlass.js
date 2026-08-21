import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
  IconButton,
  Button,
  Pagination,
  Tooltip,
} from '@mui/material';
import {
  CalendarMonthOutlined,
  VideocamOutlined,
  CallOutlined,
  ChatBubbleOutline,
  AddOutlined,
  ReplayOutlined,
  EventRepeatOutlined,
  CheckOutlined,
  CloseOutlined,
  AccessTimeRounded,
  CheckCircleOutlined,
  AutorenewRounded,
  CancelOutlined,
  FolderOpenOutlined,
  PaymentOutlined,
  EventAvailableOutlined,
  SearchOutlined,
} from '@mui/icons-material';
import { useSelector } from 'react-redux';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import ConsultationTimeline from '../../components/Consultations/ConsultationTimeline';
import clientService from '../../services/clientService';
import { launchConsultation } from '../../services/meetingLauncher';
import { clientLawyerService } from '../../services/clientService';
import RatingDialog from '../../components/UI/RatingDialog';
import BookingModal from '../../components/BookingModal';
import { SkeletonCard } from '../../components/UI/Skeleton';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';
import ErrorState from '../../components/UI/ErrorState';
import EmptyState from '../../components/UI/EmptyState';

/*
  ─────────────────────────────────────────────────────────────
  MY CONSULTATIONS  (/consultations)
  Ported 1:1 from ClaudeDesign → client/06_CONSULTATIONS.html.
  What it shows / how it works:
   • Pill tab row  Все / Предстоящие / Завершённые / Отменённые  (with counts)
   • Glass consultation cards ← clientService.consultations.getConsultations('all')
       avatar · name · status chip · spec ★ rating · question · date/type/price
   • "Войти в видео"/"Открыть чат"  → joinConsultation → video/chat route
   • "Отменить"  → cancel dialog (reason) → cancelConsultation
   • "Оценить"   → RatingDialog → clientLawyerService.leaveReview  (completed w/o rating)
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
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const STATUS = {
  accepted: { key: 'statusAccepted', color: '#7A9A6B', bg: 'rgba(122,154,107,0.14)', icon: CheckCircleOutlined },
  pending: { key: 'statusPending', color: '#C4A35A', bg: 'rgba(196,163,90,0.14)', icon: AccessTimeRounded },
  in_progress: { key: 'statusInProgress', color: 'var(--accent)', bg: 'rgba(184,149,110,0.14)', icon: AutorenewRounded },
  completed: { key: 'statusCompleted', color: '#6A8A9A', bg: 'rgba(106,138,154,0.14)', icon: CheckCircleOutlined },
  rejected: { key: 'statusRejected', color: '#B07070', bg: 'rgba(176,112,112,0.14)', icon: CancelOutlined },
  cancelled: { key: 'statusCancelled', color: '#B07070', bg: 'rgba(176,112,112,0.14)', icon: CancelOutlined },
  payment_pending: { key: 'statusPaymentPending', color: '#B06A35', bg: 'rgba(176,106,53,0.14)', icon: PaymentOutlined },
};

const ConsultationsPageGlass = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useTranslation();

  // Начальная вкладка может прийти из навигации (напр. с карточек дашборда):
  // navigate('/consultations', { state: { tab: 1 } }). Иначе — «Все» (0).
  const legacyTab = Number.isInteger(location.state?.tab) ? ['all', 'upcoming', 'completed', 'cancelled', 'archived'][location.state.tab] : null;
  const [currentTab, setCurrentTab] = useState(legacyTab || 'all');
  const [consultations, setConsultations] = useState([]);
  const [counts, setCounts] = useState({ all: 0, payment_pending: 0, upcoming: 0, completed: 0, cancelled: 0, archived: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [period, setPeriod] = useState('all');
  const [paymentLoading, setPaymentLoading] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [ratingConsultation, setRatingConsultation] = useState(null);
  const [rebookLawyer, setRebookLawyer] = useState(null);
  const [docsFor, setDocsFor] = useState(null); // консультация, чью папку документов открыли
  const { user } = useSelector((state) => state.auth);
  const [rescheduleC, setRescheduleC] = useState(null);
  const [rsDate, setRsDate] = useState('');
  const [rsTime, setRsTime] = useState('');
  const [rsLoading, setRsLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchConsultations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, page, debouncedSearch, period]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const fetchConsultations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await clientService.consultations.getConsultations({
        bucket: currentTab, page, limit: 10,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(period !== 'all' ? { period } : {}),
      });
      setConsultations(data.consultations || []);
      setCounts(data.counts || {});
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('Error fetching consultations:', err);
      setError(t('consultations.loadError'));
      setConsultations([]);
    } finally {
      setLoading(false);
    }
  };

  // Оценена ли консультация — единственный признак берём из таблицы Review
  // (association consultationReview). Consultation.rating не используется (всегда NULL).
  const isRated = (c) => Boolean(c.consultationReview);

  const locale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';

  const handleCancelConsultation = async () => {
    if (!selectedConsultation || !cancelReason.trim()) {
      toast.error(t('consultations.cancelReasonRequired'));
      return;
    }
    try {
      setActionLoading(true);
      await clientService.consultations.cancelConsultation(selectedConsultation.id, cancelReason);
      toast.success(t('consultations.cancelSuccess'));
      setCancelDialogOpen(false);
      setCancelReason('');
      setSelectedConsultation(null);
      fetchConsultations();
    } catch (err) {
      console.error('Error canceling consultation:', err);
      toast.error(t('consultations.cancelError'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinConsultation = async (consultation) => {
    // Просто открываем комнату. В in_progress переводим только когда стороны
    // реально соединились (видео — по peer-connect на странице звонка), чтобы
    // «дозвон без ответа» не завершал консультацию и не выплачивал юристу.
    try {
      await launchConsultation(consultation, navigate);
    } catch (error) {
      toast.info(error.code === 'POPUP_BLOCKED'
        ? 'Разрешите всплывающие окна, чтобы открыть Zoom'
        : error.response?.data?.error || 'Zoom-встреча ещё создаётся');
    }
  };

  const handleCompleteConsultation = async (consultation) => {
    if (!window.confirm(t('consultations.completeConfirm'))) return;
    try {
      setActionLoading(true);
      await clientService.consultations.completeConsultation(consultation.id);
      toast.success(t('consultations.completeSuccess'));
      fetchConsultations();
    } catch (err) {
      toast.error(err.response?.data?.error || t('consultations.completeError'));
    } finally {
      setActionLoading(false);
    }
  };

  const openCancelDialog = (consultation) => {
    setSelectedConsultation(consultation);
    setCancelDialogOpen(true);
  };

  const closeCancelDialog = () => {
    setCancelDialogOpen(false);
    setCancelReason('');
    setSelectedConsultation(null);
  };

  const openRatingDialog = (consultation) => {
    setRatingConsultation(consultation);
    setRatingDialogOpen(true);
  };

  const openReschedule = (c) => {
    setRescheduleC(c);
    setRsDate(c.preferredDate || '');
    setRsTime((c.preferredTime || '').slice(0, 5));
  };

  const submitReschedule = async () => {
    if (!rescheduleC || !rsDate || !rsTime) return;
    setRsLoading(true);
    try {
      await clientService.consultations.reschedule(rescheduleC.id, rsDate, rsTime);
      toast.success(t('consultations.rescheduleOk'));
      setRescheduleC(null);
      fetchConsultations();
    } catch (e) {
      toast.error(e.response?.data?.error || t('consultations.rescheduleErr'));
    } finally {
      setRsLoading(false);
    }
  };

  const handleSubmitRating = async ({ rating, text }) => {
    if (!ratingConsultation) return;
    await clientLawyerService.leaveReview(ratingConsultation.lawyerId || ratingConsultation.lawyer?.id, {
      consultationId: ratingConsultation.id,
      rating,
      text,
    });
    toast.success(t('consultations.reviewThanks'));
    fetchConsultations();
  };

  const tabs = [
    { key: 'all', label: t('consultations.tabAll') },
    { key: 'payment_pending', label: t('consultations.tabPaymentPending') },
    { key: 'upcoming', label: t('consultations.tabUpcoming') },
    { key: 'completed', label: t('consultations.tabCompleted') },
    { key: 'cancelled', label: t('consultations.tabCancelled') },
    { key: 'archived', label: t('consultations.tabArchive') },
  ];

  const tabBtn = (active) => ({
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#FFFFFF' : 'var(--text2)',
    border: 'none',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: '0.04em',
    padding: '10px 18px',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'background 0.2s, color 0.2s',
  });

  const handlePay = async (consultation) => {
    setPaymentLoading(consultation.id);
    try {
      const result = await clientService.lawyers.payConsultation(consultation.id);
      if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
      toast.success(t('consultations.paymentSuccess'));
      await fetchConsultations();
    } catch (error) {
      toast.error(error.response?.data?.error || t('consultations.paymentError'));
    } finally {
      setPaymentLoading(null);
    }
  };

  const addToCalendar = (consultation) => {
    const start = new Date(consultation.scheduledStartAt);
    const end = new Date(consultation.scheduledEndAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const fmt = (value) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const esc = (value) => String(value || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const content = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//eMaslaXat//Consultation//RU', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', `UID:${consultation.id}@maslaxat.uz`, `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`${t('consultations.calendarTitle')} — ${consultation.lawyer?.name || ''}`)}`,
      `DESCRIPTION:${esc(consultation.question || '')}`, 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `consultation-${consultation.id}.ics`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };

  const countdownText = (consultation) => {
    if (consultation.status === 'payment_pending' && consultation.paymentExpiresAt) {
      const remaining = new Date(consultation.paymentExpiresAt).getTime() - now;
      return remaining <= 0
        ? t('consultations.paymentExpired')
        : t('consultations.paymentExpiresIn', { minutes: Math.max(1, Math.ceil(remaining / 60000)) });
    }
    const start = new Date(consultation.scheduledStartAt).getTime();
    const end = new Date(consultation.scheduledEndAt).getTime();
    if (!Number.isFinite(start)) return '';
    if (Number.isFinite(end) && now >= start && now <= end) return t('consultations.countdownNow');
    const diff = start - now;
    if (diff <= 0) return '';
    const hours = Math.ceil(diff / 3600000);
    if (hours <= 24) return t('consultations.countdownHours', { hours });
    return t('consultations.countdownDate', {
      date: new Date(start).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      time: new Date(start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    });
  };

  const renderCard = (c, i) => {
    const name = c.lawyer?.name || t('consultations.lawyer');
    const st = STATUS[c.status] || STATUS.pending;
    const spec = c.lawyer?.profile?.specialization || c.lawyer?.specialization || t('consultations.lawyer');
    const rating = c.lawyer?.profile?.rating || c.lawyer?.rating || 0;
    const question = c.question || c.topic || '';
    const isVideo = c.type === 'video';
    const dateValue = c.scheduledStartAt || c.preferredDate || c.date || c.createdAt;
    const dateStr = new Date(dateValue).toLocaleDateString(locale);
    const timeStr = c.preferredTime || c.time || '';
    const when = timeStr ? `${dateStr} · ${timeStr}` : dateStr;
    const price = (c.price || 0).toLocaleString(locale);

    const rated = isRated(c);
    const canJoin = ['accepted', 'in_progress'].includes(c.status) && c.access?.canJoin === true;
    const joinDisabledReason = c.access?.reason === 'TOO_EARLY' && c.access?.retryAt
      ? t('consultations.joinOpensAt', { time: new Date(c.access.retryAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })
      : t('consultations.joinUnavailable');
    const canComplete = ['accepted', 'in_progress'].includes(c.status);
    const canCancel = ['payment_pending', 'accepted', 'pending'].includes(c.status);
    const paymentExpired = c.status === 'payment_pending' && c.paymentExpiresAt && new Date(c.paymentExpiresAt).getTime() <= now;
    const canPay = c.status === 'payment_pending' && !paymentExpired;
    // Оценивать можно только завершённую и ещё не оценённую (признак — Review, не c.rating).
    const canRate = c.status === 'completed' && !rated;
    const canRebook = (c.status === 'completed' || paymentExpired) && Boolean(c.lawyer);
    // История переписки доступна после завершения/отмены (read-only)
    const canChatHistory = ['completed', 'cancelled', 'rejected'].includes(c.status);
    // Перенос — пока консультация не началась/не завершена
    const canReschedule = ['payment_pending', 'pending', 'accepted'].includes(c.status);
    // Документы по делу — доступны с момента подтверждения и в архиве (общая папка)
    const canDocs = ['accepted', 'in_progress', 'completed'].includes(c.status);

    const canCalendar = ['payment_pending', 'pending', 'accepted'].includes(c.status) && c.scheduledStartAt && c.scheduledEndAt;
    const hasActions = canPay || canJoin || ['accepted', 'in_progress'].includes(c.status) || canComplete || canRate || canCancel || canRebook || canChatHistory || canReschedule || canDocs || canCalendar;
    const StatusIcon = st.icon;

    return (
      <div key={c.id} style={{ ...glassCard, overflow: 'hidden' }}>
        {/* Статусный хедер: цвет по статусу, иконка + название, дата справа */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 20px', background: st.bg, color: st.color, fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          <StatusIcon sx={{ fontSize: 15 }} />
          {t('consultations.' + st.key)}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, textTransform: 'none', letterSpacing: 0, opacity: 0.92 }}>
            <CalendarMonthOutlined sx={{ fontSize: 14 }} /> {when}
          </span>
        </div>

        <div role="button" tabIndex={0} onClick={() => navigate(`/consultations/${c.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/consultations/${c.id}`); }} style={{ padding: '16px 20px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                background: AV_BG[i % AV_BG.length],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#FFFFFF', fontSize: 16,
              }}
            >
              {initialsOf(name)}
            </div>

            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{name}</div>

              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>
                {spec} · ★ {rating}
              </div>

              {question && (
                <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, margin: '12px 0' }}>
                  «{question}»
                </p>
              )}

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, color: 'var(--text2)', marginTop: question ? 0 : 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {isVideo ? <VideocamOutlined sx={{ fontSize: 16 }} /> : <ChatBubbleOutline sx={{ fontSize: 16 }} />}
                  {isVideo ? t('consultations.typeVideo') : t('consultations.typeChat')}
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{price} {t('consultations.sum')}</span>
                <span>{t(`consultations.payment_${c.payment?.status || 'unpaid'}`)}</span>
                {c.payment?.paidAt && <span>{new Date(c.payment.paidAt).toLocaleDateString(locale)}</span>}
                {c.actualDuration > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AccessTimeRounded sx={{ fontSize: 16 }} />
                    {t('consultations.callDuration')}: {Math.floor(c.actualDuration / 60)}:{String(c.actualDuration % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              {countdownText(c) && <div style={{ marginTop: 10, color: 'var(--accent-dark)', fontSize: 13, fontWeight: 600 }}>{countdownText(c)}</div>}

              {/* Архив: показываем оценку, которую поставил клиент (звёзды + текст) */}
              {rated && c.consultationReview && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--canvas)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: c.consultationReview.text ? 6 : 0 }}>
                    <span style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)' }}>
                      {t('consultations.yourRating')}
                    </span>
                    <span style={{ color: 'var(--accent)', fontSize: 14, letterSpacing: 1 }}>
                      {'★'.repeat(c.consultationReview.rating)}
                      <span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(Math.max(0, 5 - c.consultationReview.rating))}</span>
                    </span>
                  </div>
                  {c.consultationReview.text && (
                    <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}>
                      «{c.consultationReview.text}»
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Таймлайн статуса — понятно, где бронь и что дальше */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <ConsultationTimeline status={c.status} role="client" />
        </div>

        {hasActions && (
          <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
            {canPay && (
              <button className="cons-foot-btn" onClick={() => handlePay(c)} disabled={paymentLoading === c.id} style={{ color: '#B06A35' }}>
                <PaymentOutlined sx={{ fontSize: 17 }} /> {paymentLoading === c.id ? t('consultations.paying') : t('consultations.pay')}
              </button>
            )}
            {['accepted', 'in_progress'].includes(c.status) && (
              <Tooltip title={canJoin ? '' : joinDisabledReason}>
                <span style={{ flex: 1, display: 'flex' }}>
              <button className="cons-foot-btn" onClick={() => handleJoinConsultation(c)} disabled={actionLoading || !canJoin} style={{ color: '#C0492F', width: '100%' }}>
                {isVideo ? <CallOutlined sx={{ fontSize: 17 }} /> : <ChatBubbleOutline sx={{ fontSize: 17 }} />}
                {isVideo ? (c.status === 'in_progress' ? t('consultations.joinCall') : t('consultations.call')) : t('consultations.openChat')}
              </button>
                </span>
              </Tooltip>
            )}
            {canCalendar && (
              <button className="cons-foot-btn" onClick={() => addToCalendar(c)} style={{ color: 'var(--text2)' }}>
                <EventAvailableOutlined sx={{ fontSize: 17 }} /> {t('consultations.addCalendar')}
              </button>
            )}
            {canComplete && (
              <button className="cons-foot-btn" onClick={() => handleCompleteConsultation(c)} disabled={actionLoading} style={{ color: '#C0492F' }}>
                <CheckOutlined sx={{ fontSize: 17 }} />
                {t('consultations.complete')}
              </button>
            )}
            {canReschedule && (
              <button className="cons-foot-btn" onClick={() => openReschedule(c)} style={{ color: 'var(--text2)' }}>
                <EventRepeatOutlined sx={{ fontSize: 16 }} />
                {t('consultations.reschedule')}
              </button>
            )}
            {canRate && (
              <button className="cons-foot-btn" onClick={() => openRatingDialog(c)} style={{ color: 'var(--accent-dark)' }}>
                {t('consultations.rate')}
              </button>
            )}
            {canRebook && (
              <button className="cons-foot-btn" onClick={() => setRebookLawyer(c.lawyer)} style={{ color: 'var(--accent)' }}>
                <ReplayOutlined sx={{ fontSize: 17 }} />
                {t('consultations.rebook')}
              </button>
            )}
            {canChatHistory && (
              <button className="cons-foot-btn" onClick={() => navigate(`/consultations/chat/${c.id}`)} style={{ color: 'var(--text2)' }}>
                <ChatBubbleOutline sx={{ fontSize: 16 }} />
                {t('consultations.chatHistory')}
              </button>
            )}
            {canDocs && (
              <button className="cons-foot-btn" onClick={() => setDocsFor(c)} style={{ color: 'var(--accent-dark)' }}>
                <FolderOpenOutlined sx={{ fontSize: 16 }} />
                {t('caseDocs.title')}
              </button>
            )}
            {canCancel && (
              <button className="cons-foot-btn" onClick={() => openCancelDialog(c)} disabled={actionLoading} style={{ color: 'var(--text3)' }}>
                {c.status === 'pending' ? t('consultations.cancelRequest') : t('consultations.cancel')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const emptyStates = {
    all: { title: t('consultations.emptyAllTitle'), sub: t('consultations.emptyAllSub'), action: true },
    payment_pending: { title: t('consultations.emptyPaymentTitle'), sub: t('consultations.emptyPaymentSub') },
    upcoming: { title: t('consultations.emptyUpcomingTitle'), sub: t('consultations.emptyUpcomingSub'), action: true },
    completed: { title: t('consultations.emptyCompletedTitle'), sub: t('consultations.emptyCompletedSub') },
    cancelled: { title: t('consultations.emptyCancelledTitle'), sub: t('consultations.emptyCancelledSub') },
    archived: { title: t('consultations.emptyArchiveTitle'), sub: t('consultations.emptyArchiveSub') },
  };
  const empty = debouncedSearch
    ? { title: t('consultations.emptySearchTitle'), sub: t('consultations.emptySearchSub') }
    : emptyStates[currentTab];

  return (
    <GlassShell active="/consultations" title={t('consultations.title')} subtitle={t('consultations.subtitle')}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Top row: tabs + Book New */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div
            className="cons-tabs"
            style={{
              display: 'flex', gap: 4, ...glassCard, padding: 5,
              maxWidth: '100%', overflowX: 'auto', scrollbarWidth: 'none',
            }}
          >
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => { setCurrentTab(tab.key); setPage(1); }} style={tabBtn(currentTab === tab.key)}>
                {tab.label} ({counts[tab.key] || 0})
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate('/lawyers')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'var(--accent)', color: '#FFFFFF', border: 'none',
              fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <AddOutlined sx={{ fontSize: 18 }} /> {t('consultations.book')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <TextField
            size="small" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder={t('consultations.searchPlaceholder')}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined sx={{ fontSize: 18 }} /></InputAdornment> }}
            sx={{ flex: '1 1 260px' }}
          />
          <select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }} aria-label={t('consultations.periodLabel')} style={{ minHeight: 40, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="all">{t('consultations.periodAll')}</option>
            <option value="30d">{t('consultations.period30')}</option>
            <option value="365d">{t('consultations.period365')}</option>
          </select>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} avatar={false} lines={3} />)}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={fetchConsultations} />
        ) : consultations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {consultations.map((c, i) => renderCard(c, i))}
            {totalPages > 1 && <Pagination count={totalPages} page={page} onChange={(_, value) => setPage(value)} sx={{ alignSelf: 'center', mt: 1 }} />}
          </div>
        ) : (
          <EmptyState title={empty.title} subtitle={empty.sub} actionLabel={empty.action ? t('consultations.findLawyer') : undefined} onAction={empty.action ? () => navigate('/lawyers') : undefined} />
        )}
      </div>

      {/* Rating Dialog */}
      <RatingDialog
        open={ratingDialogOpen}
        onClose={() => { setRatingDialogOpen(false); setRatingConsultation(null); }}
        onSubmit={handleSubmitRating}
        lawyerName={ratingConsultation?.lawyer?.name}
      />

      {/* Cancel Dialog */}
      <Dialog
        open={cancelDialogOpen}
        onClose={closeCancelDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 'var(--radius)',
            background: 'var(--card-glass)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid var(--card-brd)',
            boxShadow: 'var(--card-shadow)',
            color: 'var(--text)',
          },
        }}
      >
        <DialogTitle>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 300, fontSize: 18, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
              {t('consultations.cancelModalTitle')}
            </span>
            <IconButton onClick={closeCancelDialog} size="small">
              <CloseOutlined sx={{ color: 'var(--text3)', fontSize: 20 }} />
            </IconButton>
          </div>
        </DialogTitle>
        <DialogContent>
          {selectedConsultation && (
            <div style={{ marginBottom: 20, padding: 16, borderRadius: 'var(--radius)', background: 'var(--canvas)', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                {t('consultations.consultationWith')}
              </div>
              <div style={{ fontWeight: 500, color: 'var(--text)' }}>
                {selectedConsultation.lawyer?.name || t('consultations.lawyer')}
              </div>
              <div style={{ color: 'var(--text3)', fontSize: 13, marginTop: 2 }}>
                {new Date(selectedConsultation.scheduledStartAt || selectedConsultation.preferredDate || selectedConsultation.date || selectedConsultation.createdAt).toLocaleDateString(locale)}
                {(selectedConsultation.preferredTime || selectedConsultation.time) ? ` · ${selectedConsultation.preferredTime || selectedConsultation.time}` : ''}
              </div>
            </div>
          )}
          <TextField
            label={t('consultations.cancelReasonLabel')}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            multiline
            rows={4}
            fullWidth
            placeholder={t('consultations.cancelReasonPlaceholder')}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 'var(--radius)',
                '& fieldset': { borderColor: 'var(--border)' },
                '&:hover fieldset': { borderColor: 'var(--accent)' },
                '&.Mui-focused fieldset': { borderColor: 'var(--accent)', borderWidth: 1 },
              },
              '& .MuiInputBase-input': { color: 'var(--text)' },
              '& .MuiInputLabel-root': { color: 'var(--text3)' },
              '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent)' },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            onClick={closeCancelDialog}
            sx={{
              color: 'var(--text2)',
              border: '1px solid var(--border)',
              fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em',
              fontSize: '0.72rem', borderRadius: 'var(--radius)', px: 3, py: 1,
              '&:hover': { borderColor: 'var(--accent)', bgcolor: 'transparent' },
            }}
          >
            {t('consultations.back')}
          </Button>
          <Button
            onClick={handleCancelConsultation}
            disabled={!cancelReason.trim() || actionLoading}
            sx={{
              bgcolor: '#B07070', color: '#FFFFFF',
              fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em',
              fontSize: '0.72rem', borderRadius: 'var(--radius)', px: 3, py: 1, boxShadow: 'none',
              '&:hover': { bgcolor: '#9A5A5A', boxShadow: 'none' },
              '&:disabled': { bgcolor: 'var(--border)', color: 'var(--text3)' },
            }}
          >
            {t('consultations.cancelConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <style>{`
        .cons-foot-btn{
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 14px; background: transparent; border: none; border-right: 1px solid var(--border);
          font-family: inherit; font-size: 12px; font-weight: 500; letter-spacing: 0.05em;
          text-transform: uppercase; cursor: pointer; transition: background .15s ease;
        }
        .cons-foot-btn:last-child{ border-right: none; }
        .cons-foot-btn:hover{ background: rgba(184,149,110,0.09); }
        .cons-foot-btn:disabled{ opacity: .55; cursor: default; }
        .cons-tabs::-webkit-scrollbar{ display: none; }
      `}</style>

      {/* Записаться снова — открываем окно брони с тем же юристом */}
      <BookingModal
        open={Boolean(rebookLawyer)}
        onClose={() => setRebookLawyer(null)}
        lawyer={rebookLawyer || {}}
      />

      {/* Перенос времени консультации */}
      <Dialog open={Boolean(rescheduleC)} onClose={() => setRescheduleC(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 500 }}>{t('consultations.reschedule')}</DialogTitle>
        <DialogContent>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t('consultations.rescheduleSub')}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{t('consultations.newDate')}</div>
              <input type="date" value={rsDate} onChange={(e) => setRsDate(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{t('consultations.newTime')}</div>
              <input type="time" value={rsTime} onChange={(e) => setRsTime(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }} />
            </div>
          </div>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <button className="cons-foot-btn" style={{ flex: 'none', border: 'none', padding: '10px 18px', color: 'var(--text3)' }} onClick={() => setRescheduleC(null)}>
            {t('consultations.cancel')}
          </button>
          <button
            onClick={submitReschedule}
            disabled={rsLoading || !rsDate || !rsTime}
            style={{ border: 'none', padding: '10px 22px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: (rsLoading || !rsDate || !rsTime) ? 'default' : 'pointer', opacity: (rsLoading || !rsDate || !rsTime) ? 0.6 : 1 }}
          >
            {rsLoading ? t('consultations.rescheduleSaving') : t('consultations.rescheduleSave')}
          </button>
        </DialogActions>
      </Dialog>

      {/* Документы по делу — общая папка юриста и клиента */}
      <CaseDocuments
        consultationId={docsFor?.id}
        open={Boolean(docsFor)}
        onClose={() => setDocsFor(null)}
        currentUserId={user?.id}
      />
    </GlassShell>
  );
};

export default ConsultationsPageGlass;
