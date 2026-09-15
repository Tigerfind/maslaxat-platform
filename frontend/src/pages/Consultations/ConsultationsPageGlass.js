import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, LinearProgress, Pagination, TextField,
} from '@mui/material';
import { AddOutlined, CloseOutlined, SearchOutlined } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import ConsultationCard from '../../components/Consultations/ConsultationCard';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import { isConsultationWritable } from '../../utils/chatMessages';
import RatingDialog from '../../components/UI/RatingDialog';
import BookingModal from '../../components/BookingModal';
import { SkeletonCard } from '../../components/UI/Skeleton';
import ErrorState from '../../components/UI/ErrorState';
import EmptyState from '../../components/UI/EmptyState';
import clientService, { clientLawyerService } from '../../services/clientService';
import api from '../../services/api';
import { launchConsultation } from '../../services/meetingLauncher';
import { useTranslation } from '../../i18n';
import {
  CONSULTATION_TABS, getServerOffset, isPaymentExpired, safeRequestError,
} from '../../utils/consultationPresentation';
import { consultationQueryKey, parseConsultationQuery, serializeConsultationQuery } from '../../utils/consultationQuery';
import { consultationDialogPaperSx, localeForLanguage } from '../../utils/consultationLocale';
import { isAuthoritativeUnavailableLawyerError, joinPolicyRefreshKey, nextJoinPolicyRefreshDelay } from '../../utils/consultationRefresh';

const glassCard = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)',
};

const legacyTabs = ['all', 'upcoming', 'completed', 'cancelled', 'archived'];

