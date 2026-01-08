import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Avatar,
  Chip,
  Badge,
} from '@mui/material';
import {
  ArrowBack,
  ChevronLeft,
  ChevronRight,
  VideoCall,
  Message,
  Check,
  Close,
} from '@mui/icons-material';
import NeumorphicCard from '../../components/Neumorphic/NeumorphicCard';
import NeumorphicButton from '../../components/Neumorphic/NeumorphicButton';
import { toast } from 'react-toastify';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const MOCK_EVENTS = {
  '2024-12-08': [
    { id: 1, time: '14:00', client: 'Иван Петров', topic: 'Договор купли-продажи', type: 'video', status: 'pending' },
    { id: 2, time: '16:30', client: 'Анна Сидорова', topic: 'Трудовой спор', type: 'chat', status: 'confirmed' },
  ],
  '2024-12-09': [
    { id: 3, time: '10:00', client: 'Михаил Козлов', topic: 'Регистрация бизнеса', type: 'video', status: 'confirmed' },
  ],
  '2024-12-10': [
    { id: 4, time: '15:00', client: 'Ольга Смирнова', topic: 'Семейное право', type: 'video', status: 'pending' },
  ],
};

const LawyerSchedulePage = () => {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    return { daysInMonth, startingDayOfWeek };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const handleDateClick = (day) => {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
  };

  const hasEvents = (day) => {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return MOCK_EVENTS[dateStr]?.length > 0;
  };

  const handleConfirm = (eventId) => {
    toast.success('Консультация подтверждена');
  };

  const handleReject = (eventId) => {
    toast.info('Консультация отклонена');
  };

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
              Календарь консультаций
            </Typography>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <NeumorphicCard>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <IconButton onClick={handlePrevMonth} sx={{ color: '#5b9aa0' }}>
                  <ChevronLeft />
                </IconButton>
                <Typography variant="h5" fontWeight="bold" color="#2c3e50">
                  {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                </Typography>
                <IconButton onClick={handleNextMonth} sx={{ color: '#5b9aa0' }}>
                  <ChevronRight />
                </IconButton>
              </Box>

              <Grid container spacing={1}>
                {DAYS.map((day) => (
                  <Grid item xs={12 / 7} key={day}>
                    <Box sx={{ textAlign: 'center', py: 1 }}>
                      <Typography variant="body2" fontWeight="bold" color="#5a6c7d">
                        {day}
                      </Typography>
                    </Box>
                  </Grid>
                ))}

                {[...Array(startingDayOfWeek)].map((_, index) => (
                  <Grid item xs={12 / 7} key={`empty-${index}`}>
                    <Box sx={{ height: 80 }} />
                  </Grid>
                ))}

                {[...Array(daysInMonth)].map((_, index) => {
                  const day = index + 1;
                  const isSelected = selectedDate === `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const hasEvent = hasEvents(day);

                  return (
                    <Grid item xs={12 / 7} key={day}>
                      <NeumorphicCard
                        variant={isSelected ? 'pressed' : 'elevated'}
                        hover
                        onClick={() => handleDateClick(day)}
                        sx={{
                          height: 80,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          p: 1,
                          cursor: 'pointer',
                        }}
                      >
                        <Typography
                          variant="body1"
                          fontWeight={isSelected ? 'bold' : 'normal'}
                          color={isSelected ? '#5b9aa0' : '#2c3e50'}
                        >
                          {day}
                        </Typography>
                        {hasEvent && (
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              bgcolor: '#d4a574',
                              mt: 0.5,
                            }}
                          />
                        )}
                      </NeumorphicCard>
                    </Grid>
                  );
                })}
              </Grid>
            </NeumorphicCard>
          </Grid>

          <Grid item xs={12} lg={4}>
            <NeumorphicCard>
              <Typography variant="h6" fontWeight="bold" color="#2c3e50" gutterBottom>
                {selectedDate ? `События на ${selectedDate}` : 'Выберите дату'}
              </Typography>

              <Box sx={{ mt: 2 }}>
                {selectedDate && MOCK_EVENTS[selectedDate] ? (
                  MOCK_EVENTS[selectedDate].map((event) => (
                    <NeumorphicCard key={event.id} variant="flat" sx={{ mb: 2, p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="subtitle2" fontWeight="bold" color="#2c3e50">
                          {event.time}
                        </Typography>
                        <Chip
                          icon={event.type === 'video' ? <VideoCall /> : <Message />}
                          label={event.type === 'video' ? 'Видео' : 'Чат'}
                          size="small"
                          sx={{
                            bgcolor: event.type === 'video' ? '#5b9aa0' : '#d4a574',
                            color: 'white',
                          }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: '#5b9aa0' }}>
                          {event.client.charAt(0)}
                        </Avatar>
                        <Typography variant="body2" color="#2c3e50">
                          {event.client}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="#5a6c7d" sx={{ mb: 2 }}>
                        {event.topic}
                      </Typography>
                      {event.status === 'pending' && (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <NeumorphicButton
                            color="success"
                            size="small"
                            startIcon={<Check />}
                            onClick={() => handleConfirm(event.id)}
                            sx={{ flex: 1 }}
                          >
                            Принять
                          </NeumorphicButton>
                          <NeumorphicButton
                            color="error"
                            size="small"
                            startIcon={<Close />}
                            onClick={() => handleReject(event.id)}
                            sx={{ flex: 1 }}
                          >
                            Отклонить
                          </NeumorphicButton>
                        </Box>
                      )}
                      {event.status === 'confirmed' && (
                        <Chip label="Подтверждено" color="success" size="small" />
                      )}
                    </NeumorphicCard>
                  ))
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="#5a6c7d">
                      {selectedDate ? 'Нет событий на эту дату' : 'Выберите дату в календаре'}
                    </Typography>
                  </Box>
                )}
              </Box>
            </NeumorphicCard>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default LawyerSchedulePage;
