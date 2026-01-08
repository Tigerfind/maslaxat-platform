import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Paper,
  keyframes,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import LawyerCard from '../../components/Lawyers/LawyerCard';
import LawyerFilters from '../../components/Lawyers/LawyerFilters';
import VideoIntroModal from '../../components/Lawyers/VideoIntroModal';
import MIMARUBackground from '../../components/UI/MIMARUBackground';

const COUNTRIES = [
  { id: 'uzbekistan', name: 'Узбекистан', flag: '🇺🇿' },
  { id: 'england', name: 'Англия', flag: '🇬🇧' },
  { id: 'uae', name: 'ОАЭ', flag: '🇦🇪' },
  { id: 'russia', name: 'Россия', flag: '🇷🇺' },
];

const REGIONS = [
  { id: 'tashkent', name: 'Ташкент' }, { id: 'samarkand', name: 'Самарканд' },
  { id: 'bukhara', name: 'Бухара' }, { id: 'ferghana', name: 'Фергана' },
  { id: 'andijan', name: 'Андижан' }, { id: 'namangan', name: 'Наманган' },
  { id: 'karshi', name: 'Карши' }, { id: 'nukus', name: 'Нукус' },
  { id: 'urgench', name: 'Ургенч' }, { id: 'termez', name: 'Термез' },
  { id: 'jizzakh', name: 'Джизак' }, { id: 'gulistan', name: 'Гулистан' },
  { id: 'navoiy', name: 'Навоий' }, { id: 'zarafshan', name: 'Зарафшан' },
];

const SPECIALIZATIONS = [
  { id: 'civil', name: 'Гражданское право', active: true },
  { id: 'family', name: 'Семейное право', active: true },
  { id: 'corporate', name: 'Корпоративное право', active: true },
  { id: 'criminal', name: 'Уголовное право', active: true },
  { id: 'real-estate', name: 'Недвижимость', active: true },
  { id: 'labor', name: 'Трудовое право', active: true },
  { id: 'tax', name: 'Налоговое право', active: true },
  { id: 'intellectual', name: 'Интеллектуальная собственность', active: true },
];

