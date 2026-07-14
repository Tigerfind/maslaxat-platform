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
  LocationOn,
  Language,
  Send,
} from '@mui/icons-material';

import clientService from '../../services/clientService';
import { axelionColors } from '../../theme/axelionTheme';

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
        const data = await clientService.lawyers.getLawyerDetails(lawyerId);

        // Normalize API data — API may return { id, name, profile: { ... } }
        const profile = data.profile || {};
        const normalized = {
          id: data.id,
          name: data.name,
          avatar: data.avatar,
          rating: profile.rating || data.rating || 0,
          specializations: profile.specializations
            ? (Array.isArray(profile.specializations) ? profile.specializations : [profile.specialization])
            : (data.specializations || [data.specialization || 'Юрист']),
          experience: profile.experience || data.experience || 0,
          region: profile.location || data.region || '',
          priceFrom: profile.price || data.priceFrom || 0,
          completedConsultations: profile.completedCases || data.completedConsultations || 0,
          responseTime: profile.responseTime || data.responseTime || 0,
          successRate: profile.successRate || data.successRate || 0,
          verified: profile.isVerified || data.verified || false,
          bio: profile.bio || data.bio || '',
          education: profile.education || data.education || [],
          languages: profile.languages || data.languages || [],
          certifications: profile.certifications || data.certifications || [],
          workingHours: profile.workingHours || data.workingHours || '',
          reviewsCount: profile.reviewsCount || data.reviewsCount || 0,
        };
        setLawyer(normalized);

        // Also try to load real reviews
        try {
          const reviewsData = await clientService.lawyers.getReviews(lawyerId);
          if (Array.isArray(reviewsData) && reviewsData.length > 0) {
            setReviews(reviewsData.map(r => ({
              id: r.id,
              clientName: r.clientName || r.client?.name || 'Клиент',
              rating: r.rating,
              date: new Date(r.createdAt).toLocaleDateString('ru-RU'),
              comment: r.comment,
            })));
          }
        } catch {
          // Keep mock reviews as fallback
        }
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
          background: axelionColors.bgCream,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress
            sx={{
              color: axelionColors.gold,
              mb: 2,
            }}
            size={60}
          />
          <Typography
            variant="h6"
            sx={{
              color: axelionColors.textDark,
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
          background: axelionColors.bgCream,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h6" sx={{ color: axelionColors.textDark }}>
          Юрист не найден
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: axelionColors.bgCream,
        pb: 4,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: axelionColors.bgLight,
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          py: 2,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/lawyers')}
              sx={{
                bgcolor: axelionColors.bgLight,
                color: axelionColors.textDark,
                border: `1px solid ${axelionColors.borderLight}`,
                '&:hover': {
                  bgcolor: axelionColors.bgCream,
                },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Typography
              variant="h5"
              fontWeight="bold"
              sx={{
                color: axelionColors.textDark,
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
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
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
                      background: axelionColors.gold,
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
                      sx={{ color: axelionColors.textDark }}
                    >
                      {lawyer.name}
                    </Typography>
                    {lawyer.verified && (
                      <Verified sx={{ color: axelionColors.success, fontSize: 24 }} />
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
                    <Star sx={{ color: axelionColors.gold, fontSize: 20 }} />
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      sx={{ color: axelionColors.textDark }}
                    >
                      {lawyer.rating}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: axelionColors.textMuted }}
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
                          color: axelionColors.gold,
                        },
                      }}
                    />
                  </Box>
                </Box>

                <Divider
                  sx={{
                    my: 2,
                    borderColor: axelionColors.borderLight,
                  }}
                />

              {/* Quick Stats */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Schedule sx={{ color: axelionColors.gold }} />
                  <Typography
                    variant="body2"
                    sx={{ color: axelionColors.textDark }}
                  >
                    Ответ через <strong>{lawyer.responseTime} часа</strong>
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <TrendingUp sx={{ color: axelionColors.gold }} />
                  <Typography
                    variant="body2"
                    sx={{ color: axelionColors.textDark }}
                  >
                    <strong>{lawyer.successRate}%</strong> успешных дел
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <WorkspacePremium sx={{ color: axelionColors.gold }} />
                  <Typography
                    variant="body2"
                    sx={{ color: axelionColors.textDark }}
                  >
                    <strong>{lawyer.experience} лет</strong> опыта
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocationOn sx={{ color: axelionColors.gold }} />
                  <Typography
                    variant="body2"
                    sx={{ color: axelionColors.textDark }}
                  >
                    {lawyer.region}
                  </Typography>
                </Box>
              </Box>

              <Divider
                sx={{
                  my: 2,
                  borderColor: axelionColors.borderLight,
                }}
              />

              {/* Contact Info — contacts hidden for platform retention (C1) */}
              <Typography
                variant="subtitle2"
                fontWeight="bold"
                gutterBottom
                sx={{ color: axelionColors.textDark }}
              >
                Связь
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: '8px',
                    bgcolor: axelionColors.accentLight,
                    border: `1px solid ${axelionColors.borderLight}`,
                    mb: 1,
                  }}
                >
                  <Typography variant="body2" sx={{ color: axelionColors.textMuted, fontSize: '0.8rem' }}>
                    Для связи с юристом запишитесь на консультацию через платформу
                  </Typography>
                </Box>
                {lawyer.workingHours && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Schedule sx={{ fontSize: 18, color: axelionColors.textMuted }} />
                    <Typography
                      variant="body2"
                      sx={{ color: axelionColors.textDark }}
                    >
                      {lawyer.workingHours}
                    </Typography>
                  </Box>
                )}
              </Box>

              <Divider
                sx={{
                  my: 2,
                  borderColor: axelionColors.borderLight,
                }}
              />

              {/* Price */}
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Typography
                  variant="body2"
                  sx={{ color: axelionColors.textMuted, mb: 0.5 }}
                >
                  Консультация от
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight="bold"
                  sx={{ color: axelionColors.textDark }}
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
                    background: axelionColors.gold,
                    color: '#FFFFFF',
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      background: axelionColors.goldDark,
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
                    borderColor: axelionColors.borderLight,
                    color: axelionColors.textDark,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      borderColor: axelionColors.gold,
                      background: axelionColors.accentLight,
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
                    borderColor: axelionColors.borderLight,
                    color: axelionColors.textDark,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    py: 1.5,
                    '&:hover': {
                      borderColor: axelionColors.gold,
                      background: axelionColors.accentLight,
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
                borderRadius: '8px',
                overflow: 'hidden',
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
              }}
            >
              {/* Tabs */}
              <Tabs
                value={currentTab}
                onChange={(e, val) => setCurrentTab(val)}
                sx={{
                  borderBottom: `1px solid ${axelionColors.borderLight}`,
                  '& .MuiTab-root': {
                    color: axelionColors.textMuted,
                    fontWeight: 600,
                    textTransform: 'none',
                    '&.Mui-selected': {
                      color: axelionColors.textDark,
                    },
                  },
                  '& .MuiTabs-indicator': {
                    background: axelionColors.gold,
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
                      sx={{ color: axelionColors.textDark }}
                    >
                      О себе
                    </Typography>
                    <Typography
                      variant="body1"
                      paragraph
                      sx={{ color: axelionColors.textMuted }}
                    >
                      {lawyer.bio}
                    </Typography>

                    {/* Specializations */}
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      gutterBottom
                      sx={{ mt: 3, color: axelionColors.textDark }}
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
                      {(lawyer.specializations || []).map((spec, index) => (
                        <Chip
                          key={index}
                          label={spec}
                          icon={<Gavel />}
                          sx={{
                            background: axelionColors.bgCream,
                            color: axelionColors.textDark,
                            fontWeight: 600,
                            border: `1px solid ${axelionColors.borderLight}`,
                            '& .MuiChip-icon': {
                              color: axelionColors.gold,
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
                      sx={{ mt: 3, color: axelionColors.textDark }}
                    >
                      Образование
                    </Typography>
                    <List>
                      {(lawyer.education || []).map((edu, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar
                              sx={{
                                background: axelionColors.gold,
                              }}
                            >
                              <School />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                sx={{
                                  color: axelionColors.textDark,
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
                      sx={{ mt: 3, color: axelionColors.textDark }}
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
                      {(lawyer.languages || []).map((lang, index) => (
                        <Chip
                          key={index}
                          label={lang}
                          icon={<Language />}
                          sx={{
                            background: axelionColors.bgCream,
                            color: axelionColors.textDark,
                            fontWeight: 600,
                            border: `1px solid ${axelionColors.borderLight}`,
                            '& .MuiChip-icon': {
                              color: axelionColors.gold,
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
                      sx={{ mt: 3, color: axelionColors.textDark }}
                    >
                      Сертификаты и достижения
                    </Typography>
                    <List>
                      {(lawyer.certifications || []).map((cert, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar
                              sx={{
                                background: axelionColors.bronze,
                              }}
                            >
                              <WorkspacePremium />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                sx={{
                                  color: axelionColors.textDark,
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
                        sx={{ color: axelionColors.textDark }}
                      >
                        Отзывы клиентов
                      </Typography>
                      <Button
                        variant="contained"
                        onClick={handleOpenReviewModal}
                        startIcon={<Send />}
                        size="small"
                        sx={{
                          background: axelionColors.gold,
                          color: '#FFFFFF',
                          textTransform: 'none',
                          fontWeight: 600,
                          borderRadius: '8px',
                          '&:hover': {
                            background: axelionColors.goldDark,
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
                        background: axelionColors.bgCream,
                        border: `1px solid ${axelionColors.borderLight}`,
                        borderRadius: '8px',
                      }}
                    >
                      <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} md={4} sx={{ textAlign: 'center' }}>
                          <Typography
                            variant="h2"
                            fontWeight="bold"
                            sx={{ color: axelionColors.textDark }}
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
                                  color: axelionColors.gold,
                                },
                              }}
                            />
                          </Box>
                          <Typography
                            variant="body2"
                            sx={{ color: axelionColors.textMuted }}
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
                                  color: axelionColors.textDark,
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
                                  borderRadius: '8px',
                                  background: axelionColors.borderLight,
                                  '& .MuiLinearProgress-bar': {
                                    background: axelionColors.gold,
                                  },
                                }}
                              />
                              <Typography
                                variant="body2"
                                sx={{
                                  width: 40,
                                  color: axelionColors.textMuted,
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
                          background: axelionColors.bgLight,
                          border: `1px solid ${axelionColors.borderLight}`,
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
                              background: axelionColors.gold,
                            }}
                          >
                            {review.clientName.charAt(0)}
                          </Avatar>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography
                              variant="subtitle1"
                              fontWeight="bold"
                              sx={{ color: axelionColors.textDark }}
                            >
                              {review.clientName}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                color: axelionColors.textMuted,
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
                                color: axelionColors.gold,
                              },
                            }}
                          />
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{
                            color: axelionColors.textMuted,
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
                      sx={{ color: axelionColors.textDark }}
                    >
                      Портфолио и достижения
                    </Typography>

                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Box
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            background: axelionColors.bgCream,
                            border: `1px solid ${axelionColors.borderLight}`,
                            borderRadius: '8px',
                          }}
                        >
                          <Box
                            sx={{
                              fontSize: 48,
                              mb: 1,
                              color: axelionColors.gold,
                            }}
                          >
                            ✓
                          </Box>
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: axelionColors.textDark }}
                          >
                            {lawyer.completedConsultations}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: axelionColors.textMuted,
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
                            background: axelionColors.bgCream,
                            border: `1px solid ${axelionColors.borderLight}`,
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
                            sx={{ color: axelionColors.textDark }}
                          >
                            {lawyer.successRate}%
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: axelionColors.textMuted,
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
                            background: axelionColors.bgCream,
                            border: `1px solid ${axelionColors.borderLight}`,
                            borderRadius: '8px',
                          }}
                        >
                          <Star
                            sx={{
                              fontSize: 48,
                              color: axelionColors.gold,
                              mb: 1,
                            }}
                          />
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: axelionColors.textDark }}
                          >
                            {lawyer.rating}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: axelionColors.textMuted,
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
                            background: axelionColors.bgCream,
                            border: `1px solid ${axelionColors.borderLight}`,
                            borderRadius: '8px',
                          }}
                        >
                          <WorkspacePremium
                            sx={{
                              fontSize: 48,
                              color: axelionColors.bronze,
                              mb: 1,
                            }}
                          />
                          <Typography
                            variant="h4"
                            fontWeight="bold"
                            sx={{ color: axelionColors.textDark }}
                          >
                            {lawyer.experience}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: axelionColors.textMuted,
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
                        color: axelionColors.textMuted,
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
            background: axelionColors.bgLight,
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
          },
        }}
      >
        <DialogTitle
          sx={{
            color: axelionColors.textDark,
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
                  color: axelionColors.textMuted,
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
                    color: axelionColors.gold,
                  },
                  '& .MuiRating-iconEmpty': {
                    color: axelionColors.borderLight,
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
                  color: axelionColors.textDark,
                  backgroundColor: axelionColors.bgLight,
                  '& fieldset': {
                    borderColor: axelionColors.borderLight,
                  },
                  '&:hover fieldset': {
                    borderColor: axelionColors.gold,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: axelionColors.gold,
                  },
                },
                '& .MuiOutlinedInput-input::placeholder': {
                  color: axelionColors.textMuted,
                  opacity: 1,
                },
                '& .MuiInputBase-input': {
                  color: axelionColors.textDark,
                },
                '& .MuiInputLabel-root': {
                  color: axelionColors.textMuted,
                  '&.Mui-focused': {
                    color: axelionColors.gold,
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
              color: axelionColors.textDark,
              border: `1px solid ${axelionColors.borderLight}`,
              background: axelionColors.bgLight,
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              '&:hover': {
                background: axelionColors.bgCream,
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
              background: axelionColors.gold,
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              '&:hover': {
                background: axelionColors.goldDark,
              },
              '&.Mui-disabled': {
                background: axelionColors.borderLight,
                color: axelionColors.textMuted,
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
