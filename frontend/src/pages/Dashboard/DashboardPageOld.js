import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container,
  Typography,
  Box,
  Grid,
  Paper,
  Card,
  CardContent,
  CardActions,
  Button,
  Avatar,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  IconButton,
} from '@mui/material';
import {
  VideoCall,
  Description,
  AccountBalance,
  Notifications,
  Person,
  Event,
  TrendingUp,
  Chat,
  ExitToApp,
  Menu as MenuIcon,
} from '@mui/icons-material';
import { authActions } from '../../store/slices/authSlice';

const DashboardPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const handleLogout = () => {
    dispatch(authActions.logout());
    navigate('/login');
  };

  const statsCards = [
    {
      title: 'Активные консультации',
      value: '3',
      icon: <VideoCall sx={{ fontSize: 40 }} />,
      color: '#1a365d',
      bgColor: 'rgba(26, 54, 93, 0.1)',
    },
    {
      title: 'Документы',
      value: '12',
      icon: <Description sx={{ fontSize: 40 }} />,
      color: '#d4af37',
      bgColor: 'rgba(212, 175, 55, 0.1)',
    },
    {
      title: 'Юристы',
      value: '45',
      icon: <AccountBalance sx={{ fontSize: 40 }} />,
      color: '#2d4a7c',
      bgColor: 'rgba(45, 74, 124, 0.1)',
    },
    {
      title: 'Уведомления',
      value: '5',
      icon: <Notifications sx={{ fontSize: 40 }} />,
      color: '#aa8a2e',
      bgColor: 'rgba(170, 138, 46, 0.1)',
    },
  ];

  const upcomingConsultations = [
    {
      lawyer: 'Иванов Иван Иванович',
      specialty: 'Гражданское право',
      date: 'Сегодня, 15:00',
      status: 'scheduled',
    },
    {
      lawyer: 'Петрова Мария Сергеевна',
      specialty: 'Корпоративное право',
      date: 'Завтра, 10:30',
      status: 'scheduled',
    },
    {
      lawyer: 'Сидоров Петр Александрович',
      specialty: 'Семейное право',
      date: '15 Дек, 14:00',
      status: 'pending',
    },
  ];

  const quickActions = [
    {
      title: 'AI Консультант',
      description: 'Получите мгновенную юридическую помощь',
      icon: <Chat />,
      color: 'secondary',
      action: () => navigate('/ai-chat'),
    },
    {
      title: 'Новая консультация',
      description: 'Запланировать встречу с юристом',
      icon: <VideoCall />,
      color: 'primary',
      action: () => navigate('/consultations'),
    },
    {
      title: 'Мои документы',
      description: 'Просмотр и управление документами',
      icon: <Description />,
      color: 'secondary',
      action: () => navigate('/documents'),
    },
    {
      title: 'Найти юриста',
      description: 'Поиск специалиста по вашему вопросу',
      icon: <Person />,
      color: 'primary',
      action: () => navigate('/lawyers'),
    },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box
        sx={{
          bgcolor: 'primary.main',
          color: 'white',
          py: 3,
          px: 2,
          boxShadow: 3,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ fontSize: 32 }}>⚖️</Typography>
              <Box>
                <Typography variant="h5" fontWeight="bold">
                  MaslaXat
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  Онлайн юридическая платформа
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <IconButton color="inherit">
                <Notifications />
              </IconButton>
              <Avatar sx={{ bgcolor: 'secondary.main' }}>
                <Person />
              </Avatar>
              <IconButton color="inherit" onClick={handleLogout} title="Выйти">
                <ExitToApp />
              </IconButton>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        {/* Welcome Section */}
        <Paper sx={{ p: 3, mb: 3, background: 'linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%)', color: 'white' }}>
          <Typography variant="h4" gutterBottom fontWeight="bold">
            Добро пожаловать! 👋
          </Typography>
          <Typography variant="body1">
            У вас 3 предстоящие консультации и 5 новых уведомлений
          </Typography>
        </Paper>

        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {statsCards.map((stat, index) => (
            <Grid item xs={12} sm={6} md={3} key={index}>
              <Paper
                sx={{
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  bgcolor: stat.bgColor,
                  border: `2px solid ${stat.color}20`,
                  transition: 'transform 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                }}
              >
                <Box sx={{ color: stat.color, mb: 2 }}>
                  {stat.icon}
                </Box>
                <Typography variant="h4" fontWeight="bold" color={stat.color}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {stat.title}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={3}>
          {/* Quick Actions */}
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom fontWeight="bold" color="primary.main">
                Быстрые действия
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2}>
                {quickActions.map((action, index) => (
                  <Grid item xs={12} sm={6} md={3} key={index}>
                    <Card
                      sx={{
                        height: '100%',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                          transform: 'scale(1.05)',
                          boxShadow: 6,
                        },
                      }}
                      onClick={action.action}
                    >
                      <CardContent>
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            color: `${action.color}.main`,
                            mb: 2,
                          }}
                        >
                          {React.cloneElement(action.icon, { sx: { fontSize: 48 } })}
                        </Box>
                        <Typography variant="h6" gutterBottom textAlign="center">
                          {action.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" textAlign="center">
                          {action.description}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Paper>

            {/* Upcoming Consultations */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom fontWeight="bold" color="primary.main">
                Предстоящие консультации
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <List>
                {upcomingConsultations.map((consultation, index) => (
                  <React.Fragment key={index}>
                    <ListItem
                      sx={{
                        bgcolor: 'background.default',
                        borderRadius: 2,
                        mb: 1,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: 'primary.main' }}>
                          <Person />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography variant="subtitle1" fontWeight="bold">
                            {consultation.lawyer}
                          </Typography>
                        }
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              {consultation.specialty}
                            </Typography>
                            <Typography variant="body2" color="primary" sx={{ mt: 0.5 }}>
                              📅 {consultation.date}
                            </Typography>
                          </Box>
                        }
                      />
                      <Chip
                        label={consultation.status === 'scheduled' ? 'Подтверждено' : 'Ожидание'}
                        color={consultation.status === 'scheduled' ? 'success' : 'warning'}
                        size="small"
                      />
                    </ListItem>
                  </React.Fragment>
                ))}
              </List>
              <Button
                fullWidth
                variant="outlined"
                sx={{ mt: 2 }}
                onClick={() => navigate('/consultations')}
              >
                Посмотреть все консультации
              </Button>
            </Paper>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} md={4}>
            {/* Recent Activity */}
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom fontWeight="bold" color="primary.main">
                Последняя активность
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <List dense>
                <ListItem>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                      <Description sx={{ fontSize: 18 }} />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary="Новый документ"
                    secondary="2 часа назад"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
                      <Chat sx={{ fontSize: 18 }} />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary="Новое сообщение"
                    secondary="5 часов назад"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'success.main', width: 32, height: 32 }}>
                      <Event sx={{ fontSize: 18 }} />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary="Консультация завершена"
                    secondary="1 день назад"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              </List>
            </Paper>

            {/* Help Center */}
            <Paper sx={{ p: 3, bgcolor: 'secondary.light', color: 'white' }}>
              <Typography variant="h6" gutterBottom fontWeight="bold">
                Нужна помощь?
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Наша команда поддержки готова помочь вам 24/7
              </Typography>
              <Button
                variant="contained"
                fullWidth
                sx={{
                  bgcolor: 'white',
                  color: 'secondary.main',
                  '&:hover': { bgcolor: 'grey.100' },
                }}
                onClick={() => navigate('/help')}
              >
                Центр помощи
              </Button>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default DashboardPage;