const MOCK_LAWYERS = [
  // Узбекистан
  {
    id: 1, name: 'Иванов Иван Иванович', avatar: null, rating: 4.8,
    specializations: ['Гражданское право', 'Семейное право'],
    experience: 15, region: 'Ташкент', priceFrom: 50000,
    completedConsultations: 234, responseTime: 2, successRate: 96,
    country: 'uzbekistan', consultationType: ['online', 'offline'], city: 'Ташкент',
  },
  {
    id: 2, name: 'Петрова Мария Сергеевна', avatar: null, rating: 4.9,
    specializations: ['Корпоративное право', 'Налоговое право'],
    experience: 12, region: 'Ташкент', priceFrom: 75000,
    completedConsultations: 189, responseTime: 1, successRate: 98,
    country: 'uzbekistan', consultationType: ['online', 'offline'], city: 'Ташкент',
  },
  {
    id: 3, name: 'Сидоров Петр Александрович', avatar: null, rating: 4.7,
    specializations: ['Семейное право', 'Недвижимость'],
    experience: 10, region: 'Самарканд', priceFrom: 45000,
    completedConsultations: 156, responseTime: 3, successRate: 94,
    country: 'uzbekistan', consultationType: ['online', 'offline'], city: 'Самарканд',
  },
  {
    id: 4, name: 'Алиева Нигора Рахимовна', avatar: null, rating: 4.9,
    specializations: ['Трудовое право', 'Гражданское право'],
    experience: 18, region: 'Бухара', priceFrom: 60000,
    completedConsultations: 312, responseTime: 2, successRate: 97,
    country: 'uzbekistan', consultationType: ['online', 'offline'], city: 'Бухара',
  },
  {
    id: 5, name: 'Каримов Азиз Шавкатович', avatar: null, rating: 4.6,
    specializations: ['Уголовное право', 'Административное право'],
    experience: 20, region: 'Фергана', priceFrom: 80000,
    completedConsultations: 267, responseTime: 4, successRate: 93,
    country: 'uzbekistan', consultationType: ['online', 'offline'], city: 'Фергана',
  },
  {
    id: 6, name: 'Ибрагимова Дилноза Абдуллаевна', avatar: null, rating: 4.8,
    specializations: ['Интеллектуальная собственность', 'Корпоративное право'],
    experience: 14, region: 'Ташкент', priceFrom: 70000,
    completedConsultations: 198, responseTime: 2, successRate: 95,
    country: 'uzbekistan', consultationType: ['online'],
  },

  // Англия
  {
    id: 7, name: 'James Smith', avatar: null, rating: 4.9,
    specializations: ['Уголовное право', 'Гражданское право'],
    experience: 22, region: 'London', priceFrom: 150000,
    completedConsultations: 456, responseTime: 1, successRate: 98,
    country: 'england', consultationType: ['online'], city: 'London',
  },
  {
    id: 8, name: 'Emma Johnson', avatar: null, rating: 4.8,
    specializations: ['Гражданское право', 'Корпоративное право'],
    experience: 16, region: 'Manchester', priceFrom: 120000,
    completedConsultations: 342, responseTime: 2, successRate: 96,
    country: 'england', consultationType: ['online'], city: 'Manchester',
  },
  {
    id: 9, name: 'Oliver Brown', avatar: null, rating: 4.7,
    specializations: ['Уголовное право', 'Семейное право'],
    experience: 14, region: 'Birmingham', priceFrom: 110000,
    completedConsultations: 278, responseTime: 2, successRate: 95,
    country: 'england', consultationType: ['online', 'offline'], city: 'Birmingham',
  },

  // ОАЭ/Дубай
  {
    id: 10, name: 'Mohammed Al-Hassan', avatar: null, rating: 4.9,
    specializations: ['Корпоративное право', 'Недвижимость'],
    experience: 18, region: 'Dubai', priceFrom: 200000,
    completedConsultations: 523, responseTime: 1, successRate: 99,
    country: 'uae', consultationType: ['online', 'offline'], city: 'Dubai',
  },
  {
    id: 11, name: 'Sarah Al-Farsi', avatar: null, rating: 4.8,
    specializations: ['Недвижимость', 'Гражданское право'],
    experience: 15, region: 'Abu Dhabi', priceFrom: 180000,
    completedConsultations: 401, responseTime: 2, successRate: 97,
    country: 'uae', consultationType: ['online', 'offline'], city: 'Abu Dhabi',
  },
  {
    id: 12, name: 'Ahmed Al-Maktoum', avatar: null, rating: 4.9,
    specializations: ['Корпоративное право', 'Налоговое право'],
    experience: 20, region: 'Dubai', priceFrom: 220000,
    completedConsultations: 612, responseTime: 1, successRate: 98,
    country: 'uae', consultationType: ['online'],
  },

  // Россия
  {
    id: 13, name: 'Смирнов Александр Петрович', avatar: null, rating: 4.8,
    specializations: ['Гражданское право', 'Корпоративное право'],
    experience: 17, region: 'Москва', priceFrom: 130000,
    completedConsultations: 389, responseTime: 2, successRate: 96,
    country: 'russia', consultationType: ['online', 'offline'], city: 'Москва',
  },
  {
    id: 14, name: 'Кузнецова Елена Владимировна', avatar: null, rating: 4.7,
    specializations: ['Семейное право', 'Трудовое право'],
    experience: 13, region: 'Санкт-Петербург', priceFrom: 100000,
    completedConsultations: 267, responseTime: 3, successRate: 94,
    country: 'russia', consultationType: ['online', 'offline'], city: 'Санкт-Петербург',
  },
  {
    id: 15, name: 'Волков Дмитрий Игоревич', avatar: null, rating: 4.9,
    specializations: ['Уголовное право', 'Гражданское право'],
    experience: 19, region: 'Москва', priceFrom: 140000,
    completedConsultations: 445, responseTime: 1, successRate: 97,
    country: 'russia', consultationType: ['online'],
  },
];

