import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container,
  Typography,
  Box,
  Grid,
  Button,
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  IconButton,
  LinearProgress,
  Card,
  CardContent,
} from '@mui/material';
import {
  VideoCall,
  Description,
  TrendingUp,
  Person,
  Chat,
  CheckCircle,
  Schedule,
  Settings,
  ArrowForward,
} from '@mui/icons-material';
import { authActions } from '../../store/slices/authSlice';
import MIMARUBackground from '../../components/UI/MIMARUBackground';

const DashboardPageMIMARU = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const statsCards = [
    {
      title: 'Активные консультации',
      value: '3',
      change: 'В процессе',
      icon: <VideoCall sx={{ fontSize: 28 }} />,
      color: '#3d5a52',
    },
    {
      title: 'Документы',
      value: '12',
      change: 'Всего загружено',
      icon: <Description sx={{ fontSize: 28 }} />,
      color: '#3d5a52',
    },
    {
      title: 'Консультации',
      value: '8',
      change: 'Завершено',
      icon: <TrendingUp sx={{ fontSize: 28 }} />,
      color: '#3d5a52',
    },
    {
      title: 'Рейтинг',
      value: '4.8',
      change: 'Отлично',
      icon: <CheckCircle sx={{ fontSize: 28 }} />,
      color: '#3d5a52',
    },
  ];

  const quickActions = [
    {
      title: 'AI Консультант',
      subtitle: 'Мгновенные ответы',
      icon: <Chat />,
      path: '/ai-chat',
    },
    {
      title: 'Найти юриста',
      subtitle: 'Подберите специалиста',
      icon: <Person />,
      path: '/lawyers',
    },
    {
      title: 'Мои документы',
      subtitle: 'Управляйте документами',
      icon: <Description />,
      path: '/documents',
    },
    {
      title: 'Консультации',
      subtitle: 'Запланируйте встречу',
      icon: <VideoCall />,
      path: '/consultations',
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

  return (
    <Box sx={{ minHeight: '100vh', position: 'relative', pb: 6 }}>
      <MIMARUBackground />

      <Container maxWidth="xl" sx={{ position: 'relative', zIndex: 1, pt: 4 }}>
        {/* Header */}
        <Box sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box>
              <Typography
                variant="h3"
                fontWeight="bold"
                sx={{
                  color: '#1a2b4a',
                  mb: 1,
                  letterSpacing: '-0.5px',
                }}
              >
                Добро пожаловать
              </Typography>
              <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400 }}>
                Платформа юридических услуг МаслаХат
              </Typography>
            </Box>
            <IconButton
              onClick={() => navigate('/settings')}
              sx={{
                bgcolor: '#3d5a52',
                color: 'white',
                '&:hover': {
                  bgcolor: '#2a403a',
                },
              }}
            >
              <Settings />
            </IconButton>
          </Box>

          {/* Decorative line - MIMARU style */}
          <Box
            sx={{
              width: '120px',
              height: '3px',
              bgcolor: '#8b7355',
              mt: 2,
            }}
          />
        </Box>

        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 5 }}>
          {statsCards.map((card, index) => (
            <Grid item xs={12} sm={6} md={3} key={index}>
              <Card
                sx={{
                  height: '100%',
                  border: `2px solid ${card.color}15`,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    borderColor: `${card.color}40`,
                    transform: 'translateY(-4px)',
                  },
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
                    <Box
                      sx={{
                        width: 50,
                        height: 50,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: `${card.color}10`,
                        color: card.color,
                      }}
                    >
                      {card.icon}
                    </Box>
                    <Chip
                      label={card.change}
                      size="small"
                      sx={{
                        bgcolor: `${card.color}10`,
                        color: card.color,
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        borderRadius: 1,
                      }}
                    />
                  </Box>

                  <Typography variant="h3" fontWeight="bold" sx={{ mb: 1, color: '#1a2b4a' }}>
                    {card.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {card.title}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={4}>
          {/* Quick Actions */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent sx={{ p: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#1a2b4a' }}>
                    Быстрые действия
                  </Typography>
                  <Box
                    sx={{
                      width: '40px',
                      height: '3px',
                      bgcolor: '#8b7355',
                      ml: 2,
                    }}
                  />
                </Box>

                <Grid container spacing={2}>
                  {quickActions.map((action, index) => (
                    <Grid item xs={12} sm={6} key={index}>
                      <Box
                        onClick={() => navigate(action.path)}
                        sx={{
                          p: 3,
                          border: '2px solid',
                          borderColor: 'rgba(26, 43, 74, 0.08)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: '#1a2b4a',
                            bgcolor: 'rgba(26, 43, 74, 0.02)',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Box
                            sx={{
                              width: 44,
                              height: 44,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'rgba(26, 43, 74, 0.08)',
                              color: '#1a2b4a',
                            }}
                          >
                            {action.icon}
                          </Box>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="h6" fontWeight="600" sx={{ color: '#1a2b4a' }}>
                              {action.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {action.subtitle}
                            </Typography>
                          </Box>
                          <ArrowForward sx={{ color: '#1a2b4a' }} />
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Upcoming Consultations */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                  <Schedule sx={{ color: '#1a2b4a', mr: 1 }} />
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#1a2b4a' }}>
                    Предстоящие
                  </Typography>
                </Box>

                <List sx={{ p: 0 }}>
                  {upcomingConsultations.map((consultation, index) => (
                    <ListItem
                      key={index}
                      sx={{
                        p: 2,
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'rgba(26, 43, 74, 0.08)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          borderColor: '#1a2b4a',
                          bgcolor: 'rgba(26, 43, 74, 0.02)',
                        },
                        '&:last-child': {
                          mb: 0,
                        },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor: '#1a2b4a',
                            width: 44,
                            height: 44,
                          }}
                        >
                          {consultation.lawyer.charAt(0)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography variant="subtitle2" fontWeight="600">
                            {consultation.lawyer}
                          </Typography>
                        }
                        secondary={
                          <>
                            <Typography variant="caption" display="block" color="text.secondary">
                              {consultation.specialty}
                            </Typography>
                            <Typography variant="caption" display="block" sx={{ color: '#8b7355', mt: 0.5, fontWeight: 500 }}>
                              {consultation.date}
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>

                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => navigate('/consultations')}
                  sx={{
                    mt: 2,
                    bgcolor: '#1a2b4a',
                    '&:hover': {
                      bgcolor: '#0f1829',
                    },
                  }}
                >
                  Посмотреть все
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default DashboardPageMIMARU;
