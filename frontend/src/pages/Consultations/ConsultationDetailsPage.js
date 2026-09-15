import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, TextField } from '@mui/material';
import { ArrowBackOutlined, CloseOutlined } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import ConsultationCard from '../../components/Consultations/ConsultationCard';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import { isConsultationWritable } from '../../utils/chatMessages';
import BookingModal from '../../components/BookingModal';
import RatingDialog from '../../components/UI/RatingDialog';
import ErrorState from '../../components/UI/ErrorState';
import { SkeletonCard } from '../../components/UI/Skeleton';
import clientService, { clientLawyerService } from '../../services/clientService';
import api from '../../services/api';
import { launchConsultation } from '../../services/meetingLauncher';
import { useTranslation } from '../../i18n';
import { getConsultationStatus, getServerOffset, isPaymentExpired, safeRequestError } from '../../utils/consultationPresentation';
import { consultationDialogPaperSx, formatConsultationCurrency, formatConsultationDateTime, localeForLanguage } from '../../utils/consultationLocale';
import { isAuthoritativeUnavailableLawyerError, joinPolicyRefreshKey, nextJoinPolicyRefreshDelay } from '../../utils/consultationRefresh';

const section = { background: 'var(--card-glass)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', boxShadow: 'var(--card-shadow)', padding: 22 };

const ConsultationDetailsPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useTranslation();
  const user = useSelector((state) => state.auth.user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loadingAction, setLoadingAction] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);
  const [rebookLawyer, setRebookLawyer] = useState(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [slotsState, setSlotsState] = useState({ loading: false, error: '', dates: [], timezone: '' });
  const [slotDate, setSlotDate] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [serverOffset, setServerOffset] = useState(0);
  const slotsControllerRef = useRef(null);
  const actionLockRef = useRef('');
  const loadedRef = useRef(false);
  const [rebookUnavailable, setRebookUnavailable] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reloadToken, setReloadToken] = useState(0);
  const lastRefreshRequestRef = useRef(0);
  const joinRefetchedRef = useRef(new Set());
  const locale = localeForLanguage(language);
  const backTarget = typeof location.state?.from === 'string' && location.state.from.startsWith('/consultations') ? location.state.from : '/consultations';
  const requestRefresh = useCallback(() => {
    const requestedAt = Date.now();
    if (requestedAt - lastRefreshRequestRef.current < 250) return;
    lastRefreshRequestRef.current = requestedAt;
    setReloadToken((value) => value + 1);
  }, []);
  const goBack = () => {
    if (location.key !== 'default' && location.state?.from) navigate(-1);
    else navigate(backTarget, { replace: true });
  };

  const load = useCallback(async (signal) => {
    if (loadedRef.current) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await clientService.consultations.getConsultationDetails(consultationId, { signal });
      if (!signal?.aborted) {
        setData(result);
        loadedRef.current = true;
        setServerOffset(getServerOffset(result.policy?.serverNow || result.consultation?.policy?.serverNow));
      }
    } catch (requestError) {
      if (!signal?.aborted && requestError?.code !== 'ERR_CANCELED') setError(requestError);
    } finally { if (!signal?.aborted) { setLoading(false); setRefreshing(false); } }
  }, [consultationId]);

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, reloadToken]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => () => slotsControllerRef.current?.abort(), []);
  useEffect(() => {
    const online = () => requestRefresh();
    const visible = () => { if (document.visibilityState === 'visible') requestRefresh(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible); };
  }, [requestRefresh]);
  useEffect(() => {
    const consultation = data?.consultation;
    const key = joinPolicyRefreshKey(consultation);
    if (!key || joinRefetchedRef.current.has(key)) return undefined;
    const delay = nextJoinPolicyRefreshDelay(consultation, serverOffset);
    if (delay === null) return undefined;
    const timer = setTimeout(() => { joinRefetchedRef.current.add(key); requestRefresh(); }, delay);
    return () => clearTimeout(timer);
  }, [data?.consultation, requestRefresh, serverOffset]);

  const mutate = async (action, request, successKey) => {
    const key = `${consultationId}:${action}`;
    if (actionLockRef.current) return;
    actionLockRef.current = key;
    setLoadingAction(key);
    try { await request(); if (successKey) toast.success(t(`consultations.${successKey}`)); await load(); }
    catch (requestError) { toast.error(safeRequestError(requestError, t('consultations.actionError'), { language, t })); }
    finally { actionLockRef.current = ''; setLoadingAction(''); }
  };

  if (loading && !data) return <GlassShell active="/consultations" title={t('consultations.detailsTitle')}><div aria-label={t('consultations.loading')} style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 16 }}><SkeletonCard lines={4} /><SkeletonCard lines={2} /></div></GlassShell>;
  if (error || !data?.consultation) {
    const forbidden = [403, 404].includes(error?.response?.status);
    return <GlassShell active="/consultations" title={t('consultations.detailsTitle')}><div style={{ maxWidth: 800, margin: '0 auto' }}><Button startIcon={<ArrowBackOutlined />} onClick={goBack}>{t('consultations.backToList')}</Button><ErrorState error={safeRequestError(error, forbidden ? t('consultations.detailsUnavailable') : t('consultations.loadError'), { language, t })} onRetry={forbidden ? undefined : () => load()} /></div></GlassShell>;
  }

  const consultation = data.consultation;
  if (!consultation.policy && data.policy) consultation.policy = data.policy;
  if (!consultation.payment && data.payment) consultation.payment = data.payment;

  const addToCalendar = () => {
    const start = new Date(consultation.scheduledStartAt);
    const end = new Date(consultation.scheduledEndAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const format = (value) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escape = (value) => String(value || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//eMaslaXat//Consultation//EN', 'BEGIN:VEVENT',
      `UID:${consultation.id}@maslaxat.uz`, `DTSTART:${format(start)}`, `DTEND:${format(end)}`,
      `SUMMARY:${escape(t('consultations.calendarTitle'))}`, `DESCRIPTION:${escape(consultation.question)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `consultation-${consultation.id}.ics`; anchor.click(); URL.revokeObjectURL(url);
  };

  const loadSlots = async () => {
    slotsControllerRef.current?.abort();
    const controller = new AbortController();
    slotsControllerRef.current = controller;
    setSlotsState({ loading: true, error: '', dates: [], timezone: '' });
    try {
      const lawyerId = consultation.lawyerId || consultation.lawyer?.id;
      const { data: slots } = await api.get(`/lawyers/${lawyerId}/available-slots`, {
        params: { duration: consultation.duration, clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSlotsState({ loading: false, error: '', dates: slots.dates || [], timezone: slots.timezone || consultation.scheduleTimezone || '' });
    } catch (requestError) {
      if (!controller.signal.aborted && requestError?.code !== 'ERR_CANCELED') setSlotsState({ loading: false, error: safeRequestError(requestError, t('consultations.rescheduleSlotsError'), { language, t }), dates: [], timezone: '' });
    }
  };

  const openReschedule = () => {
    setRescheduleOpen(true); setSlotDate(''); setSlotTime('');
    if (![30, 60, 90].includes(Number(consultation.duration))) {
      setSlotsState({ loading: false, error: t('consultations.invalidDuration'), dates: [], timezone: '' });
    } else loadSlots();
  };

  const closeReschedule = () => { slotsControllerRef.current?.abort(); setRescheduleOpen(false); };

  const openRebook = async () => {
    const lawyerId = consultation.lawyerId || consultation.lawyer?.id;
    const key = `${consultation.id}:rebook`;
    if (!lawyerId || rebookUnavailable || actionLockRef.current) return;
    actionLockRef.current = key;
    setLoadingAction(key);
    try {
      const lawyer = await clientService.lawyers.getBookableLawyerDetails(lawyerId);
      if (!lawyer) {
        setRebookUnavailable(true);
        toast.error(t('consultations.rebookUnavailable'));
        return;
      }
      setRebookLawyer({ lawyer, initialConsultation: consultation });
    } catch (requestError) {
      setRebookUnavailable(true);
      if (isAuthoritativeUnavailableLawyerError(requestError)) setRebookUnavailable(true);
      toast.error(safeRequestError(requestError, t('consultations.rebookRetry'), { language, t }));
    } finally { actionLockRef.current = ''; setLoadingAction(''); }
  };

  const onAction = async (action) => {
    if (action === 'cancel') { setCancelReason(''); setCancelOpen(true); return; }
    if (action === 'reschedule') { openReschedule(); return; }
    if (action === 'calendar') { addToCalendar(); return; }
    if (action === 'view_details') return;
    if (action === 'join') {
      const key = `${consultation.id}:join`;
      if (actionLockRef.current) return;
      actionLockRef.current = key;
      setLoadingAction(key);
      try { await launchConsultation(consultation, navigate, { now: now + serverOffset }); }
      catch (requestError) { toast.error(safeRequestError(requestError, t('consultations.joinUnavailable'), { language, t })); }
      finally { actionLockRef.current = ''; setLoadingAction(''); }
      return;
    }
    if (action === 'pay') {
      if (isPaymentExpired(consultation, now, serverOffset)) { await openRebook(); return; }
      const key = `${consultation.id}:pay`;
      if (actionLockRef.current) return;
      actionLockRef.current = key;
      setLoadingAction(key);
      let expired = false;
      try {
        const result = await clientService.lawyers.payConsultation(consultation.id);
        if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
        toast.success(t('consultations.paymentSuccess')); await load();
      } catch (requestError) {
        expired = requestError?.response?.status === 410;
        toast.error(safeRequestError(requestError, t('consultations.paymentError'), { language, t }));
        if (expired) await load();
      }
      finally { actionLockRef.current = ''; setLoadingAction(''); }
      if (expired) await openRebook();
      return;
    }
    if (action === 'complete') {
      if (window.confirm(t('consultations.completeConfirm'))) await mutate(action, () => clientService.consultations.completeConsultation(consultation.id), 'completeSuccess');
      return;
    }
    if (action === 'archive' || action === 'unarchive') { await mutate(action, () => clientService.consultations.archive(consultation.id, action === 'archive'), action === 'archive' ? 'archiveSuccess' : 'unarchiveSuccess'); return; }
    if (action === 'rate') { setRatingOpen(true); return; }
    if (action === 'rebook') { await openRebook(); return; }
    if (action === 'documents') { setDocsOpen(true); return; }
    if (action === 'open_chat' || action === 'read_chat') navigate(`/consultations/chat/${consultation.id}`);
  };

  const submitRating = async ({ rating, text }) => {
    await clientLawyerService.leaveReview(consultation.lawyerId || consultation.lawyer?.id, { consultationId: consultation.id, rating, text });
    toast.success(t('consultations.reviewThanks')); setRatingOpen(false); await load();
  };
  const submitCancellation = async () => {
    if (!cancelReason.trim() || actionLockRef.current) return;
    actionLockRef.current = `${consultation.id}:cancel`;
    setLoadingAction(`${consultation.id}:cancel`);
    try {
      await clientService.consultations.cancelConsultation(consultation.id, cancelReason.trim());
      toast.success(t('consultations.cancelSuccess')); setCancelOpen(false); await load();
    } catch (requestError) { toast.error(safeRequestError(requestError, t('consultations.cancelError'), { language, t })); }
    finally { actionLockRef.current = ''; setLoadingAction(''); }
  };
  const submitReschedule = async () => {
    if (!slotDate || !slotTime || actionLockRef.current) return;
    actionLockRef.current = `${consultation.id}:reschedule`;
    setLoadingAction(`${consultation.id}:reschedule`);
    try {
      await clientService.consultations.reschedule(consultation.id, slotDate, slotTime);
      toast.success(t('consultations.rescheduleOk')); closeReschedule(); await load();
    } catch (requestError) {
      toast.error(safeRequestError(requestError, t('consultations.rescheduleErr'), { language, t }));
      if (requestError?.response?.status === 410) { closeReschedule(); await load(); }
    }
    finally { actionLockRef.current = ''; setLoadingAction(''); }
  };
  const selectedSlots = slotsState.dates.find((item) => item.date === slotDate)?.slots || [];
  const selectedSlot = selectedSlots.find((item) => item.time === slotTime);
  const actionBusy = Boolean(loadingAction);

  return (
    <GlassShell active="/consultations" title={t('consultations.detailsTitle')} subtitle={consultation.lawyer?.name || t('consultations.lawyer')}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 16 }}>
        {refreshing && <LinearProgress aria-label={t('consultations.refreshing')} sx={{ borderRadius: 2 }} />}
        {error && <div role="alert" style={{ color: '#B07070' }}>{t('consultations.refreshError')} <Button onClick={() => load()}>{t('consultations.retry')}</Button></div>}
        <Button startIcon={<ArrowBackOutlined />} onClick={goBack} sx={{ justifySelf: 'start' }}>{t('consultations.backToList')}</Button>
        <ConsultationCard consultation={consultation} now={now} serverOffset={serverOffset} loadingAction={loadingAction} disabledActions={rebookUnavailable ? ['rebook'] : []} onAction={onAction} detail />
        <section style={section}><h2 style={{ marginTop: 0, fontSize: 18 }}>{t('consultations.paymentTitle')}</h2><p>{t(`consultations.payment_${consultation.payment?.status || 'unpaid'}`)} · {formatConsultationCurrency(consultation.payment?.amount ?? consultation.price, language, consultation.payment?.currency || 'UZS')}</p>{consultation.payment?.paidAt && <p>{t('consultations.paymentDate')}: {formatConsultationDateTime(consultation.payment.paidAt, language, consultation.scheduleTimezone)}</p>}</section>
        <section style={section}><h2 style={{ marginTop: 0, fontSize: 18 }}>{t('consultations.yourQuestion')}</h2><p>{consultation.question || t('consultations.noQuestion')}</p>{consultation.description && <p style={{ whiteSpace: 'pre-wrap' }}>{consultation.description}</p>}</section>
        {consultation.lawyerSummary && <section style={section}><h2 style={{ marginTop: 0, fontSize: 18 }}>{t('consultations.lawyerSummary')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{consultation.lawyerSummary}</p></section>}
        <section style={section}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{t('consultations.historyTitle')}</h2>
          {(data.statusHistory || []).length ? (data.statusHistory || []).map((item, index) => {
            const historyStatus = item.status === 'created' ? { labelKey: 'status_created' } : getConsultationStatus(item.status);
            return <p key={`${item.status}-${item.at}-${index}`}>{formatConsultationDateTime(item.at, language, consultation.scheduleTimezone)} · {t(`consultations.${historyStatus.labelKey}`)}</p>;
          }) : <p>{t('consultations.historyEmpty')}</p>}
        </section>
      </div>
      <CaseDocuments consultationId={consultation.id} open={docsOpen} onClose={() => setDocsOpen(false)} currentUserId={user?.id} readOnly={!isConsultationWritable(consultation, 'documentsWritable')} />
      <BookingModal open={Boolean(rebookLawyer)} onClose={() => setRebookLawyer(null)} lawyer={rebookLawyer?.lawyer || rebookLawyer || {}} initialConsultation={rebookLawyer?.initialConsultation || null} />
      <RatingDialog open={ratingOpen} onClose={() => setRatingOpen(false)} onSubmit={submitRating} lawyerName={consultation.lawyer?.name} />
      <Dialog open={cancelOpen} onClose={actionBusy ? undefined : () => setCancelOpen(false)} aria-labelledby="detail-cancel-consultation-title" maxWidth="sm" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
        <DialogTitle id="detail-cancel-consultation-title" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('consultations.cancelModalTitle')}<IconButton aria-label={t('consultations.close')} onClick={() => setCancelOpen(false)} disabled={actionBusy}><CloseOutlined /></IconButton></DialogTitle>
        <DialogContent><TextField required autoFocus fullWidth multiline minRows={4} label={t('consultations.cancelReasonLabel')} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} helperText={!cancelReason.trim() ? t('consultations.cancelReasonRequired') : ' '} /></DialogContent>
        <DialogActions><Button onClick={() => setCancelOpen(false)} disabled={actionBusy}>{t('consultations.back')}</Button><Button color="error" variant="contained" disabled={!cancelReason.trim() || actionBusy} onClick={submitCancellation}>{actionBusy ? t('consultations.actionLoading') : t('consultations.cancelConfirm')}</Button></DialogActions>
      </Dialog>
      <Dialog open={rescheduleOpen} onClose={actionBusy ? undefined : closeReschedule} aria-labelledby="detail-reschedule-consultation-title" maxWidth="sm" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
        <DialogTitle id="detail-reschedule-consultation-title" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('consultations.reschedule')}<IconButton aria-label={t('consultations.close')} onClick={closeReschedule} disabled={actionBusy}><CloseOutlined /></IconButton></DialogTitle>
        {slotsState.loading && <LinearProgress aria-label={t('consultations.loadingSlots')} />}
        <DialogContent>
          {slotsState.error && <div role="alert">{slotsState.error} <Button onClick={loadSlots}>{t('consultations.retry')}</Button></div>}
          {!slotsState.loading && !slotsState.error && !slotsState.dates.length && <p>{t('consultations.noSlotsTitle')}. {t('consultations.noSlotsSub')}</p>}
          {slotsState.dates.length > 0 && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 190px' }}>{t('consultations.newDate')}<select className="consultation-detail-select" value={slotDate} onChange={(event) => { setSlotDate(event.target.value); setSlotTime(''); }}><option value="">{t('consultations.selectOption')}</option>{slotsState.dates.map((item) => <option key={item.date} value={item.date}>{new Date(`${item.date}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'full' })}</option>)}</select></label>
            <label style={{ flex: '1 1 150px' }}>{t('consultations.newTime')}<select className="consultation-detail-select" value={slotTime} onChange={(event) => setSlotTime(event.target.value)} disabled={!slotDate}><option value="">{t('consultations.selectOption')}</option>{selectedSlots.map((slot) => <option key={`${slot.clientDate || slotDate}-${slot.time}`} value={slot.time}>{slot.clientTime || slot.time}</option>)}</select></label>
          </div>}
          {slotsState.timezone && <p>{t('consultations.rescheduleTimezones', { lawyer: slotsState.timezone, client: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>}
          {selectedSlot && <p>{t('consultations.rescheduleConfirm', { date: new Date(`${selectedSlot.clientDate || slotDate}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'long' }), time: selectedSlot.clientTime || slotTime, duration: consultation.duration })}</p>}
        </DialogContent>
        <DialogActions><Button onClick={closeReschedule} disabled={actionBusy}>{t('consultations.cancel')}</Button><Button variant="contained" disabled={!selectedSlot || actionBusy} onClick={submitReschedule}>{actionBusy ? <CircularProgress size={18} /> : t('consultations.rescheduleSave')}</Button></DialogActions>
      </Dialog>
      <style>{`.consultation-detail-select{display:block;width:100%;min-height:44px;margin-top:6px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}`}</style>
    </GlassShell>
  );
};

export default ConsultationDetailsPage;
