import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Avatar,
  Tab,
  Tabs,
  Rating,
  LinearProgress,
} from '@mui/material';
import {
  ArrowBack,
  Star,
  ThumbUp,
  Comment as CommentIcon,
} from '@mui/icons-material';
import NeumorphicCard from '../../components/Neumorphic/NeumorphicCard';
import NeumorphicButton from '../../components/Neumorphic/NeumorphicButton';

const MOCK_REVIEWS = [
  {
    id: 1,
    clientName: 'Дмитрий Александров',
    rating: 5,
    comment: 'Отличная консультация! Юрист очень подробно разъяснил все нюансы договора купли-продажи. Буду обращаться снова.',
    date: '2024-12-05',
    helpful: 12,
    topic: 'Недвижимость',
  },
  {
    id: 2,
    clientName: 'Елена Васильева',
    rating: 5,
    comment: 'Профессионально и быстро! Помогли разобраться с трудовым спором. Рекомендую!',
    date: '2024-12-03',
    helpful: 8,
    topic: 'Трудовое право',
  },
  {
    id: 3,
    clientName: 'Сергей Михайлов',
    rating: 4,
    comment: 'Хороший специалист, знает свое дело. Единственное - немного долго ждал ответа.',
    date: '2024-12-01',
    helpful: 5,
    topic: 'Корпоративное право',
  },
  {
    id: 4,
    clientName: 'Анна Петрова',
    rating: 5,
    comment: 'Очень благодарна за помощь в семейном споре. Все объяснили понятно и доступно.',
    date: '2024-11-28',
    helpful: 15,
    topic: 'Семейное право',
  },
  {
    id: 5,
    clientName: 'Игорь Соколов',
    rating: 5,
    comment: 'Отличный юрист! Помог с регистрацией бизнеса, всё прошло гладко.',
    date: '2024-11-25',
    helpful: 10,
    topic: 'Регистрация бизнеса',
  },
  {
    id: 6,
    clientName: 'Мария Иванова',
    rating: 4,
    comment: 'Хорошая консультация, но хотелось бы больше конкретных примеров.',
    date: '2024-11-20',
    helpful: 3,
    topic: 'Налоговое право',
  },
];

const RATING_STATS = {
  average: 4.8,
  total: 156,
  distribution: {
    5: 120,
    4: 28,
    3: 6,
    2: 1,
    1: 1,
  },
};

const LawyerReviewsPage = () => {
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [filterRating, setFilterRating] = useState(null);

  const filteredReviews = filterRating
    ? MOCK_REVIEWS.filter((review) => review.rating === filterRating)
    : MOCK_REVIEWS;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#e4e9f2', pb: 4 }}>
      <Box
        sx={{
          background: 'linear-gradient(145deg, #6aafb5, #5b9aa0)',
          color: 'white',
          py: 3,
          px: 2,
          boxShadow: '0 8px 24px rgba(91, 154, 160, 0.3)',
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/lawyer/dashboard')}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.3)' },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Typography variant="h5" fontWeight="bold">
              Отзывы клиентов
            </Typography>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} lg={4}>
            <NeumorphicCard>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h2" fontWeight="bold" color="#5b9aa0">
                  {RATING_STATS.average}
                </Typography>
                <Rating value={RATING_STATS.average} precision={0.1} readOnly size="large" />
                <Typography variant="body2" color="#5a6c7d" sx={{ mt: 1 }}>
                  На основе {RATING_STATS.total} отзывов
                </Typography>
              </Box>

              <Box sx={{ mt: 3 }}>
                {[5, 4, 3, 2, 1].map((rating) => {
                  const count = RATING_STATS.distribution[rating];
                  const percentage = (count / RATING_STATS.total) * 100;

                  return (
                    <Box
                      key={rating}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        mb: 1.5,
                        cursor: 'pointer',
                      }}
                      onClick={() => setFilterRating(filterRating === rating ? null : rating)}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: 60 }}>
                        <Typography variant="body2" fontWeight="bold" color="#2c3e50">
                          {rating}
                        </Typography>
                        <Star sx={{ fontSize: 16, color: '#fbbf24' }} />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={percentage}
                          sx={{
                            height: 8,
                            borderRadius: 4,
                            bgcolor: 'rgba(163, 177, 198, 0.3)',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: '#5b9aa0',
                              borderRadius: 4,
                            },
                          }}
                        />
                      </Box>
                      <Typography variant="body2" color="#5a6c7d" sx={{ width: 40, textAlign: 'right' }}>
                        {count}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              {filterRating && (
                <NeumorphicButton
                  fullWidth
                  color="neutral"
                  onClick={() => setFilterRating(null)}
                  sx={{ mt: 2 }}
                >
                  Сбросить фильтр
                </NeumorphicButton>
              )}
            </NeumorphicCard>
          </Grid>

          <Grid item xs={12} lg={8}>
            <Box sx={{ mb: 3 }}>
              <Tabs
                value={tabValue}
                onChange={(e, newValue) => setTabValue(newValue)}
                sx={{
                  bgcolor: '#e4e9f2',
                  borderRadius: '12px',
                  p: 0.5,
                  boxShadow: 'inset 4px 4px 8px rgba(163, 177, 198, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
                  '& .MuiTab-root': {
                    color: '#5a6c7d',
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: '10px',
                    transition: 'all 0.3s ease',
                  },
                  '& .Mui-selected': {
                    color: '#5b9aa0',
                    background: '#e4e9f2',
                    boxShadow: '6px 6px 12px rgba(163, 177, 198, 0.6), -6px -6px 12px rgba(255, 255, 255, 0.5)',
                  },
                  '& .MuiTabs-indicator': {
                    display: 'none',
                  },
                }}
              >
                <Tab label="Все отзывы" />
                <Tab label="Положительные" />
                <Tab label="С комментариями" />
              </Tabs>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {filteredReviews.map((review) => (
                <NeumorphicCard key={review.id} hover>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Avatar
                        sx={{
                          width: 48,
                          height: 48,
                          bgcolor: '#5b9aa0',
                          boxShadow: '4px 4px 8px rgba(91, 154, 160, 0.3)',
                        }}
                      >
                        {review.clientName.charAt(0)}
                      </Avatar>
                      <Box>
                        <Typography variant="subtitle1" fontWeight="bold" color="#2c3e50">
                          {review.clientName}
                        </Typography>
                        <Typography variant="caption" color="#5a6c7d">
                          {review.date}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Rating value={review.rating} readOnly size="small" />
                      <Typography variant="caption" color="#5a6c7d" display="block">
                        {review.topic}
                      </Typography>
                    </Box>
                  </Box>

                  <Typography variant="body1" color="#2c3e50" sx={{ mb: 2, lineHeight: 1.6 }}>
                    {review.comment}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IconButton size="small" sx={{ color: '#5b9aa0' }}>
                        <ThumbUp fontSize="small" />
                      </IconButton>
                      <Typography variant="body2" color="#5a6c7d">
                        {review.helpful}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IconButton size="small" sx={{ color: '#d4a574' }}>
                        <CommentIcon fontSize="small" />
                      </IconButton>
                      <Typography variant="body2" color="#5a6c7d">
                        Ответить
                      </Typography>
                    </Box>
                  </Box>
                </NeumorphicCard>
              ))}
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default LawyerReviewsPage;
