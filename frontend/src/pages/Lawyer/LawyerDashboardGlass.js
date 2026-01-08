import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Avatar,
  Chip,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Badge,
  keyframes,
  CircularProgress,
  Card,
  Button,
} from '@mui/material';
import {
  TrendingUp,
  AttachMoney,
  People,
  CheckCircle,
  Star,
  Message,
  VideoCall,
  Logout,
  Settings,
  Notifications,
  CalendarToday,
  RateReview,
  PowerSettingsNew,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import lawyerService from '../../services/lawyerService';
import DebugPanel from '../../components/DebugPanel';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

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

const LawyerDashboardGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  const [stats, setStats] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [consultationRequests, setConsultationRequests] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusOnline, setStatusOnline] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, consultationsData, requestsData, reviewsData] = await Promise.all([
        lawyerService.dashboard.getStats(),
        lawyerService.dashboard.getPendingConsultations(),
        lawyerService.consultation.getConsultationRequests('pending'),
        lawyerService.dashboard.getRecentReviews(3),
      ]);

      setStats(statsData);
      setConsultations(consultationsData);
      setConsultationRequests(requestsData);
      setReviews(reviewsData);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId) => {
    try {
      await lawyerService.consultation.acceptConsultationRequest(requestId);
      toast.success('Запрос принят!');
      loadDashboardData(); // Reload data
    } catch (error) {
      toast.error('Ошибка при принятии запроса');
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await lawyerService.consultation.rejectConsultationRequest(requestId);
      toast.success('Запрос отклонен');
      loadDashboardData(); // Reload data
    } catch (error) {
      toast.error('Ошибка при отклонении запроса');
    }
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login/lawyer');
  };

  const handleStatusToggle = async () => {
    try {
      const newStatus = statusOnline ? 'offline' : 'online';
      await lawyerService.dashboard.updateStatus(newStatus);
      setStatusOnline(!statusOnline);
      toast.success(`Статус изменен на ${newStatus === 'online' ? 'В сети' : 'Не в сети'}`);
    } catch (error) {
      toast.error('Ошибка изменения статуса');
    }
  };

  const handleConfirmConsultation = async (consultationId) => {
    try {
      await lawyerService.schedule.confirmConsultation(consultationId);
      toast.success('Консультация подтверждена');
      loadDashboardData();
    } catch (error) {
      toast.error('Ошибка подтверждения');
    }
  };

  const handleStartConsultation = async (consultation) => {
    try {
      if (consultation.type === 'video') {
        navigate(`/consultations/video/${consultation.id}`);
      } else {
        navigate('/ai-chat');
      }
    } catch (error) {
      toast.error('Ошибка запуска консультации');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uz-UZ', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(amount) + ' сум';
  };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#F4F6F8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress sx={{ color: '#0EA5A4' }} size={60} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: '#F4F6F8',
        pb: 4,
      }}
    >
      {/* Clean Header */}
      <Box
        sx={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          py: 3,
          px: 2,
          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  background: '#0EA5A4',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  border: '1px solid #E6E9EE',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                }}
              >
                {user?.name?.charAt(0) || 'Ю'}
              </Avatar>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                    {user?.name || 'Юрист'}
                  </Typography>
                  <Chip
                    label="LAWYER"
                    size="small"
                    sx={{
                      background: '#0EA5A4',
                      color: 'white',
                      fontWeight: 'bold',
                      border: '1px solid #E6E9EE',
                    }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    icon={<PowerSettingsNew sx={{ fontSize: 16, color: 'white !important' }} />}
                    label={statusOnline ? 'В сети' : 'Не в сети'}
                    size="small"
                    onClick={handleStatusToggle}
                    sx={{
                      background: statusOnline ? '#22c55e' : '#6b7280',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      border: '1px solid #E6E9EE',
                      '&:hover': {
                        opacity: 0.9,
                      },
                    }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Star sx={{ fontSize: 18, color: '#fbbf24' }} />
                    <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {stats?.rating || '4.8'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <LanguageSwitcher
                variant="dropdown"
                sx={{
                  color: '#0B1B2B',
                  bgcolor: '#F4F6F8',
                  '&:hover': { bgcolor: '#E6E9EE' },
                }}
              />
              <IconButton
                sx={{
                  background: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  color: '#0B1B2B',
                  '&:hover': {
                    background: '#F4F6F8',
                  },
                }}
              >
                <Badge badgeContent={3} color="error">
                  <Notifications />
                </Badge>
              </IconButton>
              <IconButton
                sx={{
                  background: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  color: '#0B1B2B',
                  '&:hover': {
                    background: '#F4F6F8',
                  },
                }}
                onClick={() => navigate('/settings')}
              >
                <Settings />
              </IconButton>
              <Button
                variant="outlined"
                startIcon={<Logout />}
                onClick={handleLogout}
                sx={{
                  color: '#0B1B2B',
                  borderColor: '#E6E9EE',
                  background: '#FFFFFF',
                  '&:hover': {
                    background: '#F4F6F8',
                    borderColor: '#E6E9EE',
                  },
                }}
              >
                {t('nav.logout')}
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <AttachMoney sx={{ fontSize: 40 }} />,
              label: 'Заработано за месяц',
              value: formatCurrency(stats?.monthlyEarnings || 0),
              iconBg: '#22c55e',
            },
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: 'Активные клиенты',
              value: stats?.activeClients || 0,
              iconBg: '#3b82f6',
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              label: 'Завершенные консультации',
              value: stats?.completedConsultations || 0,
              iconBg: '#0EA5A4',
            },
            {
              icon: <TrendingUp sx={{ fontSize: 40 }} />,
              label: 'Общий доход',
              value: formatCurrency(stats?.totalEarnings || 0),
              iconBg: '#f59e0b',
            },
          ].map((stat, index) => (
            <Grid
              item
              xs={12}
              sm={6}
              lg={3}
              key={index}
              sx={{
                animation: `${fadeInUp} 0.6s ease-out`,
                animationDelay: `${index * 0.1}s`,
                animationFillMode: 'both',
              }}
            >
              <Card
                sx={{
                  p: 2.5,
                  background: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  borderRadius: '12px',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(11, 27, 43, 0.1)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '12px',
                      background: stat.iconBg,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: '#6B7280' }} gutterBottom>
                      {stat.label}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {stat.value}
                    </Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Incoming Consultation Requests */}
        {consultationRequests.length > 0 && (
          <Card
            sx={{
              p: 3,
              mb: 4,
              background: '#FFFFFF',
              border: '1px solid #E6E9EE',
              borderRadius: '12px',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                Входящие запросы на консультации
              </Typography>
              <Chip
                label={`${consultationRequests.length} новых`}
                sx={{
                  background: '#ef4444',
                  color: 'white',
                  fontWeight: 'bold',
                }}
              />
            </Box>

            <Grid container spacing={2}>
              {consultationRequests.map((request) => (
                <Grid item xs={12} key={request.id}>
                  <Card
                    sx={{
                      p: 3,
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '12px',
                      boxShadow: 'none',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        boxShadow: '0 4px 12px rgba(11, 27, 43, 0.1)',
                      },
                    }}
                  >
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={8}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                          <Avatar
                            sx={{
                              width: 48,
                              height: 48,
                              bgcolor: '#0EA5A4',
                            }}
                          >
                            {request.client?.name?.charAt(0) || 'К'}
                          </Avatar>
                          <Box>
                            <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                              {request.client?.name || 'Клиент'}
                            </Typography>
                            <Typography variant="body2" sx={{ color: '#6B7280' }}>
                              {new Date(request.createdAt).toLocaleDateString('ru-RU', {
                                day: 'numeric',
                                month: 'long',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Typography>
                          </Box>
                        </Box>

                        <Box sx={{ mb: 2 }}>
                          <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                            Вопрос:
                          </Typography>
                          <Typography variant="body2" sx={{ color: '#0B1B2B', mb: 2 }}>
                            {request.question}
                          </Typography>

                          {request.description && (
                            <>
                              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                                Описание:
                              </Typography>
                              <Typography variant="body2" sx={{ color: '#6B7280', mb: 2 }}>
                                {request.description}
                              </Typography>
                            </>
                          )}

                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Chip
                              icon={request.consultationType === 'video' ? <VideoCall /> : <Message />}
                              label={request.consultationType === 'video' ? 'Видео консультация' : 'Чат консультация'}
                              size="small"
                              sx={{
                                background: request.consultationType === 'video' ? '#3b82f6' : '#0EA5A4',
                                color: 'white',
                                border: '1px solid #E6E9EE',
                              }}
                            />
                            <Chip
                              icon={<CalendarToday />}
                              label={`${new Date(request.preferredDate).toLocaleDateString('ru-RU')} в ${request.preferredTime}`}
                              size="small"
                              sx={{
                                background: '#FFFFFF',
                                color: '#0B1B2B',
                                border: '1px solid #E6E9EE',
                              }}
                            />
                            <Chip
                              icon={<AttachMoney />}
                              label={formatCurrency(request.price)}
                              size="small"
                              sx={{
                                background: '#22c55e',
                                color: 'white',
                                border: '1px solid #E6E9EE',
                              }}
                            />
                          </Box>
                        </Box>
                      </Grid>

                      <Grid item xs={12} md={4}>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1.5,
                            height: '100%',
                            justifyContent: 'center',
                          }}
                        >
                          <Button
                            fullWidth
                            variant="contained"
                            startIcon={<CheckCircle />}
                            onClick={() => handleAcceptRequest(request.id)}
                            sx={{
                              background: '#22c55e',
                              color: 'white',
                              fontWeight: 'bold',
                              '&:hover': {
                                background: '#16a34a',
                              },
                            }}
                          >
                            Принять запрос
                          </Button>
                          <Button
                            fullWidth
                            variant="outlined"
                            onClick={() => handleRejectRequest(request.id)}
                            sx={{
                              color: '#ef4444',
                              borderColor: '#ef4444',
                              fontWeight: 'bold',
                              '&:hover': {
                                background: '#fef2f2',
                                borderColor: '#ef4444',
                              },
                            }}
                          >
                            Отклонить
                          </Button>
                        </Box>
                      </Grid>
                    </Grid>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Card>
        )}

        <Grid container spacing={3}>
          {/* Pending Consultations */}
          <Grid item xs={12} lg={8}>
            <Card
              sx={{
                p: 3,
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  Предстоящие консультации
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<CalendarToday />}
                  onClick={() => navigate('/lawyer/schedule')}
                  sx={{
                    background: '#0EA5A4',
                    color: 'white',
                    '&:hover': {
                      background: '#0d9190',
                    },
                  }}
                >
                  Календарь
                </Button>
              </Box>

              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: '#0B1B2B', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>Клиент</TableCell>
                      <TableCell sx={{ color: '#0B1B2B', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>Тема</TableCell>
                      <TableCell sx={{ color: '#0B1B2B', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>Дата и время</TableCell>
                      <TableCell sx={{ color: '#0B1B2B', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>Тип</TableCell>
                      <TableCell sx={{ color: '#0B1B2B', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>Действия</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {consultations.map((consultation) => (
                      <TableRow
                        key={consultation.id}
                        hover
                        sx={{
                          '&:hover': {
                            backgroundColor: '#F4F6F8',
                          },
                        }}
                      >
                        <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ width: 32, height: 32, bgcolor: '#0EA5A4' }}>
                              {consultation.clientName?.charAt(0)}
                            </Avatar>
                            <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                              {consultation.clientName}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                          <Typography variant="body2" sx={{ color: '#6B7280' }}>
                            {consultation.topic}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                          <Typography variant="body2" sx={{ color: '#6B7280' }}>
                            {consultation.date} в {consultation.time}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                          <Chip
                            icon={consultation.type === 'video' ? <VideoCall /> : <Message />}
                            label={consultation.type === 'video' ? 'Видео' : 'Чат'}
                            size="small"
                            sx={{
                              background: consultation.type === 'video' ? '#3b82f6' : '#0EA5A4',
                              color: 'white',
                              border: '1px solid #E6E9EE',
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => handleStartConsultation(consultation)}
                            sx={{
                              background: '#22c55e',
                              color: 'white',
                              '&:hover': {
                                background: '#16a34a',
                              },
                            }}
                          >
                            Начать
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Grid>

          {/* Recent Reviews */}
          <Grid item xs={12} lg={4}>
            <Card
              sx={{
                p: 3,
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }} gutterBottom>
                Последние отзывы
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2, flex: 1 }}>
                {reviews.map((review) => (
                  <Card
                    key={review.id}
                    sx={{
                      p: 2,
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '8px',
                      boxShadow: 'none',
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                        {review.clientName}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {[...Array(review.rating)].map((_, i) => (
                          <Star key={i} sx={{ fontSize: 16, color: '#fbbf24' }} />
                        ))}
                      </Box>
                    </Box>
                    <Typography variant="body2" sx={{ color: '#6B7280', mb: 1 }}>
                      {review.comment}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#6B7280' }}>
                      {review.date}
                    </Typography>
                  </Card>
                ))}
              </Box>

              <Button
                fullWidth
                variant="contained"
                startIcon={<RateReview />}
                sx={{
                  mt: 2,
                  background: '#0EA5A4',
                  color: 'white',
                  '&:hover': {
                    background: '#0d9190',
                  },
                }}
                onClick={() => navigate('/lawyer/reviews')}
              >
                Смотреть все отзывы
              </Button>
            </Card>
          </Grid>

          {/* Interactive Analytics Dashboard */}
          <Grid item xs={12}>
            <Grid container spacing={3}>
              {/* Weekly Activity Chart */}
              <Grid item xs={12} md={8}>
                <Card
                  sx={{
                    p: 3,
                    background: '#FFFFFF',
                    border: '1px solid #E6E9EE',
                    borderRadius: '12px',
                    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  }}
                >
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 3 }}>
                    Активность за неделю
                  </Typography>

                  <Box sx={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', height: 200 }}>
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => {
                      const heights = [65, 85, 70, 95, 80, 45, 30];
                      return (
                        <Box
                          key={day}
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 1,
                            flex: 1,
                          }}
                        >
                          <Box
                            sx={{
                              width: '80%',
                              height: `${heights[index]}%`,
                              background: index === 3 ? '#0EA5A4' : '#E6E9EE',
                              borderRadius: '8px 8px 0 0',
                              transition: 'all 0.3s ease',
                              cursor: 'pointer',
                              position: 'relative',
                              '&:hover': {
                                background: '#0EA5A4',
                                transform: 'scaleY(1.05)',
                              },
                            }}
                          >
                            <Typography
                              variant="caption"
                              fontWeight="bold"
                              sx={{
                                position: 'absolute',
                                top: -25,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                color: '#0B1B2B',
                              }}
                            >
                              {Math.round(heights[index] * 0.12)}
                            </Typography>
                          </Box>
                          <Typography variant="caption" fontWeight="bold" sx={{ color: '#6B7280' }}>
                            {day}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Card>
              </Grid>

              {/* Performance Metrics Cards */}
              <Grid item xs={12} md={4}>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Card
                      sx={{
                        p: 2.5,
                        background: 'linear-gradient(135deg, #0EA5A4 0%, #0d9190 100%)',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(14, 165, 164, 0.25)',
                        color: 'white',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box>
                          <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                            Скорость ответа
                          </Typography>
                          <Typography variant="h3" fontWeight="bold">
                            {stats?.responseRate || 95}%
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.8, mt: 0.5 }}>
                            +5% от прошлой недели
                          </Typography>
                        </Box>
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <TrendingUp sx={{ fontSize: 28 }} />
                        </Box>
                      </Box>
                    </Card>
                  </Grid>

                  <Grid item xs={12}>
                    <Card
                      sx={{
                        p: 2.5,
                        background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(251, 191, 36, 0.25)',
                        color: 'white',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box>
                          <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                            Рейтинг
                          </Typography>
                          <Typography variant="h3" fontWeight="bold">
                            {stats?.rating || '4.8'}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.3, mt: 0.5 }}>
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} sx={{ fontSize: 16 }} />
                            ))}
                          </Box>
                        </Box>
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Star sx={{ fontSize: 28 }} />
                        </Box>
                      </Box>
                    </Card>
                  </Grid>
                </Grid>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Container>

      {/* Debug Panel */}
      <DebugPanel />
    </Box>
  );
};

export default LawyerDashboardGlass;
