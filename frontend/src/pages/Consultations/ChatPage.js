import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  CircularProgress, Button,
} from '@mui/material';
import {
  ArrowBackOutlined,
  SendOutlined,
  FolderOpenOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import io from 'socket.io-client';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import ErrorState from '../../components/UI/ErrorState';
import { createClientMessageId, isConsultationWritable, mergeChatMessages, normalizeMessagePage, sendChatMessage } from '../../utils/chatMessages';
import { localeForLanguage } from '../../utils/consultationLocale';

// socket.io на корне хоста; VITE_API_URL в проде содержит /api — срезаем.
const API_URL = (import.meta.env.VITE_API_URL || `${window.location.origin}/api`).replace(/\/api\/?$/, '');

const ChatPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const { user, token: authToken } = useSelector((state) => state.auth);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [consultation, setConsultation] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [earlierError, setEarlierError] = useState(false);
  const [viewport, setViewport] = useState(() => ({ height: window.visualViewport?.height || window.innerHeight, top: window.visualViewport?.offsetTop || 0 }));
  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const prependScrollHeightRef = useRef(null);
  const skipNextAutoScrollRef = useRef(false);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pendingMessageRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load consultation info and messages
  const loadData = useCallback(async () => {
      try {
        setLoading(true);
        setLoadError(null);
        setConsultation(null);
        const [messagesRes, consultationRes] = await Promise.all([
          api.get(`/chat/${consultationId}/messages`),
          api.get(`/consultations/${consultationId}`),
        ]);
         const page = normalizeMessagePage(messagesRes.data);
         setMessages((current) => mergeChatMessages(page.messages, current));
         setNextCursor(page.nextCursor);
         setHasMore(page.hasMore);
        if (consultationRes?.data?.consultation) {
          setConsultation(consultationRes.data.consultation);
        }
      } catch (err) {
        console.error('Error loading chat:', err);
        setLoadError(err);
      } finally {
        setLoading(false);
      }
  }, [consultationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const online = () => setOffline(false);
    const offlineHandler = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineHandler); };
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return undefined;
    const update = () => setViewport({ height: visualViewport.height, top: visualViewport.offsetTop });
    visualViewport.addEventListener('resize', update);
    visualViewport.addEventListener('scroll', update);
    update();
    return () => {
      visualViewport.removeEventListener('resize', update);
      visualViewport.removeEventListener('scroll', update);
    };
  }, []);

  // Socket connection
  useEffect(() => {
    const token = authToken || localStorage.getItem('token');
    if (!token || !consultationId || loading || consultation?.id !== consultationId || loadError) return undefined;

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('join-chat', { consultationId });
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 250);
    });

    socket.on('message-received', (message) => {
      setMessages((prev) => {
        // Avoid duplicates
        return mergeChatMessages(prev, [message]);
      });
    });

    socket.on('user-typing', ({ userName }) => {
      setTypingUser(userName);
    });

    socket.on('user-stop-typing', () => {
      setTypingUser(null);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [consultationId, authToken, consultation, loadError, loading]);

  useLayoutEffect(() => {
    if (prependScrollHeightRef.current === null || !messagesScrollRef.current) return;
    messagesScrollRef.current.scrollTop += messagesScrollRef.current.scrollHeight - prependScrollHeightRef.current;
    prependScrollHeightRef.current = null;
  }, [messages]);

  // Auto-scroll on initial/realtime messages, but never after prepending history.
  useEffect(() => {
    if (skipNextAutoScrollRef.current) { skipNextAutoScrollRef.current = false; return; }
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadEarlier = async () => {
    if (!hasMore || !nextCursor || earlierLoading) return;
    setEarlierLoading(true);
    setEarlierError(false);
    skipNextAutoScrollRef.current = true;
    prependScrollHeightRef.current = messagesScrollRef.current?.scrollHeight ?? null;
    try {
      const response = await api.get(`/chat/${consultationId}/messages`, { params: { cursor: nextCursor } });
      const page = normalizeMessagePage(response.data);
      setMessages((current) => mergeChatMessages(page.messages, current));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (_) {
      prependScrollHeightRef.current = null;
      skipNextAutoScrollRef.current = false;
      setEarlierError(true);
    } finally { setEarlierLoading(false); }
  };

  const handleSend = async () => {
    const text = newMessage.trim();
    if (!text || sending) return;

    setSending(true);
    const pending = pendingMessageRef.current?.text === text
      ? pendingMessageRef.current
      : { text, clientMessageId: createClientMessageId() };
    pendingMessageRef.current = pending;

    // Clear typing indicator
    if (socketRef.current) {
      socketRef.current.emit('stop-typing', { consultationId });
    }

    try {
      const message = await sendChatMessage({
        socket: socketRef.current,
        api,
        consultationId,
        text,
        clientMessageId: pending.clientMessageId,
      });
      setMessages((prev) => mergeChatMessages(prev, [message]));
      pendingMessageRef.current = null;
      setNewMessage((current) => (current.trim() === text ? '' : current));
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error(t('chat.sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTyping = () => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('typing', { consultationId });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('stop-typing', { consultationId });
      }, 2000);
    }
  };

  const getPartnerName = () => {
    if (!consultation) return t('chat.partnerFallback');
    if (user?.role === 'client') {
      return consultation.lawyer?.name || t('chat.lawyerFallback');
    }
    return consultation.client?.name || t('chat.clientFallback');
  };

  // Two-letter initials from the partner's name (design: "АК")
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  };

  // Theme-aware glass chrome recipe for header / input bars
  const glassBar = {
    background: 'var(--card-glass)',
    backdropFilter: 'blur(30px) saturate(180%)',
    WebkitBackdropFilter: 'blur(30px) saturate(180%)',
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100dvh',
          bgcolor: 'var(--canvas)',
        }}
      >
        <CircularProgress aria-label={t('chat.loading')} sx={{ color: 'var(--accent)' }} />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box sx={{ minHeight: '100dvh', bgcolor: 'var(--canvas)', px: 2, py: 3 }}>
        <IconButton aria-label={t('chat.back')} onClick={() => navigate(-1)}><ArrowBackOutlined /></IconButton>
        <ErrorState error={loadError} title={t('chat.loadError')} subtitle={t('chat.loadErrorHint')} onRetry={loadData} />
      </Box>
    );
  }

  const partnerName = getPartnerName();
  // Завершённая/отменённая консультация — чат только для чтения (история переписки)
  const isReadOnly = !isConsultationWritable(consultation);
  const locale = localeForLanguage(language);

  return (
    <Box
      sx={{
        position: 'fixed',
        top: `${viewport.top}px`,
        left: 0,
        right: 0,
        height: `${viewport.height}px`,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--canvas)',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          minHeight: 72,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: { xs: 2, sm: 3.5 },
          borderBottom: '1px solid var(--border)',
          pt: 'env(safe-area-inset-top)',
          ...glassBar,
        }}
      >
        <IconButton
          aria-label={t('chat.back')}
          onClick={() => navigate(-1)}
          sx={{ color: 'var(--text2)', p: 0.5, '&:hover': { bgcolor: 'transparent', color: 'var(--text)' } }}
        >
          <ArrowBackOutlined />
        </IconButton>
        <Box
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #B8956E, #8B7355)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontSize: 15,
          }}
        >
          {getInitials(partnerName)}
        </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
            {partnerName}
          </Typography>
          {typingUser && (
            <Typography role="status" sx={{ fontSize: 12, color: '#7A9A6B' }}>{t('chat.typing')}</Typography>
          )}
        </Box>
        {/* Документы по делу — общая папка юриста и клиента */}
        <IconButton
          aria-label={t('caseDocs.title')}
          onClick={() => setDocsOpen(true)}
          title={t('caseDocs.title')}
          sx={{ ml: 'auto', color: 'var(--text2)', '&:hover': { color: 'var(--accent)' } }}
        >
          <FolderOpenOutlined />
        </IconButton>
      </Box>

      {offline && <Box role="status" sx={{ flexShrink: 0, px: 2, py: 1, bgcolor: 'rgba(176,112,112,.14)', color: 'var(--text)' }}>{t('chat.offline')}</Box>}

      <CaseDocuments
        consultationId={consultationId}
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        currentUserId={user?.id}
        readOnly={isReadOnly}
      />

      {/* Messages */}
      <Box ref={messagesScrollRef} role="log" aria-live="polite" aria-relevant="additions" aria-label={t('chat.messagesLabel')} sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Box
          sx={{
            maxWidth: 820,
            mx: 'auto',
            width: '100%',
            px: { xs: 2, sm: 3.5 },
            py: 3.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.75,
          }}
        >
          {(hasMore || earlierError) && <Box sx={{ alignSelf: 'center', textAlign: 'center' }}>
            <Button size="small" onClick={loadEarlier} disabled={earlierLoading}>{earlierLoading ? t('chat.loadingEarlier') : earlierError ? t('chat.retryEarlier') : t('chat.loadEarlier')}</Button>
            {earlierError && <Typography role="alert" sx={{ color: '#B07070', fontSize: 12 }}>{t('chat.loadEarlierError')}</Typography>}
          </Box>}
          {messages.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography sx={{ fontSize: 18, fontWeight: 500, color: 'var(--text2)', mb: 1 }}>
                {t('chat.startTitle')}
              </Typography>
              <Typography sx={{ fontSize: 14, color: 'var(--text3)' }}>
                {t('chat.startSub')}
              </Typography>
            </Box>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.senderId === user?.id || msg.sender?.id === user?.id;
              return (
                <Box
                  key={msg.id}
                  sx={{
                    alignSelf: isOwn ? 'flex-end' : 'flex-start',
                    maxWidth: { xs: '86%', sm: '66%' },
                    px: 2,
                    py: 1.5,
                    fontSize: 14,
                    lineHeight: 1.5,
                    bgcolor: isOwn ? 'var(--accent)' : 'var(--surface)',
                    color: isOwn ? '#FFFFFF' : 'var(--text)',
                    border: isOwn ? 'none' : '1px solid var(--border)',
                    borderRadius: isOwn ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  }}
                >
                  <Typography sx={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 11,
                      mt: 0.75,
                      color: isOwn ? 'rgba(255,255,255,0.7)' : 'var(--text3)',
                    }}
                  >
                    {new Date(msg.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                </Box>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </Box>
      </Box>

      {/* Input / read-only banner */}
      {isReadOnly ? (
        <Box sx={{ flexShrink: 0, borderTop: '1px solid var(--border)', px: { xs: 2, sm: 3.5 }, py: 2.5, textAlign: 'center', ...glassBar }}>
          <Typography role="status" sx={{ color: 'var(--text3)', fontSize: 13 }}>{t('chat.readOnly')}</Typography>
        </Box>
      ) : (
      <Box
        sx={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          px: { xs: 2, sm: 3.5 },
          pt: 2,
          pb: 'max(16px, env(safe-area-inset-bottom))',
          ...glassBar,
        }}
      >
        <Box
          sx={{
            maxWidth: 820,
            mx: 'auto',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1.5,
            bgcolor: 'var(--canvas)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius, 8px)',
            px: 1.75,
            py: 1.25,
          }}
        >
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={newMessage}
            disabled={sending || offline}
            onChange={(e) => {
              setNewMessage(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => requestAnimationFrame(scrollToBottom)}
            placeholder={t('chat.messagePlaceholder')}
            inputProps={{ 'aria-label': t('chat.messagePlaceholder') }}
            variant="standard"
            InputProps={{ disableUnderline: true }}
            sx={{
              '& .MuiInputBase-root': { color: 'var(--text)', fontSize: 14, p: 0 },
              '& textarea::placeholder': { color: 'var(--text3)', opacity: 1 },
            }}
          />
          <IconButton
            aria-label={t('chat.send')}
            onClick={handleSend}
            disabled={!newMessage.trim() || sending || offline}
            sx={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 'var(--radius, 8px)',
              bgcolor: 'var(--accent)',
              color: '#FFFFFF',
              '&:hover': { bgcolor: 'var(--accent-dark)' },
              '&.Mui-disabled': { bgcolor: 'var(--border)', color: 'var(--text3)' },
            }}
          >
            {sending ? <CircularProgress size={18} sx={{ color: '#FFFFFF' }} /> : <SendOutlined sx={{ fontSize: 20 }} />}
          </IconButton>
        </Box>
      </Box>
      )}
    </Box>
  );
};

export default ChatPage;
