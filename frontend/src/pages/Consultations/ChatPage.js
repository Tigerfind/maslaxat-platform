import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBackOutlined,
  SendOutlined,
  AttachFileOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import io from 'socket.io-client';
import api from '../../services/api';
import { useTranslation } from '../../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const ChatPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useSelector((state) => state.auth);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [consultation, setConsultation] = useState(null);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load consultation info and messages
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [messagesRes, consultationRes] = await Promise.all([
          api.get(`/chat/${consultationId}/messages`),
          api.get(`/consultations/${consultationId}`),
        ]);
        setMessages(messagesRes.data || []);
        if (consultationRes?.data?.consultation) {
          setConsultation(consultationRes.data.consultation);
        }
      } catch (err) {
        console.error('Error loading chat:', err);
        toast.error(t('chat.loadError'));
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [consultationId]);

  // Socket connection
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !consultationId) return;

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('join-chat', { consultationId });
    });

    socket.on('message-received', (message) => {
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
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
  }, [consultationId]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    const text = newMessage.trim();
    if (!text || sending) return;

    setSending(true);
    setNewMessage('');

    // Clear typing indicator
    if (socketRef.current) {
      socketRef.current.emit('stop-typing', { consultationId });
    }

    try {
      if (socketRef.current?.connected) {
        socketRef.current.emit('send-message', { consultationId, text });
      } else {
        // REST fallback
        const res = await api.post(`/chat/${consultationId}/messages`, { text });
        setMessages((prev) => [...prev, res.data]);
      }
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error(t('chat.sendError'));
      setNewMessage(text);
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
          height: '100vh',
          bgcolor: 'var(--canvas)',
        }}
      >
        <CircularProgress sx={{ color: 'var(--accent)' }} />
      </Box>
    );
  }

  const partnerName = getPartnerName();
  // Завершённая/отменённая консультация — чат только для чтения (история переписки)
  const isReadOnly = consultation && ['completed', 'cancelled', 'rejected'].includes(consultation.status);

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--canvas)',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          height: 72,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: { xs: 2, sm: 3.5 },
          borderBottom: '1px solid var(--border)',
          ...glassBar,
        }}
      >
        <IconButton
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
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
            {partnerName}
          </Typography>
          {typingUser && (
            <Typography sx={{ fontSize: 12, color: '#7A9A6B' }}>{t('chat.typing')}</Typography>
          )}
        </Box>
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                    maxWidth: '66%',
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
                    {new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
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
          <Typography sx={{ color: 'var(--text3)', fontSize: 13 }}>{t('chat.readOnly')}</Typography>
        </Box>
      ) : (
      <Box
        sx={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          px: { xs: 2, sm: 3.5 },
          py: 2,
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
          <AttachFileOutlined sx={{ color: 'var(--text3)', fontSize: 20, mb: 0.75 }} />
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.messagePlaceholder')}
            variant="standard"
            InputProps={{ disableUnderline: true }}
            sx={{
              '& .MuiInputBase-root': { color: 'var(--text)', fontSize: 14, p: 0 },
              '& textarea::placeholder': { color: 'var(--text3)', opacity: 1 },
            }}
          />
          <IconButton
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            sx={{
              flexShrink: 0,
              width: 38,
              height: 38,
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
