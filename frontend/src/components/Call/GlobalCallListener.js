import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import { CallOutlined, CallEndOutlined, VideocamOutlined } from '@mui/icons-material';
import { Button, Dialog, DialogContent } from '@mui/material';
import { useTranslation } from '../../i18n';

// socket.io живёт на корне хоста, а VITE_API_URL в проде включает /api —
// срезаем его (иначе в проде сокет цепляется к неверному namespace).
const API_URL = (import.meta.env.VITE_API_URL || `${window.location.origin}/api`).replace(/\/api\/?$/, '');
const RING_TIMEOUT_MS = 45000;

// Рингтон без файлов-ассетов: классический двухтональный звонок через Web Audio
// (440+480 Гц, «звонок… пауза»). Автозапуск может быть заблокирован политикой
// автоплей до первого клика — тогда просто тихо (модалка всё равно видна).
function createRingtone() {
  let ctx = null;
  let interval = null;
  let stopped = true;

  const burst = () => {
    if (!ctx || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    // Два тона по 0.4с (как телефонный «дзынь-дзынь»), затем пауза до след. цикла
    [0, 0.6].forEach((offset) => {
      [440, 480].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.42);
      });
    });
  };

  return {
    async start() {
      if (!stopped) return ctx?.state === 'running';
      stopped = false;
      let audible = false;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ctx = new AC();
          if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
          if (ctx.state === 'running') {
            audible = true;
            burst();
            interval = setInterval(burst, 3000);
          }
        }
      } catch (e) { /* автоплей заблокирован — тихо */ }
      try { if (document.visibilityState === 'visible') navigator.vibrate?.([600, 400, 600]); } catch (e) { /* нет вибрации */ }
      return audible;
    },
    stop() {
      stopped = true;
      if (interval) { clearInterval(interval); interval = null; }
      if (ctx) { ctx.close().catch(() => {}); ctx = null; }
      try { navigator.vibrate?.(0); } catch (e) { /* noop */ }
    },
  };
}

