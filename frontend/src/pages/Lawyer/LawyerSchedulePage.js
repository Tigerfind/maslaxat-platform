import React, { useState, useEffect, useCallback } from 'react';
import {
  VideocamOutlined,
  ChatBubbleOutline,
  CheckOutlined,
  CloseOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
import GlassShell from '../../components/GlassKit/GlassShell';

/*
  ─────────────────────────────────────────────────────────────
  LAWYER SCHEDULE  (/lawyer/schedule)
  Ported 1:1 from ClaudeDesign → LawyerApp "SCHEDULE".
   • Monthly calendar (RU names) with day-dots for events
     ← lawyerService.schedule.getSchedule(year, month)
   • Right panel = selected day's events (time / type / client / topic)
     pending → Принять / Отклонить
       → lawyerService.schedule.confirmConsultation / rejectConsultation
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

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const navArrowBtn = {
  width: 34,
  height: 34,
  border: '1px solid var(--border)',
  background: 'transparent',
  borderRadius: 'var(--radius)',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const LawyerSchedulePage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);

  const loadSchedule = useCallback(async () => {
    try {
      setLoading(true);
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const data = await lawyerService.schedule.getSchedule(year, month);
      setEvents(data.events || {});
    } catch (error) {
      console.error('Error loading schedule:', error);
      setEvents({});
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    return { daysInMonth, startingDayOfWeek };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const dateStrOf = (day) =>
    `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const handleDateClick = (day) => setSelectedDate(dateStrOf(day));

  const eventCount = (day) => events[dateStrOf(day)]?.length || 0;

  const handleConfirm = async (eventId) => {
    try {
      await lawyerService.schedule.confirmConsultation(eventId);
      toast.success('Консультация подтверждена');
      loadSchedule();
    } catch {
      toast.error('Ошибка подтверждения');
    }
  };

  const handleReject = async (eventId) => {
    try {
      await lawyerService.schedule.rejectConsultation(eventId);
      toast.info('Консультация отклонена');
      loadSchedule();
    } catch {
      toast.error('Ошибка отклонения');
    }
  };

  const dayEvents = (selectedDate && events[selectedDate]) || [];
  const selectedLabel = selectedDate
    ? `${Number(selectedDate.split('-')[2])} ${MONTHS_GEN[Number(selectedDate.split('-')[1]) - 1]}`
    : 'Выберите дату';
  const selectedSub = !selectedDate
    ? 'Нажмите на дату в календаре'
    : dayEvents.length
      ? `${dayEvents.length} ${dayEvents.length === 1 ? 'консультация' : 'консультаций'}`
      : 'Свободный день';

  return (
    <GlassShell active="/lawyer/schedule" title="Расписание" subtitle="Календарь консультаций" role="lawyer">
      <div
        className="sched-grid"
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* CALENDAR */}
        <div style={{ ...glassCard, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div style={{ fontSize: 18, fontWeight: 400, letterSpacing: '0.04em', color: 'var(--text)' }}>
              {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handlePrevMonth} style={navArrowBtn} aria-label="Предыдущий месяц">‹</button>
              <button onClick={handleNextMonth} style={navArrowBtn} aria-label="Следующий месяц">›</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
            {DAYS.map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text3)', padding: '6px 0' }}>
                {w}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {[...Array(startingDayOfWeek)].map((_, index) => (
              <div key={`empty-${index}`} style={{ aspectRatio: '1' }} />
            ))}

            {[...Array(loading ? 0 : daysInMonth)].map((_, index) => {
              const day = index + 1;
              const dateStr = dateStrOf(day);
              const isSelected = selectedDate === dateStr;
              const count = eventCount(day);
              return (
                <button
                  key={day}
                  onClick={() => handleDateClick(day)}
                  style={{
                    aspectRatio: '1',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    cursor: 'pointer',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                    background: isSelected ? 'rgba(184,149,110,0.12)' : 'transparent',
                    color: isSelected ? 'var(--text)' : 'var(--text2)',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  <span>{day}</span>
                  {count > 0 && (
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: count >= 2 ? 'var(--accent)' : 'var(--info)',
                        marginTop: 3,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* SELECTED DAY EVENTS */}
        <div style={{ ...glassCard, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{selectedLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>{selectedSub}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {loading ? (
              <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>Загрузка…</div>
            ) : dayEvents.length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
                Нет консультаций в этот день
              </div>
            ) : (
              dayEvents.map((e) => {
                const isVideo = e.type === 'video';
                const accent = isVideo ? 'var(--accent)' : 'var(--info)';
                const isPending = e.status === 'pending';
                return (
                  <div
                    key={e.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: 15,
                      borderLeft: `3px solid ${accent}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{e.time}</div>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: accent }}>
                        {isVideo ? <VideocamOutlined sx={{ fontSize: 14 }} /> : <ChatBubbleOutline sx={{ fontSize: 14 }} />}
                        {isVideo ? 'Видео' : 'Чат'}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text)' }}>{e.client}</div>
                    <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>{e.topic}</div>

                    {isPending && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button
                          onClick={() => handleConfirm(e.id)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            background: 'var(--accent)',
                            color: '#FFFFFF',
                            border: 'none',
                            fontSize: 12,
                            fontWeight: 500,
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <CheckOutlined sx={{ fontSize: 16 }} /> Принять
                        </button>
                        <button
                          onClick={() => handleReject(e.id)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            background: 'transparent',
                            color: 'var(--error)',
                            border: '1px solid var(--error)',
                            fontSize: 12,
                            fontWeight: 500,
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <CloseOutlined sx={{ fontSize: 16 }} /> Отклонить
                        </button>
                      </div>
                    )}

                    {(e.status === 'accepted' || e.status === 'confirmed') && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--success)', background: 'rgba(122,154,107,0.12)', padding: '7px 12px', borderRadius: 'var(--radius)' }}>
                        <CheckOutlined sx={{ fontSize: 15 }} /> Подтверждено
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 900px){ .sched-grid { grid-template-columns: 1fr !important; } }`}</style>
    </GlassShell>
  );
};

export default LawyerSchedulePage;