const LawyersPage = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    specialization: '', region: '', priceRange: [10000, 500000],
    minRating: 0, experience: '', sortBy: 'rating',
    country: '', consultationType: '',
  });
  const [selectedLawyer, setSelectedLawyer] = useState(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);

  const handleFilterChange = (newFilters) => setFilters(newFilters);
  const handleClearFilters = () => setFilters({
    specialization: '', region: '', priceRange: [10000, 500000],
    minRating: 0, experience: '', sortBy: 'rating',
    country: '', consultationType: '',
  });

  const handleViewProfile = (lawyerId) => navigate(`/lawyers/${lawyerId}`);
  const handleBook = (lawyer) => navigate('/consultations', { state: { lawyer } });
  const handlePlayVideo = (lawyer) => {
    setSelectedLawyer(lawyer);
    setVideoModalOpen(true);
  };

  const filteredLawyers = MOCK_LAWYERS
    .filter((lawyer) => {
      if (filters.region && lawyer.region !== filters.region) return false;
      if (filters.minRating && lawyer.rating < filters.minRating) return false;
      if (lawyer.priceFrom < filters.priceRange[0] || lawyer.priceFrom > filters.priceRange[1]) return false;
      return true;
    })
    .sort((a, b) => {
      switch (filters.sortBy) {
        case 'rating': return b.rating - a.rating;
        case 'price-asc': return a.priceFrom - b.priceFrom;
        case 'price-desc': return b.priceFrom - a.priceFrom;
        case 'experience': return b.experience - a.experience;
        case 'consultations': return b.completedConsultations - a.completedConsultations;
        default: return 0;
      }
    });

  return (
    <Box sx={{ minHeight: '100vh', position: 'relative', pb: 4 }}>
      <MIMARUBackground />

      <Box
        sx={{
          bgcolor: '#1a2b4a',
          color: 'white',
          py: 5,
          px: 2,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
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
            <Box>
              <Typography variant="h4" fontWeight="bold" sx={{ mb: 1 }}>
                Каталог юристов
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.9 }}>
                Найдите лучшего специалиста для вашего вопроса
              </Typography>
            </Box>
          </Box>
          {/* Decorative line - MIMARU style */}
          <Box
            sx={{
              width: '120px',
              height: '3px',
              bgcolor: '#8b7355',
              mt: 3,
            }}
          />
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4, position: 'relative', zIndex: 1 }}>
        <Paper
          sx={{
            p: 3,
            mb: 3,
            border: '2px solid rgba(26, 43, 74, 0.08)',
          }}
        >
          <Typography variant="h5" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 2, color: '#1a2b4a' }}>
            <Box
              sx={{
                width: '4px',
                height: '28px',
                bgcolor: '#8b7355',
              }}
            />
            Найдено юристов: {filteredLawyers.length}
          </Typography>
        </Paper>

        <Grid container spacing={3}>
          <Grid item xs={12} md={3}>
            <LawyerFilters
              filters={filters}
              onFilterChange={handleFilterChange}
              onClearFilters={handleClearFilters}
              specializations={SPECIALIZATIONS}
              regions={REGIONS}
            />
          </Grid>

          <Grid item xs={12} md={9}>
            <Grid container spacing={3}>
              {filteredLawyers.length > 0 ? (
                filteredLawyers.map((lawyer) => (
                  <Grid item xs={12} sm={6} lg={4} key={lawyer.id}>
                    <LawyerCard
                      lawyer={lawyer}
                      onViewProfile={handleViewProfile}
                      onBook={handleBook}
                      onPlayVideo={handlePlayVideo}
                    />
                  </Grid>
                ))
              ) : (
                <Grid item xs={12}>
                  <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="h6" color="text.secondary">Юристы не найдены</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Попробуйте изменить параметры фильтров
                    </Typography>
                  </Paper>
                </Grid>
              )}
            </Grid>
          </Grid>
        </Grid>
      </Container>

      <VideoIntroModal
        open={videoModalOpen}
        onClose={() => setVideoModalOpen(false)}
        lawyer={selectedLawyer}
      />
    </Box>
  );
};

export default LawyersPage;