/*
  Глобальный приём входящих звонков. Держит собственный socket на уровне App
  (переживает навигацию), слушает 'incoming-call' в персональной комнате
  пользователя и показывает модалку «Вам звонит…» с Принять/Отклонить.
  Принять → переход на страницу видеозвонка. Не рендерит ничего, пока нет вызова.
*/
const GlobalCallListener = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, token } = useSelector((s) => s.auth);
  const socketRef = useRef(null);
  const timeoutRef = useRef(null);
  const ringtoneRef = useRef(null);
  const [call, setCall] = useState(null); // { consultationId, callerId, callerName, callerAvatar, type }
  const [soundBlocked, setSoundBlocked] = useState(false);

  // На самой странице звонка входящие подавляем (мы уже в звонке)
  const onCallPage = location.pathname.startsWith('/consultations/video/');
  const onCallPageRef = useRef(onCallPage);
  useEffect(() => { onCallPageRef.current = onCallPage; }, [onCallPage]);

  useEffect(() => {
    const authToken = token || localStorage.getItem('token');
    if (!isAuthenticated || !authToken) return undefined;

    const socket = io(API_URL, { auth: { token: authToken }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('incoming-call', (data) => {
      if (!data || !data.consultationId) return;
      // Уже на странице звонка — не поднимаем модалку/таймаут (иначе устаревшая
      // модалка всплывёт при уходе со звонка, а таймаут пошлёт лишний decline).
      if (onCallPageRef.current) return;
      setCall(data);
    });
    socket.on('call-cancelled', ({ consultationId }) => {
      setCall((c) => (c && c.consultationId === consultationId ? null : c));
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 250);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, token]);

  // Рингтон + вибрация, пока есть входящий вызов
  useEffect(() => {
    if (!call || onCallPage) return undefined;
    if (!ringtoneRef.current) ringtoneRef.current = createRingtone();
    ringtoneRef.current.start().then((audible) => setSoundBlocked(!audible));
    return () => ringtoneRef.current && ringtoneRef.current.stop();
  }, [call, onCallPage]);

  // Автосброс вызова по таймауту (не ответили)
  useEffect(() => {
    if (!call) return undefined;
    timeoutRef.current = setTimeout(() => {
      if (socketRef.current) {
        socketRef.current.emit('call-decline', { consultationId: call.consultationId, callerId: call.callerId });
      }
      setCall(null);
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [call]);

  const accept = () => {
    if (!call) return;
    socketRef.current?.emit('call-accept', { consultationId: call.consultationId, callerId: call.callerId });
    const id = call.consultationId;
    setCall(null);
    navigate(`/consultations/video/${id}`);
  };

  const decline = () => {
    if (!call) return;
    socketRef.current?.emit('call-decline', { consultationId: call.consultationId, callerId: call.callerId });
    setCall(null);
  };

  const enableSound = async () => {
    ringtoneRef.current?.stop();
    const audible = await ringtoneRef.current?.start();
    setSoundBlocked(!audible);
  };

  if (!call || onCallPage) return null;

  const initial = (call.callerName || '?').charAt(0).toUpperCase();

  return (
    <Dialog open aria-labelledby="incoming-call-title" aria-describedby="incoming-call-description" onClose={() => {}} disableEscapeKeyDown PaperProps={{ sx: { width: 340, maxWidth: 'calc(100vw - 24px)', m: 1.5, borderRadius: '20px', background: 'var(--surface, #fff)' } }}>
      <DialogContent sx={{ p: 'max(24px, env(safe-area-inset-top)) 26px max(24px, env(safe-area-inset-bottom))', textAlign: 'center' }}>
        <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3, #999)', marginBottom: 20, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <VideocamOutlined sx={{ fontSize: 18 }} /> <span id="incoming-call-title">{t('call.incoming')}</span>
        </div>
        <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 16px' }}>
          <span className="mx-ring" style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px solid var(--accent, #B8956E)' }} />
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: call.callerAvatar ? `center/cover url(${call.callerAvatar})` : 'linear-gradient(135deg,#B8956E,#8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 38, fontWeight: 600 }}>
            {!call.callerAvatar && initial}
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text, #1a1a1a)', marginBottom: 4 }}>{call.callerName || t('call.someone')}</div>
        <div id="incoming-call-description" style={{ fontSize: 13, color: 'var(--text3, #999)', marginBottom: soundBlocked ? 12 : 28 }}>{t('call.ringing')}</div>
        {soundBlocked && <Button onClick={enableSound} sx={{ minHeight: 44, mb: 2 }}>{t('call.enableSound')}</Button>}
        {soundBlocked && <div role="status" style={{ fontSize: 12, color: 'var(--text3, #999)', marginBottom: 16 }}>{t('call.soundBlocked')}</div>}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button aria-label={t('call.decline')} onClick={decline} title={t('call.decline')} style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#D9534F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(217,83,79,0.45)' }}>
            <CallEndOutlined sx={{ fontSize: 28 }} />
          </button>
          <button aria-label={t('call.accept')} onClick={accept} title={t('call.accept')} style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#5AA06A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(90,160,106,0.45)' }} className="mx-accept">
            <CallOutlined sx={{ fontSize: 28 }} />
          </button>
        </div>
      </DialogContent>
      <style>{`
        .mx-ring { animation: mxRing 1.4s ease-out infinite; }
        @keyframes mxRing { 0%{ transform: scale(1); opacity: 0.9 } 100%{ transform: scale(1.35); opacity: 0 } }
        .mx-accept { animation: mxPulse 1.2s ease-in-out infinite; }
        @keyframes mxPulse { 0%,100%{ transform: scale(1) } 50%{ transform: scale(1.08) } }
        @media (prefers-reduced-motion: reduce){ .mx-ring,.mx-accept{ animation: none } }
      `}</style>
    </Dialog>
  );
};

export default GlobalCallListener;
