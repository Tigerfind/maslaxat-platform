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
  Gavel,
  Description,
  CheckCircle,
  Star,
  Message,
  VideoCall,
  Logout,
  Settings,
  Notifications,
  ChatBubble,
  Search,
  UploadFile,
  CalendarToday,
  TrendingUp,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import clientService from '../../services/clientService';
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

const DashboardPageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  const [stats, setStats] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, consultationsData] = await Promise.all([
        clientService.dashboard.getStats(),
        clientService.dashboard.getUpcomingConsultations(),
      ]);

      setStats(statsData);
      setConsultations(consultationsData);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login/client');
  };

  const handleJoinConsultation = async (consultation) => {
    try {
      if (consultation.type === 'video') {
        await clientService.consultations.joinConsultation(consultation.id);
        navigate(`/consultations/video/${consultation.id}`);
      } else {
        navigate('/ai-chat');
      }
    } catch (error) {
      toast.error(t('common.error'));
    }
  };

  const quickActions = [
    {
      icon: <ChatBubble sx={{ fontSize: 40 }} />,
      labelKey: 'askAI',
      descKey: 'AI консультант',
      color: '#2563EB',
      onClick: () => navigate('/ai-chat'),
    },
    {
      icon: <Search sx={{ fontSize: 40 }} />,
      labelKey: 'findLawyer',
      descKey: 'Поиск специалиста',
      color: '#2563EB',
      onClick: () => navigate('/lawyers'),
    },
    {
      icon: <UploadFile sx={{ fontSize: 40 }} />,
      labelKey: 'uploadDocument',
      descKey: 'Управление файлами',
      color: '#2563EB',
      onClick: () => navigate('/documents'),
    },
    {
      icon: <CalendarToday sx={{ fontSize: 40 }} />,
      labelKey: 'viewAll',
      descKey: 'Ваши записи',
      color: '#2563EB',
      onClick: () => navigate('/consultations'),
    },
  ];

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
        <CircularProgress sx={{ color: '#2563EB' }} size={60} />
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
      {/* Header */}
      <Box
        sx={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  background: '#2563EB',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  color: '#FFFFFF',
                }}
              >
                {user?.name?.charAt(0) || 'К'}
              </Avatar>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                    {user?.name || t('login.client')}
                  </Typography>
                  <Chip
                    label="CLIENT"
                    size="small"
                    sx={{
                      background: '#FFFFFF',
                      color: '#2563EB',
                      fontWeight: 'bold',
                      border: '1px solid #E6E9EE',
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                  {t('dashboard.welcome')} {t('common.appName')}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {/* Language Switcher */}
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
                variant="contained"
                startIcon={<Logout />}
                onClick={handleLogout}
                sx={{
                  background: '#2563EB',
                  color: '#FFFFFF',
                  textTransform: 'none',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  '&:hover': {
                    background: '#1e40af',
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
              icon: <Gavel sx={{ fontSize: 40 }} />,
              labelKey: 'activeConsultations',
              value: stats?.activeConsultations || 0,
              color: '#2563EB',
            },
            {
              icon: <Description sx={{ fontSize: 40 }} />,
              labelKey: 'documents',
              value: stats?.documents || 0,
              color: '#2563EB',
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              labelKey: 'completedConsultations',
              value: stats?.completedConsultations || 0,
              color: '#2563EB',
            },
            {
              icon: <Star sx={{ fontSize: 40 }} />,
              labelKey: 'rating',
              value: stats?.rating || '4.8',
              color: '#2563EB',
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
                  background: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  borderRadius: '12px',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  p: 3,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
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
                      background: stat.color,
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: '#6B7280' }} gutterBottom>
                      {stat.labelKey === 'documents' ? t('nav.documents') :
                       stat.labelKey === 'rating' ? t('lawyers.rating') :
                       t(`dashboard.${stat.labelKey}`)}
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

        <Grid container spacing={3}>
          {/* Quick Actions */}
          <Grid item xs={12} lg={4}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
                height: '100%',
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }} gutterBottom>
                {t('dashboard.quickActions')}
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                {quickActions.map((action, index) => (
                  <Card
                    key={index}
                    onClick={action.onClick}
                    sx={{
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '8px',
                      p: 2,
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      animation: `${fadeInUp} 0.6s ease-out`,
                      animationDelay: `${(index + 4) * 0.1}s`,
                      animationFillMode: 'both',
                      '&:hover': {
                        background: '#FFFFFF',
                        boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                        transform: 'translateX(4px)',
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: '8px',
                          background: action.color,
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                        }}
                      >
                        {action.icon}
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                          {t(`dashboard.${action.labelKey}`)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#6B7280' }}>
                          {action.descKey}
                        </Typography>
                      </Box>
                    </Box>
                  </Card>
                ))}
              </Box>
            </Card>
          </Grid>

          {/* Upcoming Consultations */}
          <Grid item xs={12} lg={8}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
                animation: `${fadeInUp} 0.6s ease-out`,
                animationDelay: '0.8s',
                animationFillMode: 'both',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {t('consultations.upcoming')}
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<CalendarToday />}
                  onClick={() => navigate('/consultations')}
                  sx={{
                    background: '#2563EB',
                    color: '#FFFFFF',
                    textTransform: 'none',
                    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                    '&:hover': {
                      background: '#1e40af',
                    },
                  }}
                >
                  {t('dashboard.viewAll')}
                </Button>
              </Box>

              {consultations.length === 0 ? (
                <Box
                  sx={{
                    textAlign: 'center',
                    py: 6,
                    px: 2,
                  }}
                >
                  <Typography variant="h6" sx={{ color: '#0B1B2B', mb: 2 }}>
                    {t('consultations.noConsultations')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#6B7280', mb: 3 }}>
                    {t('consultations.bookFirst')}
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<Search />}
                    onClick={() => navigate('/lawyers')}
                    sx={{
                      background: '#2563EB',
                      color: '#FFFFFF',
                      textTransform: 'none',
                      boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                      '&:hover': {
                        background: '#1e40af',
                      },
                    }}
                  >
                    {t('dashboard.findLawyer')}
                  </Button>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>{t('consultations.lawyer')}</TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>{t('consultations.topic')}</TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>{t('consultations.date')} / {t('consultations.time')}</TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}>{t('consultations.consultationType')}</TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold', borderBottom: '1px solid #E6E9EE' }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {consultations.map((consultation) => (
                        <TableRow
                          key={consultation.id}
                          sx={{
                            '&:hover': {
                              background: '#F4F6F8',
                            },
                          }}
                        >
                          <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32, bgcolor: '#2563EB' }}>
                                {consultation.lawyerName?.charAt(0)}
                              </Avatar>
                              <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                                {consultation.lawyerName}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                            <Typography variant="body2" sx={{ color: '#6B7280' }}>
                              {consultation.topic || t('consultations.title')}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                            <Typography variant="body2" sx={{ color: '#6B7280' }}>
                              {consultation.date} - {consultation.time}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                            <Chip
                              icon={consultation.type === 'video' ? <VideoCall /> : <Message />}
                              label={consultation.type === 'video' ? t('consultations.videoCall') : t('consultations.chatConsultation')}
                              size="small"
                              sx={{
                                background: '#2563EB',
                                color: '#FFFFFF',
                              }}
                            />
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #E6E9EE' }}>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => handleJoinConsultation(consultation)}
                              sx={{
                                background: '#2563EB',
                                color: '#FFFFFF',
                                textTransform: 'none',
                                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                                '&:hover': {
                                  background: '#1e40af',
                                },
                              }}
                            >
                              {t('consultations.joinCall')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Card>
          </Grid>

          {/* Activity Summary */}
          <Grid item xs={12}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
                animation: `${fadeInUp} 0.6s ease-out`,
                animationDelay: '0.9s',
                animationFillMode: 'both',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  {t('dashboard.recentActivity')}
                </Typography>
                <TrendingUp sx={{ color: '#2563EB', fontSize: 28 }} />
              </Box>

              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <Card
                    sx={{
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '8px',
                      textAlign: 'center',
                      py: 3,
                      px: 2,
                    }}
                  >
                    <Typography variant="h3" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                      {stats?.activeConsultations || 0}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      {t('dashboard.activeConsultations')}
                    </Typography>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card
                    sx={{
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '8px',
                      textAlign: 'center',
                      py: 3,
                      px: 2,
                    }}
                  >
                    <Typography variant="h3" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                      {stats?.completedConsultations || 0}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      {t('dashboard.completedConsultations')}
                    </Typography>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card
                    sx={{
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                      borderRadius: '8px',
                      textAlign: 'center',
                      py: 3,
                      px: 2,
                    }}
                  >
                    <Typography variant="h3" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                      {stats?.documents || 0}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      {t('nav.documents')}
                    </Typography>
                  </Card>
                </Grid>
              </Grid>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default DashboardPageGlass;
