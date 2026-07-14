import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Box,
  Typography,
  IconButton,
  CircularProgress,
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
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { axelionColors } from '../../theme/axelionTheme';
import api from '../../services/api';

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

  // State
  const [consultation, setConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [remoteName, setRemoteName] = useState('');
  const [remoteRole, setRemoteRole] = useState('');

  // Media controls
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Call state
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState(null);

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

  // Load consultation details
  useEffect(() => {
    const loadConsultation = async () => {
      try {
        const response = await api.get(`/video/consultation/${consultationId}`);
        setConsultation(response.data);
      } catch (err) {
        setError('Failed to load consultation details');
        console.error('Load consultation error:', err);
      } finally {
        setLoading(false);
      }
    };
    loadConsultation();
  }, [consultationId]);

  // Start call timer
  useEffect(() => {
    if (peerConnected && !callStartTime) {
      setCallStartTime(Date.now());
    }
  }, [peerConnected, callStartTime]);

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
    // Clear stale pending signals from any previous peer
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
    });

    peer.on('close', () => {
      setPeerConnected(false);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      // Don't show error for non-critical peer issues during negotiation
      if (err.code === 'ERR_DATA_CHANNEL' || err.code === 'ERR_CONNECTION_FAILURE') {
        setError('Не удалось установить соединение. Проверьте интернет и попробуйте снова.');
      }
    });

    peerRef.current = peer;

    // Flush any pending signals that arrived before peer was created
    if (pendingSignalsRef.current.length > 0) {
      pendingSignalsRef.current.forEach((sig) => {
        try {
          peer.signal(sig);
        } catch (e) {
          console.error('Error applying pending signal:', e);
        }
      });
      pendingSignalsRef.current = [];
    }
  }, []);

  // End call
  const handleEndCall = useCallback(async (emitEvent = true) => {
    // Stop all media
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
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
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Mark consultation as completed
    try {
      await api.post(`/video/consultation/${consultationId}/end`);
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

  // Initialize media and socket connection
  useEffect(() => {
    if (!consultation || error) return;
    // Prevent double-start from React StrictMode
    if (callStartedRef.current) return;
    callStartedRef.current = true;

    let socket = null;
    let stream = null;
    let cancelled = false;

    const init = async () => {
      try {
        // Get local media stream
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Mark consultation as in_progress
        try {
          await api.post(`/video/consultation/${consultationId}/start`);
        } catch (e) {
          // Ignore — may already be in_progress
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
        });

        socket.on('connect_error', (err) => {
          console.error('Socket connection error:', err.message);
          if (!cancelled) {
            setError('Failed to connect to signaling server');
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
          }
        });

        // When another user joins — they will initiate, we respond
        socket.on('user-joined', ({ socketId, userName, userRole }) => {
          if (cancelled) return;
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
          setError('Camera/microphone access denied. Please allow access and try again.');
        } else {
          setError('Failed to start video call: ' + err.message);
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
        stream.getTracks().forEach((t) => t.stop());
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
      pendingSignalsRef.current = [];
      localStreamRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultation, consultationId, createPeer, handleEndCall]);

  // Toggle audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (screenSharing) {
      // Stop screen sharing, restore camera
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (peerRef.current && videoTrack) {
        const senders = peerRef.current._pc?.getSenders();
        const videoSender = senders?.find((s) => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
        }
      }
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setScreenSharing(false);
    } else {
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

        screenTrack.onended = () => {
          toggleScreenShare();
        };

        setScreenSharing(true);
      } catch (err) {
        console.error('Screen share error:', err);
      }
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
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
          Connection Error
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
          Go Back
        </Box>
      </Box>
    );
  }

  // Status label shown in the top bar (design: dot + "Соединено · timer")
  const statusText = peerConnected
    ? `Соединено · ${formatDuration(callDuration)}`
    : connected
    ? 'Ожидание собеседника…'
    : 'Соединение…';
  const statusDotColor = peerConnected ? '#7A9A6B' : '#C4A35A';

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
              color: '#C9A980',
              fontSize: 13,
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
            }}
          >
            {statusText}
          </Typography>
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
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
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
              {otherPartyName || remoteName || 'Участник'}
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
              {remoteRole === 'client' ? 'Клиент' : 'Юрист'}
            </Typography>
            <CircularProgress
              size={28}
              thickness={2}
              sx={{ color: '#C9A980', mt: 3 }}
            />
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
              Камера выкл.
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
            Вы
          </Typography>
        </Box>
      </Box>

      {/* Controls bar */}
      <Box
        sx={{
          height: 96,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
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
    </Box>
  );
};

export default VideoCallPage;
