import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from '@mui/material';
import {
  AccessTimeRounded,
  ArchiveOutlined,
  AutorenewRounded,
  CalendarMonthOutlined,
  CancelOutlined,
  ChatBubbleOutline,
  CheckCircleOutlined,
  EventAvailableOutlined,
  EventRepeatOutlined,
  FolderOpenOutlined,
  HelpOutline,
  MicNoneOutlined,
  PaymentOutlined,
  ReplayOutlined,
  StarRounded,
  UnarchiveOutlined,
  VideocamOutlined,
} from '@mui/icons-material';
import { useTranslation } from '../../i18n';
import { resolvePublicAssetUrl } from '../../services/clientService';
import ConsultationTimeline from './ConsultationTimeline';
import {
  getCancellationTypeKey,
  getConsultationActions,
  getConsultationFormat,
  getConsultationStatus,
  getJoinState,
  isPaymentExpired,
} from '../../utils/consultationPresentation';
import { formatConsultationCurrency, formatConsultationDateTime, localeForLanguage } from '../../utils/consultationLocale';

const glassCard = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)', overflow: 'hidden',
};

const STATUS_ICONS = {
  payment: PaymentOutlined, time: AccessTimeRounded, accepted: CheckCircleOutlined,
  completed: CheckCircleOutlined, live: AutorenewRounded, cancel: CancelOutlined, unknown: HelpOutline,
};

const FORMAT_ICONS = { chat: ChatBubbleOutline, audio: MicNoneOutlined, video: VideocamOutlined, zoom: VideocamOutlined };
const initialsOf = (name = '') => name.trim().split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase() || '?';

const actionIcon = {
  pay: PaymentOutlined, join: VideocamOutlined, calendar: EventAvailableOutlined,
  reschedule: EventRepeatOutlined, rebook: ReplayOutlined, open_chat: ChatBubbleOutline,
  read_chat: ChatBubbleOutline, documents: FolderOpenOutlined, archive: ArchiveOutlined,
  unarchive: UnarchiveOutlined,
};

const actionLabel = (action, consultation, t) => {
  if (action === 'join') {
    const format = getConsultationFormat(consultation).key;
    if (format === 'chat') return t('consultations.openChat');
    if (consultation.policy?.status === 'in_progress') return t('consultations.joinCall');
    if (format === 'zoom') return t('consultations.joinZoom');
    if (format === 'audio') return t('consultations.joinAudio');
    return t('consultations.joinVideo');
  }
  const keys = {
    view_details: 'viewDetails', pay: 'pay', cancel: 'cancel', calendar: 'addCalendar',
    complete: 'complete', reschedule: 'reschedule', rate: 'rate', rebook: 'rebook',
    open_chat: 'openChat', read_chat: 'chatHistory', documents: 'documents',
    archive: 'archive', unarchive: 'unarchive',
  };
  return t(`consultations.${keys[action] || action}`);
};

const joinReason = (consultation, join, locale, t) => {
  if (join.reason === 'TOO_EARLY' && join.opensAt) {
    return t('consultations.joinOpensAt', { time: new Date(join.opensAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) });
  }
  const key = `joinReason_${join.reason || 'UNAVAILABLE'}`;
  const translated = t(`consultations.${key}`);
  return translated === `consultations.${key}` ? t('consultations.joinUnavailable') : translated;
};

