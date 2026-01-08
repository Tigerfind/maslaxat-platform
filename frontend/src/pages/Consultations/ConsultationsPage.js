import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
  Tabs,
  Tab,
  Button,
  Card,
  CardContent,
  Avatar,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Divider,
  Rating,
} from '@mui/material';
import {
  ArrowBack,
  VideoCall,
  Chat,
  Schedule,
  CheckCircle,
  Cancel,
  Pending,
  CalendarMonth,
  AccessTime,
  Person,
  Gavel,
  Payment,
  Star,
} from '@mui/icons-material';

// Mock consultations data
const MOCK_CONSULTATIONS = {
  upcoming: [
    {
      id: 1,
      lawyer: {
        id: 1,
        name: 'Иванов Иван Иванович',
        specialization: 'Гражданское право',
        rating: 4.8,
      },
      date: '2024-12-15',
      time: '14:00',
      duration: 60,
      type: 'video',
      topic: 'Консультация по договору купли-продажи',
      price: 50000,
      status: 'confirmed',
    },
    {
      id: 2,
      lawyer: {
        id: 2,
        name: 'Петрова Мария Сергеевна',
        specialization: 'Корпоративное право',
        rating: 4.9,
      },
      date: '2024-12-16',
      time: '10:00',
      duration: 30,
      type: 'chat',
      topic: 'Вопросы по регистрации ООО',
      price: 35000,
      status: 'pending',
    },
  ],
  completed: [
    {
      id: 3,
      lawyer: {
        id: 3,
        name: 'Сидоров Петр Александрович',
        specialization: 'Семейное право',
        rating: 4.7,
      },
      date: '2024-11-20',
      time: '15:00',
      duration: 45,
      type: 'video',
      topic: 'Консультация по разделу имущества',
      price: 45000,
      status: 'completed',
      reviewed: false,
    },
    {
      id: 4,
      lawyer: {
        id: 1,
        name: 'Иванов Иван Иванович',
        specialization: 'Гражданское право',
        rating: 4.8,
      },
      date: '2024-11-15',
      time: '11:00',
      duration: 60,
      type: 'chat',
      topic: 'Вопросы по наследству',
      price: 50000,
      status: 'completed',
      reviewed: true,
    },
  ],
  cancelled: [
    {
      id: 5,
      lawyer: {
        id: 2,
        name: 'Петрова Мария Сергеевна',
        specialization: 'Корпоративное право',
        rating: 4.9,
      },
      date: '2024-11-10',
      time: '16:00',
      duration: 30,
      type: 'video',
      topic: 'Налоговая консультация',
      price: 75000,
      status: 'cancelled',
    },
  ],
};

const TIME_SLOTS = [
  '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00',
];

const ConsultationsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentTab, setCurrentTab] = useState(0);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState(null);

  // Booking form state
  const [bookingForm, setBookingForm] = useState({
    lawyer: location.state?.lawyer || null,
    date: '',
    time: '',
    duration: 30,
    type: 'video',
    topic: '',
  });

  // Review form state
  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    comment: '',
  });

  const handleBookingChange = (field, value) => {
    setBookingForm({ ...bookingForm, [field]: value });
  };

  const handleSubmitBooking = () => {
    console.log('Booking submitted:', bookingForm);
    setBookingDialogOpen(false);
    setBookingForm({
      lawyer: null,
      date: '',
      time: '',
      duration: 30,
      type: 'video',
      topic: '',
    });
  };

  const handleCancelConsultation = (consultationId) => {
    console.log('Cancel consultation:', consultationId);
  };

  const handleJoinConsultation = (consultation) => {
    if (consultation.type === 'video') {
      navigate(`/consultations/video/${consultation.id}`);
    } else {
      navigate('/ai-chat', { state: { consultationId: consultation.id } });
    }
  };

  const handleSubmitReview = () => {
    console.log('Review submitted:', reviewForm);
    setReviewDialogOpen(false);
    setReviewForm({ rating: 5, comment: '' });
    setSelectedConsultation(null);
  };

  const renderConsultationCard = (consultation, showActions = true) => {
    const statusConfig = {
      confirmed: { color: 'success', label: 'Подтверждено', icon: <CheckCircle /> },
      pending: { color: 'warning', label: 'Ожидание', icon: <Pending /> },
      completed: { color: 'info', label: 'Завершено', icon: <CheckCircle /> },
      cancelled: { color: 'error', label: 'Отменено', icon: <Cancel /> },
    };

    const config = statusConfig[consultation.status];

    return (
      <Card key={consultation.id} sx={{ mb: 2, borderRadius: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, flexGrow: 1 }}>
              <Avatar
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: '#3d5a52',
                  fontSize: '1.5rem',
                }}
              >
                {consultation.lawyer.name.charAt(0)}
              </Avatar>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" fontWeight="bold">
                  {consultation.lawyer.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    size="small"
                    label={consultation.lawyer.specialization}
                    icon={<Gavel />}
                    sx={{ bgcolor: '#f0fdf4', color: '#3d5a52' }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Star sx={{ fontSize: 16, color: '#fbbf24' }} />
                    <Typography variant="body2">{consultation.lawyer.rating}</Typography>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {consultation.topic}
                </Typography>
              </Box>
            </Box>
            <Chip
              label={config.label}
              color={config.color}
              icon={config.icon}
              sx={{ fontWeight: 'bold' }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarMonth sx={{ fontSize: 20, color: 'text.secondary' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Дата
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {new Date(consultation.date).toLocaleDateString('ru-RU')}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AccessTime sx={{ fontSize: 20, color: 'text.secondary' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Время
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {consultation.time} ({consultation.duration} мин)
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {consultation.type === 'video' ? (
                  <VideoCall sx={{ fontSize: 20, color: 'text.secondary' }} />
                ) : (
                  <Chat sx={{ fontSize: 20, color: 'text.secondary' }} />
                )}
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Тип
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {consultation.type === 'video' ? 'Видео' : 'Чат'}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Payment sx={{ fontSize: 20, color: 'text.secondary' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Стоимость
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {consultation.price.toLocaleString()} сум
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>

          {showActions && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {consultation.status === 'confirmed' && (
                  <>
                    <Button
                      variant="contained"
                      startIcon={consultation.type === 'video' ? <VideoCall /> : <Chat />}
                      onClick={() => handleJoinConsultation(consultation)}
                      sx={{
                        background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
                      }}
                    >
                      {consultation.type === 'video' ? 'Войти в видео' : 'Открыть чат'}
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<Cancel />}
                      onClick={() => handleCancelConsultation(consultation.id)}
                    >
                      Отменить
                    </Button>
                  </>
                )}
                {consultation.status === 'pending' && (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<Cancel />}
                    onClick={() => handleCancelConsultation(consultation.id)}
                  >
                    Отменить запрос
                  </Button>
                )}
                {consultation.status === 'completed' && !consultation.reviewed && (
                  <Button
                    variant="contained"
                    startIcon={<Star />}
                    onClick={() => {
                      setSelectedConsultation(consultation);
                      setReviewDialogOpen(true);
                    }}
                    sx={{
                      background: 'linear-gradient(135deg, #a67c52 0%, #c29a6e 100%)',
                    }}
                  >
                    Оставить отзыв
                  </Button>
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    );
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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton
                color="inherit"
                onClick={() => navigate('/dashboard')}
                sx={{
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' },
                }}
              >
                <ArrowBack />
              </IconButton>
              <Typography variant="h5" fontWeight="bold">
                Мои консультации
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<Schedule />}
              onClick={() => setBookingDialogOpen(true)}
              sx={{
                bgcolor: 'white',
                color: '#3d5a52',
                '&:hover': { bgcolor: '#f0fdf4' },
                fontWeight: 'bold',
              }}
            >
              Записаться на консультацию
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Tabs */}
        <Paper sx={{ mb: 3, borderRadius: 3, overflow: 'hidden' }}>
          <Tabs
            value={currentTab}
            onChange={(e, val) => setCurrentTab(val)}
            sx={{ bgcolor: '#faf8f6' }}
          >
            <Tab
              label={`Предстоящие (${MOCK_CONSULTATIONS.upcoming.length})`}
              icon={<Schedule />}
              iconPosition="start"
            />
            <Tab
              label={`Завершенные (${MOCK_CONSULTATIONS.completed.length})`}
              icon={<CheckCircle />}
              iconPosition="start"
            />
            <Tab
              label={`Отмененные (${MOCK_CONSULTATIONS.cancelled.length})`}
              icon={<Cancel />}
              iconPosition="start"
            />
          </Tabs>
        </Paper>

        {/* Tab Content */}
        {currentTab === 0 && (
          <Box>
            {MOCK_CONSULTATIONS.upcoming.length > 0 ? (
              MOCK_CONSULTATIONS.upcoming.map((consultation) =>
                renderConsultationCard(consultation)
              )
            ) : (
              <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
                <Schedule sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  У вас пока нет предстоящих консультаций
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<Schedule />}
                  onClick={() => setBookingDialogOpen(true)}
                  sx={{
                    mt: 2,
                    background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
                  }}
                >
                  Записаться на консультацию
                </Button>
              </Paper>
            )}
          </Box>
        )}

        {currentTab === 1 && (
          <Box>
            {MOCK_CONSULTATIONS.completed.map((consultation) =>
              renderConsultationCard(consultation)
            )}
          </Box>
        )}

        {currentTab === 2 && (
          <Box>
            {MOCK_CONSULTATIONS.cancelled.map((consultation) =>
              renderConsultationCard(consultation, false)
            )}
          </Box>
        )}
      </Container>

      {/* Booking Dialog */}
      <Dialog
        open={bookingDialogOpen}
        onClose={() => setBookingDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Запись на консультацию
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {bookingForm.lawyer && (
              <Paper sx={{ p: 2, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Выбранный юрист:
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {bookingForm.lawyer.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {bookingForm.lawyer.specializations?.[0] || 'Юрист'}
                </Typography>
              </Paper>
            )}

            {!bookingForm.lawyer && (
              <Button
                variant="outlined"
                startIcon={<Person />}
                onClick={() => navigate('/lawyers')}
              >
                Выбрать юриста
              </Button>
            )}

            <TextField
              label="Дата консультации"
              type="date"
              value={bookingForm.date}
              onChange={(e) => handleBookingChange('date', e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{
                min: new Date().toISOString().split('T')[0],
              }}
              fullWidth
            />

            <TextField
              select
              label="Время"
              value={bookingForm.time}
              onChange={(e) => handleBookingChange('time', e.target.value)}
              fullWidth
            >
              {TIME_SLOTS.map((slot) => (
                <MenuItem key={slot} value={slot}>
                  {slot}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Длительность"
              value={bookingForm.duration}
              onChange={(e) => handleBookingChange('duration', e.target.value)}
              fullWidth
            >
              <MenuItem value={30}>30 минут</MenuItem>
              <MenuItem value={60}>1 час</MenuItem>
              <MenuItem value={90}>1.5 часа</MenuItem>
              <MenuItem value={120}>2 часа</MenuItem>
            </TextField>

            <TextField
              select
              label="Тип консультации"
              value={bookingForm.type}
              onChange={(e) => handleBookingChange('type', e.target.value)}
              fullWidth
            >
              <MenuItem value="video">Видеоконсультация</MenuItem>
              <MenuItem value="chat">Чат-консультация</MenuItem>
            </TextField>

            <TextField
              label="Тема консультации"
              value={bookingForm.topic}
              onChange={(e) => handleBookingChange('topic', e.target.value)}
              multiline
              rows={3}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setBookingDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmitBooking}
            disabled={!bookingForm.lawyer || !bookingForm.date || !bookingForm.time || !bookingForm.topic}
            sx={{
              background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
            }}
          >
            Записаться
          </Button>
        </DialogActions>
      </Dialog>

      {/* Review Dialog */}
      <Dialog
        open={reviewDialogOpen}
        onClose={() => setReviewDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Оставить отзыв
          </Typography>
        </DialogTitle>
        <DialogContent>
          {selectedConsultation && (
            <Box sx={{ pt: 2 }}>
              <Box sx={{ display: 'flex', gap: 2, mb: 3, p: 2, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                <Avatar sx={{ width: 48, height: 48, bgcolor: '#3d5a52' }}>
                  {selectedConsultation.lawyer.name.charAt(0)}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {selectedConsultation.lawyer.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedConsultation.lawyer.specialization}
                  </Typography>
                </Box>
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                Оцените консультацию
              </Typography>
              <Rating
                value={reviewForm.rating}
                onChange={(e, value) => setReviewForm({ ...reviewForm, rating: value })}
                size="large"
                sx={{ mb: 2 }}
              />

              <TextField
                label="Ваш отзыв"
                value={reviewForm.comment}
                onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                multiline
                rows={4}
                fullWidth
                placeholder="Поделитесь своим опытом работы с юристом..."
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setReviewDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmitReview}
            disabled={!reviewForm.comment}
            sx={{
              background: 'linear-gradient(135deg, #a67c52 0%, #c29a6e 100%)',
            }}
          >
            Отправить отзыв
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ConsultationsPage;
