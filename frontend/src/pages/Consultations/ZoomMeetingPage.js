import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import { zoomTimeWarning } from './zoomTime';
import { useTranslation } from '../../i18n';
import { safeRequestError } from '../../utils/consultationPresentation';
import { createReconnectTracker } from './zoomReconnect';
import { localeForLanguage, zoomLocaleForLanguage } from '../../utils/consultationLocale';
import { classifyMediaError, mediaConstraints, reconcileMediaSelection } from '../../utils/mediaSession';
import { zoomAudioOnlyCapability, zoomClientInitOptions } from './zoomAudioOnly';

const button = { minHeight: 44, border: 0, borderRadius: 10, padding: '10px 18px', cursor: 'pointer', font: 'inherit' };
const formatTime = (value, timezone, locale) => new Intl.DateTimeFormat(locale, {
  timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const explainMediaError = (failure, t) => t(`zoomMeeting.media_${failure.device}_${failure.reason}`);
const lifecycleKey = (value) => ['scheduled', 'ready', 'rescheduled', 'in_progress', 'started', 'completed', 'no_show_client', 'no_show_lawyer', 'no_show_both', 'cancelled', 'provider_cancelled'].includes(value) ? value : 'unknown';

const ZoomMeetingPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const locale = localeForLanguage(language);
  const sdkRoot = useRef(null);
  const preview = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const sdkClientRef = useRef(null);
  const reconnectTrackerRef = useRef(null);
  const mountedRef = useRef(true);
  const joinGenerationRef = useRef(0);
  const mobileListenerRegisteredRef = useRef(false);
  const [preflight, setPreflight] = useState(null);
  const [devices, setDevices] = useState({ cameras: [], microphones: [], speakers: [] });
  const [selected, setSelected] = useState({ camera: '', microphone: '', speaker: '' });
  const [mediaError, setMediaError] = useState('');
  const [mediaFailure, setMediaFailure] = useState(null);
  const [meterState, setMeterState] = useState('idle');
  const [permissionState, setPermissionState] = useState('prompt');
  const [micLevel, setMicLevel] = useState(0);
  const [status, setStatus] = useState('checking');
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [attempts, setAttempts] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [timeWarning, setTimeWarning] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const warnedRef = useRef(new Set());
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    || window.matchMedia('(max-width: 900px)').matches;

  const reportTelemetry = (event) => api.post(`/zoom/consultations/${consultationId}/telemetry`, { event }).catch(() => {});
  if (!reconnectTrackerRef.current) {
    reconnectTrackerRef.current = createReconnectTracker(reportTelemetry, () => {
      if (!mountedRef.current) return;
      setStatus('error');
      setMediaError(t('zoomMeeting.reconnectFailed'));
    });
  }

  const cleanupSdkSession = async () => {
    const session = sdkClientRef.current;
    sdkClientRef.current = null;
    if (session?.type === 'component') {
      session.client.off?.('connection-change', session.connectionHandler);
      await session.client.leaveMeeting?.().catch?.(() => {});
      session.destroy?.();
    } else if (session?.type === 'client') {
      session.ZoomMtg.leaveMeeting?.({ confirm: false });
      const root = document.getElementById('zmmtg-root');
      if (root) root.style.display = 'none';
    }
  };

  const loadPreflight = async (silent = false) => {
    if (!silent) setStatus('checking');
    try {
      const { data } = await api.get(`/zoom/consultations/${consultationId}/preflight`);
      setPreflight(data);
      setServerOffset(new Date(data.serverNow).getTime() - Date.now());
      if (!silent) setStatus('lobby');
    } catch (error) {
      setMediaError(safeRequestError(error, t('zoomMeeting.loadError'), { language, t }));
      setStatus('error');
    }
  };

  useEffect(() => { loadPreflight(); }, [consultationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!preflight || ['connecting', 'connected', 'reconnecting', 'ended'].includes(status)) return undefined;
    const timer = setInterval(() => loadPreflight(true), preflight.preparing ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [preflight?.preparing, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinGenerationRef.current += 1;
      reconnectTrackerRef.current?.dispose();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.close?.();
      cleanupSdkSession();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!['connected', 'reconnecting'].includes(status)) return undefined;
    const preventAccidentalExit = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [status]);

  const checkEquipment = async (forceAudioOnly = audioOnly) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.close?.();
    setMediaError('');
    setMediaFailure(null);
    setMeterState('checking');
    setPermissionState('checking');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupportedError' });
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints({
        audioOnly: forceAudioOnly,
        cameraId: forceAudioOnly ? '' : selected.camera,
        microphoneId: selected.microphone,
      }));
      streamRef.current = stream;
      setPermissionState('granted');
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (!mountedRef.current) return;
          const device = track.kind === 'audio' ? 'microphone' : 'camera';
          const failure = { reason: 'revoked', device, canUseAudioOnly: device === 'camera' && !forceAudioOnly };
          setMediaFailure(failure); setMediaError(explainMediaError(failure, t)); setPermissionState('revoked');
        };
      });
      if (preview.current) preview.current.srcObject = stream;
      const list = await navigator.mediaDevices.enumerateDevices();
      const nextDevices = {
        cameras: list.filter((item) => item.kind === 'videoinput'), microphones: list.filter((item) => item.kind === 'audioinput'), speakers: list.filter((item) => item.kind === 'audiooutput'),
      };
      setDevices(nextDevices);
      setSelected((current) => reconcileMediaSelection(current, nextDevices));
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { setMeterState('unsupported'); setStatus('ready'); return; }
      const context = new AC(); audioRef.current = context;
      if (context.state === 'suspended') await context.resume().catch(() => {});
      if (context.state === 'suspended') { setMeterState('suspended'); setStatus('ready'); return; }
      setMeterState('active');
      const analyser = context.createAnalyser(); analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => { if (audioRef.current !== context) return; analyser.getByteFrequencyData(values); setMicLevel(Math.round(values.reduce((a, b) => a + b, 0) / values.length)); requestAnimationFrame(sample); };
      sample();
      setStatus('ready');
    } catch (error) {
      const failure = classifyMediaError(error, { audioOnly: forceAudioOnly });
      setMediaFailure(failure);
      setMediaError(explainMediaError(failure, t));
      setMeterState('idle');
      setPermissionState(failure.reason);
      setStatus('lobby');
    }
  };

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const refresh = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const nextDevices = {
        cameras: list.filter((item) => item.kind === 'videoinput'), microphones: list.filter((item) => item.kind === 'audioinput'), speakers: list.filter((item) => item.kind === 'audiooutput'),
      };
      setDevices(nextDevices);
      setSelected((current) => reconcileMediaSelection(current, nextDevices));
    };
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  const openExternal = async () => {
    const popup = window.open('about:blank', '_blank');
    try {
      const { data } = await api.post(`/zoom/consultations/${consultationId}/access`);
      if (!data.url) {
        popup?.close();
        setMediaError(data.error || t('zoomMeeting.preparing'));
        await loadPreflight();
        return;
      }
      if (data.role === 'client') setFallbackUrl(data.url);
      else setFallbackUrl('');
      if (popup) { popup.opener = null; popup.location.replace(data.url); }
      else window.location.assign(data.url);
    } catch (error) {
      popup?.close(); setMediaError(safeRequestError(error, t('zoomMeeting.unavailable'), { language, t }));
    }
  };

  const testSound = async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { setMeterState('unsupported'); return; }
    const context = new AC();
    if (context.state === 'suspended') await context.resume().catch(() => {});
    if (selected.speaker && typeof context.setSinkId === 'function') await context.setSinkId(selected.speaker).catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain(); gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.5);
    oscillator.onended = () => context.close();
  };

  const joinSdk = async (retry = 0) => {
    if (!preflight?.sdkEnabled) return openExternal();
    setStatus('connecting'); setMediaError('');
    const generation = retry === 0 ? ++joinGenerationRef.current : joinGenerationRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.close?.(); audioRef.current = null;
    try {
      const { data } = await api.post(`/zoom/consultations/${consultationId}/sdk-access`);
      if (!mountedRef.current || generation !== joinGenerationRef.current) return;
      if (mobile) {
        const { ZoomMtg } = await import('@zoom/meetingsdk');
        if (!mountedRef.current || generation !== joinGenerationRef.current) return;
        ZoomMtg.preLoadWasm(); ZoomMtg.prepareWebSDK();
        const root = document.getElementById('zmmtg-root'); if (root) root.style.display = 'block';
        if (!mobileListenerRegisteredRef.current) {
          ZoomMtg.inMeetingServiceListener('onMeetingStatus', ({ status: meetingStatus }) => {
            if (!mountedRef.current) return;
            if (meetingStatus === 2) {
              reconnectTrackerRef.current.connected();
              setStatus('connected');
            } else if (meetingStatus === 4) {
              reconnectTrackerRef.current.started();
              setStatus('reconnecting');
            }
            else if (meetingStatus === 3) {
              const root = document.getElementById('zmmtg-root'); if (root) root.style.display = 'none';
              sdkClientRef.current = null;
              setStatus('ended');
            }
          });
          mobileListenerRegisteredRef.current = true;
        }
        sdkClientRef.current = { type: 'client', ZoomMtg };
        await new Promise((resolve, reject) => ZoomMtg.init(zoomClientInitOptions({
          leaveUrl: `${window.location.origin}/consultations`, patchJsMedia: true,
          success: () => {
            if (!mountedRef.current || generation !== joinGenerationRef.current) {
              ZoomMtg.leaveMeeting?.({ confirm: false }); reject(Object.assign(new Error('Join cancelled'), { code: 'JOIN_CANCELLED' })); return;
            }
            ZoomMtg.join({ signature: data.signature, meetingNumber: data.meetingNumber, passWord: data.password, userName: data.userName, customerKey: data.customerKey, ...(data.zak ? { zak: data.zak } : {}), success: resolve, error: reject });
          }, error: reject,
        }, audioOnly)));
        if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
        setStatus('connected'); setAttempts(0);
        if (!reconnectTrackerRef.current.connected()) reportTelemetry(retry ? 'reconnect_succeeded' : 'join_succeeded');
        return;
      }
      const [{ default: ZoomMtgEmbedded }] = await Promise.all([import('@zoom/meetingsdk/embedded'), import('@zoom/meetingsdk/dist/ui/zoom-meetingsdk.css')]);
      if (!mountedRef.current || generation !== joinGenerationRef.current) return;
      if (sdkClientRef.current?.type === 'component') {
        sdkClientRef.current.client.off?.('connection-change', sdkClientRef.current.connectionHandler);
        await sdkClientRef.current.client.leaveMeeting?.().catch?.(() => {});
        sdkClientRef.current.destroy?.();
      }
      const client = ZoomMtgEmbedded.createClient();
      const requirements = client.checkSystemRequirements?.();
      if (requirements && (requirements.audio === false || requirements.video === false)) throw Object.assign(new Error(t('zoomMeeting.unsupportedBrowser')), { code: 'UNSUPPORTED_BROWSER' });
      const connectionHandler = (payload) => {
        if (payload.state === 'Reconnecting') {
          reconnectTrackerRef.current.started(); setStatus('reconnecting');
        } else if (payload.state === 'Connected') {
          const reconnected = reconnectTrackerRef.current.connected();
          setStatus('connected');
          if (!reconnected) reportTelemetry('join_succeeded');
        } else if (payload.state === 'Closed') { reconnectTrackerRef.current.dispose(); setStatus('ended'); reportTelemetry('meeting_completed'); }
      };
      client.on('connection-change', connectionHandler);
      sdkClientRef.current = { type: 'component', client, connectionHandler, destroy: ZoomMtgEmbedded.destroyClient };
      await client.init({ zoomAppRoot: sdkRoot.current, language: zoomLocaleForLanguage(language), patchJsMedia: true, leaveOnPageUnload: true, customize: { video: { isResizable: true } } });
      if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
      await client.join({ signature: data.signature, meetingNumber: data.meetingNumber, password: data.password, userName: data.userName, customerKey: data.customerKey, ...(data.zak ? { zak: data.zak } : {}) });
      if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
      setStatus('connected'); setAttempts(0);
    } catch (error) {
      const nextAttempt = retry + 1;
      setAttempts(nextAttempt);
      if (retry) reconnectTrackerRef.current.failed(); else reportTelemetry('join_failed');
      const responseStatus = error.response?.status;
      const retryable = !responseStatus || responseStatus === 429 || responseStatus >= 500;
      if (retryable && error.code !== 'UNSUPPORTED_BROWSER' && nextAttempt < 3) {
        await cleanupSdkSession();
        setStatus('reconnecting');
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** retry)));
        if (!mountedRef.current || generation !== joinGenerationRef.current) return;
        return joinSdk(nextAttempt);
      }
      await cleanupSdkSession();
      setStatus('error');
      setMediaError(safeRequestError(error, t('zoomMeeting.joinError'), { language, t }));
    }
  };

  const serverNow = now + serverOffset;
  const endsAt = preflight ? new Date(preflight.scheduledEndAt).getTime() : 0;
  const graceEndsAt = preflight?.graceEndsAt ? new Date(preflight.graceEndsAt).getTime() : endsAt;
  const remaining = Math.max(0, Math.ceil((endsAt - serverNow) / 1000));
  const canJoin = Boolean(preflight?.access?.canJoin);
  const network = navigator.connection;
  const weakNetwork = network && (network.effectiveType === '2g' || Number(network.rtt) > 500 || Number(network.downlink) < 1);
  const networkLabel = !network ? t('zoomMeeting.networkZoom') : weakNetwork ? t('zoomMeeting.networkWeak') : Number(network.rtt) > 250 ? t('zoomMeeting.networkMedium') : t('zoomMeeting.networkGood');
  const audioOnlyCapability = zoomAudioOnlyCapability(mobile ? 'client' : 'component', audioOnly);
  let equipmentActionLabel = t('zoomMeeting.retryCheck');
  if (status === 'error') equipmentActionLabel = t('zoomMeeting.retryPreflight');
  else if (mediaFailure?.reason === 'denied' || mediaFailure?.reason === 'revoked') equipmentActionLabel = t('zoomMeeting.allowAccess');
  const leavePage = async () => {
    if (['connected', 'reconnecting'].includes(status) && !window.confirm(t('zoomMeeting.leaveConfirm'))) return;
    await cleanupSdkSession();
    navigate(-1);
  };
  const retryFromError = async () => {
    setAttempts(0);
    await loadPreflight();
  };
  useEffect(() => {
    if (!preflight || !['connected', 'reconnecting'].includes(status)) return;
    const warning = zoomTimeWarning(remaining);
    if (warning && !warnedRef.current.has(warning.key)) {
      warnedRef.current.add(warning.key);
      setTimeWarning(warning.textKey);
    }
  }, [preflight, remaining, status]);
  useEffect(() => {
    if (!preflight || serverNow < graceEndsAt || status === 'ended') return;
    cleanupSdkSession();
    setStatus('ended');
  }, [graceEndsAt, preflight, serverNow, status]);

  return <main style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: '#15130f', color: '#f5efe6', padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div><strong>eMaslaXat · Zoom</strong><div aria-live="polite" style={{ color: '#c9a980', fontSize: 13 }}>{status === 'reconnecting' ? t('zoomMeeting.reconnecting') : status === 'connected' ? t('zoomMeeting.connected') : t('zoomMeeting.preflight')}</div></div>
        <button type="button" style={{ ...button, background: '#2b2721', color: '#fff' }} onClick={leavePage}>{['connected', 'reconnecting'].includes(status) ? t('zoomMeeting.leave') : t('zoomMeeting.back')}</button>
      </header>
      {preflight && <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, color: '#d8cdbd' }}>
        <span>{preflight.role === 'lawyer' ? t('zoomMeeting.roleHost') : t('zoomMeeting.roleParticipant')}</span><span>{t('zoomMeeting.duration', { minutes: preflight.duration })}</span><span>{t('zoomMeeting.status', { status: t(`zoomMeeting.lifecycle_${lifecycleKey(preflight.lifecycleStatus)}`) })}</span>
        <span>{formatTime(preflight.scheduledStartAt, preflight.timezone, locale)} ({preflight.timezone})</span>
        <span aria-live="off">{t('zoomMeeting.remaining', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` })}</span><span>{networkLabel}</span>
      </section>}
      {timeWarning && <div role="status" aria-live="assertive" style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: '#5a4328' }}>{t(`zoomMeeting.${timeWarning === 'warningGrace' ? 'warningGraceConfigured' : timeWarning}`, { minutes: preflight?.graceMinutes })}</div>}
      {status === 'ended' && <section role="status" style={{ padding: 24, borderRadius: 14, background: '#211e19', textAlign: 'center' }}><h1>{t('zoomMeeting.ended')}</h1><button type="button" style={{ ...button, background: '#b8956e', color: '#fff' }} onClick={() => navigate('/consultations')}>{t('zoomMeeting.done')}</button></section>}
      {!['connecting', 'connected', 'reconnecting', 'ended'].includes(status) && <section style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(280px, 380px)', gap: 20 }}>
        <div style={{ position: 'relative', minHeight: 260, borderRadius: 14, overflow: 'hidden', background: '#000' }}>
          <video ref={preview} autoPlay muted playsInline style={{ width: '100%', minHeight: 260, maxHeight: 520, objectFit: 'cover', visibility: audioOnly ? 'hidden' : 'visible' }} />
          {audioOnly && <div data-testid="zoom-audio-only-preview" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#c9a980', textAlign: 'center', padding: 20 }}>{t('zoomMeeting.audioOnlyActive')}</div>}
        </div>
        <div style={{ background: '#211e19', borderRadius: 14, padding: 20 }}>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>{t('zoomMeeting.equipment')}</h1>
          <p>{t('zoomMeeting.browser')}: {navigator.mediaDevices ? t('zoomMeeting.supported') : t('zoomMeeting.unsupported')}</p>
          {weakNetwork && <p role="alert" style={{ color: '#efb16f' }}>{t('zoomMeeting.unstableNetwork')}</p>}
          {!audioOnly && <label>{t('zoomMeeting.camera')}<select aria-label={t('zoomMeeting.selectCamera')} value={selected.camera} onChange={(e) => setSelected({ ...selected, camera: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.cameras.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || t('zoomMeeting.camera')}</option>)}</select></label>}
          <label>{t('zoomMeeting.microphone')}<select aria-label={t('zoomMeeting.selectMicrophone')} value={selected.microphone} onChange={(e) => setSelected({ ...selected, microphone: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.microphones.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || t('zoomMeeting.microphone')}</option>)}</select></label>
          {devices.speakers.length > 0 && <label>{t('zoomMeeting.speaker')}<select aria-label={t('zoomMeeting.selectSpeaker')} value={selected.speaker} onChange={(e) => setSelected({ ...selected, speaker: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.speakers.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || t('zoomMeeting.speaker')}</option>)}</select></label>}
          <p style={{ fontSize: 12, color: '#b9ad9c' }}>{t('zoomMeeting.localCheck')}</p>
          <p role="status" data-testid="zoom-permission-state" style={{ fontSize: 12, color: permissionState === 'granted' ? '#9fc58c' : '#c9a980' }}>{audioOnly && permissionState === 'granted' ? t('zoomMeeting.audioOnlyActive') : t(`zoomMeeting.permission_${permissionState}`)}</p>
          <div role="progressbar" aria-label={t('zoomMeeting.micLevel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, micLevel)} style={{ height: 8, margin: '14px 0', background: '#3a342b', borderRadius: 8 }}><div style={{ width: `${Math.min(100, micLevel)}%`, height: '100%', background: '#7fa76d', borderRadius: 8 }} /></div>
          {meterState === 'unsupported' && <p role="status" style={{ color: '#b9ad9c' }}>{t('zoomMeeting.meterUnsupported')}</p>}
          {meterState === 'suspended' && <p role="status" style={{ color: '#b9ad9c' }}>{t('zoomMeeting.meterSuspended')}</p>}
          {mediaError && <p role="alert" style={{ color: '#ef8e79' }}>{mediaError}</p>}
          {audioOnlyCapability.requiresZoomControl && <p role="status" style={{ color: '#efb16f' }}>{t('zoomMeeting.audioOnlyZoomControl')}</p>}
          {preflight?.preparing && <p role="status" style={{ color: '#c9a980' }}>{t('zoomMeeting.preparingAuto')}</p>}
          {preflight?.failed && <p role="alert" style={{ color: '#ef8e79' }}>{preflight.safeError || t('zoomMeeting.prepareFailed')} {t('zoomMeeting.prepareFailedAction')}</p>}
          {preflight && !preflight.paid && <p role="alert" style={{ color: '#efb16f' }}>{t('zoomMeeting.paymentRequired')}</p>}
          {!canJoin && preflight?.access?.opensAt && <p>{t('zoomMeeting.lobbyOpens', { time: formatTime(preflight.access.opensAt, preflight.timezone, locale), timezone: preflight.timezone })}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...button, background: '#51483d', color: '#fff' }} onClick={status === 'error' ? retryFromError : () => checkEquipment()}>{equipmentActionLabel}</button>
            <button type="button" style={{ ...button, background: '#51483d', color: '#fff' }} onClick={testSound}>{t('zoomMeeting.testSound')}</button>
             {!audioOnly && <button type="button" style={{ ...button, background: '#51483d', color: '#fff' }} onClick={() => { setAudioOnly(true); checkEquipment(true); }}>{mediaFailure?.canUseAudioOnly ? t('zoomMeeting.continueAudioOnly') : t('zoomMeeting.audioOnly')}</button>}
            <button type="button" style={{ ...button, background: '#b8956e', color: '#fff', opacity: canJoin && preflight?.paid && !preflight?.preparing ? 1 : .5 }} disabled={!canJoin || !preflight?.paid || preflight?.preparing} onClick={() => joinSdk(0)}>{preflight?.role === 'lawyer' ? t('zoomMeeting.start') : t('zoomMeeting.join')}</button>
            <button type="button" style={{ ...button, background: '#2b2721', color: '#fff', opacity: canJoin && preflight?.externalFallback ? 1 : .5 }} disabled={!canJoin || !preflight?.externalFallback} onClick={openExternal}>{t('zoomMeeting.openZoom')}</button>
            {fallbackUrl && preflight?.role === 'client' && <button type="button" style={{ ...button, background: '#2b2721', color: '#fff' }} onClick={() => navigator.clipboard.writeText(fallbackUrl)}>{t('zoomMeeting.copyLink')}</button>}
          </div>
            {attempts >= 3 && <button type="button" style={{ ...button, marginTop: 10 }} onClick={() => navigate('/help')}>{t('zoomMeeting.support')}</button>}
            {preflight?.failed && <button type="button" style={{ ...button, marginTop: 10 }} onClick={() => navigate('/consultations')}>{t('zoomMeeting.reschedule')}</button>}
        </div>
      </section>}
      <div ref={sdkRoot} style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', height: ['connecting', 'connected', 'reconnecting'].includes(status) ? 'calc(100dvh - 120px)' : 0, minHeight: ['connecting', 'connected', 'reconnecting'].includes(status) ? 'min(560px, calc(100dvh - 120px))' : 0 }} />
    </div>
  </main>;
};

export default ZoomMeetingPage;
