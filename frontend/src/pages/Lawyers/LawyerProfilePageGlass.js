import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  Avatar,
  Button,
  Chip,
  Rating,
  Divider,
  Tab,
  Tabs,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBack,
  Star,
  Verified,
  Schedule,
  TrendingUp,
  Chat,
  VideoCall,
  Gavel,
  WorkspacePremium,
  School,
  Phone,
  Email,
  LocationOn,
  Language,
  Send,
} from '@mui/icons-material';

import clientService from '../../services/clientService';

// Mock lawyer data - fallback for demo
const MOCK_LAWYERS = {
  1: {
    id: 1,
    name: 'Иванов Иван Иванович',
    avatar: null,
    rating: 4.8,
    specializations: ['Гражданское право', 'Семейное право'],
    experience: 15,
    region: 'Ташкент',
    priceFrom: 50000,
    completedConsultations: 234,
    responseTime: 2,
    successRate: 96,
    verified: true,
    bio: 'Опытный юрист с 15-летним стажем работы в области гражданского и семейного права. Помог более 200 клиентам решить их юридические вопросы. Специализируюсь на семейных спорах, наследственных делах и договорном праве.',
    education: [
      'Ташкентский государственный юридический университет (2008)',
      'Магистратура по гражданскому праву (2010)',
    ],
    languages: ['Русский', 'Узбекский', 'Английский'],
    certifications: [
      'Сертифицированный медиатор',
      'Член Адвокатской палаты Узбекистана',
    ],
    phone: '+998 90 123-45-67',
    email: 'ivanov@maslaxat.uz',
    workingHours: 'Пн-Пт: 9:00-18:00, Сб: 10:00-15:00',
  },
  2: {
    id: 2,
    name: 'Петрова Мария Сергеевна',
    avatar: null,
    rating: 4.9,
    specializations: ['Корпоративное право', 'Налоговое право'],
    experience: 12,
    region: 'Ташкент',
    priceFrom: 75000,
    completedConsultations: 189,
    responseTime: 1,
    successRate: 98,
    verified: true,
    bio: 'Специалист в области корпоративного и налогового права. Работаю с крупными компаниями и стартапами. Помогаю оптимизировать налоговую нагрузку и структурировать бизнес.',
    education: [
      'МГУ им. Ломоносова, юридический факультет (2011)',
      'MBA в области корпоративного управления (2015)',
    ],
    languages: ['Русский', 'Английский', 'Немецкий'],
    certifications: [
      'Налоговый консультант',
      'Сертифицированный аудитор',
    ],
    phone: '+998 91 234-56-78',
    email: 'petrova@maslaxat.uz',
    workingHours: 'Пн-Пт: 10:00-19:00',
  },
};

// Mock reviews
const MOCK_REVIEWS = [
  {
    id: 1,
    clientName: 'Алексей К.',
    rating: 5,
    date: '15 ноября 2024',
    comment: 'Отличный специалист! Помог решить сложный семейный спор. Всё объяснил понятно и доступно. Рекомендую!',
  },
  {
    id: 2,
    clientName: 'Марина С.',
    rating: 5,
    date: '8 ноября 2024',
    comment: 'Профессионал своего дела. Быстро разобрался в ситуации и предложил оптимальное решение. Спасибо!',
  },
  {
    id: 3,
    clientName: 'Дмитрий П.',
    rating: 4,
    date: '2 ноября 2024',
    comment: 'Хороший юрист, но немного долго отвечал на вопросы. В остальном всё отлично.',
  },
];

