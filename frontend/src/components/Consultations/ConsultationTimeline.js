import React from 'react';
import { useTranslation } from '../../i18n';

/*
  ConsultationTimeline — понятный статус консультации для ОБЕИХ ролей.
  Показывает, где сейчас бронь: Забронирована → Подтверждена → Идёт → Завершена,
  плюс подсказка «что дальше». Отклонённая/отменённая — терминальное состояние.
  props: status, role ('client' | 'lawyer')
*/

const STEPS = ['booked', 'confirmed', 'active', 'done'];

// Статус консультации → индекс активного шага (0..3)
const stepOf = (status) => {
  if (['payment_pending', 'pending'].includes(status)) return 0;
  if (status === 'accepted') return 1;
  if (status === 'in_progress') return 2;
  if (status === 'completed') return 3;
  return 0;
};

const ConsultationTimeline = ({ status, role = 'client' }) => {
  const { t } = useTranslation();
  const terminal = ['rejected', 'cancelled'].includes(status);

  if (terminal) {
    const isRejected = status === 'rejected';
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10,
        background: 'rgba(192,73,47,0.08)', border: '1px solid rgba(192,73,47,0.25)',
      }}>
        <span style={{ fontSize: 14 }}>{isRejected ? '✕' : '⊘'}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          {t(isRejected ? 'timeline.rejected' : 'timeline.cancelled')}
        </span>
      </div>
    );
  }

  const cur = stepOf(status);
  const labels = {
    booked: t('timeline.booked'),
    confirmed: t('timeline.confirmed'),
    active: t('timeline.active'),
    done: t('timeline.done'),
  };
  // Подсказка «что дальше» — своя для клиента и юриста.
  const hint = (() => {
    if (cur === 0) return role === 'lawyer' ? t('timeline.hintLawyerConfirm') : t('timeline.hintClientWait');
    if (cur === 1) return role === 'lawyer' ? t('timeline.hintLawyerStart') : t('timeline.hintClientConfirmed');
    if (cur === 2) return t('timeline.hintActive');
    return t('timeline.hintDone');
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {STEPS.map((s, i) => {
          const done = i < cur;
          const active = i === cur;
          const color = done ? 'var(--success, #6E9A5F)' : active ? 'var(--accent)' : 'var(--border-strong)';
          return (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10.5, fontWeight: 700, color: (done || active) ? '#fff' : 'var(--text3)',
                  background: done ? 'var(--success, #6E9A5F)' : active ? 'linear-gradient(135deg,var(--accent),var(--accent-dark))' : 'var(--border)',
                  boxShadow: active ? '0 0 0 4px rgba(184,149,110,0.16)' : 'none',
                }}>{done ? '✓' : i + 1}</div>
                <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 400, color: active ? 'var(--text)' : 'var(--text3)', whiteSpace: 'nowrap' }}>{labels[s]}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, margin: '0 6px', marginBottom: 16, borderRadius: 2, background: i < cur ? 'var(--success, #6E9A5F)' : 'var(--border-strong)', transition: 'background .25s' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8, textAlign: 'center' }}>{hint}</div>
      )}
    </div>
  );
};

export default ConsultationTimeline;
