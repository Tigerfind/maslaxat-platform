import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
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
  Business,
  Person,
  CheckCircle,
  ThumbUp,
  Language,
  Phone,
  Email,
  LocationOn,
} from '@mui/icons-material';

// Mock lawyer data - matching the structure from LawyersPage
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
  3: {
    id: 3,
    name: 'Сидоров Петр Александрович',
    avatar: null,
    rating: 4.7,
    specializations: ['Семейное право', 'Недвижимость'],
    experience: 10,
    region: 'Самарканд',
    priceFrom: 45000,
    completedConsultations: 156,
    responseTime: 3,
    successRate: 94,
    verified: true,
    bio: 'Практикующий юрист с опытом работы в семейном праве и сделках с недвижимостью. Специализируюсь на разводах, разделе имущества и оформлении купли-продажи недвижимости.',
    education: [
      'Самаркандский государственный университет (2013)',
    ],
    languages: ['Русский', 'Узбекский'],
    certifications: [
      'Риелтор-консультант',
    ],
    phone: '+998 93 345-67-89',
    email: 'sidorov@maslaxat.uz',
    workingHours: 'Пн-Сб: 9:00-17:00',
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

const LawyerProfilePage = () => {
  const { lawyerId } = useParams();
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState(0);

  // Get lawyer data
  const lawyer = MOCK_LAWYERS[lawyerId] || MOCK_LAWYERS[1];

  const handleBookConsultation = () => {
    navigate('/consultations', { state: { lawyer } });
  };

  const handleStartChat = () => {
    navigate('/ai-chat', { state: { lawyerId: lawyer.id } });
  };

  const handleVideoCall = () => {
    navigate(`/consultations/video/${lawyer.id}`);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#faf8f6', pb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
          color: 'white',
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              color="inherit"
              onClick={() => navigate('/lawyers')}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.1)',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Typography variant="h5" fontWeight="bold">
              Профиль юриста
            </Typography>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          {/* Left Column - Lawyer Info */}
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              {/* Avatar and Name */}
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Avatar
                  sx={{
                    width: 120,
                    height: 120,
                    margin: '0 auto',
                    bgcolor: '#3d5a52',
                    fontSize: '3rem',
                    mb: 2,
                  }}
                >
                  {lawyer.name.charAt(0)}
                </Avatar>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="h5" fontWeight="bold">
                    {lawyer.name}
                  </Typography>
                  {lawyer.verified && (
                    <Verified sx={{ color: '#3d5a52', fontSize: 24 }} />
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 2 }}>
                  <Star sx={{ color: '#fbbf24', fontSize: 20 }} />
                  <Typography variant="h6" fontWeight="bold">
                    {lawyer.rating}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ({lawyer.completedConsultations} консультаций)
                  </Typography>
                </Box>
                <Rating value={lawyer.rating} precision={0.1} readOnly />
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Quick Stats */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Schedule sx={{ color: '#3d5a52' }} />
                  <Typography variant="body2">
                    Ответ через <strong>{lawyer.responseTime} часа</strong>
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <TrendingUp sx={{ color: '#3d5a52' }} />
                  <Typography variant="body2">
                    <strong>{lawyer.successRate}%</strong> успешных дел
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <WorkspacePremium sx={{ color: '#3d5a52' }} />
                  <Typography variant="body2">
                    <strong>{lawyer.experience} лет</strong> опыта
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocationOn sx={{ color: '#3d5a52' }} />
                  <Typography variant="body2">
                    {lawyer.region}
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Contact Info */}
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                Контактная информация
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Phone sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2">{lawyer.phone}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Email sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2">{lawyer.email}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2">{lawyer.workingHours}</Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Price */}
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Консультация от
                </Typography>
                <Typography variant="h4" fontWeight="bold" color="primary">
                  {lawyer.priceFrom.toLocaleString()} сум
                </Typography>
              </Box>

              {/* Action Buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  startIcon={<VideoCall />}
                  onClick={handleBookConsultation}
                  sx={{
                    py: 1.5,
                    background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
                  }}
                >
                  Записаться на консультацию
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  fullWidth
                  startIcon={<Chat />}
                  onClick={handleStartChat}
                  sx={{ py: 1.5 }}
                >
                  Начать чат
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  fullWidth
                  startIcon={<VideoCall />}
                  onClick={handleVideoCall}
                  sx={{ py: 1.5 }}
                >
                  Видеозвонок
                </Button>
              </Box>
            </Paper>
          </Grid>

          {/* Right Column - Details */}
          <Grid item xs={12} md={8}>
            <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
              {/* Tabs */}
              <Tabs
                value={currentTab}
                onChange={(e, val) => setCurrentTab(val)}
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: '#faf8f6',
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
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      О себе
                    </Typography>
                    <Typography variant="body1" color="text.secondary" paragraph>
                      {lawyer.bio}
                    </Typography>

                    {/* Specializations */}
                    <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mt: 3 }}>
                      Специализации
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                      {lawyer.specializations.map((spec, index) => (
                        <Chip
                          key={index}
                          label={spec}
                          icon={<Gavel />}
                          sx={{
                            bgcolor: '#f0fdf4',
                            color: '#3d5a52',
                            fontWeight: 600,
                            border: '1px solid #3d5a52',
                          }}
                        />
                      ))}
                    </Box>

                    {/* Education */}
                    <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mt: 3 }}>
                      Образование
                    </Typography>
                    <List>
                      {lawyer.education.map((edu, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar sx={{ bgcolor: '#3d5a52' }}>
                              <School />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText primary={edu} />
                        </ListItem>
                      ))}
                    </List>

                    {/* Languages */}
                    <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mt: 3 }}>
                      Языки
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                      {lawyer.languages.map((lang, index) => (
                        <Chip
                          key={index}
                          label={lang}
                          icon={<Language />}
                          variant="outlined"
                        />
                      ))}
                    </Box>

                    {/* Certifications */}
                    <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mt: 3 }}>
                      Сертификаты и достижения
                    </Typography>
                    <List>
                      {lawyer.certifications.map((cert, index) => (
                        <ListItem key={index}>
                          <ListItemAvatar>
                            <Avatar sx={{ bgcolor: '#a67c52' }}>
                              <WorkspacePremium />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText primary={cert} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                {/* Tab 1: Reviews */}
                {currentTab === 1 && (
                  <Box>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      Отзывы клиентов
                    </Typography>

                    {/* Rating Summary */}
                    <Card sx={{ mb: 3, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                      <CardContent>
                        <Grid container spacing={2} alignItems="center">
                          <Grid item xs={12} md={4} sx={{ textAlign: 'center' }}>
                            <Typography variant="h2" fontWeight="bold" color="primary">
                              {lawyer.rating}
                            </Typography>
                            <Rating value={lawyer.rating} precision={0.1} readOnly size="large" />
                            <Typography variant="body2" color="text.secondary">
                              На основе {lawyer.completedConsultations} отзывов
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={8}>
                            {[5, 4, 3, 2, 1].map((star) => (
                              <Box key={star} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="body2" sx={{ width: 60 }}>
                                  {star} звезд
                                </Typography>
                                <LinearProgress
                                  variant="determinate"
                                  value={star === 5 ? 80 : star === 4 ? 15 : 5}
                                  sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                />
                                <Typography variant="body2" color="text.secondary" sx={{ width: 40 }}>
                                  {star === 5 ? '80%' : star === 4 ? '15%' : '5%'}
                                </Typography>
                              </Box>
                            ))}
                          </Grid>
                        </Grid>
                      </CardContent>
                    </Card>

                    {/* Review List */}
                    {MOCK_REVIEWS.map((review) => (
                      <Card key={review.id} sx={{ mb: 2, borderRadius: 2 }}>
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                            <Avatar sx={{ bgcolor: '#3d5a52' }}>
                              {review.clientName.charAt(0)}
                            </Avatar>
                            <Box sx={{ flexGrow: 1 }}>
                              <Typography variant="subtitle1" fontWeight="bold">
                                {review.clientName}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {review.date}
                              </Typography>
                            </Box>
                            <Rating value={review.rating} readOnly size="small" />
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            {review.comment}
                          </Typography>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                )}

                {/* Tab 2: Portfolio */}
                {currentTab === 2 && (
                  <Box>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      Портфолио и достижения
                    </Typography>

                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f0fdf4', borderRadius: 2 }}>
                          <CheckCircle sx={{ fontSize: 48, color: '#3d5a52', mb: 1 }} />
                          <Typography variant="h4" fontWeight="bold" color="primary">
                            {lawyer.completedConsultations}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Завершенных консультаций
                          </Typography>
                        </Card>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#fef3c7', borderRadius: 2 }}>
                          <ThumbUp sx={{ fontSize: 48, color: '#a67c52', mb: 1 }} />
                          <Typography variant="h4" fontWeight="bold" sx={{ color: '#a67c52' }}>
                            {lawyer.successRate}%
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Успешных дел
                          </Typography>
                        </Card>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#fef2f2', borderRadius: 2 }}>
                          <Star sx={{ fontSize: 48, color: '#fbbf24', mb: 1 }} />
                          <Typography variant="h4" fontWeight="bold" sx={{ color: '#fbbf24' }}>
                            {lawyer.rating}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Средний рейтинг
                          </Typography>
                        </Card>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f0f9ff', borderRadius: 2 }}>
                          <WorkspacePremium sx={{ fontSize: 48, color: '#3b82f6', mb: 1 }} />
                          <Typography variant="h4" fontWeight="bold" sx={{ color: '#3b82f6' }}>
                            {lawyer.experience}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Лет опыта
                          </Typography>
                        </Card>
                      </Grid>
                    </Grid>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
                      Детальная информация о делах доступна только после начала консультации
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default LawyerProfilePage;
