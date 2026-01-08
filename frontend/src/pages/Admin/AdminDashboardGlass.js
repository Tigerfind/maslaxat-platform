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
  Dashboard,
  People,
  Gavel,
  AttachMoney,
  Description,
  Settings,
  Logout,
  Notifications,
  Assessment,
  Shield,
  TrendingUp,
  CheckCircle,
  PersonAdd,
  Category,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import adminService from '../../services/adminService';
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

const AdminDashboardGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, activityData] = await Promise.all([
        adminService.dashboard.getStats(),
        adminService.dashboard.getRecentActivity(10),
      ]);

      setStats(statsData);
      setRecentActivity(activityData);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login/admin');
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uz-UZ', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(amount) + ' сум';
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'user_registration':
        return <PersonAdd />;
      case 'consultation_completed':
        return <CheckCircle />;
      case 'lawyer_approved':
        return <Gavel />;
      case 'payment':
        return <AttachMoney />;
      default:
        return <Dashboard />;
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'user_registration':
        return '#60a5fa';
      case 'consultation_completed':
        return '#4ade80';
      case 'lawyer_approved':
        return '#f59e0b';
      case 'payment':
        return '#22c55e';
      default:
        return '#8b5cf6';
    }
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
                  background: '#DC2626',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                }}
              >
                <Shield sx={{ fontSize: 36 }} />
              </Avatar>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                    Панель администратора
                  </Typography>
                  <Chip
                    label="ADMIN"
                    size="small"
                    sx={{
                      background: '#DC2626',
                      color: '#FFFFFF',
                      fontWeight: 'bold',
                      border: 'none',
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                  {user?.name || 'Администратор'} | Полный доступ
                </Typography>
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
                <Badge badgeContent={5} color="error">
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
                  background: '#DC2626',
                  color: '#FFFFFF',
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 3,
                  boxShadow: 'none',
                  '&:hover': {
                    background: '#B91C1C',
                    boxShadow: 'none',
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
              icon: <People sx={{ fontSize: 40 }} />,
              label: 'Всего пользователей',
              value: stats?.totalUsers?.toLocaleString() || '0',
              color: '#2563EB',
            },
            {
              icon: <Gavel sx={{ fontSize: 40 }} />,
              label: 'Юристов',
              value: stats?.totalLawyers?.toLocaleString() || '0',
              color: '#F59E0B',
            },
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: 'Клиентов',
              value: stats?.totalClients?.toLocaleString() || '0',
              color: '#8B5CF6',
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              label: 'Активные консультации',
              value: stats?.activeConsultations?.toLocaleString() || '0',
              color: '#10B981',
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
                      background: stat.color,
                      color: '#FFFFFF',
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

        {/* Revenue Stats */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
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
                    background: '#22C55E',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AttachMoney sx={{ fontSize: 40 }} />
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: '#6B7280' }} gutterBottom>
                    Доход за месяц
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                    {formatCurrency(stats?.monthlyRevenue || 0)}
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
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
                    background: '#F59E0B',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp sx={{ fontSize: 40 }} />
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: '#6B7280' }} gutterBottom>
                    Общий доход
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                    {formatCurrency(stats?.totalRevenue || 0)}
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Grid>
        </Grid>

        {/* Quick Actions */}
        <Card
          sx={{
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            p: 3,
            mb: 4,
          }}
        >
          <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }} gutterBottom>
            Быстрые действия
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {[
              {
                icon: <People />,
                label: 'Управление пользователями',
                path: '/admin/users',
                color: '#2563EB',
              },
              {
                icon: <Gavel />,
                label: 'Управление юристами',
                path: '/admin/lawyers',
                color: '#F59E0B',
              },
              {
                icon: <Assessment />,
                label: 'Просмотр отчетов',
                path: '/admin/reports',
                color: '#10B981',
              },
              {
                icon: <Category />,
                label: 'Специализации',
                path: '/admin/specializations',
                color: '#8B5CF6',
              },
            ].map((action, index) => (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={action.icon}
                  onClick={() => navigate(action.path)}
                  sx={{
                    py: 2,
                    justifyContent: 'flex-start',
                    color: '#0B1B2B',
                    borderColor: '#E6E9EE',
                    textTransform: 'none',
                    fontWeight: 600,
                    '&:hover': {
                      background: action.color,
                      borderColor: action.color,
                      color: '#FFFFFF',
                      transform: 'translateY(-2px)',
                    },
                    transition: 'all 0.3s ease',
                  }}
                >
                  {action.label}
                </Button>
              </Grid>
            ))}
          </Grid>
        </Card>

        <Grid container spacing={3}>
          {/* Recent Activity */}
          <Grid item xs={12} lg={8}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                  Последняя активность
                </Typography>
                <Chip
                  label={`${recentActivity.length} записей`}
                  sx={{
                    background: '#F4F6F8',
                    color: '#0B1B2B',
                    fontWeight: 'bold',
                    border: '1px solid #E6E9EE',
                  }}
                />
              </Box>

              {recentActivity.length > 0 ? (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold' }}>
                          Тип
                        </TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold' }}>
                          Описание
                        </TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold' }}>
                          Пользователь
                        </TableCell>
                        <TableCell sx={{ color: '#6B7280', fontWeight: 'bold' }}>
                          Дата
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentActivity.map((activity, index) => (
                        <TableRow
                          key={index}
                          hover
                          sx={{
                            '&:hover': {
                              background: '#F4F6F8',
                            },
                          }}
                        >
                          <TableCell>
                            <Box
                              sx={{
                                width: 40,
                                height: 40,
                                borderRadius: '8px',
                                background: getActivityColor(activity.type),
                                color: '#FFFFFF',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {getActivityIcon(activity.type)}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                              {activity.description}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32, bgcolor: '#2563EB' }}>
                                {activity.userName?.charAt(0) || 'U'}
                              </Avatar>
                              <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                                {activity.userName || 'Неизвестно'}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#6B7280' }}>
                              {activity.date || 'Недавно'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" sx={{ color: '#6B7280' }}>
                    Нет данных о последней активности
                  </Typography>
                </Box>
              )}
            </Card>
          </Grid>

          {/* System Overview */}
          <Grid item xs={12} lg={4}>
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
                mb: 3,
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }} gutterBottom>
                Обзор системы
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      Всего пользователей
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {stats?.totalUsers?.toLocaleString() || '0'}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      background: '#F4F6F8',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: '85%',
                        background: '#2563EB',
                      }}
                    />
                  </Box>
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      Активные юристы
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {stats?.totalLawyers?.toLocaleString() || '0'}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      background: '#F4F6F8',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: '72%',
                        background: '#F59E0B',
                      }}
                    />
                  </Box>
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: '#6B7280' }}>
                      Консультации
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                      {stats?.activeConsultations?.toLocaleString() || '0'}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      background: '#F4F6F8',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: '65%',
                        background: '#10B981',
                      }}
                    />
                  </Box>
                </Box>
              </Box>

              <Button
                fullWidth
                variant="contained"
                startIcon={<Assessment />}
                sx={{
                  mt: 3,
                  background: '#2563EB',
                  color: '#FFFFFF',
                  textTransform: 'none',
                  fontWeight: 600,
                  py: 1.5,
                  boxShadow: 'none',
                  '&:hover': {
                    background: '#1D4ED8',
                    boxShadow: 'none',
                  },
                }}
                onClick={() => navigate('/admin/analytics')}
              >
                Подробная аналитика
              </Button>
            </Card>

            {/* System Health */}
            <Card
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }} gutterBottom>
                Состояние системы
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                {[
                  { label: 'API сервер', status: 'online', uptime: '99.9%' },
                  { label: 'База данных', status: 'online', uptime: '99.8%' },
                  { label: 'Видео сервер', status: 'online', uptime: '98.5%' },
                  { label: 'AI сервис', status: 'online', uptime: '99.2%' },
                ].map((system, index) => (
                  <Box
                    key={index}
                    sx={{
                      p: 2,
                      borderRadius: '8px',
                      background: '#F4F6F8',
                      border: '1px solid #E6E9EE',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: '#10B981',
                        }}
                      />
                      <Typography variant="body2" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                        {system.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: '#6B7280' }}>
                      Uptime: {system.uptime}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default AdminDashboardGlass;
