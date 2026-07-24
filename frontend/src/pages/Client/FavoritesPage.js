import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Card,
  Button,
  Avatar,
  Chip,
  keyframes,
} from '@mui/material';
import {
  ArrowBack,
  Favorite,
  FavoriteBorder,
  Star,
  WorkOutline,
  AttachMoney,
  LocationOn,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { axelionColors } from '../../theme/axelionTheme';
import clientService from '../../services/clientService';
import EmptyState from '../../components/UI/EmptyState';
import { useTranslation } from '../../i18n';

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const FavoritesPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      setLoading(true);
      const data = await clientService.favorites.getFavorites();
      setFavorites(data);
    } catch (error) {
      console.error('Error loading favorites:', error);
      toast.error(t('favorites.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFavorite = async (lawyerId) => {
    try {
      await clientService.favorites.removeFavorite(lawyerId);
      setFavorites((prev) => prev.filter((l) => l.id !== lawyerId));
      toast.success(t('favorites.removed'));
    } catch (error) {
      toast.error(t('favorites.removeError'));
    }
  };

  const handleViewProfile = (lawyerId) => {
    navigate(`/lawyers/${lawyerId}`);
  };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: axelionColors.bgCream,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: `2px solid ${axelionColors.borderLight}`,
            borderTopColor: axelionColors.gold,
            animation: 'spin 1s linear infinite',
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' },
            },
          }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, pb: 6 }}>
      {/* Header */}
      <Box
        sx={{
          bgcolor: axelionColors.bgLight,
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          py: { xs: 2, md: 4 },
          px: { xs: 1, md: 2 },
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 3 } }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                border: `1px solid ${axelionColors.borderLight}`,
                bgcolor: axelionColors.bgLight,
                borderRadius: '8px',
                '&:hover': {
                  bgcolor: axelionColors.bgWarm,
                  borderColor: axelionColors.gold,
                },
              }}
            >
              <ArrowBack sx={{ color: axelionColors.textDark }} />
            </IconButton>
            <Box>
              <Typography
                sx={{
                  fontWeight: 300,
                  fontSize: { xs: '1.25rem', md: '1.75rem' },
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: axelionColors.textDark,
                  mb: 0.5,
                }}
              >
                {t('favorites.title')}
              </Typography>
              <Typography sx={{ color: axelionColors.textMuted, fontSize: '0.9rem' }}>
                {favorites.length} {favorites.length === 1 ? t('favorites.lawyerOne') : t('favorites.lawyerMany')}
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {favorites.length === 0 ? (
          <EmptyState
            icon={<FavoriteBorder sx={{ fontSize: 64, color: axelionColors.borderLight }} />}
            title={t('favorites.emptyTitle')}
            subtitle={t('favorites.emptySub')}
            actionLabel={t('favorites.findLawyer')}
            onAction={() => navigate('/lawyers')}
          />
        ) : (
          <Grid container spacing={3}>
            {favorites.map((lawyer, index) => (
              <Grid
                item
                xs={12}
                sm={6}
                lg={4}
                key={lawyer.id}
                sx={{
                  animation: `${fadeInUp} 0.5s ease-out`,
                  animationDelay: `${index * 0.08}s`,
                  animationFillMode: 'both',
                }}
              >
                <Card
                  sx={{
                    bgcolor: axelionColors.bgLight,
                    border: `1px solid ${axelionColors.borderLight}`,
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    '&:hover': {
                      boxShadow: '0 8px 24px rgba(26, 26, 26, 0.08)',
                      borderColor: axelionColors.gold,
                      transform: 'translateY(-4px)',
                    },
                  }}
                >
                  {/* Favorite Icon */}
                  <IconButton
                    onClick={() => handleRemoveFavorite(lawyer.id)}
                    sx={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      bgcolor: axelionColors.bgLight,
                      border: `1px solid ${axelionColors.borderLight}`,
                      '&:hover': {
                        bgcolor: axelionColors.bgWarm,
                        borderColor: axelionColors.gold,
                      },
                    }}
                  >
                    <Favorite sx={{ color: axelionColors.gold, fontSize: 20 }} />
                  </IconButton>

                  <Box sx={{ p: 3, pt: 4 }}>
                    {/* Lawyer Avatar */}
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                      <Avatar
                        src={lawyer.avatar}
                        sx={{
                          width: 100,
                          height: 100,
                          border: `3px solid ${axelionColors.gold}`,
                          bgcolor: axelionColors.bgBeige,
                          fontSize: '2rem',
                          fontWeight: 300,
                          color: axelionColors.gold,
                        }}
                      >
                        {lawyer.name?.charAt(0)}
                      </Avatar>
                    </Box>

                    {/* Lawyer Name */}
                    <Typography
                      sx={{
                        fontWeight: 500,
                        fontSize: '1.1rem',
                        textAlign: 'center',
                        color: axelionColors.textDark,
                        mb: 1,
                      }}
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
                      <Star sx={{ color: axelionColors.gold, fontSize: 20 }} />
                      <Typography sx={{ fontWeight: 500, color: axelionColors.textDark }}>
                        {lawyer.rating || 0}
                      </Typography>
                      <Typography sx={{ color: axelionColors.textMuted, fontSize: '0.85rem' }}>
                        ({lawyer.completedConsultations || 0} {t('favorites.reviews')})
                      </Typography>
                    </Box>

                    {/* Specialization */}
                    {lawyer.specialization && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                        <Chip
                          label={lawyer.specialization}
                          size="small"
                          sx={{
                            bgcolor: axelionColors.accentLight,
                            color: axelionColors.gold,
                            fontWeight: 500,
                            fontSize: '0.7rem',
                            letterSpacing: '0.05em',
                            borderRadius: '8px',
                          }}
                        />
                      </Box>
                    )}

                    {/* Info */}
                    <Box sx={{ mb: 2 }}>
                      {lawyer.experience > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <WorkOutline sx={{ fontSize: 18, color: axelionColors.gold }} />
                          <Typography sx={{ color: axelionColors.textSecondary, fontSize: '0.85rem' }}>
                            {lawyer.experience} {t('favorites.yearsExp')}
                          </Typography>
                        </Box>
                      )}
                      {lawyer.priceFrom > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <AttachMoney sx={{ fontSize: 18, color: axelionColors.gold }} />
                          <Typography sx={{ color: axelionColors.textSecondary, fontSize: '0.85rem' }}>
                            {t('favorites.from')} {lawyer.priceFrom.toLocaleString()} {t('favorites.sum')}
                          </Typography>
                        </Box>
                      )}
                      {lawyer.location && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <LocationOn sx={{ fontSize: 18, color: axelionColors.gold }} />
                          <Typography sx={{ color: axelionColors.textSecondary, fontSize: '0.85rem' }}>
                            {lawyer.location}
                          </Typography>
                        </Box>
                      )}
                    </Box>

                    {/* Added date */}
                    {lawyer.addedAt && (
                      <Typography
                        sx={{
                          textAlign: 'center',
                          fontSize: '0.7rem',
                          color: axelionColors.textMuted,
                          mb: 2,
                        }}
                      >
                        {t('favorites.addedOn')} {new Date(lawyer.addedAt).toLocaleDateString('ru-RU')}
                      </Typography>
                    )}

                    {/* View Profile Button */}
                    <Button
                      fullWidth
                      onClick={() => handleViewProfile(lawyer.id)}
                      sx={{
                        bgcolor: axelionColors.gold,
                        color: '#FFFFFF',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        fontSize: '0.75rem',
                        borderRadius: '8px',
                        py: 1.5,
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: axelionColors.goldDark,
                          boxShadow: 'none',
                        },
                      }}
                    >
                      {t('favorites.viewProfile')}
                    </Button>
                  </Box>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
    </Box>
  );
};

export default FavoritesPage;
