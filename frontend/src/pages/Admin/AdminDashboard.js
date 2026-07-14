import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
  Card,
  CardContent,
  Button,
  IconButton,
  Avatar,
  Chip,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Badge,
  keyframes,
} from '@mui/material';
import {
  Dashboard,
  People,
  Gavel,
  AttachMoney,
  TrendingUp,
  Description,
  Block,
  CheckCircle,
  Warning,
  Shield,
  Settings,
  Logout,
  Notifications,
  Assessment,
  PersonAdd,
  Add,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';

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

// Mock admin statistics
const ADMIN_STATS = {
  totalUsers: 15420,
  totalLawyers: 342,
  activeLawyers: 198,
  pendingLawyers: 24,
  totalRevenue: 125000000,
  monthlyRevenue: 18500000,
  activeConsultations: 156,
  completedConsultations: 8934,
  platformCommission: 15, // percentage
};

const RECENT_REGISTRATIONS = [
  {
    id: 1,
    name: 'Иванов Иван Иванович',
    email: 'ivanov@example.com',
    role: 'lawyer',
    specialization: 'Гражданское право',
    date: '2024-12-08',
    status: 'pending',
  },
  {
    id: 2,
    name: 'Петрова Анна',
    email: 'petrova@example.com',
    role: 'client',
    date: '2024-12-08',
    status: 'active',
  },
  {
    id: 3,
    name: 'Сидоров Петр',
    email: 'sidorov@example.com',
    role: 'lawyer',
    specialization: 'Корпоративное право',
    date: '2024-12-07',
    status: 'pending',
  },
];

const PLATFORM_ACTIVITY = [
  { day: 'ПН', consultations: 45, users: 320 },
  { day: 'ВТ', consultations: 52, users: 385 },
  { day: 'СР', consultations: 48, users: 350 },
  { day: 'ЧТ', consultations: 61, users: 420 },
  { day: 'ПТ', consultations: 55, users: 390 },
  { day: 'СБ', consultations: 38, users: 280 },
  { day: 'ВС', consultations: 32, users: 240 },
];

const AdminDashboard = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const [tabValue, setTabValue] = useState(0);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uz-UZ', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(amount) + ' сум';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'pending':
        return 'warning';
      case 'blocked':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active':
        return 'Активен';
      case 'pending':
        return 'На проверке';
      case 'blocked':
        return 'Заблокирован';
      default:
        return status;
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f5', pb: 4 }}>
      {/* Admin Header */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
          color: 'white',
          py: 3,
          px: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
          },
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: 'rgba(239, 68, 68, 0.1)',
                  border: '2px solid #ef4444',
                  color: '#ef4444',
                }}
              >
                <Shield sx={{ fontSize: 36 }} />
              </Avatar>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold">
                    Панель администратора
                  </Typography>
                  <Chip
                    label="ADMIN"
                    size="small"
                    sx={{
                      bgcolor: '#ef4444',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '0.7rem',
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                  {user?.name || 'Администратор'} | Полный доступ
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton color="inherit" sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)' }}>
                <Badge badgeContent={5} color="warning">
                  <Notifications />
                </Badge>
              </IconButton>
              <IconButton
                color="inherit"
                sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)' }}
                onClick={() => navigate('/admin/settings')}
              >
                <Settings />
              </IconButton>
              <Button
                variant="contained"
                startIcon={<Logout />}
                onClick={handleLogout}
                sx={{
                  bgcolor: 'white',
                  color: '#ef4444',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.9)' },
                }}
              >
                Выйти
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Key Metrics */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: 'Всего пользователей',
              value: ADMIN_STATS.totalUsers.toLocaleString(),
              color: '#6366f1',
              bgColor: '#e0e7ff',
            },
            {
              icon: <Gavel sx={{ fontSize: 40 }} />,
              label: 'Юристов на платформе',
              value: `${ADMIN_STATS.activeLawyers}/${ADMIN_STATS.totalLawyers}`,
              color: '#a67c52',
              bgColor: '#fef3c7',
            },
            {
              icon: <AttachMoney sx={{ fontSize: 40 }} />,
              label: 'Доход за месяц',
              value: formatCurrency(ADMIN_STATS.monthlyRevenue),
              color: '#10b981',
              bgColor: '#d1fae5',
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              label: 'Завершенных консультаций',
              value: ADMIN_STATS.completedConsultations.toLocaleString(),
              color: '#8b5cf6',
              bgColor: '#ede9fe',
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
                  height: '100%',
                  background: 'white',
                  border: '2px solid ' + stat.bgColor,
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                  },
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        borderRadius: 3,
                        bgcolor: stat.bgColor,
                        color: stat.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {stat.icon}
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        {stat.label}
                      </Typography>
                      <Typography variant="h5" fontWeight="bold" color={stat.color}>
                        {stat.value}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Quick Actions */}
        <Paper sx={{ p: 3, mb: 4, borderRadius: 4 }}>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            Быстрые действия
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {[
              { icon: <PersonAdd />, label: 'Добавить юриста', path: '/admin/lawyers/add' },
              { icon: <Assessment />, label: 'Аналитика', path: '/admin/analytics' },
              { icon: <Description />, label: 'Документы', path: '/admin/documents' },
              { icon: <Settings />, label: 'Настройки', path: '/admin/specializations' },
            ].map((action, index) => (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={action.icon}
                  onClick={() => {
                    if (action.path === '/admin/specializations') {
                      navigate(action.path);
                    } else {
                      toast.info(`${action.label} - раздел в разработке`);
                    }
                  }}
                  sx={{
                    py: 2,
                    justifyContent: 'flex-start',
                    borderWidth: 2,
                    '&:hover': {
                      borderWidth: 2,
                    },
                  }}
                >
                  {action.label}
                </Button>
              </Grid>
            ))}
          </Grid>
        </Paper>

        <Grid container spacing={3}>
          {/* Recent Registrations */}
          <Grid item xs={12} lg={8}>
            <Paper sx={{ p: 3, borderRadius: 4 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold">
                  Последние регистрации
                </Typography>
                <Chip
                  label={`${ADMIN_STATS.pendingLawyers} на проверке`}
                  color="warning"
                  icon={<Warning />}
                />
              </Box>

              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Имя</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Роль</TableCell>
                      <TableCell>Специализация</TableCell>
                      <TableCell>Дата</TableCell>
                      <TableCell>Статус</TableCell>
                      <TableCell>Действия</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {RECENT_REGISTRATIONS.map((registration) => (
                      <TableRow key={registration.id} hover>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ width: 32, height: 32, bgcolor: '#ef4444' }}>
                              {registration.name.charAt(0)}
                            </Avatar>
                            <Typography variant="body2" fontWeight="bold">
                              {registration.name}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{registration.email}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={registration.role === 'lawyer' ? 'Юрист' : 'Клиент'}
                            size="small"
                            color={registration.role === 'lawyer' ? 'secondary' : 'primary'}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {registration.specialization || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{registration.date}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getStatusLabel(registration.status)}
                            size="small"
                            color={getStatusColor(registration.status)}
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {registration.status === 'pending' && (
                              <>
                                <Button size="small" variant="contained" color="success">
                                  Одобрить
                                </Button>
                                <Button size="small" variant="outlined" color="error">
                                  Отклонить
                                </Button>
                              </>
                            )}
                            {registration.status === 'active' && (
                              <Button size="small" variant="outlined">
                                Просмотр
                              </Button>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>

          {/* Platform Activity */}
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 3, borderRadius: 4, height: '100%' }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Активность платформы
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                За последние 7 дней
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {PLATFORM_ACTIVITY.map((activity, index) => (
                  <Box key={index}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2" fontWeight="bold">
                        {activity.day}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {activity.consultations} консультаций
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={(activity.consultations / 70) * 100}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: '#e5e7eb',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: index === PLATFORM_ACTIVITY.length - 1 ? '#ef4444' : '#10b981',
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {activity.users} активных пользователей
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Button
                fullWidth
                variant="outlined"
                startIcon={<Assessment />}
                sx={{ mt: 3 }}
                onClick={() => navigate('/admin/analytics')}
              >
                Подробная аналитика
              </Button>
            </Paper>
          </Grid>

          {/* System Health */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3, borderRadius: 4 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Состояние системы
              </Typography>

              <Grid container spacing={3} sx={{ mt: 1 }}>
                {[
                  { label: 'API сервер', status: 'online', uptime: '99.9%' },
                  { label: 'База данных', status: 'online', uptime: '99.8%' },
                  { label: 'Видео сервер', status: 'online', uptime: '98.5%' },
                  { label: 'AI сервис', status: 'online', uptime: '99.2%' },
                ].map((system, index) => (
                  <Grid item xs={12} sm={6} md={3} key={index}>
                    <Box
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        bgcolor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: '#10b981',
                          }}
                        />
                        <Typography variant="body2" fontWeight="bold">
                          {system.label}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Uptime: {system.uptime}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default AdminDashboard;
