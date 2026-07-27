import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import { CallOutlined, CallEndOutlined, VideocamOutlined } from '@mui/icons-material';
import { useTranslation } from '../../i18n';

// socket.io живёт на корне хоста, а REACT_APP_API_URL в проде включает /api —
// срезаем его (иначе в проде сокет цепляется к неверному namespace).
const API_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
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
    start() {
      if (!stopped) return;
      stopped = false;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ctx = new AC();
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          burst();
          interval = setInterval(burst, 3000);
        }
      } catch (e) { /* автоплей заблокирован — тихо */ }
      try { navigator.vibrate?.([600, 400, 600, 400, 600]); } catch (e) { /* нет вибрации */ }
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

  // На самой странице звонка входящие подавляем (мы уже в звонке)
  const onCallPage = location.pathname.startsWith('/consultations/video/');

  useEffect(() => {
    const authToken = token || localStorage.getItem('token');
    if (!isAuthenticated || !authToken) return undefined;

    const socket = io(API_URL, { auth: { token: authToken }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('incoming-call', (data) => {
      if (!data || !data.consultationId) return;
      setCall(data);
    });
    socket.on('call-cancelled', ({ consultationId }) => {
      setCall((c) => (c && c.consultationId === consultationId ? null : c));
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
    ringtoneRef.current.start();
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

  if (!call || onCallPage) return null;

  const initial = (call.callerName || '?').charAt(0).toUpperCase();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(20,16,12,0.55)', backdropFilter: 'blur(4px)' }}>
      <div style={{ width: 340, maxWidth: 'calc(100vw - 32px)', background: 'var(--surface, #fff)', borderRadius: 20, padding: '32px 26px', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3, #999)', marginBottom: 20, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <VideocamOutlined sx={{ fontSize: 18 }} /> {t('call.incoming')}
        </div>
        <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 16px' }}>
          <span className="mx-ring" style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px solid var(--accent, #B8956E)' }} />
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: call.callerAvatar ? `center/cover url(${call.callerAvatar})` : 'linear-gradient(135deg,#B8956E,#8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 38, fontWeight: 600 }}>
            {!call.callerAvatar && initial}
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text, #1a1a1a)', marginBottom: 4 }}>{call.callerName || t('call.someone')}</div>
        <div style={{ fontSize: 13, color: 'var(--text3, #999)', marginBottom: 28 }}>{t('call.ringing')}</div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button onClick={decline} title={t('call.decline')} style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#D9534F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(217,83,79,0.45)' }}>
            <CallEndOutlined sx={{ fontSize: 28 }} />
          </button>
          <button onClick={accept} title={t('call.accept')} style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#5AA06A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(90,160,106,0.45)' }} className="mx-accept">
            <CallOutlined sx={{ fontSize: 28 }} />
          </button>
        </div>
      </div>
      <style>{`
        .mx-ring { animation: mxRing 1.4s ease-out infinite; }
        @keyframes mxRing { 0%{ transform: scale(1); opacity: 0.9 } 100%{ transform: scale(1.35); opacity: 0 } }
        .mx-accept { animation: mxPulse 1.2s ease-in-out infinite; }
        @keyframes mxPulse { 0%,100%{ transform: scale(1) } 50%{ transform: scale(1.08) } }
        @media (prefers-reduced-motion: reduce){ .mx-ring,.mx-accept{ animation: none } }
      `}</style>
    </div>
  );
};

export default GlobalCallListener;
