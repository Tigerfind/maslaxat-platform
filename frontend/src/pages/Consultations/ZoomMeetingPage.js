import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import { zoomTimeWarning } from './zoomTime';

const button = { minHeight: 44, border: 0, borderRadius: 10, padding: '10px 18px', cursor: 'pointer', font: 'inherit' };
const formatTime = (value, timezone) => new Intl.DateTimeFormat(undefined, {
  timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const explainMediaError = (error) => {
  if (error?.name === 'NotAllowedError') return 'Доступ к камере или микрофону запрещён. Разрешите доступ в настройках браузера.';
  if (error?.name === 'NotFoundError') return 'Камера или микрофон не найдены. Подключите устройство или выберите другое.';
  if (error?.name === 'NotReadableError') return 'Камера или микрофон используются другим приложением.';
  return 'Не удалось проверить оборудование. Повторите проверку.';
};

const ZoomMeetingPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const sdkRoot = useRef(null);
  const preview = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const sdkClientRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const joinGenerationRef = useRef(0);
  const mobileListenerRegisteredRef = useRef(false);
  const [preflight, setPreflight] = useState(null);
  const [devices, setDevices] = useState({ cameras: [], microphones: [], speakers: [] });
  const [selected, setSelected] = useState({ camera: '', microphone: '', speaker: '' });
  const [mediaError, setMediaError] = useState('');
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
      setMediaError(error.response?.data?.error || 'Не удалось загрузить видеоконсультацию');
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
      clearTimeout(reconnectTimerRef.current);
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
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupportedError' });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: forceAudioOnly ? false : selected.camera ? { deviceId: { exact: selected.camera } } : true,
          audio: selected.microphone ? { deviceId: { exact: selected.microphone } } : true,
        });
      } catch (error) {
        if (!forceAudioOnly && ['NotFoundError', 'NotReadableError'].includes(error.name)) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setAudioOnly(true);
        } else throw error;
      }
      streamRef.current = stream;
      if (preview.current) preview.current.srcObject = stream;
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cameras: list.filter((item) => item.kind === 'videoinput'), microphones: list.filter((item) => item.kind === 'audioinput'), speakers: list.filter((item) => item.kind === 'audiooutput'),
      });
      const context = new AudioContext(); audioRef.current = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => { if (audioRef.current !== context) return; analyser.getByteFrequencyData(values); setMicLevel(Math.round(values.reduce((a, b) => a + b, 0) / values.length)); requestAnimationFrame(sample); };
      sample();
      setStatus('ready');
    } catch (error) { setMediaError(explainMediaError(error)); setStatus('lobby'); }
  };

  const openExternal = async () => {
    const popup = window.open('about:blank', '_blank');
    try {
      const { data } = await api.post(`/zoom/consultations/${consultationId}/access`);
      if (!data.url) {
        popup?.close();
        setMediaError(data.error || 'Подготавливаем видеовстречу');
        await loadPreflight();
        return;
      }
      setFallbackUrl(data.url);
      if (popup) { popup.opener = null; popup.location.replace(data.url); }
      else window.location.assign(data.url);
    } catch (error) {
      popup?.close(); setMediaError(error.response?.data?.error || 'Zoom временно недоступен');
    }
  };

  const testSound = async () => {
    const context = new AudioContext();
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
            if (meetingStatus === 2) setStatus('connected');
            else if (meetingStatus === 4) setStatus('reconnecting');
            else if (meetingStatus === 3) {
              const root = document.getElementById('zmmtg-root'); if (root) root.style.display = 'none';
              sdkClientRef.current = null;
              setStatus('ended');
            }
          });
          mobileListenerRegisteredRef.current = true;
        }
        sdkClientRef.current = { type: 'client', ZoomMtg };
        await new Promise((resolve, reject) => ZoomMtg.init({
          leaveUrl: `${window.location.origin}/consultations`, patchJsMedia: true,
          success: () => {
            if (!mountedRef.current || generation !== joinGenerationRef.current) {
              ZoomMtg.leaveMeeting?.({ confirm: false }); reject(Object.assign(new Error('Join cancelled'), { code: 'JOIN_CANCELLED' })); return;
            }
            ZoomMtg.join({ signature: data.signature, meetingNumber: data.meetingNumber, passWord: data.password, userName: data.userName, customerKey: data.customerKey, ...(data.zak ? { zak: data.zak } : {}), success: resolve, error: reject });
          }, error: reject,
        }));
        if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
        setStatus('connected'); setAttempts(0);
        api.post(`/zoom/consultations/${consultationId}/telemetry`, { event: retry ? 'reconnect_succeeded' : 'join_succeeded' }).catch(() => {});
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
      if (requirements && (requirements.audio === false || requirements.video === false)) throw Object.assign(new Error('Этот браузер не поддерживает необходимые функции Zoom'), { code: 'UNSUPPORTED_BROWSER' });
      const connectionHandler = (payload) => {
        clearTimeout(reconnectTimerRef.current);
        if (payload.state === 'Reconnecting') {
          setStatus('reconnecting'); api.post(`/zoom/consultations/${consultationId}/telemetry`, { event: 'reconnect_started' }).catch(() => {});
          reconnectTimerRef.current = setTimeout(() => { setStatus('error'); setMediaError('Не удалось восстановить соединение. Подключитесь повторно или откройте Zoom.'); }, 15000);
        } else if (payload.state === 'Connected') { setStatus('connected'); api.post(`/zoom/consultations/${consultationId}/telemetry`, { event: attempts ? 'reconnect_succeeded' : 'join_succeeded' }).catch(() => {}); }
        else if (payload.state === 'Closed') { setStatus('ended'); api.post(`/zoom/consultations/${consultationId}/telemetry`, { event: 'meeting_completed' }).catch(() => {}); }
      };
      client.on('connection-change', connectionHandler);
      sdkClientRef.current = { type: 'component', client, connectionHandler, destroy: ZoomMtgEmbedded.destroyClient };
      await client.init({ zoomAppRoot: sdkRoot.current, language: 'ru-RU', patchJsMedia: true, leaveOnPageUnload: true, customize: { video: { isResizable: true } } });
      if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
      await client.join({ signature: data.signature, meetingNumber: data.meetingNumber, password: data.password, userName: data.userName, customerKey: data.customerKey, ...(data.zak ? { zak: data.zak } : {}) });
      if (!mountedRef.current || generation !== joinGenerationRef.current) { await cleanupSdkSession(); return; }
      setStatus('connected'); setAttempts(0);
    } catch (error) {
      const nextAttempt = retry + 1;
      setAttempts(nextAttempt);
      api.post(`/zoom/consultations/${consultationId}/telemetry`, { event: retry ? 'reconnect_failed' : 'join_failed' }).catch(() => {});
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
      setMediaError(error.response?.data?.error || 'Не удалось подключиться к Zoom. Повторите попытку или откройте официальное приложение.');
    }
  };

  const serverNow = now + serverOffset;
  const endsAt = preflight ? new Date(preflight.scheduledEndAt).getTime() : 0;
  const remaining = Math.max(0, Math.ceil((endsAt - serverNow) / 1000));
  const canJoin = Boolean(preflight?.access?.canJoin);
  const network = navigator.connection;
  const weakNetwork = network && (network.effectiveType === '2g' || Number(network.rtt) > 500 || Number(network.downlink) < 1);
  const networkLabel = !network ? 'Качество сети определяет Zoom' : weakNetwork ? 'Слабое соединение' : Number(network.rtt) > 250 ? 'Среднее соединение' : 'Хорошее соединение';
  const leavePage = async () => {
    if (['connected', 'reconnecting'].includes(status) && !window.confirm('Выйти из видеоконсультации? Вы сможете подключиться повторно до окончания времени.')) return;
    await cleanupSdkSession();
    navigate(-1);
  };
  useEffect(() => {
    if (!preflight || !['connected', 'reconnecting'].includes(status)) return;
    const warning = zoomTimeWarning(remaining);
    if (warning && !warnedRef.current.has(warning.key)) {
      warnedRef.current.add(warning.key);
      setTimeWarning(warning.text);
    }
  }, [preflight, remaining, status]);
  useEffect(() => {
    if (!preflight || serverNow < endsAt + 5 * 60000 || status === 'ended') return;
    cleanupSdkSession();
    setStatus('ended');
  }, [endsAt, preflight, serverNow, status]);

  return <main style={{ minHeight: '100dvh', background: '#15130f', color: '#f5efe6', padding: 16, boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div><strong>eMaslaXat · Zoom</strong><div aria-live="polite" style={{ color: '#c9a980', fontSize: 13 }}>{status === 'reconnecting' ? 'Соединение потеряно, переподключаемся…' : status === 'connected' ? 'Подключено' : 'Проверка перед консультацией'}</div></div>
        <button style={{ ...button, background: '#2b2721', color: '#fff' }} onClick={leavePage}>{['connected', 'reconnecting'].includes(status) ? 'Выйти' : 'Назад'}</button>
      </header>
      {preflight && <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, color: '#d8cdbd' }}>
        <span>{preflight.role === 'lawyer' ? 'Вы ведущий' : 'Вы участник'}</span><span>{preflight.duration} минут</span><span>Статус: {preflight.lifecycleStatus}</span>
        <span>{formatTime(preflight.scheduledStartAt, preflight.timezone)} ({preflight.timezone})</span>
        <span aria-live="polite">Осталось: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span><span>{networkLabel}</span>
      </section>}
      {timeWarning && <div role="status" aria-live="assertive" style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: '#5a4328' }}>{timeWarning}</div>}
      {status === 'ended' && <section role="status" style={{ padding: 24, borderRadius: 14, background: '#211e19', textAlign: 'center' }}><h1>Консультация завершена</h1><button style={{ ...button, background: '#b8956e', color: '#fff' }} onClick={() => navigate('/consultations')}>Готово</button></section>}
      {!['connecting', 'connected', 'reconnecting', 'ended'].includes(status) && <section style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(280px, 380px)', gap: 20 }}>
        <video ref={preview} autoPlay muted playsInline style={{ width: '100%', minHeight: 260, maxHeight: 520, background: '#000', borderRadius: 14, objectFit: 'cover' }} />
        <div style={{ background: '#211e19', borderRadius: 14, padding: 20 }}>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Проверка оборудования</h1>
          <p>Браузер: {navigator.mediaDevices ? 'поддерживается' : 'не поддерживается'}</p>
          {weakNetwork && <p role="alert" style={{ color: '#efb16f' }}>Соединение нестабильно. Закройте VPN или используйте аудио без видео.</p>}
          <label>Камера<select aria-label="Выбрать камеру" value={selected.camera} onChange={(e) => setSelected({ ...selected, camera: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.cameras.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || 'Камера'}</option>)}</select></label>
          <label>Микрофон<select aria-label="Выбрать микрофон" value={selected.microphone} onChange={(e) => setSelected({ ...selected, microphone: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.microphones.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || 'Микрофон'}</option>)}</select></label>
          {devices.speakers.length > 0 && <label>Динамик<select aria-label="Выбрать динамик" value={selected.speaker} onChange={(e) => setSelected({ ...selected, speaker: e.target.value })} style={{ width: '100%', minHeight: 44 }}>{devices.speakers.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || 'Динамик'}</option>)}</select></label>}
          <p style={{ fontSize: 12, color: '#b9ad9c' }}>Это локальная проверка. При необходимости выберите устройство ещё раз в настройках Zoom.</p>
          <div aria-label="Уровень микрофона" style={{ height: 8, margin: '14px 0', background: '#3a342b', borderRadius: 8 }}><div style={{ width: `${Math.min(100, micLevel)}%`, height: '100%', background: '#7fa76d', borderRadius: 8 }} /></div>
          {mediaError && <p role="alert" style={{ color: '#ef8e79' }}>{mediaError}</p>}
          {preflight?.preparing && <p role="status" style={{ color: '#c9a980' }}>Подготавливаем видеовстречу. Страница обновится автоматически.</p>}
          {preflight?.failed && <p role="alert" style={{ color: '#ef8e79' }}>{preflight.safeError || 'Zoom-встречу подготовить не удалось.'} Перенесите консультацию или обратитесь в поддержку.</p>}
          {preflight && !preflight.paid && <p role="alert" style={{ color: '#efb16f' }}>Перед подключением необходимо завершить оплату.</p>}
          {!canJoin && preflight?.access?.opensAt && <p>Комната ожидания откроется: {formatTime(preflight.access.opensAt, preflight.timezone)} ({preflight.timezone})</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={{ ...button, background: '#51483d', color: '#fff' }} onClick={() => checkEquipment()}>{mediaError.includes('запрещён') ? 'Разрешить доступ' : 'Повторить проверку'}</button>
            <button style={{ ...button, background: '#51483d', color: '#fff' }} onClick={testSound}>Проверить звук</button>
            <button style={{ ...button, background: audioOnly ? '#7a9a6b' : '#51483d', color: '#fff' }} onClick={() => { setAudioOnly(true); checkEquipment(true); }}>Только аудио</button>
            <button style={{ ...button, background: '#b8956e', color: '#fff', opacity: canJoin && preflight?.paid && !preflight?.preparing ? 1 : .5 }} disabled={!canJoin || !preflight?.paid || preflight?.preparing} onClick={() => joinSdk(0)}>{preflight?.role === 'lawyer' ? 'Начать консультацию' : 'Подключиться'}</button>
            <button style={{ ...button, background: '#2b2721', color: '#fff', opacity: canJoin && preflight?.externalFallback ? 1 : .5 }} disabled={!canJoin || !preflight?.externalFallback} onClick={openExternal}>Открыть в Zoom</button>
            {fallbackUrl && <button style={{ ...button, background: '#2b2721', color: '#fff' }} onClick={() => navigator.clipboard.writeText(fallbackUrl)}>Скопировать ссылку</button>}
          </div>
          {attempts > 0 && attempts < 4 && <button style={{ ...button, marginTop: 10 }} onClick={() => joinSdk(0)}>Переподключиться ({attempts}/3)</button>}
            {attempts >= 3 && <button style={{ ...button, marginTop: 10 }} onClick={() => navigate('/help')}>Обратиться в поддержку</button>}
            {preflight?.failed && <button style={{ ...button, marginTop: 10 }} onClick={() => navigate('/consultations')}>Перенести консультацию</button>}
        </div>
      </section>}
      <div ref={sdkRoot} style={{ width: '100%', height: ['connecting', 'connected', 'reconnecting'].includes(status) ? 'calc(100dvh - 120px)' : 0, minHeight: ['connecting', 'connected', 'reconnecting'].includes(status) ? 560 : 0 }} />
    </div>
  </main>;
};

export default ZoomMeetingPage;