const LawyerProfilePageGlass = () => {
  const { lawyerId } = useParams();
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState(0);
  const [lawyer, setLawyer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState(MOCK_REVIEWS);
  const [openReviewModal, setOpenReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Fetch lawyer details
  useEffect(() => {
    const fetchLawyerDetails = async () => {
      try {
        setLoading(true);
        // Try to fetch from API
        const data = await clientService.lawyers.getLawyerDetails(lawyerId);
        setLawyer(data);
      } catch (error) {
        // Fallback to mock data
        console.log('Using mock lawyer data');
        setLawyer(MOCK_LAWYERS[lawyerId] || MOCK_LAWYERS[1]);
      } finally {
        setLoading(false);
      }
    };

    fetchLawyerDetails();
  }, [lawyerId]);

  const handleBookConsultation = () => {
    navigate('/consultations', { state: { lawyer } });
  };

  const handleStartChat = () => {
    navigate('/ai-chat', { state: { lawyerId: lawyer?.id } });
  };

  const handleVideoCall = () => {
    navigate(`/consultations/video/${lawyer?.id}`);
  };

  const handleOpenReviewModal = () => {
    setOpenReviewModal(true);
  };

  const handleCloseReviewModal = () => {
    setOpenReviewModal(false);
    setReviewRating(5);
    setReviewComment('');
  };

  const handleSubmitReview = async () => {
    if (!reviewComment.trim()) {
      alert('Пожалуйста, добавьте комментарий');
      return;
    }

    try {
      setSubmittingReview(true);
      // Try to submit review via API
      await clientService.lawyers.leaveReview(lawyer.id, {
        rating: reviewRating,
        comment: reviewComment,
      });

      // Add review to local state
      const newReview = {
        id: reviews.length + 1,
        clientName: 'Вы',
        rating: reviewRating,
        date: new Date().toLocaleDateString('ru-RU'),
        comment: reviewComment,
      };
      setReviews([newReview, ...reviews]);

      handleCloseReviewModal();
      alert('Спасибо! Ваш отзыв успешно опубликован.');
    } catch (error) {
      console.error('Error submitting review:', error);
      alert('Ошибка при публикации отзыва. Пожалуйста, попробуйте позже.');
    } finally {
      setSubmittingReview(false);
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
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress
            sx={{
              color: '#2563EB',
              mb: 2,
            }}
            size={60}
          />
          <Typography
            variant="h6"
            sx={{
              color: '#0B1B2B',
              fontWeight: 600,
            }}
          >
            Загрузка профиля юриста...
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!lawyer) {
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
        <Typography variant="h6" sx={{ color: '#0B1B2B' }}>
          Юрист не найден
        </Typography>
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
          py: 2,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/lawyers')}
              sx={{
                bgcolor: '#FFFFFF',
                color: '#0B1B2B',
                border: '1px solid #E6E9EE',
                '&:hover': {
                  bgcolor: '#F4F6F8',
                },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Typography
              variant="h5"
              fontWeight="bold"
              sx={{
                color: '#0B1B2B',
              }}
            >
              Профиль юриста
            </Typography>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          {/* Left Column - Lawyer Info */}
          <Grid item xs={12} md={4}>
            <Card
              sx={{
                mb: 3,
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              }}
            >
              <CardContent>
                {/* Avatar and Name */}
                <Box sx={{ textAlign: 'center', mb: 3 }}>
                  <Avatar
                    sx={{
                      width: 120,
                      height: 120,
                      margin: '0 auto',
                      background: '#2563EB',
                      fontSize: '3rem',
                      fontWeight: 'bold',
                      color: '#FFFFFF',
                      mb: 2,
                    }}
                  >
                    {lawyer.name.charAt(0)}
                  </Avatar>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      mb: 1,
                    }}
                  >
                    <Typography
                      variant="h5"
                      fontWeight="bold"
                      sx={{ color: '#0B1B2B' }}
                    >
                      {lawyer.name}
                    </Typography>
                    {lawyer.verified && (
                      <Verified sx={{ color: '#10b981', fontSize: 24 }} />
                    )}
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      mb: 2,
                    }}
                  >
                    <Star sx={{ color: '#2563EB', fontSize: 20 }} />
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      sx={{ color: '#0B1B2B' }}
                    >
                      {lawyer.rating}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: '#6B7280' }}
                    >
                      ({lawyer.completedConsultations} консультаций)
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Rating
                      value={lawyer.rating}
                      precision={0.1}
                      readOnly
                      sx={{
                        '& .MuiRating-iconFilled': {
                          color: '#2563EB',
                        },
                      }}
                    />
                  </Box>
                </Box>

                <Divider
                  sx={{
                    my: 2,
                    borderColor: '#E6E9EE',
                  }}
                />

              {/* Quick Stats */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Schedule sx={{ color: '#2563EB' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    Ответ через <strong>{lawyer.responseTime} часа</strong>
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <TrendingUp sx={{ color: '#2563EB' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    <strong>{lawyer.successRate}%</strong> успешных дел
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <WorkspacePremium sx={{ color: '#2563EB' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    <strong>{lawyer.experience} лет</strong> опыта
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocationOn sx={{ color: '#2563EB' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    {lawyer.region}
                  </Typography>
                </Box>
              </Box>

              <Divider
                sx={{
                  my: 2,
                  borderColor: '#E6E9EE',
                }}
              />

              {/* Contact Info */}
              <Typography
                variant="subtitle2"
                fontWeight="bold"
                gutterBottom
                sx={{ color: '#0B1B2B' }}
              >
                Контактная информация
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Phone sx={{ fontSize: 18, color: '#6B7280' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    {lawyer.phone}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Email sx={{ fontSize: 18, color: '#6B7280' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    {lawyer.email}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Schedule sx={{ fontSize: 18, color: '#6B7280' }} />
                  <Typography
                    variant="body2"
                    sx={{ color: '#0B1B2B' }}
                  >
                    {lawyer.workingHours}
                  </Typography>
                </Box>
              </Box>

              <Divider
                sx={{
                  my: 2,
                  borderColor: '#E6E9EE',
                }}
              />

              {/* Price */}
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Typography
                  variant="body2"
                  sx={{ color: '#6B7280', mb: 0.5 }}
                >
                  Консультация от
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight="bold"
                  sx={{ color: '#0B1B2B' }}
                >
                  {lawyer.priceFrom.toLocaleString()} сум
                </Typography>
              </Box>

              {/* Action Buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleBookConsultation}
                  startIcon={<VideoCall />}
                  size="large"
                  sx={{
                    background: '#2563EB',
                    color: '#FFFFFF',
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      background: '#1d4ed8',
                    },
                  }}
                >
                  Записаться на консультацию
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleStartChat}
                  startIcon={<Chat />}
                  size="large"
                  sx={{
                    borderColor: '#E6E9EE',
                    color: '#0B1B2B',
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      borderColor: '#2563EB',
                      background: '#F4F6F8',
                    },
                  }}
                >
                  Начать чат
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleVideoCall}
                  startIcon={<VideoCall />}
                  size="large"
                  sx={{
                    borderColor: '#E6E9EE',
                    color: '#0B1B2B',
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      borderColor: '#2563EB',
                      background: '#F4F6F8',
                    },
                  }}
                >
                  Видеозвонок
                </Button>
              </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Right Column - Details */}
          <Grid item xs={12} md={8}>
            <Card
              sx={{
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              }}
            >
              {/* Tabs */}
              <Tabs
                value={currentTab}
                onChange={(e, val) => setCurrentTab(val)}
                sx={{
                  borderBottom: '1px solid #E6E9EE',
                  '& .MuiTab-root': {
                    color: '#6B7280',
                    fontWeight: 600,
                    textTransform: 'none',
                    '&.Mui-selected': {
                      color: '#0B1B2B',
                    },
                  },
                  '& .MuiTabs-indicator': {
                    background: '#2563EB',
                    height: 3,
                  },
                }}
              >
                <Tab label="О юристе" />
                <Tab label="Отзывы" />
                <Tab label="Портфолио" />
              </Tabs>

              <Box sx={{ p: 3 }}>
                {/* Tab 0: About */}
                {currentTab === 0 && (
                  <Box>
                    {/* Bio */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ color: '#0B1B2B' }}
                    >
                      О себе
                    </Typography>
                    <Typography
                      variant="body1"
                      paragraph
                      sx={{ color: '#6B7280' }}
                    >
                      {lawyer.bio}
                    </Typography>

                    {/* Specializations */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ mt: 3, color: '#0B1B2B' }}
                    >
                      Специализации
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        mb: 3,
                      }}
                    >
                      {lawyer.specializations.map((spec, index) => (
                        <Chip
                          key={index}
                          label={spec}
                          icon={<Gavel />}
                          sx={{
                            background: '#F4F6F8',
                            color: '#0B1B2B',
                            fontWeight: 600,
                            border: '1px solid #E6E9EE',
                            '& .MuiChip-icon': {
                              color: '#2563EB',
                            },
                          }}
                        />
                      ))}
                    </Box>

                    {/* Education */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ mt: 3, color: '#0B1B2B' }}
                    >
                      Образование
                    </Typography>
                    <List>
                      {lawyer.education.map((edu, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar
                              sx={{
                                background: '#2563EB',
                              }}
                            >
                              <School />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                sx={{
                                  color: '#0B1B2B',
                                  fontWeight: 600,
                                }}
                              >
                                {edu}
                              </Typography>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>

                    {/* Languages */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ mt: 3, color: '#0B1B2B' }}
                    >
                      Языки
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        mb: 3,
                      }}
                    >
                      {lawyer.languages.map((lang, index) => (
                        <Chip
                          key={index}
                          label={lang}
                          icon={<Language />}
                          sx={{
                            background: '#F4F6F8',
                            color: '#0B1B2B',
                            fontWeight: 600,
                            border: '1px solid #E6E9EE',
                            '& .MuiChip-icon': {
                              color: '#2563EB',
                            },
                          }}
                        />
                      ))}
                    </Box>

                    {/* Certifications */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ mt: 3, color: '#0B1B2B' }}
                    >
                      Сертификаты и достижения
                    </Typography>
                    <List>
                      {lawyer.certifications.map((cert, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar
                              sx={{
                                background: '#2563EB',
                              }}
                            >
                              <WorkspacePremium />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                sx={{
                                  color: '#0B1B2B',
                                  fontWeight: 600,
                                }}
                              >
                                {cert}
                              </Typography>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                {/* Tab 1: Reviews */}
                {currentTab === 1 && (
                  <Box>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 3,
                      }}
                    >
                      <Typography
                        variant="h6"
                        fontWeight="bold"
                        sx={{ color: '#0B1B2B' }}
                      >
                        Отзывы клиентов
                      </Typography>
                      <Button
                        variant="contained"
                        onClick={handleOpenReviewModal}
                        startIcon={<Send />}
                        size="small"
                        sx={{
                          background: '#2563EB',
                          color: '#FFFFFF',
                          textTransform: 'none',
                          fontWeight: 600,
                          borderRadius: '8px',
                          '&:hover': {
                            background: '#1d4ed8',
                          },
                        }}
                      >
                        Оставить отзыв
                      </Button>
                    </Box>

                    {/* Rating Summary */}
                    <Box
                      sx={{
                        mb: 3,
                        p: 2,
                        background: '#F4F6F8',
                        border: '1px solid #E6E9EE',
                        borderRadius: '8px',
                      }}
                    >
                      <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} md={4} sx={{ textAlign: 'center' }}>
                          <Typography
                            variant="h2"
                            fontWeight="bold"
                            sx={{ color: '#0B1B2B' }}
                          >
                            {lawyer.rating}
                          </Typography>
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'center',
                              my: 1,
                            }}
                          >
                            <Rating
                              value={lawyer.rating}
                              precision={0.1}
                              readOnly
                              size="large"
                              sx={{
                                '& .MuiRating-iconFilled': {
                                  color: '#2563EB',
                                },
                              }}
                            />
                          </Box>
                          <Typography
                            variant="body2"
                            sx={{ color: '#6B7280' }}
                          >
                            На основе {lawyer.completedConsultations} отзывов
                          </Typography>
                        </Grid>
                        <Grid item xs={12} md={8}>
                          {[5, 4, 3, 2, 1].map((star) => (
                            <Box
                              key={star}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 1,
                              }}
                            >
                              <Typography
                                variant="body2"
                                sx={{
                                  width: 60,
                                  color: '#0B1B2B',
                                }}
                              >
                                {star} звезд
                              </Typography>
                              <LinearProgress
                                variant="determinate"
                                value={
                                  star === 5
                                    ? 80
                                    : star === 4
                                    ? 15
                                    : 5
                                }
                                sx={{
                                  flexGrow: 1,
                                  height: 8,
                                  borderRadius: 4,
                                  background: '#E6E9EE',
                                  '& .MuiLinearProgress-bar': {
                                    background: '#2563EB',
                                  },
                                }}
                              />
                              <Typography
                                variant="body2"
                                sx={{
                                  width: 40,
                                  color: '#6B7280',
                                }}
                              >
                                {star === 5
                                  ? '80%'
                                  : star === 4
                                  ? '15%'
                                  : '5%'}
                              </Typography>
                            </Box>
                          ))}
                        </Grid>
                      </Grid>
                    </Box>

                    {/* Review List */}
                    {reviews.map((review) => (
                      <Box
                        key={review.id}
                        sx={{
                          mb: 2,
                          p: 2,
                          background: '#FFFFFF',
                          border: '1px solid #E6E9EE',
                          borderRadius: '8px',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            mb: 1,
                          }}
                        >
                          <Avatar
                            sx={{
                              background: '#2563EB',
                            }}
                          >
                            {review.clientName.charAt(0)}
                          </Avatar>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography
                              variant="subtitle1"
                              fontWeight="bold"
                              sx={{ color: '#0B1B2B' }}
                            >
                              {review.clientName}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                color: '#6B7280',
                              }}
                            >
                              {review.date}
                            </Typography>
                          </Box>
                          <Rating
                            value={review.rating}
                            readOnly
                            size="small"
                            sx={{
                              '& .MuiRating-iconFilled': {
                                color: '#2563EB',
                              },
                            }}
                          />
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#6B7280',
                          }}
                        >
                          {review.comment}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Tab 2: Portfolio */}
                {currentTab === 2 && (
                  <Box>
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ color: '#0B1B2B' }}
                    >
                      Портфолио и достижения
                    </Typography>

                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Box
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            background: '#F4F6F8',
                            border: '1px solid #E6E9EE',
                            borderRadius: '8px',
                          }}
                        >
                          <Box
                            sx={{
                              fontSize: 48,
                              mb: 1,
                              color: '#2563EB',
                            }}
                          >
                            ✓
                          </Box>
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: '#0B1B2B' }}
                          >
                            {lawyer.completedConsultations}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: '#6B7280',
                            }}
                          >
                            Завершенных консультаций
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Box
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            background: '#F4F6F8',
                            border: '1px solid #E6E9EE',
                            borderRadius: '8px',
                          }}
                        >
                          <Box
                            sx={{
                              fontSize: 48,
                              mb: 1,
                            }}
                          >
                            👍
                          </Box>
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: '#0B1B2B' }}
                          >
                            {lawyer.successRate}%
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: '#6B7280',
                            }}
                          >
                            Успешных дел
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Box
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            background: '#F4F6F8',
                            border: '1px solid #E6E9EE',
                            borderRadius: '8px',
                          }}
                        >
                          <Star
                            sx={{
                              fontSize: 48,
                              color: '#2563EB',
                              mb: 1,
                            }}
                          />
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: '#0B1B2B' }}
                          >
                            {lawyer.rating}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: '#6B7280',
                            }}
                          >
                            Средний рейтинг
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Box
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            background: '#F4F6F8',
                            border: '1px solid #E6E9EE',
                            borderRadius: '8px',
                          }}
                        >
                          <WorkspacePremium
                            sx={{
                              fontSize: 48,
                              color: '#2563EB',
                              mb: 1,
                            }}
                          />
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: '#0B1B2B' }}
                          >
                            {lawyer.experience}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: '#6B7280',
                            }}
                          >
                            Лет опыта
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>

                    <Typography
                      variant="body2"
                      sx={{
                        mt: 3,
                        textAlign: 'center',
                        color: '#6B7280',
                      }}
                    >
                      Детальная информация о делах доступна только после
                      начала консультации
                    </Typography>
                  </Box>
                )}
              </Box>
            </Card>
          </Grid>
        </Grid>
      </Container>

      {/* Leave Review Modal */}
      <Dialog
        open={openReviewModal}
        onClose={handleCloseReviewModal}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          },
        }}
      >
        <DialogTitle
          sx={{
            color: '#0B1B2B',
            fontWeight: 'bold',
            fontSize: '1.5rem',
          }}
        >
          Оставить отзыв
        </DialogTitle>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography
                variant="body2"
                sx={{
                  color: '#6B7280',
                  mb: 1,
                }}
              >
                Ваша оценка
              </Typography>
              <Rating
                value={reviewRating}
                onChange={(e, value) => setReviewRating(value)}
                size="large"
                sx={{
                  '& .MuiRating-iconFilled': {
                    color: '#2563EB',
                  },
                  '& .MuiRating-iconEmpty': {
                    color: '#E6E9EE',
                  },
                }}
              />
            </Box>
            <TextField
              label="Ваш комментарий"
              multiline
              rows={4}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              fullWidth
              variant="outlined"
              placeholder="Поделитесь вашим мнением об этом юристе..."
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: '#0B1B2B',
                  backgroundColor: '#FFFFFF',
                  '& fieldset': {
                    borderColor: '#E6E9EE',
                  },
                  '&:hover fieldset': {
                    borderColor: '#2563EB',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#2563EB',
                  },
                },
                '& .MuiOutlinedInput-input::placeholder': {
                  color: '#6B7280',
                  opacity: 1,
                },
                '& .MuiInputBase-input': {
                  color: '#0B1B2B',
                },
                '& .MuiInputLabel-root': {
                  color: '#6B7280',
                  '&.Mui-focused': {
                    color: '#2563EB',
                  },
                },
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={handleCloseReviewModal}
            sx={{
              color: '#0B1B2B',
              border: '1px solid #E6E9EE',
              background: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              '&:hover': {
                background: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmitReview}
            disabled={submittingReview}
            sx={{
              background: '#2563EB',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              '&:hover': {
                background: '#1d4ed8',
              },
              '&.Mui-disabled': {
                background: '#E6E9EE',
                color: '#6B7280',
              },
            }}
          >
            {submittingReview ? 'Отправка...' : 'Отправить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LawyerProfilePageGlass;
