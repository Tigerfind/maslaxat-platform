import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Badge,
  Dialog,
  keyframes,
} from '@mui/material';
import {
  MicOutlined,
  MicOffOutlined,
  VideocamOutlined,
  VideocamOffOutlined,
  CallEndOutlined,
  ScreenShareOutlined,
  StopScreenShareOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ChatBubbleOutline,
  SendOutlined,
  CloseOutlined,
  CallOutlined,
  MoreTimeOutlined,
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { axelionColors } from '../../theme/axelionTheme';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { useTranslation } from '../../i18n';

// Короткий сигнал (Web Audio, без файлов) — уведомление о времени
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.52);
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch (e) { /* автоплей заблокирован */ }
}

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

// Derive Socket.IO server URL: strip /api suffix from API URL if present
const API_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');

const VideoCallPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  // State
  const [consultation, setConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [remoteName, setRemoteName] = useState('');
  const [remoteRole, setRemoteRole] = useState('');
  const [remoteMedia, setRemoteMedia] = useState({ audio: true, video: true }); // состояние камеры/микрофона собеседника

  // Экран подготовки перед входом (лобби)
  const [inLobby, setInLobby] = useState(true);
  const [devices, setDevices] = useState({ cameras: [], mics: [] });
  const [selectedCam, setSelectedCam] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [lobbyCamOn, setLobbyCamOn] = useState(true);
  const [lobbyMicOn, setLobbyMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [permError, setPermError] = useState(false);
  const lobbyVideoRef = useRef(null);
  const lobbyStreamRef = useRef(null);
  const lobbyAudioCtxRef = useRef(null);
  // выбранные устройства/состояние переносим в звонок
  const joinPrefsRef = useRef({ camId: '', micId: '', cam: true, mic: true });

  // Media controls
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Call state
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState(null);
  const [ringStatus, setRingStatus] = useState(null); // null|'ringing'|'offline'|'declined'
  const [quality, setQuality] = useState(null); // null|'good'|'ok'|'poor' — качество связи
  const [extendOpen, setExtendOpen] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendMin, setExtendMin] = useState(15); // выбор длительности продления
  const [extendWaiting, setExtendWaiting] = useState(false); // ждём ответ собеседника
  const [incomingExtend, setIncomingExtend] = useState(null); // { minutes, from }
  const EXTEND_MIN = 15;
  const extendWaitRef = useRef(null);
  const extendWaitingRef = useRef(false);
  const endedRef = useRef(false);

  // In-call chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatUnread, setChatUnread] = useState(0);
  const chatOpenRef = useRef(false);
  const chatEndRef = useRef(null);

  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const containerRef = useRef(null);
  const timerRef = useRef(null);
  const pendingSignalsRef = useRef([]);
  const callStartedRef = useRef(false);
  const calleeIdRef = useRef(null); // id другой стороны — чтобы отменить ring при отбое
  const peerConnectedRef = useRef(false);
  const callDurationRef = useRef(0);
  const warnedRef = useRef({ five: false, one: false, up: false });

  // Load consultation details
  useEffect(() => {
    const loadConsultation = async () => {
      try {
        const response = await api.get(`/video/consultation/${consultationId}`);
        const cons = response.data;
        setConsultation(cons);
        // id собеседника (для отмены ring при отбое до ответа)
        if (cons && user?.id) {
          calleeIdRef.current = cons.clientId === user.id ? cons.lawyerId : cons.clientId;
        }
      } catch (err) {
        setError(t('videoCall.loadError'));
        console.error('Load consultation error:', err);
      } finally {
        setLoading(false);
      }
    };
    loadConsultation();
  }, [consultationId]);

  // Start call timer + перевод в in_progress ТОЛЬКО когда оба реально соединились
  // (раньше /start дёргался при входе одного — тогда «дозвон без ответа» + отбой
  // завершал консультацию и выплачивал юристу за несостоявшийся звонок).
  useEffect(() => {
    if (peerConnected && !callStartTime) {
      setCallStartTime(Date.now());
      api.post(`/video/consultation/${consultationId}/start`).catch(() => {});
    }
  }, [peerConnected, callStartTime, consultationId]);

  // Держим ref в синхроне со state (для доступа из endCall-замыкания)
  useEffect(() => { peerConnectedRef.current = peerConnected; }, [peerConnected]);
  useEffect(() => { callDurationRef.current = callDuration; }, [callDuration]);

  useEffect(() => { extendWaitingRef.current = extendWaiting; }, [extendWaiting]);

  // Синхронизируем состояние фуллскрина с реальным (в т.ч. выход по ESC),
  // иначе кнопка «залипала» в неверном состоянии.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // Предупреждения о времени: за 5 мин, за 1 мин (+сигнал) и при истечении.
  useEffect(() => {
    if (!peerConnected || !consultation) return;
    const rem = (consultation.duration || 60) * 60 - callDuration;
    const w = warnedRef.current;
    if (rem <= 300 && rem > 60 && !w.five) { w.five = true; toast.info(t('videoCall.warn5')); }
    if (rem <= 60 && rem > 0 && !w.one) { w.one = true; toast.warning(t('videoCall.warn1')); beep(); }
    if (rem <= 0 && !w.up) { w.up = true; toast.warning(t('videoCall.timeUp')); beep(); }
  }, [callDuration, peerConnected, consultation, t]);

  // Индикатор качества связи: опрашиваем WebRTC-статистику (RTT + потери пакетов)
  useEffect(() => {
    if (!peerConnected) { setQuality(null); return undefined; }
    const iv = setInterval(async () => {
      const pc = peerRef.current && peerRef.current._pc;
      if (!pc || !pc.getStats) return;
      try {
        const stats = await pc.getStats();
        let rtt = null; let lost = 0; let recv = 0;
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.currentRoundTripTime != null && (r.nominated || r.state === 'succeeded')) {
            rtt = r.currentRoundTripTime;
          }
          if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) {
            lost = r.packetsLost || 0; recv = r.packetsReceived || 0;
          }
        });
        const loss = recv + lost > 0 ? lost / (recv + lost) : 0;
        let q = 'good';
        if ((rtt != null && rtt > 0.3) || loss > 0.05) q = 'ok';
        if ((rtt != null && rtt > 0.6) || loss > 0.12) q = 'poor';
        setQuality(q);
      } catch (e) { /* stats недоступны — игнор */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [peerConnected]);

  // Чат: синхрон ref, сброс непрочитанных при открытии, автоскролл
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  // История чата этой консультации (чтобы в звонке была видна прежняя переписка)
  useEffect(() => {
    let alive = true;
    api.get(`/chat/${consultationId}/messages`)
      .then((res) => {
        if (!alive) return;
        // Мержим историю с уже пришедшими realtime-сообщениями (дедуп по id),
        // а не затираем — иначе сообщение, пришедшее до резолва истории, терялось.
        const hist = res.data || [];
        setChatMessages((prev) => {
          const ids = new Set(hist.map((m) => m.id));
          const extra = prev.filter((m) => !ids.has(m.id));
          return [...hist, ...extra];
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [consultationId]);

  useEffect(() => {
    if (callStartTime) {
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStartTime]);

  // Format call duration
  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Create WebRTC peer connection
  const createPeer = useCallback((targetSocketId, stream, initiator) => {
    // Забираем накопленные ранние сигналы (пришли до создания peer) в локальную
    // переменную ДО очистки буфера — чтобы прогнать их после создания peer.
    // Раньше буфер очищался здесь, а flush ниже видел уже пустой массив → ранние
    // WebRTC-сигналы (offer/answer) молча терялись.
    const buffered = pendingSignalsRef.current;
    pendingSignalsRef.current = [];

    if (peerRef.current) {
      peerRef.current.destroy();
    }

    const peer = new Peer({
      initiator,
      trickle: true,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Free TURN servers for NAT traversal
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceCandidatePoolSize: 10,
      },
    });

    peer.on('signal', (signal) => {
      socketRef.current?.emit('signal', { to: targetSocketId, signal });
    });

    peer.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setPeerConnected(true);
      // Синхронизируем своё состояние камеры/микрофона с собеседником при соединении
      const s = localStreamRef.current;
      socketRef.current?.emit('media-state', {
        audio: s?.getAudioTracks()[0]?.enabled ?? true,
        video: s?.getVideoTracks()[0]?.enabled ?? true,
      });
    });

    peer.on('close', () => {
      setPeerConnected(false);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      // Don't show error for non-critical peer issues during negotiation
      if (err.code === 'ERR_DATA_CHANNEL' || err.code === 'ERR_CONNECTION_FAILURE') {
        setError(t('videoCall.peerError'));
      }
    });

    peerRef.current = peer;

    // Прогоняем ранние сигналы, пришедшие до создания peer
    buffered.forEach((sig) => {
      try {
        peer.signal(sig);
      } catch (e) {
        console.error('Error applying pending signal:', e);
      }
    });
  }, []);

  // End call
  const handleEndCall = useCallback(async (emitEvent = true) => {
    // Guard от повторного завершения (гонка call-ended + ручной отбой → двойной navigate)
    if (endedRef.current) return;
    endedRef.current = true;

    // Stop all media
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((tr) => tr.stop());
      screenStreamRef.current = null;
    }

    // Destroy peer
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    // Notify other party and disconnect socket
    if (emitEvent && socketRef.current) {
      socketRef.current.emit('end-call');
      // Если собеседник ещё не ответил (мы только звонили) — гасим у него ring
      if (!peerConnectedRef.current && calleeIdRef.current) {
        socketRef.current.emit('call-cancel', { consultationId, calleeId: calleeIdRef.current });
      }
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Mark consultation as completed + фактическая длительность звонка
    try {
      await api.post(`/video/consultation/${consultationId}/end`, {
        durationSeconds: callDurationRef.current,
      });
    } catch (err) {
      // Silently ignore — may already be completed
    }

    // Navigate back
    if (user?.role === 'lawyer') {
      navigate('/lawyer/dashboard');
    } else {
      navigate('/consultations');
    }
  }, [consultationId, navigate, user]);

  // ─── Лобби: превью камеры, список устройств, уровень микрофона ───
  const consultationLoaded = Boolean(consultation);
  useEffect(() => {
    if (!inLobby || !consultationLoaded) return undefined;
    let cancelled = false;
    let raf;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        lobbyStreamRef.current = stream;
        setPermError(false);
        if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = stream;
        stream.getVideoTracks().forEach((tr) => { tr.enabled = lobbyCamOn; });
        stream.getAudioTracks().forEach((tr) => { tr.enabled = lobbyMicOn; });

        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices({
            cameras: list.filter((d) => d.kind === 'videoinput'),
            mics: list.filter((d) => d.kind === 'audioinput'),
          });
          if (!selectedCam) { const c = stream.getVideoTracks()[0]?.getSettings().deviceId; if (c) setSelectedCam(c); }
          if (!selectedMic) { const m = stream.getAudioTracks()[0]?.getSettings().deviceId; if (m) setSelectedMic(m); }
        }

        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          lobbyAudioCtxRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (cancelled) return;
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            setMicLevel(Math.min(100, Math.round(avg * 1.6)));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch (e) {
        if (!cancelled) setPermError(true);
      }
    };
    start();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (lobbyStreamRef.current) { lobbyStreamRef.current.getTracks().forEach((tr) => tr.stop()); lobbyStreamRef.current = null; }
      if (lobbyAudioCtxRef.current) { lobbyAudioCtxRef.current.close().catch(() => {}); lobbyAudioCtxRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inLobby, consultationLoaded, selectedCam, selectedMic]);

  const toggleLobbyCam = () => {
    const on = !lobbyCamOn; setLobbyCamOn(on);
    lobbyStreamRef.current?.getVideoTracks().forEach((tr) => { tr.enabled = on; });
  };
  const toggleLobbyMic = () => {
    const on = !lobbyMicOn; setLobbyMicOn(on);
    lobbyStreamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = on; });
  };
  const joinCall = () => {
    joinPrefsRef.current = { camId: selectedCam, micId: selectedMic, cam: lobbyCamOn, mic: lobbyMicOn };
    setInLobby(false); // init-эффект поднимет звонок с выбранными устройствами
  };

  // Initialize media and socket connection.
  // Init-эффект зависит от булевых флагов (загружено/не в лобби), а НЕ от объекта
  // consultation: иначе setConsultation (продление) пересоздавал бы эффект → обрыв.
  useEffect(() => {
    if (!consultationLoaded || error || inLobby) return;
    // Prevent double-start from React StrictMode
    if (callStartedRef.current) return;
    callStartedRef.current = true;

    let socket = null;
    let stream = null;
    let cancelled = false;

    const init = async () => {
      try {
        // Get local media stream с устройствами и состоянием, выбранными в лобби
        const prefs = joinPrefsRef.current;
        stream = await navigator.mediaDevices.getUserMedia({
          video: prefs.camId ? { deviceId: { exact: prefs.camId } } : true,
          audio: prefs.micId ? { deviceId: { exact: prefs.micId } } : true,
        });

        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }

        // Применяем выбор «камера/микрофон вкл/выкл» из лобби
        stream.getVideoTracks().forEach((tr) => { tr.enabled = prefs.cam; });
        stream.getAudioTracks().forEach((tr) => { tr.enabled = prefs.mic; });
        setVideoEnabled(prefs.cam);
        setAudioEnabled(prefs.mic);

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (cancelled) return;

        // Connect to signaling server
        const token = localStorage.getItem('token');
        socket = io(API_URL, {
          auth: { token },
          transports: ['websocket', 'polling'],
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          if (cancelled) return;
          setConnected(true);
          socket.emit('join-room', { consultationId });
          socket.emit('join-chat', { consultationId }); // чат в звонке — та же комната
        });

        // Сообщение чата во время звонка
        socket.on('message-received', (msg) => {
          if (cancelled || !msg) return;
          setChatMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (!chatOpenRef.current) setChatUnread((u) => u + 1);
        });

        // Состояние медиа собеседника (камера/микрофон вкл/выкл)
        socket.on('media-state', ({ audio, video }) => {
          if (!cancelled) setRemoteMedia({ audio: audio !== false, video: video !== false });
        });

        // ─── Продление по согласию ───
        // Пришло предложение продлить — показываем окошко для принятия
        socket.on('extend-request', ({ minutes, from }) => {
          // Игнорируем чужое предложение, если сами уже предлагаем/ждём ответ —
          // иначе одновременный обоюдный extend приводил бы к двойному продлению.
          if (cancelled || extendWaitingRef.current) return;
          setIncomingExtend({ minutes: minutes || 15, from });
        });
        // Собеседник принял наше предложение — применяем новые значения у себя
        socket.on('extend-accept', (data) => {
          if (cancelled) return;
          setExtendWaiting(false);
          if (data && data.duration) {
            setConsultation((prev) => (prev ? { ...prev, duration: data.duration, price: data.price } : prev));
            warnedRef.current = { five: false, one: false, up: false };
            toast.success(
              t('videoCall.extendedOk')
                .replace('{min}', data.minutes || EXTEND_MIN)
                .replace('{sum}', Number(data.addAmount || 0).toLocaleString('ru-RU'))
            );
          }
        });
        // Собеседник отклонил продление
        socket.on('extend-decline', () => {
          if (cancelled) return;
          setExtendWaiting(false);
          toast.info(t('videoCall.extendDeclined'));
        });

        socket.on('connect_error', (err) => {
          console.error('Socket connection error:', err.message);
          if (!cancelled) {
            setError(t('videoCall.connectError'));
          }
        });

        // When other user is already in the room — we initiate the peer connection
        socket.on('room-users', ({ users }) => {
          if (cancelled) return;
          if (users.length > 0) {
            const remoteUser = users[0];
            setRemoteName(remoteUser.userName);
            setRemoteRole(remoteUser.userRole);
            createPeer(remoteUser.socketId, stream, true);
          } else {
            // Мы зашли первыми — «звоним» собеседнику (ему прилетит ring)
            socket.emit('call-user', { consultationId });
            setRingStatus('ringing');
          }
        });

        // Статус дозвона другой стороне
        socket.on('call-ringing', () => { if (!cancelled) setRingStatus('ringing'); });
        socket.on('call-offline', () => { if (!cancelled) setRingStatus('offline'); });
        socket.on('call-declined', () => { if (!cancelled) setRingStatus('declined'); });

        // When another user joins — they will initiate, we respond
        socket.on('user-joined', ({ socketId, userName, userRole }) => {
          if (cancelled) return;
          setRingStatus(null); // дозвонились — собеседник в комнате
          setRemoteName(userName);
          setRemoteRole(userRole);
          createPeer(socketId, stream, false);
        });

        // Relay WebRTC signals — buffer if peer not ready yet
        socket.on('signal', ({ from, signal }) => {
          if (cancelled) return;
          if (peerRef.current && !peerRef.current.destroyed) {
            try {
              peerRef.current.signal(signal);
            } catch (e) {
              console.error('Error signaling peer:', e);
            }
          } else {
            // Buffer signal until peer is created
            pendingSignalsRef.current.push(signal);
          }
        });

        // User left
        socket.on('user-left', () => {
          if (cancelled) return;
          setPeerConnected(false);
          setRemoteName('');
          // Собеседник ушёл — закрываем диалоги продления (нельзя принять/ждать
          // продление, если оплачивать/подтверждать некому)
          setIncomingExtend(null);
          setExtendWaiting(false);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
          }
        });

        // Call ended by other party
        socket.on('call-ended', () => {
          if (!cancelled) handleEndCall(false);
        });

        socket.on('error', ({ message }) => {
          if (!cancelled) setError(message);
        });
      } catch (err) {
        if (cancelled) return;
        if (err.name === 'NotAllowedError') {
          setError(t('videoCall.mediaError'));
        } else {
          setError(t('videoCall.startError') + err.message);
        }
        console.error('Start call error:', err);
      }
    };

    init();

    // Cleanup on unmount (or StrictMode re-mount)
    return () => {
      cancelled = true;
      callStartedRef.current = false;

      if (stream) {
        stream.getTracks().forEach((tr) => tr.stop());
      }
      // Останавливаем и захват экрана (иначе при уходе со страницы во время
      // шаринга без явного завершения он продолжает жить)
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((tr) => tr.stop());
        screenStreamRef.current = null;
      }
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      clearTimeout(extendWaitRef.current); // таймаут ожидания продления
      pendingSignalsRef.current = [];
      localStreamRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationLoaded, consultationId, inLobby]);

  // Toggle audio
  // Сообщаем собеседнику своё состояние (микрофон/камера) по факту стримов
  const emitMediaState = () => {
    const s = localStreamRef.current;
    const audio = s?.getAudioTracks()[0]?.enabled ?? true;
    const video = s?.getVideoTracks()[0]?.enabled ?? true;
    socketRef.current?.emit('media-state', { audio, video });
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
        emitMediaState();
      }
    }
  };

  // Перезвонить — повторный вызов собеседника после отклонения/недозвона
  const retryCall = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('call-user', { consultationId });
    setRingStatus('ringing');
  };

  // Предлагаем продление собеседнику (применяется только после его согласия)
  const proposeExtend = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('extend-request', { minutes: extendMin });
    setExtendOpen(false);
    setExtendWaiting(true);
    clearTimeout(extendWaitRef.current);
    extendWaitRef.current = setTimeout(() => setExtendWaiting(false), 30000);
  };

  // Применяем продление у себя из ответа бэкенда
  const applyExtendResult = (data) => {
    setConsultation((prev) => (prev ? { ...prev, duration: data.duration, price: data.price } : prev));
    warnedRef.current = { five: false, one: false, up: false };
    toast.success(
      t('videoCall.extendedOk')
        .replace('{min}', data.minutes || EXTEND_MIN)
        .replace('{sum}', Number(data.addAmount || 0).toLocaleString('ru-RU'))
    );
  };

  // Принять входящее предложение продления: применяем на сервере (доплата
  // клиента) и сообщаем инициатору новыми значениями.
  const acceptIncomingExtend = async () => {
    if (!incomingExtend) return;
    setExtending(true);
    try {
      const res = await api.post(`/video/consultation/${consultationId}/extend`, { minutes: incomingExtend.minutes });
      applyExtendResult(res.data || {});
      socketRef.current?.emit('extend-accept', res.data || {});
      setIncomingExtend(null);
    } catch (e) {
      toast.error(e.response?.data?.error || t('videoCall.extendErr'));
    } finally {
      setExtending(false);
    }
  };

  const declineIncomingExtend = () => {
    socketRef.current?.emit('extend-decline');
    setIncomingExtend(null);
  };

  // Отправка сообщения в чат во время звонка
  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit('send-message', { consultationId, text });
    setChatInput('');
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
        emitMediaState();
      }
    }
  };

  // Остановить показ экрана (только рефы + setState — без stale-closure, чтобы
  // безопасно вызываться из screenTrack.onended при системной «Остановить показ»)
  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((tr) => tr.stop());
      screenStreamRef.current = null;
    }
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (peerRef.current && videoTrack) {
      const senders = peerRef.current._pc?.getSenders();
      const videoSender = senders?.find((s) => s.track?.kind === 'video');
      if (videoSender) videoSender.replaceTrack(videoTrack);
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    setScreenSharing(false);
  }, []);

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (screenSharing) {
      stopScreenShare();
    } else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        toast.error(t('videoCall.screenShareUnsupported'));
        return;
      }
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        screenStreamRef.current = screenStream;

        const screenTrack = screenStream.getVideoTracks()[0];
        if (peerRef.current) {
          const senders = peerRef.current._pc?.getSenders();
          const videoSender = senders?.find((s) => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
          }
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        // Системная кнопка «Остановить показ» → чистый стоп (не открывать пикер заново)
        screenTrack.onended = () => {
          stopScreenShare();
        };

        setScreenSharing(true);
      } catch (err) {
        console.error('Screen share error:', err);
        // Отмену пользователем (закрыл диалог выбора) молчим, прочее — сообщаем
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          toast.error(t('videoCall.screenShareError'));
        }
      }
    }
  };

  // Toggle fullscreen (кросс-браузерно; состояние синхронит fullscreenchange-эффект)
  const toggleFullscreen = () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      const el = containerRef.current;
      const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
      if (req) {
        try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) { /* не поддержано */ }
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* noop */ }
      }
    }
  };

  // Determine the other party's name
  const otherPartyName = consultation
    ? user?.role === 'lawyer'
      ? consultation.client?.name
      : consultation.lawyer?.name
    : '';

  // Loading state
  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          bgcolor: '#1A1A1A',
        }}
      >
        <CircularProgress sx={{ color: axelionColors.gold }} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          bgcolor: '#1A1A1A',
          color: 'white',
          gap: 3,
          px: 3,
          textAlign: 'center',
        }}
      >
        <Typography variant="h5" sx={{ color: axelionColors.error }}>
          {t('videoCall.connectionError')}
        </Typography>
        <Typography variant="body1" sx={{ color: axelionColors.textMuted, maxWidth: 400 }}>
          {error}
        </Typography>
        <Box
          component="button"
          onClick={() => navigate(-1)}
          sx={{
            mt: 2,
            bgcolor: axelionColors.gold,
            color: 'white',
            px: 4,
            py: 1.5,
            borderRadius: '12px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 500,
            '&:hover': { bgcolor: axelionColors.goldDark },
          }}
        >
          {t('videoCall.goBack')}
        </Box>
      </Box>
    );
  }

  // Status label shown in the top bar (design: dot + "Соединено · timer")
  const ringText = ringStatus === 'offline'
    ? t('call.calleeOffline')
    : ringStatus === 'declined'
    ? t('call.calleeDeclined')
    : ringStatus === 'ringing'
    ? t('call.calling')
    : null;
  // Обратный отсчёт от забронированной длительности (duration в минутах)
  const bookedSeconds = (consultation?.duration || 60) * 60;
  const remaining = bookedSeconds - callDuration;
  const overtime = remaining < 0;
  const timeText = overtime
    ? `${t('videoCall.overtime')} +${formatDuration(-remaining)}`
    : `${t('videoCall.timeLeft')} ${formatDuration(remaining)}`;
  const timeColor = overtime ? '#D9534F' : remaining <= 300 ? '#C4A35A' : '#C9A980';

  const statusText = peerConnected
    ? timeText
    : connected
    ? (ringText || t('videoCall.waiting'))
    : t('videoCall.connecting');
  const statusDotColor = peerConnected ? (overtime ? '#D9534F' : '#7A9A6B') : '#C4A35A';

  // Shared control-button recipe
  const controlBtnSx = (active) => ({
    width: 52,
    height: 52,
    borderRadius: '50%',
    bgcolor: active ? '#B07070' : 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
    '&:hover': {
      bgcolor: active ? '#9A5F5F' : 'rgba(255,255,255,0.16)',
    },
    transition: 'all 0.2s ease',
  });

  // ─── Экран подготовки (лобби) ───
  if (inLobby) {
    const selStyle = { width: '100%', marginTop: 6, padding: '9px 10px', borderRadius: 8, background: '#2C2C2C', color: '#EEE', border: '1px solid #3A3A3A', fontSize: 13, fontFamily: 'inherit' };
    return (
      <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#1A1A1A', color: '#FFF', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, animation: `${fadeIn} 0.3s ease-out` }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600, mb: 0.5 }}>{t('videoCall.lobbyTitle')}</Typography>
        <Typography sx={{ fontSize: 13, color: '#9A9A9A', mb: 2.5 }}>
          {t('videoCall.lobbyWith')} {otherPartyName || t('videoCall.participant')}
        </Typography>

        {/* Превью камеры */}
        <Box sx={{ position: 'relative', width: 'min(440px, 92vw)', aspectRatio: '16/9', bgcolor: '#000', borderRadius: '14px', overflow: 'hidden', mb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video ref={lobbyVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', visibility: lobbyCamOn && !permError ? 'visible' : 'hidden' }} />
          {permError && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, px: 3, textAlign: 'center' }}>
              <VideocamOffOutlined sx={{ fontSize: 40, color: '#E06B6B' }} />
              <Typography sx={{ fontSize: 14, color: '#E0E0E0' }}>{t('videoCall.permDenied')}</Typography>
              <Typography sx={{ fontSize: 12, color: '#9A9A9A' }}>{t('videoCall.permHint')}</Typography>
            </Box>
          )}
          {!permError && !lobbyCamOn && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <VideocamOffOutlined sx={{ fontSize: 36, color: '#888' }} />
              <Typography sx={{ fontSize: 13, color: '#888' }}>{t('videoCall.camOff')}</Typography>
            </Box>
          )}
          {/* индикатор уровня микрофона */}
          {!permError && (
            <Box sx={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: 'rgba(0,0,0,0.5)', px: 1, py: 0.5, borderRadius: '12px' }}>
              {lobbyMicOn ? <MicOutlined sx={{ fontSize: 15, color: '#FFF' }} /> : <MicOffOutlined sx={{ fontSize: 15, color: '#E06B6B' }} />}
              <Box sx={{ width: 60, height: 5, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
                <Box sx={{ width: `${lobbyMicOn ? micLevel : 0}%`, height: '100%', bgcolor: micLevel > 60 ? '#E0A24A' : '#5AA06A', transition: 'width 0.1s' }} />
              </Box>
            </Box>
          )}
        </Box>

        {/* Кнопки микрофон/камера */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <IconButton onClick={toggleLobbyMic} sx={controlBtnSx(!lobbyMicOn)}>
            {lobbyMicOn ? <MicOutlined /> : <MicOffOutlined />}
          </IconButton>
          <IconButton onClick={toggleLobbyCam} sx={controlBtnSx(!lobbyCamOn)}>
            {lobbyCamOn ? <VideocamOutlined /> : <VideocamOffOutlined />}
          </IconButton>
        </Box>

        {/* Выбор устройств */}
        {!permError && (
          <Box sx={{ width: 'min(440px, 92vw)', mb: 2 }}>
            {devices.cameras.length > 1 && (
              <select value={selectedCam} onChange={(e) => setSelectedCam(e.target.value)} style={selStyle}>
                {devices.cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('videoCall.camera')} ${i + 1}`}</option>)}
              </select>
            )}
            {devices.mics.length > 1 && (
              <select value={selectedMic} onChange={(e) => setSelectedMic(e.target.value)} style={selStyle}>
                {devices.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('videoCall.mic')} ${i + 1}`}</option>)}
              </select>
            )}
          </Box>
        )}

        {/* Войти */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'transparent', border: '1px solid #444', color: '#DDD', padding: '12px 24px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
            {t('videoCall.cancel')}
          </button>
          <button onClick={joinCall} style={{ background: 'linear-gradient(135deg,#B8956E,#8B7355)', border: 'none', color: '#FFF', padding: '12px 32px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <CallOutlined sx={{ fontSize: 18 }} /> {t('videoCall.joinCall')}
          </button>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: '#1A1A1A',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        animation: `${fadeIn} 0.3s ease-out`,
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          height: 68,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3.5 },
          borderBottom: '1px solid #3A3A3A',
        }}
      >
        {/* Brand */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              flexShrink: 0,
              border: '1.5px solid #B8956E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#B8956E',
              fontWeight: 300,
            }}
          >
            M
          </Box>
          <Typography
            sx={{
              color: '#FFFFFF',
              fontSize: 14,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              display: { xs: 'none', sm: 'block' },
            }}
          >
            eMaslaXat
          </Typography>
        </Box>

        {/* Status */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: statusDotColor,
              animation: !peerConnected ? `${pulse} 2s ease-in-out infinite` : 'none',
            }}
          />
          <Typography
            sx={{
              color: peerConnected ? timeColor : '#C9A980',
              fontSize: 13,
              fontWeight: peerConnected && remaining <= 300 ? 700 : 400,
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
            }}
          >
            {statusText}
          </Typography>

          {/* Индикатор качества связи (полоски сигнала) */}
          {peerConnected && quality && (() => {
            const qColor = quality === 'good' ? '#5AA06A' : quality === 'ok' ? '#C4A35A' : '#D9534F';
            const bars = quality === 'good' ? 3 : quality === 'ok' ? 2 : 1;
            const qLabel = t(quality === 'good' ? 'videoCall.qGood' : quality === 'ok' ? 'videoCall.qOk' : 'videoCall.qPoor');
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 1.25 }} title={qLabel}>
                <Box sx={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: 13 }}>
                  {[1, 2, 3].map((n) => (
                    <Box key={n} sx={{ width: 3, height: 3 + n * 3, borderRadius: '1px', bgcolor: n <= bars ? qColor : 'rgba(255,255,255,0.22)' }} />
                  ))}
                </Box>
                <Typography sx={{ color: qColor, fontSize: 11, letterSpacing: '0.04em' }}>{qLabel}</Typography>
              </Box>
            );
          })()}
        </Box>

        {/* Right spacer to keep status centred */}
        <Box sx={{ flex: 1 }} />
      </Box>

      {/* Main video area */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: 'radial-gradient(circle at 50% 40%, #2D2D2D, #1A1A1A)',
        }}
      >
        {/* Remote video (fills area) */}
        {peerConnected ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                visibility: remoteMedia.video ? 'visible' : 'hidden',
              }}
            />
            {/* Камера собеседника выключена → аватар вместо чёрного кадра */}
            {!remoteMedia.video && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
                <Box sx={{ width: 120, height: 120, borderRadius: '50%', background: 'linear-gradient(135deg, #B8956E, #8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 44, fontWeight: 300 }}>
                  {(otherPartyName || remoteName)?.charAt(0) || '?'}
                </Box>
                <Typography sx={{ color: '#FFF', fontSize: 18 }}>{otherPartyName || remoteName || t('videoCall.participant')}</Typography>
                <Typography sx={{ color: '#9A9A9A', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <VideocamOffOutlined sx={{ fontSize: 16 }} /> {t('videoCall.remoteCameraOff')}
                </Typography>
              </Box>
            )}
            {/* Плашка с именем + индикатор выключенного микрофона собеседника */}
            <Box sx={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: 'rgba(0,0,0,0.55)', px: 1.5, py: 0.75, borderRadius: '20px', backdropFilter: 'blur(6px)' }}>
              {!remoteMedia.audio && <MicOffOutlined sx={{ fontSize: 16, color: '#E06B6B' }} />}
              <Typography sx={{ color: '#FFF', fontSize: 13, fontWeight: 500 }}>{otherPartyName || remoteName || t('videoCall.participant')}</Typography>
            </Box>
          </>
        ) : (
          <Box sx={{ textAlign: 'center', animation: `${fadeIn} 0.5s ease-out` }}>
            <Box
              sx={{
                width: 140,
                height: 140,
                mx: 'auto',
                mb: 2.5,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #B8956E, #8B7355)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: 48,
                fontWeight: 300,
              }}
            >
              {(otherPartyName || remoteName)?.charAt(0) || '?'}
            </Box>
            <Typography sx={{ color: '#FFFFFF', fontSize: 20, fontWeight: 400 }}>
              {otherPartyName || remoteName || t('videoCall.participant')}
            </Typography>
            <Typography
              sx={{
                color: '#9A9A9A',
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                mt: 0.75,
              }}
            >
              {remoteRole === 'client' ? t('videoCall.roleClient') : t('videoCall.roleLawyer')}
            </Typography>
            {ringStatus === 'declined' || ringStatus === 'offline' ? (
              <button
                onClick={retryCall}
                style={{
                  marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#5AA06A', color: '#FFFFFF', border: 'none', fontSize: 14, fontWeight: 600,
                  padding: '12px 24px', borderRadius: 24, cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 6px 18px rgba(90,160,106,0.4)',
                }}
              >
                <CallOutlined sx={{ fontSize: 20 }} /> {t('call.callBack')}
              </button>
            ) : (
              <CircularProgress size={28} thickness={2} sx={{ color: '#C9A980', mt: 3 }} />
            )}
          </Box>
        )}

        {/* Local video (picture-in-picture) */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            width: { xs: 130, sm: 200 },
            height: { xs: 86, sm: 132 },
            borderRadius: 'var(--radius, 8px)',
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.15)',
            background: 'linear-gradient(135deg, #6B5A45, #3A3A3A)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 5,
          }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              display: videoEnabled ? 'block' : 'none',
            }}
          />
          {!videoEnabled && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.45)',
                fontSize: 12,
              }}
            >
              {t('videoCall.cameraOff')}
            </Box>
          )}
          <Typography
            sx={{
              position: 'absolute',
              bottom: 6,
              left: 10,
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}
          >
            {t('videoCall.you')}
          </Typography>
        </Box>
      </Box>

      {/* Controls bar */}
      <Box
        sx={{
          minHeight: 96,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: { xs: 1.25, sm: 2 },
          py: 1.5,
          borderTop: '1px solid #3A3A3A',
        }}
      >
        {/* Mic toggle */}
        <IconButton onClick={toggleAudio} sx={controlBtnSx(!audioEnabled)}>
          {audioEnabled ? <MicOutlined /> : <MicOffOutlined />}
        </IconButton>

        {/* Camera toggle */}
        <IconButton onClick={toggleVideo} sx={controlBtnSx(!videoEnabled)}>
          {videoEnabled ? <VideocamOutlined /> : <VideocamOffOutlined />}
        </IconButton>

        {/* Screen share */}
        <IconButton
          onClick={toggleScreenShare}
          sx={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            bgcolor: screenSharing ? '#C9A980' : 'rgba(255,255,255,0.08)',
            color: screenSharing ? '#1A1A1A' : '#FFFFFF',
            border: `1px solid ${screenSharing ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
            '&:hover': {
              bgcolor: screenSharing ? '#B8956E' : 'rgba(255,255,255,0.16)',
            },
            transition: 'all 0.2s ease',
          }}
        >
          {screenSharing ? <StopScreenShareOutlined /> : <ScreenShareOutlined />}
        </IconButton>

        {/* Fullscreen */}
        <IconButton onClick={toggleFullscreen} sx={controlBtnSx(false)}>
          {isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        </IconButton>

        {/* Extend consultation */}
        <IconButton onClick={() => setExtendOpen(true)} sx={controlBtnSx(false)} title={t('videoCall.extend')}>
          <MoreTimeOutlined />
        </IconButton>

        {/* Chat toggle */}
        <Badge badgeContent={chatUnread} color="error" overlap="circular">
          <IconButton onClick={() => setChatOpen((o) => !o)} sx={controlBtnSx(chatOpen)}>
            <ChatBubbleOutline />
          </IconButton>
        </Badge>

        {/* End call */}
        <IconButton
          onClick={() => handleEndCall(true)}
          sx={{
            width: 64,
            height: 52,
            borderRadius: '26px',
            bgcolor: '#B07070',
            color: '#FFFFFF',
            ml: 0.5,
            '&:hover': { bgcolor: '#9A5F5F' },
            transition: 'all 0.2s ease',
          }}
        >
          <CallEndOutlined />
        </IconButton>
      </Box>

      {/* ─── In-call chat panel ─── */}
      {chatOpen && (
        <Box
          sx={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: { xs: '100%', sm: 340 },
            bgcolor: '#1E1E1E', borderLeft: '1px solid #3A3A3A', display: 'flex', flexDirection: 'column', zIndex: 20,
          }}
        >
          <Box sx={{ height: 56, flexShrink: 0, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #3A3A3A' }}>
            <Typography sx={{ color: '#FFF', fontSize: 15, fontWeight: 600 }}>{t('videoCall.chatTitle')}</Typography>
            <IconButton onClick={() => setChatOpen(false)} sx={{ color: '#AAA' }}><CloseOutlined /></IconButton>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {chatMessages.length === 0 ? (
              <Typography sx={{ color: '#777', fontSize: 13, textAlign: 'center', mt: 3 }}>{t('videoCall.chatEmpty')}</Typography>
            ) : chatMessages.map((m) => {
              const own = m.senderId === user?.id;
              return (
                <Box key={m.id} sx={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                  <Box sx={{ px: 1.5, py: 1, borderRadius: '12px', bgcolor: own ? '#B8956E' : '#2C2C2C', color: own ? '#1A1A1A' : '#EEE', fontSize: 13.5, lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {m.text}
                  </Box>
                </Box>
              );
            })}
            <div ref={chatEndRef} />
          </Box>
          <Box sx={{ flexShrink: 0, p: 1.5, borderTop: '1px solid #3A3A3A', display: 'flex', gap: 1 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
              placeholder={t('videoCall.chatPlaceholder')}
              style={{ flex: 1, background: '#2C2C2C', border: '1px solid #3A3A3A', borderRadius: 10, color: '#FFF', padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }}
            />
            <IconButton onClick={sendChat} disabled={!chatInput.trim()} sx={{ bgcolor: '#B8956E', color: '#1A1A1A', borderRadius: '10px', '&:hover': { bgcolor: '#C9A980' }, '&.Mui-disabled': { bgcolor: '#3A3A3A', color: '#666' } }}>
              <SendOutlined sx={{ fontSize: 20 }} />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* ─── Диалог предложения продления (выбор 15/30) ─── */}
      <Dialog open={extendOpen} onClose={() => setExtendOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '18px', bgcolor: '#1E1E1E', color: '#FFF' } }}>
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 2, borderRadius: '50%', bgcolor: 'rgba(184,149,110,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MoreTimeOutlined sx={{ fontSize: 28, color: '#C9A980' }} />
          </Box>
          <Typography sx={{ fontSize: 18, fontWeight: 600, mb: 1.5 }}>{t('videoCall.extendTitle')}</Typography>
          {/* выбор длительности */}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mb: 2 }}>
            {[15, 30].map((m) => (
              <button key={m} onClick={() => setExtendMin(m)}
                style={{ padding: '10px 22px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  border: extendMin === m ? '1px solid #C9A980' : '1px solid #444',
                  background: extendMin === m ? 'rgba(184,149,110,0.22)' : 'transparent',
                  color: extendMin === m ? '#C9A980' : '#CCC' }}>
                +{m} {t('videoCall.min')}
              </button>
            ))}
          </Box>
          {consultation && consultation.duration > 0 && (
            <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#C9A980', mb: 0.5 }}>
              {t('videoCall.extendSurcharge')}: {Math.round((consultation.price / consultation.duration) * extendMin).toLocaleString('ru-RU')} {t('videoCall.sum')}
            </Typography>
          )}
          <Typography sx={{ fontSize: 12, color: '#888', mb: 2.5 }}>{t('videoCall.extendNeedsConsent')}</Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <button onClick={() => setExtendOpen(false)}
              style={{ flex: 1, background: 'transparent', border: '1px solid #444', color: '#DDD', padding: '12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
              {t('videoCall.cancel')}
            </button>
            <button onClick={proposeExtend}
              style={{ flex: 1, background: 'linear-gradient(135deg,#B8956E,#8B7355)', border: 'none', color: '#FFF', padding: '12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600 }}>
              {t('videoCall.extendPropose')}
            </button>
          </Box>
        </Box>
      </Dialog>

      {/* ─── Входящее предложение продления ─── */}
      <Dialog open={!!incomingExtend} onClose={() => !extending && declineIncomingExtend()} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '18px', bgcolor: '#1E1E1E', color: '#FFF' } }}>
        {incomingExtend && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 2, borderRadius: '50%', bgcolor: 'rgba(184,149,110,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MoreTimeOutlined sx={{ fontSize: 28, color: '#C9A980' }} />
            </Box>
            <Typography sx={{ fontSize: 17, fontWeight: 600, mb: 1 }}>
              {t('videoCall.extendIncoming').replace('{name}', incomingExtend.from || t('videoCall.participant')).replace('{min}', incomingExtend.minutes)}
            </Typography>
            {consultation && consultation.duration > 0 && (
              <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#C9A980', mb: 2.5 }}>
                {t('videoCall.extendSurcharge')}: {Math.round((consultation.price / consultation.duration) * incomingExtend.minutes).toLocaleString('ru-RU')} {t('videoCall.sum')}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <button onClick={declineIncomingExtend} disabled={extending}
                style={{ flex: 1, background: 'transparent', border: '1px solid #444', color: '#DDD', padding: '12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
                {t('videoCall.decline')}
              </button>
              <button onClick={acceptIncomingExtend} disabled={extending}
                style={{ flex: 1, background: 'linear-gradient(135deg,#5AA06A,#4A8A5A)', border: 'none', color: '#FFF', padding: '12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600 }}>
                {extending ? t('videoCall.extendWait') : t('videoCall.accept')}
              </button>
            </Box>
          </Box>
        )}
      </Dialog>

      {/* Индикатор ожидания ответа на продление */}
      {extendWaiting && (
        <Box sx={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', bgcolor: 'rgba(30,30,30,0.92)', color: '#C9A980', px: 2.5, py: 1.25, borderRadius: '20px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 1, zIndex: 30 }}>
          <CircularProgress size={14} thickness={3} sx={{ color: '#C9A980' }} />
          {t('videoCall.extendWaiting')}
        </Box>
      )}
    </Box>
  );
};

export default VideoCallPage;
