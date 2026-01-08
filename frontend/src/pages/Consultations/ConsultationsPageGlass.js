import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  Tabs,
  Tab,
  Avatar,
  Chip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Card,
  Button,
  keyframes,
} from '@mui/material';
import {
  ArrowBack,
  VideoCall,
  Chat,
  Schedule,
  CheckCircle,
  Cancel,
  Pending,
  CalendarMonth,
  AccessTime,
  Gavel,
  Payment,
  Star,
  Close,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import { toast } from 'react-toastify';

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const scaleIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const ConsultationsPageGlass = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // State
  const [currentTab, setCurrentTab] = useState(0);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch consultations on mount and tab change
  useEffect(() => {
    fetchConsultations();
  }, [currentTab]);

  const fetchConsultations = async () => {
    try {
      setLoading(true);
      setError(null);

      // Map tab index to status filter
      const statusMap = ['all', 'upcoming', 'completed', 'cancelled'];
      const status = statusMap[currentTab];

      const data = await clientService.consultations.getConsultations(status);
      setConsultations(data);
    } catch (err) {
      console.error('Error fetching consultations:', err);
      setError('Не удалось загрузить консультации. Попробуйте позже.');

      // Fallback to mock data for development
      setConsultations(getMockConsultations(currentTab));
    } finally {
      setLoading(false);
    }
  };

  // Mock data fallback
  const getMockConsultations = (tabIndex) => {
    const mockData = {
      0: [ // All
        {
          id: 1,
          lawyer: { name: 'Иванов Иван Иванович', specialization: 'Гражданское право', rating: 4.8 },
          date: '2024-12-15',
          time: '14:00',
          duration: 60,
          type: 'video',
          topic: 'Консультация по договору купли-продажи',
          price: 50000,
          status: 'confirmed',
        },
        {
          id: 2,
          lawyer: { name: 'Петрова Мария Сергеевна', specialization: 'Корпоративное право', rating: 4.9 },
          date: '2024-12-16',
          time: '10:00',
          duration: 30,
          type: 'chat',
          topic: 'Вопросы по регистрации ООО',
          price: 35000,
          status: 'pending',
        },
      ],
      1: [ // Upcoming
        {
          id: 1,
          lawyer: { name: 'Иванов Иван Иванович', specialization: 'Гражданское право', rating: 4.8 },
          date: '2024-12-15',
          time: '14:00',
          duration: 60,
          type: 'video',
          topic: 'Консультация по договору купли-продажи',
          price: 50000,
          status: 'confirmed',
        },
      ],
      2: [ // Completed
        {
          id: 3,
          lawyer: { name: 'Сидоров Петр Александрович', specialization: 'Семейное право', rating: 4.7 },
          date: '2024-11-20',
          time: '15:00',
          duration: 45,
          type: 'video',
          topic: 'Консультация по разделу имущества',
          price: 45000,
          status: 'completed',
          reviewed: false,
        },
      ],
      3: [ // Cancelled
        {
          id: 5,
          lawyer: { name: 'Петрова Мария Сергеевна', specialization: 'Корпоративное право', rating: 4.9 },
          date: '2024-11-10',
          time: '16:00',
          duration: 30,
          type: 'video',
          topic: 'Налоговая консультация',
          price: 75000,
          status: 'cancelled',
        },
      ],
    };
    return mockData[tabIndex] || [];
  };

  // Filter consultations by current tab
  const getFilteredConsultations = () => {
    if (currentTab === 0) return consultations; // All

    const statusMap = {
      1: ['confirmed', 'pending'], // Upcoming
      2: ['completed'], // Completed
      3: ['cancelled'], // Cancelled
    };

    const allowedStatuses = statusMap[currentTab] || [];
    return consultations.filter(c => allowedStatuses.includes(c.status));
  };

  // Handler functions
  const handleCancelConsultation = async () => {
    if (!selectedConsultation || !cancelReason.trim()) {
      toast.error('Пожалуйста, укажите причину отмены');
      return;
    }

    try {
      setActionLoading(true);
      await clientService.consultations.cancelConsultation(
        selectedConsultation.id,
        cancelReason
      );

      toast.success('Консультация успешно отменена');
      setCancelDialogOpen(false);
      setCancelReason('');
      setSelectedConsultation(null);

      // Refresh consultations
      fetchConsultations();
    } catch (err) {
      console.error('Error canceling consultation:', err);
      toast.error('Не удалось отменить консультацию');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinConsultation = async (consultation) => {
    try {
      setActionLoading(true);
      await clientService.consultations.joinConsultation(consultation.id);

      if (consultation.type === 'video') {
        navigate(`/consultations/video/${consultation.id}`);
      } else {
        navigate('/ai-chat', { state: { consultationId: consultation.id } });
      }
    } catch (err) {
      console.error('Error joining consultation:', err);
      toast.error('Не удалось присоединиться к консультации');
    } finally {
      setActionLoading(false);
    }
  };

  const openCancelDialog = (consultation) => {
    setSelectedConsultation(consultation);
    setCancelDialogOpen(true);
  };

  const closeCancelDialog = () => {
    setCancelDialogOpen(false);
    setCancelReason('');
    setSelectedConsultation(null);
  };

  // Status configuration
  const getStatusConfig = (status) => {
    const configs = {
      confirmed: {
        color: 'success',
        label: 'Подтверждено',
        icon: <CheckCircle />,
        bgColor: '#10b981',
      },
      pending: {
        color: 'warning',
        label: 'Ожидание',
        icon: <Pending />,
        bgColor: '#f59e0b',
      },
      completed: {
        color: 'info',
        label: 'Завершено',
        icon: <CheckCircle />,
        bgColor: '#2563EB',
      },
      cancelled: {
        color: 'error',
        label: 'Отменено',
        icon: <Cancel />,
        bgColor: '#ef4444',
      },
    };
    return configs[status] || configs.pending;
  };

  // Render consultation card
  const renderConsultationCard = (consultation, index) => {
    const statusConfig = getStatusConfig(consultation.status);
    const showActions = ['confirmed', 'pending'].includes(consultation.status);

    return (
      <Card
        key={consultation.id}
        sx={{
          mb: 3,
          p: 3,
          borderRadius: 2,
          border: '1px solid #E6E9EE',
          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          background: '#FFFFFF',
          animation: `${scaleIn} 0.5s ease-out`,
          animationDelay: `${index * 0.1}s`,
          animationFillMode: 'both',
          transition: 'all 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(11, 27, 43, 0.1)',
          },
        }}
      >
        <Box>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, flexGrow: 1 }}>
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: '#2563EB',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                }}
              >
                {consultation.lawyer.name.charAt(0)}
              </Avatar>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 0.5, color: '#0B1B2B' }}>
                  {consultation.lawyer.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    size="small"
                    label={consultation.lawyer.specialization}
                    icon={<Gavel />}
                    sx={{
                      bgcolor: '#F4F6F8',
                      color: '#2563EB',
                      border: '1px solid #E6E9EE',
                      fontWeight: 600,
                    }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Star sx={{ fontSize: 16, color: '#fbbf24' }} />
                    <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {consultation.lawyer.rating}
                    </Typography>
                  </Box>
                </Box>
                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                  {consultation.topic}
                </Typography>
              </Box>
            </Box>
            <Chip
              label={statusConfig.label}
              icon={statusConfig.icon}
              sx={{
                bgcolor: statusConfig.bgColor,
                color: 'white',
                fontWeight: 'bold',
                border: 'none',
              }}
            />
          </Box>

          {/* Details Grid */}
          <Grid container spacing={2} sx={{ mb: showActions ? 3 : 0 }}>
            <Grid item xs={6} sm={3}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <CalendarMonth sx={{ fontSize: 18, color: '#2563EB' }} />
                  <Typography variant="caption" sx={{ color: '#6B7280', fontWeight: 600 }}>
                    Дата
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {new Date(consultation.date).toLocaleDateString('ru-RU')}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <AccessTime sx={{ fontSize: 18, color: '#2563EB' }} />
                  <Typography variant="caption" sx={{ color: '#6B7280', fontWeight: 600 }}>
                    Время
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {consultation.time} ({consultation.duration} мин)
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  {consultation.type === 'video' ? (
                    <VideoCall sx={{ fontSize: 18, color: '#2563EB' }} />
                  ) : (
                    <Chat sx={{ fontSize: 18, color: '#2563EB' }} />
                  )}
                  <Typography variant="caption" sx={{ color: '#6B7280', fontWeight: 600 }}>
                    Тип
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {consultation.type === 'video' ? 'Видео' : 'Чат'}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Payment sx={{ fontSize: 18, color: '#10b981' }} />
                  <Typography variant="caption" sx={{ color: '#6B7280', fontWeight: 600 }}>
                    Стоимость
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {consultation.price.toLocaleString()} сум
                </Typography>
              </Box>
            </Grid>
          </Grid>

          {/* Action Buttons */}
          {showActions && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {consultation.status === 'confirmed' && (
                <>
                  <Button
                    variant="contained"
                    startIcon={consultation.type === 'video' ? <VideoCall /> : <Chat />}
                    onClick={() => handleJoinConsultation(consultation)}
                    disabled={actionLoading}
                    sx={{
                      bgcolor: '#2563EB',
                      color: 'white',
                      fontWeight: 600,
                      textTransform: 'none',
                      borderRadius: 2,
                      px: 3,
                      py: 1,
                      boxShadow: 'none',
                      '&:hover': {
                        bgcolor: '#1d4ed8',
                        boxShadow: 'none',
                      },
                    }}
                  >
                    {consultation.type === 'video' ? 'Войти в видео' : 'Открыть чат'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Cancel />}
                    onClick={() => openCancelDialog(consultation)}
                    disabled={actionLoading}
                    sx={{
                      color: '#ef4444',
                      borderColor: '#E6E9EE',
                      fontWeight: 600,
                      textTransform: 'none',
                      borderRadius: 2,
                      px: 3,
                      py: 1,
                      '&:hover': {
                        borderColor: '#ef4444',
                        bgcolor: 'rgba(239, 68, 68, 0.04)',
                      },
                    }}
                  >
                    Отменить
                  </Button>
                </>
              )}
              {consultation.status === 'pending' && (
                <Button
                  variant="outlined"
                  startIcon={<Cancel />}
                  onClick={() => openCancelDialog(consultation)}
                  disabled={actionLoading}
                  sx={{
                    color: '#ef4444',
                    borderColor: '#E6E9EE',
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: 2,
                    px: 3,
                    py: 1,
                    '&:hover': {
                      borderColor: '#ef4444',
                      bgcolor: 'rgba(239, 68, 68, 0.04)',
                    },
                  }}
                >
                  Отменить запрос
                </Button>
              )}
            </Box>
          )}
        </Box>
      </Card>
    );
  };

  // Get tab counts
  const getTabCounts = () => {
    return {
      all: consultations.length,
      upcoming: consultations.filter(c => ['confirmed', 'pending'].includes(c.status)).length,
      completed: consultations.filter(c => c.status === 'completed').length,
      cancelled: consultations.filter(c => c.status === 'cancelled').length,
    };
  };

  const tabCounts = getTabCounts();
  const filteredConsultations = getFilteredConsultations();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F4F6F8', pb: 6 }}>
      {/* Header */}
      <Box
        sx={{
          bgcolor: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          py: 4,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton
                onClick={() => navigate('/dashboard')}
                sx={{
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                  '&:hover': { bgcolor: '#E6E9EE' },
                }}
              >
                <ArrowBack sx={{ color: '#0B1B2B' }} />
              </IconButton>
              <Box>
                <Typography variant="h4" fontWeight="bold" sx={{ mb: 0.5, color: '#0B1B2B' }}>
                  Мои консультации
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                  Управляйте своими юридическими консультациями
                </Typography>
              </Box>
            </Box>
            <Button
              variant="contained"
              startIcon={<Schedule />}
              onClick={() => navigate('/lawyers')}
              sx={{
                bgcolor: '#2563EB',
                color: 'white',
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: 2,
                px: 3,
                py: 1.5,
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#1d4ed8',
                  boxShadow: 'none',
                },
              }}
            >
              Записаться
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Tabs */}
        <Card
          sx={{
            mb: 4,
            borderRadius: 2,
            border: '1px solid #E6E9EE',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            bgcolor: '#FFFFFF',
            animation: `${fadeInUp} 0.6s ease-out`,
          }}
        >
          <Tabs
            value={currentTab}
            onChange={(e, val) => setCurrentTab(val)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              '& .MuiTab-root': {
                fontWeight: 600,
                fontSize: '0.95rem',
                minHeight: 64,
                color: '#6B7280',
              },
              '& .Mui-selected': {
                color: '#2563EB',
              },
              '& .MuiTabs-indicator': {
                bgcolor: '#2563EB',
                height: 3,
              },
            }}
          >
            <Tab
              label={`Все (${tabCounts.all})`}
              icon={<Schedule />}
              iconPosition="start"
            />
            <Tab
              label={`Предстоящие (${tabCounts.upcoming})`}
              icon={<Pending />}
              iconPosition="start"
            />
            <Tab
              label={`Завершенные (${tabCounts.completed})`}
              icon={<CheckCircle />}
              iconPosition="start"
            />
            <Tab
              label={`Отмененные (${tabCounts.cancelled})`}
              icon={<Cancel />}
              iconPosition="start"
            />
          </Tabs>
        </Card>

        {/* Content */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress
              sx={{
                color: '#2563EB',
              }}
            />
          </Box>
        ) : error ? (
          <Alert
            severity="error"
            sx={{
              borderRadius: 2,
              animation: `${fadeInUp} 0.6s ease-out`,
            }}
          >
            {error}
          </Alert>
        ) : filteredConsultations.length > 0 ? (
          <Box>
            {filteredConsultations.map((consultation, index) =>
              renderConsultationCard(consultation, index)
            )}
          </Box>
        ) : (
          <Card
            sx={{
              textAlign: 'center',
              py: 8,
              px: 3,
              borderRadius: 2,
              border: '1px solid #E6E9EE',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              bgcolor: '#FFFFFF',
              animation: `${fadeInUp} 0.6s ease-out`,
            }}
          >
            <Schedule sx={{ fontSize: 80, color: '#2563EB', mb: 2, opacity: 0.3 }} />
            <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ color: '#0B1B2B' }}>
              Консультации не найдены
            </Typography>
            <Typography variant="body1" sx={{ color: '#6B7280', mb: 3 }}>
              У вас пока нет консультаций в этой категории
            </Typography>
            <Button
              variant="contained"
              startIcon={<Schedule />}
              onClick={() => navigate('/lawyers')}
              sx={{
                bgcolor: '#2563EB',
                color: 'white',
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: 2,
                px: 3,
                py: 1.5,
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#1d4ed8',
                  boxShadow: 'none',
                },
              }}
            >
              Найти юриста
            </Button>
          </Card>
        )}
      </Container>

      {/* Cancel Dialog */}
      <Dialog
        open={cancelDialogOpen}
        onClose={closeCancelDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            border: '1px solid #E6E9EE',
            boxShadow: '0 4px 12px rgba(11, 27, 43, 0.1)',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
              Отмена консультации
            </Typography>
            <IconButton onClick={closeCancelDialog} size="small">
              <Close sx={{ color: '#6B7280' }} />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedConsultation && (
            <Box sx={{ mb: 3, p: 2, borderRadius: 2, bgcolor: '#F4F6F8', border: '1px solid #E6E9EE' }}>
              <Typography variant="subtitle2" sx={{ color: '#6B7280' }} gutterBottom>
                Консультация с:
              </Typography>
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                {selectedConsultation.lawyer.name}
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                {new Date(selectedConsultation.date).toLocaleDateString('ru-RU')} в{' '}
                {selectedConsultation.time}
              </Typography>
            </Box>
          )}
          <TextField
            label="Причина отмены"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            multiline
            rows={4}
            fullWidth
            placeholder="Пожалуйста, укажите причину отмены консультации..."
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                '& fieldset': {
                  borderColor: '#E6E9EE',
                },
                '&:hover fieldset': {
                  borderColor: '#2563EB',
                },
              },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            variant="outlined"
            onClick={closeCancelDialog}
            sx={{
              color: '#6B7280',
              borderColor: '#E6E9EE',
              fontWeight: 600,
              textTransform: 'none',
              borderRadius: 2,
              px: 3,
              py: 1,
              '&:hover': {
                borderColor: '#6B7280',
                bgcolor: '#F4F6F8',
              },
            }}
          >
            Назад
          </Button>
          <Button
            variant="contained"
            onClick={handleCancelConsultation}
            disabled={!cancelReason.trim() || actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : <Cancel />}
            sx={{
              bgcolor: '#ef4444',
              color: 'white',
              fontWeight: 600,
              textTransform: 'none',
              borderRadius: 2,
              px: 3,
              py: 1,
              boxShadow: 'none',
              '&:hover': {
                bgcolor: '#dc2626',
                boxShadow: 'none',
              },
              '&:disabled': {
                bgcolor: '#E6E9EE',
                color: '#6B7280',
              },
            }}
          >
            Отменить консультацию
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ConsultationsPageGlass;
