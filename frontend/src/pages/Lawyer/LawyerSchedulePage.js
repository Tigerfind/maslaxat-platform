import React, { useState, useEffect, useCallback } from 'react';
import {
  VideocamOutlined,
  ChatBubbleOutline,
  CheckOutlined,
  CloseOutlined,
  FolderOpenOutlined,
} from '@mui/icons-material';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
import GlassShell from '../../components/GlassKit/GlassShell';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import { useTranslation } from '../../i18n';
import { MIN_WEEKLY_SLOTS, countWeeklySlots } from '../../utils/schedulePolicy';

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
  const { t } = useTranslation();
  const DAYS = t('lawyerPanel.days');
  const MONTHS = t('lawyerPanel.months');
  const MONTHS_GEN = t('lawyerPanel.monthsGen');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [docsFor, setDocsFor] = useState(null); // консультация, чью папку документов открыли
  const { user } = useSelector((state) => state.auth);

  // ── Недельные слоты доступности ──
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const [availability, setAvailability] = useState({});
  const [availSaving, setAvailSaving] = useState(false);
  const [availabilityLoadError, setAvailabilityLoadError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await lawyerService.schedule.getAvailability();
        const s = res.schedule || {};
        const filled = {};
        DAY_KEYS.forEach((d) => {
          filled[d] = {
            enabled: Boolean(s[d]?.enabled),
            from: s[d]?.from || '09:00',
            to: s[d]?.to || '18:00',
          };
        });
        setAvailability(filled);
        setAvailabilityLoadError(false);
      } catch {
        setAvailability({});
        setAvailabilityLoadError(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDay = (day, patch) => setAvailability((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  const weeklySlots = countWeeklySlots(availability);

  const handleSaveAvailability = async () => {
    setAvailSaving(true);
    try {
      await lawyerService.schedule.saveAvailability(availability);
      toast.success(t('lawyerPanel.hoursSaved'));
    } catch {
      toast.error(t('lawyerPanel.hoursError'));
    } finally {
      setAvailSaving(false);
    }
  };

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
      toast.success(t('lawyerPanel.confirmSuccess'));
      loadSchedule();
    } catch {
      toast.error(t('lawyerPanel.confirmError'));
    }
  };

  const handleReject = async (eventId) => {
    try {
      await lawyerService.schedule.rejectConsultation(eventId);
      toast.info(t('lawyerPanel.rejectInfo'));
      loadSchedule();
    } catch {
      toast.error(t('lawyerPanel.schedRejectError'));
    }
  };

  const dayEvents = (selectedDate && events[selectedDate]) || [];
  const selectedLabel = selectedDate
    ? `${Number(selectedDate.split('-')[2])} ${MONTHS_GEN[Number(selectedDate.split('-')[1]) - 1]}`
    : t('lawyerPanel.selectDate');
  const selectedSub = !selectedDate
    ? t('lawyerPanel.clickDate')
    : dayEvents.length
      ? `${dayEvents.length} ${dayEvents.length === 1 ? t('lawyerPanel.consultationOne') : t('lawyerPanel.consultationMany')}`
      : t('lawyerPanel.freeDay');

  return (
    <GlassShell active="/lawyer/schedule" title={t('lawyerPanel.scheduleTitle')} subtitle={t('lawyerPanel.scheduleSub')} role="lawyer">
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
              <button onClick={handlePrevMonth} style={navArrowBtn} aria-label={t('lawyerPanel.prevMonth')}>‹</button>
              <button onClick={handleNextMonth} style={navArrowBtn} aria-label={t('lawyerPanel.nextMonth')}>›</button>
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
              <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>{t('common.loading')}</div>
            ) : dayEvents.length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
                {t('lawyerPanel.noConsultationsDay')}
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
                        {isVideo ? t('lawyerPanel.typeVideo') : t('lawyerPanel.typeChat')}
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
                          <CheckOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.accept')}
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
                          <CloseOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.reject')}
                        </button>
                      </div>
                    )}

                    {(e.status === 'accepted' || e.status === 'confirmed') && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--success)', background: 'rgba(122,154,107,0.12)', padding: '7px 12px', borderRadius: 'var(--radius)' }}>
                        <CheckOutlined sx={{ fontSize: 15 }} /> {t('lawyerPanel.confirmed')}
                      </div>
                    )}

                    {['accepted', 'confirmed', 'in_progress', 'completed'].includes(e.status) && (
                      <button
                        onClick={() => setDocsFor(e)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, marginLeft: 8,
                          background: 'transparent', color: 'var(--accent-dark)', border: '1px solid var(--card-brd)',
                          fontSize: 11, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                          padding: '7px 12px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <FolderOpenOutlined sx={{ fontSize: 15 }} /> {t('caseDocs.title')}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* WEEKLY AVAILABILITY EDITOR */}
      <div style={{ maxWidth: 1120, margin: '24px auto 0' }}>
        <div style={{ ...glassCard, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{t('lawyerPanel.availabilityTitle')}</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>{t('lawyerPanel.availabilitySub')}</div>
            </div>
            <button
              onClick={handleSaveAvailability}
              disabled={availSaving || availabilityLoadError}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--accent)', color: '#FFFFFF',
                border: 'none', fontSize: 13, fontWeight: 500, letterSpacing: '0.03em', padding: '10px 20px',
                borderRadius: 'var(--radius)', cursor: availSaving || availabilityLoadError ? 'default' : 'pointer', fontFamily: 'inherit', opacity: availSaving || availabilityLoadError ? 0.6 : 1,
              }}
            >
              <CheckOutlined sx={{ fontSize: 17 }} /> {availSaving ? t('lawyerPanel.savingProfile') : t('lawyerPanel.saveHours')}
            </button>
          </div>

          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, background: weeklySlots >= MIN_WEEKLY_SLOTS ? 'rgba(122,154,107,0.12)' : 'rgba(196,163,90,0.14)', color: 'var(--text2)', fontSize: 13 }}>
            {availabilityLoadError
              ? t('lawyerPanel.availabilityLoadError')
              : t('lawyerPanel.availabilityProgress', { count: weeklySlots, required: MIN_WEEKLY_SLOTS })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DAY_KEYS.map((d, i) => {
              const day = availability[d] || { enabled: false, from: '09:00', to: '18:00' };
              return (
                <div key={d} className="avail-row" style={{
                  display: 'grid', gridTemplateColumns: '150px 1fr', alignItems: 'center', gap: 14,
                  padding: '10px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  background: day.enabled ? 'rgba(184,149,110,0.05)' : 'transparent',
                }}>
                  <button
                    onClick={() => setDay(d, { enabled: !day.enabled })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                  >
                    <span style={{
                      width: 40, height: 22, borderRadius: 12, flexShrink: 0, position: 'relative', transition: 'background .2s',
                      background: day.enabled ? 'var(--accent)' : 'var(--border)',
                    }}>
                      <span style={{
                        position: 'absolute', top: 2, left: day.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
                        background: '#FFFFFF', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: day.enabled ? 'var(--text)' : 'var(--text3)' }}>
                      {(t('lawyerPanel.daysFull') || [])[i] || (t('lawyerPanel.days') || [])[i]}
                    </span>
                  </button>

                  {day.enabled ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="time" value={day.from} onChange={(e) => setDay(d, { from: e.target.value })} className="avail-time" />
                      <span style={{ color: 'var(--text3)', fontSize: 13 }}>—</span>
                      <input type="time" value={day.to} onChange={(e) => setDay(d, { to: e.target.value })} className="avail-time" />
                    </div>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}>{t('lawyerPanel.dayOff')}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px){ .sched-grid { grid-template-columns: 1fr !important; } }
        @media (max-width: 560px){ .avail-row { grid-template-columns: 1fr !important; gap: 10px !important; } }
        .avail-time {
          font-family: inherit; font-size: 13px; color: var(--text); background: var(--surface);
          border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer;
        }
      `}</style>

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

export default LawyerSchedulePage;
