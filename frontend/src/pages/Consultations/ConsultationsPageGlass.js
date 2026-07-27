import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Button,
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
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import { clientLawyerService } from '../../services/clientService';
import RatingDialog from '../../components/UI/RatingDialog';
import BookingModal from '../../components/BookingModal';
import { SkeletonCard } from '../../components/UI/Skeleton';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';

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
};

const ConsultationsPageGlass = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [currentTab, setCurrentTab] = useState(0);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [ratingConsultation, setRatingConsultation] = useState(null);
  const [rebookLawyer, setRebookLawyer] = useState(null);
  const [rescheduleC, setRescheduleC] = useState(null);
  const [rsDate, setRsDate] = useState('');
  const [rsTime, setRsTime] = useState('');
  const [rsLoading, setRsLoading] = useState(false);

  useEffect(() => {
    fetchConsultations();
  }, []);

  const fetchConsultations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await clientService.consultations.getConsultations('all');
      // Дедупликация по id: hasOne-include (consultationReview) при дублирующихся
      // Review-строках может задвоить консультацию — держим по одной записи на id.
      const list = Array.isArray(data) ? data : [];
      const seen = new Set();
      const unique = list.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
      setConsultations(unique);
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

  const getFilteredConsultations = () => {
    switch (currentTab) {
      case 0: // Все
        return consultations;
      case 1: // Предстоящие
        return consultations.filter((c) => ['accepted', 'pending', 'in_progress'].includes(c.status));
      case 2: // Завершённые — завершено, но ещё не оценено (очередь на «Оценить»)
        return consultations.filter((c) => c.status === 'completed' && !isRated(c));
      case 3: // Отменённые
        return consultations.filter((c) => ['cancelled', 'rejected'].includes(c.status));
      case 4: // Архив — завершено и уже оценено
        return consultations.filter((c) => c.status === 'completed' && isRated(c));
      default:
        return consultations;
    }
  };

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

  const handleJoinConsultation = (consultation) => {
    // Просто открываем комнату. В in_progress переводим только когда стороны
    // реально соединились (видео — по peer-connect на странице звонка), чтобы
    // «дозвон без ответа» не завершал консультацию и не выплачивал юристу.
    if (consultation.type === 'video') {
      navigate(`/consultations/video/${consultation.id}`);
    } else {
      navigate(`/consultations/chat/${consultation.id}`);
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

  const getTabCounts = () => ({
    all: consultations.length,
    upcoming: consultations.filter((c) => ['accepted', 'pending', 'in_progress'].includes(c.status)).length,
    completed: consultations.filter((c) => c.status === 'completed' && !isRated(c)).length,
    cancelled: consultations.filter((c) => ['cancelled', 'rejected'].includes(c.status)).length,
    archived: consultations.filter((c) => c.status === 'completed' && isRated(c)).length,
  });

  const tabCounts = getTabCounts();
  const filteredConsultations = getFilteredConsultations();

  const tabs = [
    `${t('consultations.tabAll')} (${tabCounts.all})`,
    `${t('consultations.tabUpcoming')} (${tabCounts.upcoming})`,
    `${t('consultations.tabCompleted')} (${tabCounts.completed})`,
    `${t('consultations.tabCancelled')} (${tabCounts.cancelled})`,
    `${t('consultations.tabArchive')} (${tabCounts.archived})`,
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

  const renderCard = (c, i) => {
    const name = c.lawyer?.name || t('consultations.lawyer');
    const st = STATUS[c.status] || STATUS.pending;
    const spec = c.lawyer?.profile?.specialization || c.lawyer?.specialization || t('consultations.lawyer');
    const rating = c.lawyer?.profile?.rating || c.lawyer?.rating || 0;
    const question = c.question || c.topic || '';
    const isVideo = c.type === 'video';
    const dateStr = new Date(c.preferredDate || c.date || c.createdAt).toLocaleDateString('ru-RU');
    const timeStr = c.preferredTime || c.time || '';
    const when = timeStr ? `${dateStr} · ${timeStr}` : dateStr;
    const price = (c.price || 0).toLocaleString('ru-RU');

    const rated = isRated(c);
    const canJoin = ['accepted', 'in_progress'].includes(c.status);
    const canComplete = ['accepted', 'in_progress'].includes(c.status);
    const canCancel = ['accepted', 'pending', 'in_progress'].includes(c.status);
    // Оценивать можно только завершённую и ещё не оценённую (признак — Review, не c.rating).
    const canRate = c.status === 'completed' && !rated;
    const canRebook = c.status === 'completed' && Boolean(c.lawyer);
    // История переписки доступна после завершения/отмены (read-only)
    const canChatHistory = ['completed', 'cancelled', 'rejected'].includes(c.status);
    // Перенос — пока консультация не началась/не завершена
    const canReschedule = ['payment_pending', 'pending', 'accepted'].includes(c.status);

    const hasActions = canJoin || canComplete || canRate || canCancel || canRebook || canChatHistory || canReschedule;
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

        <div style={{ padding: '16px 20px' }}>
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
                {c.actualDuration > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AccessTimeRounded sx={{ fontSize: 16 }} />
                    {t('consultations.callDuration')}: {Math.floor(c.actualDuration / 60)}:{String(c.actualDuration % 60).padStart(2, '0')}
                  </span>
                )}
              </div>

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

        {hasActions && (
          <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
            {canJoin && (
              <button className="cons-foot-btn" onClick={() => handleJoinConsultation(c)} disabled={actionLoading} style={{ color: '#C0492F' }}>
                {isVideo ? <CallOutlined sx={{ fontSize: 17 }} /> : <ChatBubbleOutline sx={{ fontSize: 17 }} />}
                {isVideo ? (c.status === 'in_progress' ? t('consultations.joinCall') : t('consultations.call')) : t('consultations.openChat')}
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
            {tabs.map((label, idx) => (
              <button key={idx} onClick={() => setCurrentTab(idx)} style={tabBtn(currentTab === idx)}>
                {label}
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

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} avatar={false} lines={3} />)}
          </div>
        ) : error ? (
          <div style={{ ...glassCard, padding: 32, textAlign: 'center', color: '#B07070', fontSize: 14 }}>
            {error}
          </div>
        ) : filteredConsultations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filteredConsultations.map((c, i) => renderCard(c, i))}
          </div>
        ) : (
          <div style={{ ...glassCard, padding: '56px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 300, color: 'var(--text)', marginBottom: 6 }}>
              {t('consultations.emptyTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
              {t('consultations.emptySub')}
            </div>
            <button
              onClick={() => navigate('/lawyers')}
              style={{
                background: 'var(--accent)', color: '#FFFFFF', border: 'none',
                fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {t('consultations.findLawyer')} →
            </button>
          </div>
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
                {new Date(selectedConsultation.preferredDate || selectedConsultation.date || selectedConsultation.createdAt).toLocaleDateString('ru-RU')}
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
    </GlassShell>
  );
};

export default ConsultationsPageGlass;
