import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  TextField,
  InputAdornment,
  Chip,
  Avatar,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Rating,
  CircularProgress,
  Pagination,
  Card,
  Button,
  keyframes,
} from '@mui/material';
import {
  ArrowBack,
  Search,
  Star,
  LocationOn,
  Verified,
  WorkOutline,
  AttachMoney,
  FilterList,
  Close,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import BookingModal from '../../components/BookingModal';
import DebugPanel from '../../components/DebugPanel';

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

const scaleIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const LawyersPageGlass = () => {
  const navigate = useNavigate();
  const { specializations } = useSelector((state) => state.specializations);

  // State
  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedLawyer, setSelectedLawyer] = useState(null);

  // Filters
  const [filters, setFilters] = useState({
    specialization: '',
    minRating: 0,
    priceRange: [0, 500000],
    experience: '',
    sortBy: 'rating',
  });

  // Fetch lawyers
  useEffect(() => {
    fetchLawyers();
  }, [filters, currentPage, searchQuery]);

  const fetchLawyers = async () => {
    try {
      setLoading(true);
      const response = await clientService.lawyers.searchLawyers({
        ...filters,
        search: searchQuery,
        page: currentPage,
        limit: 9,
      });

      // Handle both array response and paginated response
      if (Array.isArray(response)) {
        setLawyers(response);
        setTotalPages(1);
      } else {
        setLawyers(response.lawyers || response.data || []);
        setTotalPages(response.totalPages || 1);
      }
    } catch (error) {
      console.error('Error fetching lawyers:', error);
      // Fallback to empty array on error
      setLawyers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setCurrentPage(1); // Reset to first page on filter change
  };

  const handleClearFilters = () => {
    setFilters({
      specialization: '',
      minRating: 0,
      priceRange: [0, 500000],
      experience: '',
      sortBy: 'rating',
    });
    setSearchQuery('');
    setCurrentPage(1);
  };

  const handleBookConsultation = (lawyer) => {
    setSelectedLawyer(lawyer);
    setBookingModalOpen(true);
  };

  const handleCloseBookingModal = () => {
    setBookingModalOpen(false);
    setSelectedLawyer(null);
  };

  const handleViewProfile = (lawyerId) => {
    navigate(`/lawyers/${lawyerId}`);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F4F6F8', pb: 6 }}>
      {/* Header */}
      <Box
        sx={{
          bgcolor: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          py: 4,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 3 }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                border: '1px solid #E6E9EE',
                bgcolor: '#FFFFFF',
                '&:hover': {
                  bgcolor: '#F4F6F8',
                  borderColor: '#2563EB',
                },
                transition: 'all 0.3s ease',
              }}
            >
              <ArrowBack sx={{ color: '#0B1B2B' }} />
            </IconButton>
            <Box>
              <Typography
                variant="h3"
                fontWeight="700"
                sx={{ mb: 0.5, color: '#0B1B2B' }}
              >
                Найти юриста
              </Typography>
              <Typography variant="h6" sx={{ color: '#6B7280' }}>
                Лучшие юристы для вашего дела
              </Typography>
            </Box>
          </Box>

          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Поиск по имени, специализации..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ color: '#6B7280' }} />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchQuery('')}>
                    <Close sx={{ color: '#6B7280' }} />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              bgcolor: '#FFFFFF',
              borderRadius: '8px',
              '& .MuiOutlinedInput-root': {
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
            }}
          />
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Results Summary */}
        <Card
          sx={{
            mb: 3,
            bgcolor: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            animation: `${fadeInUp} 0.6s ease-out`,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2.5 }}>
            <Typography variant="h6" fontWeight="700" sx={{ color: '#0B1B2B' }}>
              Найдено юристов: {lawyers.length}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<FilterList />}
              onClick={() => setShowFilters(!showFilters)}
              sx={{
                borderColor: '#E6E9EE',
                color: '#0B1B2B',
                fontWeight: '600',
                textTransform: 'none',
                borderRadius: '8px',
                px: 3,
                '&:hover': {
                  borderColor: '#2563EB',
                  bgcolor: '#F4F6F8',
                },
              }}
            >
              {showFilters ? 'Скрыть фильтры' : 'Показать фильтры'}
            </Button>
          </Box>
        </Card>

        <Grid container spacing={3}>
          {/* Filters Sidebar */}
          {showFilters && (
            <Grid
              item
              xs={12}
              md={3}
              sx={{
                animation: `${fadeInUp} 0.6s ease-out`,
                animationDelay: '0.1s',
                animationFillMode: 'both',
              }}
            >
              <Card
                sx={{
                  bgcolor: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  borderRadius: '12px',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                }}
              >
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h6" fontWeight="700" sx={{ color: '#0B1B2B' }}>
                      Фильтры
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={handleClearFilters}
                      sx={{
                        color: '#6B7280',
                        '&:hover': {
                          bgcolor: '#F4F6F8',
                        },
                      }}
                    >
                      <Close />
                    </IconButton>
                  </Box>

                  {/* Specialization Filter */}
                  <FormControl fullWidth sx={{ mb: 3 }}>
                    <InputLabel>Специализация</InputLabel>
                    <Select
                      value={filters.specialization}
                      label="Специализация"
                      onChange={(e) => handleFilterChange('specialization', e.target.value)}
                      sx={{
                        bgcolor: '#FFFFFF',
                        borderRadius: '8px',
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                      }}
                    >
                      <MenuItem value="">Все</MenuItem>
                      {specializations
                        .filter((s) => s.active)
                        .map((spec) => (
                          <MenuItem key={spec.id} value={spec.id}>
                            {spec.name}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>

                  {/* Rating Filter */}
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2, color: '#0B1B2B' }}>
                      Минимальный рейтинг
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Rating
                        value={filters.minRating}
                        onChange={(e, value) => handleFilterChange('minRating', value || 0)}
                        precision={0.5}
                        sx={{
                          '& .MuiRating-iconFilled': {
                            color: '#2563EB',
                          },
                        }}
                      />
                      <Typography variant="body2" sx={{ color: '#6B7280' }}>
                        {filters.minRating || 'Любой'}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Price Range Filter */}
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2, color: '#0B1B2B' }}>
                      Диапазон цен (₸)
                    </Typography>
                    <Slider
                      value={filters.priceRange}
                      onChange={(e, value) => handleFilterChange('priceRange', value)}
                      valueLabelDisplay="auto"
                      min={0}
                      max={500000}
                      step={10000}
                      sx={{
                        color: '#2563EB',
                        '& .MuiSlider-thumb': {
                          bgcolor: '#2563EB',
                        },
                        '& .MuiSlider-track': {
                          bgcolor: '#2563EB',
                        },
                        '& .MuiSlider-rail': {
                          bgcolor: '#E6E9EE',
                        },
                      }}
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                      <Typography variant="caption" sx={{ color: '#6B7280' }}>
                        {filters.priceRange[0].toLocaleString()} ₸
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#6B7280' }}>
                        {filters.priceRange[1].toLocaleString()} ₸
                      </Typography>
                    </Box>
                  </Box>

                  {/* Experience Filter */}
                  <FormControl fullWidth sx={{ mb: 3 }}>
                    <InputLabel>Опыт работы</InputLabel>
                    <Select
                      value={filters.experience}
                      label="Опыт работы"
                      onChange={(e) => handleFilterChange('experience', e.target.value)}
                      sx={{
                        bgcolor: '#FFFFFF',
                        borderRadius: '8px',
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                      }}
                    >
                      <MenuItem value="">Любой</MenuItem>
                      <MenuItem value="0-5">0-5 лет</MenuItem>
                      <MenuItem value="5-10">5-10 лет</MenuItem>
                      <MenuItem value="10-15">10-15 лет</MenuItem>
                      <MenuItem value="15+">15+ лет</MenuItem>
                    </Select>
                  </FormControl>

                  {/* Sort By Filter */}
                  <FormControl fullWidth>
                    <InputLabel>Сортировка</InputLabel>
                    <Select
                      value={filters.sortBy}
                      label="Сортировка"
                      onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                      sx={{
                        bgcolor: '#FFFFFF',
                        borderRadius: '8px',
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#2563EB',
                        },
                      }}
                    >
                      <MenuItem value="rating">По рейтингу</MenuItem>
                      <MenuItem value="price-asc">По цене (возрастание)</MenuItem>
                      <MenuItem value="price-desc">По цене (убывание)</MenuItem>
                      <MenuItem value="experience">По опыту</MenuItem>
                    </Select>
                  </FormControl>

                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={handleClearFilters}
                    sx={{
                      mt: 3,
                      borderColor: '#E6E9EE',
                      color: '#0B1B2B',
                      fontWeight: '600',
                      textTransform: 'none',
                      borderRadius: '8px',
                      py: 1.25,
                      '&:hover': {
                        borderColor: '#2563EB',
                        bgcolor: '#F4F6F8',
                      },
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                </Box>
              </Card>
            </Grid>
          )}

          {/* Lawyers Grid */}
          <Grid item xs={12} md={showFilters ? 9 : 12}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress
                  sx={{
                    color: '#2563EB',
                  }}
                />
              </Box>
            ) : lawyers.length > 0 ? (
              <>
                <Grid container spacing={3}>
                  {lawyers.map((lawyer, index) => (
                    <Grid
                      item
                      xs={12}
                      sm={6}
                      lg={4}
                      key={lawyer.id}
                      sx={{
                        animation: `${scaleIn} 0.6s ease-out`,
                        animationDelay: `${index * 0.1}s`,
                        animationFillMode: 'both',
                      }}
                    >
                      <Card
                        onClick={() => handleViewProfile(lawyer.id)}
                        sx={{
                          bgcolor: '#FFFFFF',
                          border: '1px solid #E6E9EE',
                          borderRadius: '12px',
                          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
                            borderColor: '#2563EB',
                            transform: 'translateY(-2px)',
                          },
                        }}
                      >
                        <Box sx={{ p: 3 }}>
                          {/* Lawyer Avatar */}
                          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                            <Avatar
                              src={lawyer.avatar}
                              sx={{
                                width: 100,
                                height: 100,
                                border: '3px solid #E6E9EE',
                                bgcolor: '#2563EB',
                                fontSize: '2rem',
                                fontWeight: 'bold',
                                color: '#FFFFFF',
                              }}
                            >
                              {lawyer.name?.charAt(0)}
                            </Avatar>
                          </Box>

                          {/* Lawyer Name */}
                          <Typography
                            variant="h6"
                            fontWeight="700"
                            align="center"
                            sx={{ mb: 1, color: '#0B1B2B' }}
                          >
                            {lawyer.name}
                          </Typography>

                          {/* Rating */}
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              gap: 1,
                              mb: 2,
                            }}
                          >
                            <Star sx={{ color: '#2563EB', fontSize: 20 }} />
                            <Typography variant="h6" fontWeight="700" sx={{ color: '#0B1B2B' }}>
                              {lawyer.rating || 0}
                            </Typography>
                            <Typography variant="body2" sx={{ color: '#6B7280' }}>
                              ({lawyer.completedConsultations || 0} отзывов)
                            </Typography>
                          </Box>

                          {/* Specializations */}
                          <Box
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 1,
                              mb: 2,
                              justifyContent: 'center',
                            }}
                          >
                            {lawyer.specializations?.slice(0, 2).map((spec, idx) => (
                              <Chip
                                key={idx}
                                label={spec}
                                size="small"
                                sx={{
                                  bgcolor: '#2563EB',
                                  color: '#FFFFFF',
                                  fontWeight: 600,
                                  borderRadius: '6px',
                                }}
                              />
                            ))}
                            {lawyer.specializations?.length > 2 && (
                              <Chip
                                label={`+${lawyer.specializations.length - 2}`}
                                size="small"
                                sx={{
                                  bgcolor: '#F4F6F8',
                                  color: '#2563EB',
                                  fontWeight: 600,
                                  borderRadius: '6px',
                                }}
                              />
                            )}
                          </Box>

                          {/* Info */}
                          <Box sx={{ mb: 2, space: 1 }}>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 1,
                              }}
                            >
                              <WorkOutline sx={{ fontSize: 18, color: '#2563EB' }} />
                              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                                {lawyer.experience || 0} лет опыта
                              </Typography>
                            </Box>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 1,
                              }}
                            >
                              <AttachMoney sx={{ fontSize: 18, color: '#2563EB' }} />
                              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                                от {lawyer.priceFrom?.toLocaleString() || 0} ₸
                              </Typography>
                            </Box>
                            {lawyer.region && (
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                }}
                              >
                                <LocationOn sx={{ fontSize: 18, color: '#2563EB' }} />
                                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                                  {lawyer.region}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Success Rate */}
                          {lawyer.successRate && (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 2,
                                p: 1.5,
                                borderRadius: '8px',
                                bgcolor: '#F0FDF4',
                                border: '1px solid #BBF7D0',
                              }}
                            >
                              <Verified sx={{ color: '#10b981', fontSize: 20 }} />
                              <Typography variant="body2" fontWeight="600" sx={{ color: '#10b981' }}>
                                {lawyer.successRate}% успешных дел
                              </Typography>
                            </Box>
                          )}

                          {/* Book Button */}
                          <Button
                            fullWidth
                            variant="contained"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBookConsultation(lawyer);
                            }}
                            sx={{
                              bgcolor: '#2563EB',
                              color: '#FFFFFF',
                              fontWeight: '600',
                              textTransform: 'none',
                              borderRadius: '8px',
                              py: 1.25,
                              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.2)',
                              '&:hover': {
                                bgcolor: '#1D4ED8',
                                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                              },
                            }}
                          >
                            Записаться на консультацию
                          </Button>
                        </Box>
                      </Card>
                    </Grid>
                  ))}
                </Grid>

                {/* Pagination */}
                {totalPages > 1 && (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      mt: 4,
                    }}
                  >
                    <Card
                      sx={{
                        bgcolor: '#FFFFFF',
                        border: '1px solid #E6E9EE',
                        borderRadius: '12px',
                        boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                      }}
                    >
                      <Box sx={{ p: 2 }}>
                        <Pagination
                          count={totalPages}
                          page={currentPage}
                          onChange={(e, page) => setCurrentPage(page)}
                          sx={{
                            '& .MuiPaginationItem-root': {
                              color: '#0B1B2B',
                              fontWeight: 600,
                              border: '1px solid #E6E9EE',
                              '&:hover': {
                                bgcolor: '#F4F6F8',
                                borderColor: '#2563EB',
                              },
                            },
                            '& .Mui-selected': {
                              bgcolor: '#2563EB',
                              color: '#FFFFFF',
                              borderColor: '#2563EB',
                              '&:hover': {
                                bgcolor: '#1D4ED8',
                              },
                            },
                          }}
                        />
                      </Box>
                    </Card>
                  </Box>
                )}
              </>
            ) : (
              <Card
                sx={{
                  bgcolor: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  borderRadius: '12px',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                }}
              >
                <Box sx={{ p: 8, textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight="700" sx={{ mb: 2, color: '#0B1B2B' }}>
                    Юристы не найдены
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 3, color: '#6B7280' }}>
                    Попробуйте изменить параметры фильтров или поискового запроса
                  </Typography>
                  <Button
                    variant="contained"
                    onClick={handleClearFilters}
                    sx={{
                      bgcolor: '#2563EB',
                      color: '#FFFFFF',
                      fontWeight: '600',
                      textTransform: 'none',
                      borderRadius: '8px',
                      px: 4,
                      py: 1.25,
                      boxShadow: '0 2px 6px rgba(37, 99, 235, 0.2)',
                      '&:hover': {
                        bgcolor: '#1D4ED8',
                        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                      },
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                </Box>
              </Card>
            )}
          </Grid>
        </Grid>
      </Container>

      {/* Booking Modal */}
      <BookingModal
        open={bookingModalOpen}
        onClose={handleCloseBookingModal}
        lawyer={selectedLawyer}
      />

      {/* Debug Panel */}
      <DebugPanel />
    </Box>
  );
};

export default LawyersPageGlass;