const ConsultationCard = ({ consultation, now = Date.now(), serverOffset = 0, loadingAction, disabledActions = [], onAction, showTimeline = true, detail = false, from }) => {
  const { t, language } = useTranslation();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const locale = localeForLanguage(language);
  const status = getConsultationStatus(consultation);
  const paymentExpired = isPaymentExpired(consultation, now, serverOffset);
  const format = getConsultationFormat(consultation);
  const actions = getConsultationActions(consultation).filter((action) => action !== 'reason' && (!detail || action !== 'view_details'));
  if (paymentExpired) {
    const paymentAction = actions.indexOf('pay');
    if (paymentAction >= 0) actions.splice(paymentAction, 1, 'rebook');
    const rescheduleAction = actions.indexOf('reschedule');
    if (rescheduleAction >= 0) actions.splice(rescheduleAction, 1);
  }
  const join = getJoinState(consultation, now, serverOffset);
  if (join.visible && !actions.includes('join')) actions.splice(Math.min(1, actions.length), 0, 'join');
  const StatusIcon = STATUS_ICONS[status.icon] || HelpOutline;
  const FormatIcon = FORMAT_ICONS[format.icon] || ChatBubbleOutline;
  const lawyer = consultation.lawyer || {};
  const profile = lawyer.profile || {};
  const name = lawyer.name || t('consultations.lawyer');
  const specialization = profile.specialization || profile.specializations?.[0] || lawyer.specialization || t('consultations.specializationUnknown');
  const rating = Number(profile.rating ?? lawyer.rating);
  const avatar = resolvePublicAssetUrl(lawyer.avatar || lawyer.photo);
  const start = consultation.scheduledStartAt ? new Date(consultation.scheduledStartAt) : null;
  const validStart = start && !Number.isNaN(start.getTime());
  const timezone = consultation.scheduleTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dateText = validStart
    ? formatConsultationDateTime(start, language, timezone)
    : t('consultations.notScheduled');
  const amount = Number(consultation.payment?.amount ?? consultation.price ?? 0);
  const currency = consultation.payment?.currency || 'UZS';
  const price = formatConsultationCurrency(amount, language, currency);
  const paymentStatus = consultation.payment?.status || 'unpaid';
  const review = consultation.consultationReview;
  const cancellation = consultation.policy?.cancellation;
  const cancellationAt = consultation.cancelledAt || (status.status === 'payment_expired' ? consultation.paymentExpiresAt : null);
  const paymentRemaining = consultation.paymentExpiresAt
    ? new Date(consultation.paymentExpiresAt).getTime() - (now + serverOffset) : null;
  const busy = (action) => loadingAction instanceof Set
    ? loadingAction.has(`${consultation.id}:${action}`)
    : loadingAction === `${consultation.id}:${action}`;
  const itemBusy = loadingAction instanceof Set
    ? [...loadingAction].some((key) => key.startsWith(`${consultation.id}:`))
    : Boolean(loadingAction && loadingAction.startsWith(`${consultation.id}:`));

  const invoke = (action) => {
    if (!busy(action)) onAction?.(action, consultation);
  };

  return (
    <article style={glassCard} data-testid={`consultation-${consultation.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', background: status.background, color: status.color, fontSize: 12, fontWeight: 650, letterSpacing: '0.04em', textTransform: 'uppercase', flexWrap: 'wrap' }}>
        <StatusIcon sx={{ fontSize: 17 }} aria-hidden="true" />
        <span>{t(`consultations.${status.labelKey}`)}</span>
        <span className="consultation-card-date" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
          <CalendarMonthOutlined sx={{ fontSize: 16 }} aria-hidden="true" /> {dateText}
        </span>
      </div>

      {status.status === 'in_progress' && (
        <div role="status" style={{ padding: '13px 18px', color: '#fff', background: 'linear-gradient(100deg,#9A6F4C,#B8956E)', fontWeight: 650 }}>
          {t('consultations.liveNow')}
        </div>
      )}

      <div style={{ padding: '18px 20px' }}>
        <div className="consultation-card-person" style={{ display: 'flex', alignItems: 'flex-start', gap: 15 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: 'linear-gradient(135deg,#6A8A9A,#4A6A7A)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 650 }}>
            <span>{initialsOf(name)}</span>
            {avatar && !avatarFailed && <img src={avatar} alt="" loading="lazy" decoding="async" onError={() => setAvatarFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', gridArea: '1/1', position: 'relative' }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/consultations/${consultation.id}`} state={from ? { from } : undefined} style={{ color: 'var(--text)', fontSize: 17, fontWeight: 600, textDecoration: 'none', outlineOffset: 4 }}>{name}</Link>
            <div style={{ color: 'var(--text3)', fontSize: 13, marginTop: 3 }}>
              {specialization}{Number.isFinite(rating) && rating > 0 ? ` · ★ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rating)}` : ''}
            </div>
            {(consultation.question || consultation.topic) && <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.55, margin: '12px 0' }}>“{consultation.question || consultation.topic}”</p>}
            <div style={{ display: 'flex', gap: '8px 20px', flexWrap: 'wrap', color: 'var(--text2)', fontSize: 13, marginTop: 10 }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><FormatIcon sx={{ fontSize: 17 }} />{t(`consultations.${format.labelKey}`)}</span>
              <span><AccessTimeRounded sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: .5 }} />{consultation.duration || 60} {t('consultations.minutesShort')}</span>
              <span>{timezone}</span>
              <strong style={{ color: 'var(--text)' }}>{price}</strong>
              <span>{t(`consultations.payment_${paymentStatus}`)}</span>
            </div>
            {status.status === 'payment_pending' && paymentRemaining != null && (
              <div aria-live="off" style={{ marginTop: 10, color: paymentExpired ? '#B07070' : '#9A6F4C', fontSize: 13, fontWeight: 650 }}>
                {paymentExpired ? t('consultations.paymentExpired') : t('consultations.paymentExpiresIn', { minutes: Math.max(1, Math.ceil(paymentRemaining / 60000)) })}
              </div>
            )}
          </div>
        </div>

        {cancellation && (
          <div style={{ marginTop: 16, padding: 14, background: 'rgba(176,112,112,0.08)', border: '1px solid rgba(176,112,112,0.22)', borderRadius: 10 }}>
            <strong>{t(`consultations.${getCancellationTypeKey(cancellation)}`)}</strong>
            <div style={{ marginTop: 5, color: 'var(--text2)', fontSize: 13 }}>{t('consultations.cancellationInitiator')}: {t(`consultations.${getCancellationTypeKey(cancellation)}`)}</div>
            <div style={{ marginTop: 5, color: 'var(--text2)', fontSize: 13 }}>{t('consultations.cancellationReason')}: {cancellation.reason || t('consultations.cancellationReasonMissing')}</div>
            <div style={{ marginTop: 5, color: 'var(--text2)', fontSize: 13 }}>{t('consultations.cancellationDate')}: {cancellationAt ? new Date(cancellationAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : t('consultations.dateUnknown')}</div>
          </div>
        )}

        {review && (
          <div style={{ marginTop: 15, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>{t('consultations.yourRating')}</span>
            <div style={{ color: '#B8956E', marginTop: 4 }}>{Array.from({ length: 5 }).map((_, index) => <StarRounded key={index} sx={{ fontSize: 18, opacity: index < review.rating ? 1 : .25 }} />)}</div>
            {review.text && <p style={{ color: 'var(--text2)', fontSize: 13, fontStyle: 'italic', margin: '5px 0 0' }}>“{review.text}”</p>}
          </div>
        )}
      </div>

      {showTimeline && <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}><ConsultationTimeline consultation={consultation} role="client" /></div>}

      {actions.length > 0 && (
        <div className="consultation-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 1, borderTop: '1px solid var(--border)', background: 'var(--border)' }}>
          {actions.map((action) => {
            const Icon = actionIcon[action];
            const disabled = itemBusy
              || (action === 'join' && !join.enabled)
              || disabledActions.includes(action)
              || (action === 'rebook' && !(consultation.lawyerId || consultation.lawyer?.id));
            const reasonId = `consultation-${consultation.id}-${action}-reason`;
            const button = (
              <button type="button" key={action} onClick={() => invoke(action)} disabled={disabled} aria-describedby={action === 'join' && disabled ? reasonId : undefined} className={`consultation-action consultation-action-${action}`}>
                {Icon && <Icon sx={{ fontSize: 18 }} aria-hidden="true" />}
                {busy(action) ? t('consultations.actionLoading') : actionLabel(action, consultation, t)}
              </button>
            );
            return action === 'join' && disabled
              ? <Tooltip key={action} title={joinReason(consultation, join, locale, t)}><span tabIndex={0} aria-describedby={reasonId} style={{ display: 'flex', flex: '1 1 150px' }}>{button}<span id={reasonId} className="consultation-sr-only">{joinReason(consultation, join, locale, t)}</span></span></Tooltip>
              : button;
          })}
        </div>
      )}
      <style>{`
        .consultation-action { min-height:44px; flex:1 1 160px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:10px 12px; border:0; background:var(--card-glass); color:var(--text2); font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
        .consultation-action:hover { background:var(--canvas); color:var(--accent-dark); }
        .consultation-action:focus-visible { outline:2px solid var(--accent); outline-offset:-3px; }
        .consultation-action:disabled { cursor:not-allowed; opacity:.55; }
        .consultation-action-join, .consultation-action-pay { color:#9A6F4C; }
        .consultation-action-complete { color:#607F54; }
        .consultation-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        @media (max-width:600px) { .consultation-card-date { width:100%; margin-left:25px !important; } .consultation-action { flex-basis:100%; min-width:0; } }
        @media (max-width:359px) { .consultation-card-person { gap:10px !important; } }
      `}</style>
    </article>
  );
};

export default ConsultationCard;