const ConsultationsPageGlass = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { t, language } = useTranslation();
  const { user } = useSelector((state) => state.auth);
  const legacyTab = Number.isInteger(location.state?.tab) ? legacyTabs[location.state.tab] : null;
  const query = parseConsultationQuery(params, legacyTab);
  const { tab: currentTab, search: querySearch, period, page } = query;
  const [search, setSearch] = useState(querySearch);
  const [consultations, setConsultations] = useState([]);
  const [counts, setCounts] = useState(Object.fromEntries(CONSULTATION_TABS.map((key) => [key, 0])));
  const [totalPages, setTotalPages] = useState(1);
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingActions, setLoadingActions] = useState(new Set());
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [ratingFor, setRatingFor] = useState(null);
  const [rebookLawyer, setRebookLawyer] = useState(null);
  const [docsFor, setDocsFor] = useState(null);
  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [slotsState, setSlotsState] = useState({ loading: false, error: '', dates: [], timezone: '' });
  const [slotDate, setSlotDate] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const loadedRef = useRef(false);
  const displayedQueryRef = useRef('');
  const tabsRef = useRef(null);
  const slotsControllerRef = useRef(null);
  const actionLocksRef = useRef(new Set());
  const [unavailableLawyers, setUnavailableLawyers] = useState(new Set());
  const expiryRefetchedRef = useRef(new Set());
  const lastRefreshRequestRef = useRef(0);
  const joinRefetchedRef = useRef(new Set());
  const locale = localeForLanguage(language);
  const queryKey = consultationQueryKey(query);
  const refetch = useCallback(() => {
    const requestedAt = Date.now();
    if (requestedAt - lastRefreshRequestRef.current < 250) return;
    lastRefreshRequestRef.current = requestedAt;
    setReloadToken((value) => value + 1);
  }, []);

  const updateQuery = useCallback((patch, replace = false) => {
    const next = serializeConsultationQuery({ ...query, ...patch });
    setParams(next, { replace });
  }, [currentTab, page, period, querySearch, setParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (location.state?.tab == null || params.has('tab')) return;
    const next = serializeConsultationQuery({ ...query, tab: legacyTab });
    setParams(next, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (querySearch !== search) setSearch(querySearch);
  }, [querySearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector('[aria-selected="true"]');
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [currentTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== querySearch) updateQuery({ search: search.trim(), page: 1 }, true);
    }, 350);
    return () => clearTimeout(timer);
  }, [querySearch, search, updateQuery]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const online = () => { setOffline(false); refetch(); };
    const wentOffline = () => setOffline(true);
    const visible = () => { if (document.visibilityState === 'visible') refetch(); };
    window.addEventListener('online', online);
    window.addEventListener('offline', wentOffline);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(tick); window.removeEventListener('online', online); window.removeEventListener('offline', wentOffline); document.removeEventListener('visibilitychange', visible); };
  }, [refetch]);

  const fetchConsultations = useCallback(async (signal) => {
    const sameQuery = displayedQueryRef.current === queryKey;
    if (loadedRef.current && sameQuery) setRefreshing(true);
    else setInitialLoading(true);
    setError(null);
    try {
      const data = await clientService.consultations.getConsultations({
        bucket: currentTab, page, limit: 10,
        ...(querySearch ? { search: querySearch } : {}),
        ...(period !== 'all' ? { period } : {}),
      }, { signal });
      if (signal?.aborted) return;
      const rows = data.consultations || [];
      const nextTotalPages = Math.max(1, data.totalPages || 1);
      if (!rows.length && page > nextTotalPages) {
        updateQuery({ page: nextTotalPages }, true);
        return;
      }
      setConsultations(rows);
      setCounts((previous) => ({ ...previous, ...(data.counts || {}) }));
      setTotalPages(nextTotalPages);
      setServerOffset(getServerOffset(data.serverNow));
      displayedQueryRef.current = queryKey;
      loadedRef.current = true;
    } catch (requestError) {
      if (requestError?.name === 'CanceledError' || requestError?.code === 'ERR_CANCELED' || signal?.aborted) return;
      setError(requestError);
    } finally {
      if (!signal?.aborted) { setInitialLoading(false); setRefreshing(false); }
    }
  }, [currentTab, page, period, queryKey, querySearch, updateQuery]);

  useEffect(() => {
    const controller = new AbortController();
    fetchConsultations(controller.signal);
    return () => controller.abort();
  }, [fetchConsultations, reloadToken]);

  useEffect(() => {
    const nextExpiry = consultations
      .filter((item) => item.status === 'payment_pending' && item.paymentExpiresAt)
      .map((item) => ({ id: item.id, expiresAt: item.paymentExpiresAt, at: new Date(item.paymentExpiresAt).getTime() }))
      .filter((item) => Number.isFinite(item.at) && !expiryRefetchedRef.current.has(`${item.id}:${item.expiresAt}`))
      .sort((a, b) => a.at - b.at)[0];
    if (!nextExpiry) return undefined;
    const key = `${nextExpiry.id}:${nextExpiry.expiresAt}`;
    const delay = Math.max(0, nextExpiry.at - (Date.now() + serverOffset)) + 100;
    const timer = setTimeout(() => { expiryRefetchedRef.current.add(key); refetch(); }, delay);
    return () => clearTimeout(timer);
  }, [consultations, serverOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pending = consultations.filter((item) => {
      const key = joinPolicyRefreshKey(item);
      return key && !joinRefetchedRef.current.has(key);
    }).sort((left, right) => new Date(left.policy.joinAvailableAt) - new Date(right.policy.joinAvailableAt));
    const next = pending[0];
    const delay = nextJoinPolicyRefreshDelay(next, serverOffset);
    if (delay === null) return undefined;
    const timer = setTimeout(() => {
      joinRefetchedRef.current.add(joinPolicyRefreshKey(next));
      refetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [consultations, refetch, serverOffset]);
  const beginAction = (key) => {
    const consultationId = key.split(':')[0];
    if ([...actionLocksRef.current].some((activeKey) => activeKey.startsWith(`${consultationId}:`))) return false;
    actionLocksRef.current.add(key);
    setLoadingActions(new Set(actionLocksRef.current));
    return true;
  };
  const endAction = (key) => {
    actionLocksRef.current.delete(key);
    setLoadingActions(new Set(actionLocksRef.current));
  };
  const mutate = async (consultation, action, request, successKey) => {
    const key = `${consultation.id}:${action}`;
    if (!beginAction(key)) return false;
    try {
      await request();
      if (successKey) toast.success(t(`consultations.${successKey}`));
      refetch();
      return true;
    } catch (requestError) {
      toast.error(safeRequestError(requestError, t('consultations.actionError'), { language, t }));
      if (requestError?.response?.status === 410) refetch();
      throw requestError;
    } finally { endAction(key); }
  };

  const openRebook = async (consultation) => {
    const lawyerId = consultation.lawyerId || consultation.lawyer?.id;
    if (!lawyerId || unavailableLawyers.has(lawyerId)) return;
    const key = `${consultation.id}:rebook`;
    if (!beginAction(key)) return;
    try {
      const lawyer = await clientService.lawyers.getBookableLawyerDetails(lawyerId);
      if (!lawyer) {
        setUnavailableLawyers((current) => new Set(current).add(lawyerId));
        toast.error(t('consultations.rebookUnavailable'));
        return;
      }
      setRebookLawyer({ lawyer, initialConsultation: consultation });
    } catch (requestError) {
      if (isAuthoritativeUnavailableLawyerError(requestError)) setUnavailableLawyers((current) => new Set(current).add(lawyerId));
      toast.error(safeRequestError(requestError, t('consultations.rebookRetry'), { language, t }));
    } finally { endAction(key); }
  };

  const addToCalendar = (consultation) => {
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

  const loadSlots = async (consultation) => {
    slotsControllerRef.current?.abort();
    const controller = new AbortController();
    slotsControllerRef.current = controller;
    setSlotsState({ loading: true, error: '', dates: [], timezone: '' });
    try {
      const lawyerId = consultation.lawyerId || consultation.lawyer?.id;
      const { data } = await api.get(`/lawyers/${lawyerId}/available-slots`, {
        params: { duration: consultation.duration, clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSlotsState({ loading: false, error: '', dates: data.dates || [], timezone: data.timezone || consultation.scheduleTimezone || '' });
    } catch (requestError) {
      if (controller.signal.aborted || requestError?.code === 'ERR_CANCELED') return;
      setSlotsState({ loading: false, error: safeRequestError(requestError, t('consultations.rescheduleSlotsError'), { language, t }), dates: [], timezone: '' });
    }
  };

  const openReschedule = (consultation) => {
    setRescheduleFor(consultation); setSlotDate(''); setSlotTime('');
    if (![30, 60, 90].includes(Number(consultation.duration))) {
      setSlotsState({ loading: false, error: t('consultations.invalidDuration'), dates: [], timezone: '' });
      return;
    }
    loadSlots(consultation);
  };

  const closeReschedule = () => {
    slotsControllerRef.current?.abort();
    setRescheduleFor(null);
  };

  useEffect(() => () => slotsControllerRef.current?.abort(), []);

  const handleAction = async (action, consultation) => {
    if (action === 'view_details') { navigate(`/consultations/${consultation.id}`, { state: { from: `${location.pathname}${location.search}` } }); return; }
    if (action === 'join') {
      const key = `${consultation.id}:join`;
      if (!beginAction(key)) return;
      try { await launchConsultation(consultation, navigate, { now: now + serverOffset }); }
      catch (requestError) { toast.error(safeRequestError(requestError, t('consultations.joinUnavailable'), { language, t })); }
      finally { endAction(key); }
      return;
    }
    if (action === 'pay') {
      if (isPaymentExpired(consultation, now, serverOffset)) { await openRebook(consultation); return; }
      const key = `${consultation.id}:pay`;
      if (!beginAction(key)) return;
      let expired = false;
      try {
        const result = await clientService.lawyers.payConsultation(consultation.id);
        if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
        toast.success(t('consultations.paymentSuccess')); refetch();
      } catch (requestError) {
        expired = requestError?.response?.status === 410;
        toast.error(safeRequestError(requestError, t('consultations.paymentError'), { language, t }));
        if (expired) refetch();
      }
      finally { endAction(key); }
      if (expired) await openRebook(consultation);
      return;
    }
    if (action === 'cancel') { setCancelFor(consultation); setCancelReason(''); return; }
    if (action === 'reschedule') { openReschedule(consultation); return; }
    if (action === 'rate') { setRatingFor(consultation); return; }
    if (action === 'rebook') { await openRebook(consultation); return; }
    if (action === 'open_chat' || action === 'read_chat') { navigate(`/consultations/chat/${consultation.id}`); return; }
    if (action === 'documents') { setDocsFor(consultation); return; }
    if (action === 'calendar') { addToCalendar(consultation); return; }
    if (action === 'complete') {
      if (!window.confirm(t('consultations.completeConfirm'))) return;
      await mutate(consultation, action, () => clientService.consultations.completeConsultation(consultation.id), 'completeSuccess').catch(() => {});
      return;
    }
    if (action === 'archive' || action === 'unarchive') {
      await mutate(consultation, action, () => clientService.consultations.archive(consultation.id, action === 'archive'), action === 'archive' ? 'archiveSuccess' : 'unarchiveSuccess').catch(() => {});
    }
  };

  const submitCancellation = async () => {
    if (!cancelReason.trim()) return;
    try {
      if (await mutate(cancelFor, 'cancel', () => clientService.consultations.cancelConsultation(cancelFor.id, cancelReason.trim()), 'cancelSuccess')) {
        setCancelFor(null); setCancelReason('');
      }
    } catch { /* error is already shown by mutate */ }
  };

  const submitReschedule = async () => {
    if (!slotDate || !slotTime || !rescheduleFor) return;
    try {
      if (await mutate(rescheduleFor, 'reschedule', () => clientService.consultations.reschedule(rescheduleFor.id, slotDate, slotTime), 'rescheduleOk')) closeReschedule();
    } catch (requestError) {
      if (requestError?.response?.status === 410) {
        const expiredConsultation = rescheduleFor;
        closeReschedule();
        await openRebook(expiredConsultation);
      }
    }
  };

  const submitRating = async ({ rating, text }) => {
    const key = `${ratingFor.id}:rate`;
    if (!beginAction(key)) return;
    try {
      await clientLawyerService.leaveReview(ratingFor.lawyerId || ratingFor.lawyer?.id, { consultationId: ratingFor.id, rating, text });
      toast.success(t('consultations.reviewThanks')); setRatingFor(null); refetch();
    } finally { endAction(key); }
  };

  const tabs = [
    ['all', 'tabAll'], ['payment_pending', 'tabPaymentPending'], ['upcoming', 'tabUpcoming'],
    ['completed', 'tabCompleted'], ['cancelled', 'tabCancelled'], ['archived', 'tabArchive'],
  ];
  const emptyKey = querySearch ? 'Search' : ({ all: 'All', payment_pending: 'Payment', upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled', archived: 'Archive' }[currentTab]);
  const emptyHasAction = !querySearch && ['all', 'upcoming'].includes(currentTab);
  const selectedSlots = slotsState.dates.find((item) => item.date === slotDate)?.slots || [];
  const selectedSlot = selectedSlots.find((slot) => slot.time === slotTime);
  const actionBusy = loadingActions.size > 0;
  const showingCurrentQuery = displayedQueryRef.current === queryKey;
  const visibleConsultations = showingCurrentQuery ? consultations : [];

  const selectTab = (key, element) => {
    updateQuery({ tab: key, page: 1 });
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const handleTabKeyDown = (event, index) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[nextIndex];
    next?.focus();
    selectTab(tabs[nextIndex][0], next);
  };

  return (
    <GlassShell active="/consultations" title={t('consultations.title')} subtitle={t('consultations.subtitle')}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
          <div ref={tabsRef} role="tablist" aria-label={t('consultations.tabsLabel')} className="consultation-tabs" style={{ ...glassCard, display: 'flex', gap: 4, padding: 5, maxWidth: '100%', overflowX: 'auto' }}>
            {tabs.map(([key, label], index) => <button type="button" role="tab" id={`consultation-tab-${key}`} aria-controls="consultation-panel" aria-selected={currentTab === key} tabIndex={currentTab === key ? 0 : -1} key={key} onClick={(event) => selectTab(key, event.currentTarget)} onKeyDown={(event) => handleTabKeyDown(event, index)} className={currentTab === key ? 'consultation-tab active' : 'consultation-tab'}>{t(`consultations.${label}`)} ({counts[key] || 0})</button>)}
          </div>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => navigate('/lawyers')}>{t('consultations.book')}</Button>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <TextField size="small" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('consultations.searchPlaceholder')} inputProps={{ 'aria-label': t('consultations.searchPlaceholder') }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment> }} sx={{ flex: '1 1 260px' }} />
          <select value={period} onChange={(event) => updateQuery({ period: event.target.value, page: 1 })} aria-label={t('consultations.periodLabel')} className="consultation-select">
            <option value="all">{t('consultations.periodAll')}</option><option value="30d">{t('consultations.period30')}</option><option value="365d">{t('consultations.period365')}</option>
          </select>
        </div>
        {refreshing && <LinearProgress aria-label={t('consultations.refreshing')} sx={{ mb: 1, borderRadius: 2 }} />}
        {offline && <div role="status" style={{ ...glassCard, padding: 14, marginBottom: 14 }}>{t('consultations.offline')}</div>}
        <div role="tabpanel" id="consultation-panel" aria-labelledby={`consultation-tab-${currentTab}`} tabIndex={0}>
        {(initialLoading || (!showingCurrentQuery && !error)) ? <div style={{ display: 'grid', gap: 16 }}>{[1, 2, 3].map((key) => <SkeletonCard key={key} lines={3} />)}</div>
          : error && visibleConsultations.length === 0 ? <ErrorState error={t('consultations.loadError')} onRetry={refetch} />
            : visibleConsultations.length ? <div style={{ display: 'grid', gap: 16 }}>{visibleConsultations.map((consultation) => <ConsultationCard key={consultation.id} consultation={consultation} now={now} serverOffset={serverOffset} loadingAction={loadingActions} disabledActions={unavailableLawyers.has(consultation.lawyerId || consultation.lawyer?.id) ? ['rebook'] : []} onAction={handleAction} from={`${location.pathname}${location.search}`} />)}{totalPages > 1 && <Pagination page={page} count={totalPages} onChange={(_, value) => updateQuery({ page: value })} sx={{ justifySelf: 'center' }} />}</div>
              : <EmptyState title={t(`consultations.empty${emptyKey}Title`)} subtitle={t(`consultations.empty${emptyKey}Sub`)} actionLabel={emptyHasAction ? t('consultations.findLawyer') : undefined} onAction={emptyHasAction ? () => navigate('/lawyers') : undefined} />}
        {error && visibleConsultations.length > 0 && <div role="alert" style={{ marginTop: 12, color: '#B07070' }}>{t('consultations.refreshError')} <button type="button" onClick={refetch}>{t('consultations.retry')}</button></div>}
        </div>
      </div>

      <Dialog open={Boolean(cancelFor)} onClose={actionBusy ? undefined : () => setCancelFor(null)} aria-labelledby="cancel-consultation-title" maxWidth="sm" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
        <DialogTitle id="cancel-consultation-title" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('consultations.cancelModalTitle')}<IconButton aria-label={t('consultations.close')} onClick={() => setCancelFor(null)} disabled={actionBusy}><CloseOutlined /></IconButton></DialogTitle>
        <DialogContent><TextField required autoFocus fullWidth multiline minRows={4} label={t('consultations.cancelReasonLabel')} placeholder={t('consultations.cancelReasonPlaceholder')} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} error={Boolean(cancelFor && !cancelReason.trim())} helperText={!cancelReason.trim() ? t('consultations.cancelReasonRequired') : ' '} /></DialogContent>
        <DialogActions><Button onClick={() => setCancelFor(null)} disabled={actionBusy}>{t('consultations.back')}</Button><Button color="error" variant="contained" disabled={!cancelReason.trim() || actionBusy} onClick={submitCancellation}>{actionBusy ? t('consultations.actionLoading') : t('consultations.cancelConfirm')}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(rescheduleFor)} onClose={actionBusy ? undefined : closeReschedule} aria-labelledby="reschedule-consultation-title" maxWidth="sm" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
        <DialogTitle id="reschedule-consultation-title" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('consultations.reschedule')}<IconButton aria-label={t('consultations.close')} onClick={closeReschedule} disabled={actionBusy}><CloseOutlined /></IconButton></DialogTitle>
        {slotsState.loading && <LinearProgress aria-label={t('consultations.loadingSlots')} />}
        <DialogContent>
          <p style={{ color: 'var(--text2)', marginTop: 0 }}>{t('consultations.rescheduleSub')}</p>
          {slotsState.error && <div role="alert" style={{ color: '#B07070', marginBottom: 14 }}>{slotsState.error} <Button onClick={() => loadSlots(rescheduleFor)}>{t('consultations.retry')}</Button></div>}
          {!slotsState.loading && !slotsState.error && slotsState.dates.length === 0 && <EmptyState title={t('consultations.noSlotsTitle')} subtitle={t('consultations.noSlotsSub')} />}
          {slotsState.dates.length > 0 && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 190px' }}>{t('consultations.newDate')}<select className="consultation-select full" value={slotDate} onChange={(event) => { setSlotDate(event.target.value); setSlotTime(''); }}><option value="">{t('consultations.selectOption')}</option>{slotsState.dates.map((item) => <option key={item.date} value={item.date}>{new Date(`${item.date}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'full' })}</option>)}</select></label>
            <label style={{ flex: '1 1 150px' }}>{t('consultations.newTime')}<select className="consultation-select full" value={slotTime} onChange={(event) => setSlotTime(event.target.value)} disabled={!slotDate}><option value="">{t('consultations.selectOption')}</option>{selectedSlots.map((slot) => <option key={`${slot.clientDate || slotDate}-${slot.time}`} value={slot.time}>{slot.clientDate && slot.clientDate !== slotDate ? `${new Date(`${slot.clientDate}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'medium' })} ` : ''}{slot.clientTime || slot.time}</option>)}</select></label>
          </div>}
          {slotsState.timezone && <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t('consultations.rescheduleTimezones', { lawyer: slotsState.timezone, client: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>}
          {selectedSlot && <div role="status" style={{ ...glassCard, padding: 14, marginTop: 14 }}>{t('consultations.rescheduleConfirm', { date: new Date(`${selectedSlot.clientDate || slotDate}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'long' }), time: selectedSlot.clientTime || slotTime, duration: rescheduleFor?.duration })}</div>}
        </DialogContent>
        <DialogActions><Button onClick={closeReschedule} disabled={actionBusy}>{t('consultations.cancel')}</Button><Button variant="contained" onClick={submitReschedule} disabled={!selectedSlot || actionBusy || slotsState.loading}>{actionBusy ? <CircularProgress size={18} /> : t('consultations.rescheduleSave')}</Button></DialogActions>
      </Dialog>

      <RatingDialog open={Boolean(ratingFor)} onClose={() => setRatingFor(null)} onSubmit={submitRating} lawyerName={ratingFor?.lawyer?.name} />
      <BookingModal open={Boolean(rebookLawyer)} onClose={() => setRebookLawyer(null)} lawyer={rebookLawyer?.lawyer || rebookLawyer || {}} initialConsultation={rebookLawyer?.initialConsultation || null} />
      <CaseDocuments consultationId={docsFor?.id} open={Boolean(docsFor)} onClose={() => setDocsFor(null)} currentUserId={user?.id} readOnly={!isConsultationWritable(docsFor, 'documentsWritable')} />
      <style>{`
        .consultation-tabs{scrollbar-width:none;scroll-padding-inline:10px}.consultation-tabs::-webkit-scrollbar{display:none}.consultation-tab{min-height:44px;padding:9px 15px;border:0;border-radius:var(--radius);background:transparent;color:var(--text2);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;scroll-margin-inline:10px}.consultation-tab.active{background:var(--accent);color:#fff}.consultation-tab:focus-visible{outline:2px solid var(--text);outline-offset:2px}.consultation-select{min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;max-width:100%}.consultation-select.full{display:block;width:100%;margin-top:6px}
        @media(max-width:600px){.consultation-tabs{width:100%}}
      `}</style>
    </GlassShell>
  );
};

export default ConsultationsPageGlass;
