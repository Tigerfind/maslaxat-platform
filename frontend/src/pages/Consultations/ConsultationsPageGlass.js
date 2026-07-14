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
  ChatBubbleOutline,
  AddOutlined,
  CloseOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import { clientLawyerService } from '../../services/clientService';
import RatingDialog from '../../components/UI/RatingDialog';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';

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
  accepted: { label: 'Подтверждено', color: '#7A9A6B', bg: 'rgba(122,154,107,0.14)' },
  pending: { label: 'Ожидание', color: '#C4A35A', bg: 'rgba(196,163,90,0.14)' },
  in_progress: { label: 'В процессе', color: 'var(--accent)', bg: 'rgba(184,149,110,0.14)' },
  completed: { label: 'Завершено', color: '#6A8A9A', bg: 'rgba(106,138,154,0.14)' },
  rejected: { label: 'Отклонено', color: '#B07070', bg: 'rgba(176,112,112,0.14)' },
  cancelled: { label: 'Отменено', color: '#B07070', bg: 'rgba(176,112,112,0.14)' },
};

const ConsultationsPageGlass = () => {
  const navigate = useNavigate();

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

  useEffect(() => {
    fetchConsultations();
  }, []);

  const fetchConsultations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await clientService.consultations.getConsultations('all');
      setConsultations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching consultations:', err);
      setError('Не удалось загрузить консультации');
      setConsultations([]);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredConsultations = () => {
    if (currentTab === 0) return consultations;
    const statusMap = {
      1: ['accepted', 'pending', 'in_progress'],
      2: ['completed'],
      3: ['cancelled', 'rejected'],
    };
    const allowedStatuses = statusMap[currentTab] || [];
    return consultations.filter((c) => allowedStatuses.includes(c.status));
  };

  const handleCancelConsultation = async () => {
    if (!selectedConsultation || !cancelReason.trim()) {
      toast.error('Пожалуйста, укажите причину отмены');
      return;
    }
    try {
      setActionLoading(true);
      await clientService.consultations.cancelConsultation(selectedConsultation.id, cancelReason);
      toast.success('Консультация успешно отменена');
      setCancelDialogOpen(false);
      setCancelReason('');
      setSelectedConsultation(null);
      fetchConsultations();
    } catch (err) {
      console.error('Error canceling consultation:', err);
      toast.error('Не удалось отменить консультацию');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinConsultation = async (consultation) => {
    try {
      setActionLoading(true);
      await clientService.consultations.joinConsultation(consultation.id);
      if (consultation.type === 'video') {
        navigate(`/consultations/video/${consultation.id}`);
      } else {
        navigate(`/consultations/chat/${consultation.id}`);
      }
    } catch (err) {
      console.error('Error joining consultation:', err);
      toast.error('Не удалось присоединиться к консультации');
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

  const handleSubmitRating = async ({ rating, text }) => {
    if (!ratingConsultation) return;
    await clientLawyerService.leaveReview(ratingConsultation.lawyerId || ratingConsultation.lawyer?.id, {
      consultationId: ratingConsultation.id,
      rating,
      text,
    });
    toast.success('Спасибо за отзыв!');
    fetchConsultations();
  };

  const getTabCounts = () => ({
    all: consultations.length,
    upcoming: consultations.filter((c) => ['accepted', 'pending', 'in_progress'].includes(c.status)).length,
    completed: consultations.filter((c) => c.status === 'completed').length,
    cancelled: consultations.filter((c) => ['cancelled', 'rejected'].includes(c.status)).length,
  });

  const tabCounts = getTabCounts();
  const filteredConsultations = getFilteredConsultations();

  const tabs = [
    `Все (${tabCounts.all})`,
    `Предстоящие (${tabCounts.upcoming})`,
    `Завершённые (${tabCounts.completed})`,
    `Отменённые (${tabCounts.cancelled})`,
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
    transition: 'background 0.2s, color 0.2s',
  });

  const renderCard = (c, i) => {
    const name = c.lawyer?.name || 'Юрист';
    const st = STATUS[c.status] || STATUS.pending;
    const spec = c.lawyer?.profile?.specialization || c.lawyer?.specialization || 'Юрист';
    const rating = c.lawyer?.profile?.rating || c.lawyer?.rating || 0;
    const question = c.question || c.topic || '';
    const isVideo = c.type === 'video';
    const dateStr = new Date(c.preferredDate || c.date || c.createdAt).toLocaleDateString('ru-RU');
    const timeStr = c.preferredTime || c.time || '';
    const when = timeStr ? `${dateStr} · ${timeStr}` : dateStr;
    const price = (c.price || 0).toLocaleString('ru-RU');

    const canJoin = ['accepted', 'in_progress'].includes(c.status);
    const canCancel = ['accepted', 'pending', 'in_progress'].includes(c.status);
    const canRate = c.status === 'completed' && !c.rating;

    return (
      <div key={c.id} style={{ ...glassCard, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
              background: AV_BG[i % AV_BG.length],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFFFFF', fontSize: 17,
            }}
          >
            {initialsOf(name)}
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{name}</div>
              <span
                style={{
                  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: st.color, background: st.bg, padding: '4px 10px', borderRadius: 'var(--radius)',
                }}
              >
                {st.label}
              </span>
            </div>

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
                <CalendarMonthOutlined sx={{ fontSize: 16 }} /> {when}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {isVideo ? <VideocamOutlined sx={{ fontSize: 16 }} /> : <ChatBubbleOutline sx={{ fontSize: 16 }} />}
                {isVideo ? 'Видео' : 'Чат'}
              </span>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{price} сум</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {canJoin && (
              <button
                onClick={() => handleJoinConsultation(c)}
                disabled={actionLoading}
                style={{
                  background: '#1A1A1A', color: '#FFFFFF', border: 'none',
                  fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase',
                  padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {isVideo ? 'Войти в видео' : 'Открыть чат'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => openCancelDialog(c)}
                disabled={actionLoading}
                style={{
                  background: 'transparent', border: 'none', color: '#B07070',
                  fontSize: 12, letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {c.status === 'pending' ? 'Отменить запрос' : 'Отменить'}
              </button>
            )}
            {canRate && (
              <button
                onClick={() => openRatingDialog(c)}
                style={{
                  background: 'transparent', border: '1px solid var(--accent)', color: 'var(--text)',
                  fontSize: 12, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                  padding: '11px 20px', borderRadius: 'var(--radius)', cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                Оценить
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <GlassShell active="/consultations" title="Консультации" subtitle="Управляйте своими юридическими консультациями">
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Top row: tabs + Book New */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex', gap: 4, ...glassCard, padding: 5, width: 'fit-content',
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
            <AddOutlined sx={{ fontSize: 18 }} /> Записаться
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ ...glassCard, padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Загрузка…
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
              Консультаций не найдено
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
              У вас пока нет консультаций в этой категории
            </div>
            <button
              onClick={() => navigate('/lawyers')}
              style={{
                background: 'var(--accent)', color: '#FFFFFF', border: 'none',
                fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Найти юриста →
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
              Отмена консультации
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
                Консультация с:
              </div>
              <div style={{ fontWeight: 500, color: 'var(--text)' }}>
                {selectedConsultation.lawyer?.name || 'Юрист'}
              </div>
              <div style={{ color: 'var(--text3)', fontSize: 13, marginTop: 2 }}>
                {new Date(selectedConsultation.preferredDate || selectedConsultation.date || selectedConsultation.createdAt).toLocaleDateString('ru-RU')}
                {(selectedConsultation.preferredTime || selectedConsultation.time) ? ` в ${selectedConsultation.preferredTime || selectedConsultation.time}` : ''}
              </div>
            </div>
          )}
          <TextField
            label="Причина отмены"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            multiline
            rows={4}
            fullWidth
            placeholder="Пожалуйста, укажите причину отмены консультации..."
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
            Назад
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
            Отменить консультацию
          </Button>
        </DialogActions>
      </Dialog>
    </GlassShell>
  );
};

export default ConsultationsPageGlass;
