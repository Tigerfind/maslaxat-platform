import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  IconButton,
  Badge,
  Typography,
  Button,
  Chip,
  CircularProgress,
  ClickAwayListener,
  Popper,
  Paper,
  Fade,
  Divider,
} from '@mui/material';
import {
  Notifications,
  NotificationsNone,
  Circle,
  Gavel,
  CheckCircle,
  VideoCall,
  Star,
  Close,
  DoneAll,
  AccessTime,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import io from 'socket.io-client';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

// socket.io на корне хоста; REACT_APP_API_URL в проде содержит /api — срезаем.
const API_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');

const NOTIFICATION_ICONS = {
  consultation_request: <Gavel sx={{ fontSize: 20, color: axelionColors.gold }} />,
  consultation_accepted: <CheckCircle sx={{ fontSize: 20, color: axelionColors.success }} />,
  consultation_rejected: <Close sx={{ fontSize: 20, color: axelionColors.error }} />,
  consultation_cancelled: <Close sx={{ fontSize: 20, color: axelionColors.error }} />,
  consultation_started: <VideoCall sx={{ fontSize: 20, color: axelionColors.gold }} />,
  consultation_completed: <CheckCircle sx={{ fontSize: 20, color: axelionColors.success }} />,
  consultation_reminder: <AccessTime sx={{ fontSize: 20, color: axelionColors.gold }} />,
  consultation_rescheduled: <AccessTime sx={{ fontSize: 20, color: axelionColors.gold }} />,
  new_review: <Star sx={{ fontSize: 20, color: axelionColors.gold }} />,
  new_message: <Gavel sx={{ fontSize: 20, color: axelionColors.gold }} />,
};

const NotificationCenter = ({ sx = {} }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authToken = useSelector((s) => s.auth.token);
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchNotifications();
    // Опрос оставляем как fallback (реже — realtime приходит через socket)
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  // Realtime-пуш: мгновенно добавляем новое уведомление без ожидания опроса.
  // Пересоздаём сокет при смене токена (логин/логаут) — иначе realtime «залипал».
  useEffect(() => {
    const token = authToken || localStorage.getItem('token');
    if (!token) return undefined;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] });

    socket.on('notification:new', (notif) => {
      if (!notif || !notif.id) return;
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notif.id)) return prev;
        return [notif, ...prev].slice(0, 20);
      });
      setUnreadCount((c) => c + 1);
      if (notif.title) {
        toast.info(notif.title, { autoClose: 5000 });
      }
    });

    return () => { socket.disconnect(); };
  }, [authToken]);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/notifications?limit=20');
      const data = res.data;
      const items = data.notifications || data || [];
      setNotifications(Array.isArray(items) ? items : []);
      const unread = Array.isArray(items) ? items.filter(n => !n.isRead).length : 0;
      setUnreadCount(data.unreadCount ?? unread);
    } catch (err) {
      // Silently fail — notifications are non-critical
    }
  };

  const handleToggle = () => {
    setOpen((prev) => !prev);
    if (!open) fetchNotifications();
  };

  const handleClose = () => setOpen(false);

  const handleMarkRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      // ignore
    }
  };

  const formatTimeAgo = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return t('notif.justNow');
    if (diff < 3600) return `${Math.floor(diff / 60)} ${t('notif.minAgo')}`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ${t('notif.hourAgo')}`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} ${t('notif.dayAgo')}`;
    return date.toLocaleDateString('ru-RU');
  };

  return (
    <>
      <IconButton
        ref={anchorRef}
        onClick={handleToggle}
        aria-label={t('notif.title')}
        sx={{
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          borderRadius: '8px',
          color: axelionColors.textSecondary,
          '&:hover': {
            backgroundColor: axelionColors.bgWarm,
            borderColor: axelionColors.gold,
            color: axelionColors.gold,
          },
          ...sx,
        }}
      >
        <Badge
          badgeContent={unreadCount}
          sx={{
            '& .MuiBadge-badge': {
              backgroundColor: axelionColors.gold,
              color: '#FFFFFF',
              fontSize: '0.65rem',
            },
          }}
        >
          {unreadCount > 0 ? <Notifications sx={{ fontSize: 20 }} /> : <NotificationsNone sx={{ fontSize: 20 }} />}
        </Badge>
      </IconButton>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-end"
        transition
        style={{ zIndex: 1300 }}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={200}>
            <Paper
              sx={{
                mt: 1,
                width: 380,
                maxHeight: 480,
                borderRadius: '12px',
                border: `1px solid ${axelionColors.borderLight}`,
                boxShadow: '0 12px 40px rgba(26,26,26,0.12)',
                overflow: 'hidden',
              }}
            >
              <ClickAwayListener onClickAway={handleClose}>
                <Box>
                  {/* Header */}
                  <Box sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    p: 2, borderBottom: `1px solid ${axelionColors.borderLight}`,
                  }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.95rem', color: axelionColors.textDark }}>
                      {t('notif.title')}
                    </Typography>
                    {unreadCount > 0 && (
                      <Button
                        size="small"
                        startIcon={<DoneAll sx={{ fontSize: 16 }} />}
                        onClick={handleMarkAllRead}
                        sx={{
                          color: axelionColors.gold,
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          '&:hover': { bgcolor: axelionColors.accentLight },
                        }}
                      >
                        {t('notif.markAll')}
                      </Button>
                    )}
                  </Box>

                  {/* Notifications list */}
                  <Box sx={{ maxHeight: 380, overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
                        <NotificationsNone sx={{ fontSize: 48, color: axelionColors.borderLight, mb: 1 }} />
                        <Typography sx={{ color: axelionColors.textMuted, fontSize: '0.9rem' }}>
                          {t('notif.empty')}
                        </Typography>
                      </Box>
                    ) : (
                      notifications.map((notif) => (
                        <Box
                          key={notif.id}
                          onClick={() => {
                            if (!notif.isRead) handleMarkRead(notif.id);
                            handleClose();
                            const m = notif.metadata || {};
                            // Пропущенный звонок → открыть звонок (перезвонить);
                            // прочие с консультацией → в «Мои консультации».
                            if (m.consultationId) {
                              if (m.missedCall) navigate(`/consultations/video/${m.consultationId}`);
                              else navigate('/consultations');
                            }
                          }}
                          sx={{
                            display: 'flex', gap: 1.5, p: 2,
                            bgcolor: notif.isRead ? 'transparent' : axelionColors.accentLight + '30',
                            borderBottom: `1px solid ${axelionColors.borderLight}`,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': { bgcolor: axelionColors.bgWarm },
                          }}
                        >
                          <Box sx={{
                            width: 36, height: 36, borderRadius: '8px',
                            bgcolor: axelionColors.bgWarm, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            {NOTIFICATION_ICONS[notif.type] || <Notifications sx={{ fontSize: 20, color: axelionColors.textMuted }} />}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{
                              fontSize: '0.85rem', color: axelionColors.textDark,
                              fontWeight: notif.isRead ? 400 : 600,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {notif.title}
                            </Typography>
                            <Typography sx={{
                              fontSize: '0.75rem', color: axelionColors.textMuted,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {notif.message}
                            </Typography>
                            <Typography sx={{ fontSize: '0.65rem', color: axelionColors.textMuted, mt: 0.5 }}>
                              {formatTimeAgo(notif.createdAt)}
                            </Typography>
                          </Box>
                          {!notif.isRead && (
                            <Circle sx={{ fontSize: 8, color: axelionColors.gold, mt: 0.5, flexShrink: 0 }} />
                          )}
                        </Box>
                      ))
                    )}
                  </Box>
                </Box>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  );
};

export default NotificationCenter;
