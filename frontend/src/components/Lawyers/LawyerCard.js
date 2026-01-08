import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Avatar,
  Typography,
  Button,
  Box,
  Rating,
  Chip,
  IconButton,
} from '@mui/material';
import {
  VideoCall,
  PlayCircleOutline,
  LocationOn,
  Work,
  AttachMoney,
  Favorite,
  FavoriteBorder,
} from '@mui/icons-material';

const LawyerCard = ({ lawyer, onViewProfile, onBook, onPlayVideo }) => {
  const [isFavorite, setIsFavorite] = useState(false);

  const handleToggleFavorite = (e) => {
    e.stopPropagation();
    setIsFavorite(!isFavorite);
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        '&:hover': {
          transform: 'translateY(-8px)',
          boxShadow: 8,
        },
      }}
      onClick={() => onViewProfile(lawyer.id)}
    >
      {/* Favorite Button */}
      <IconButton
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          bgcolor: 'white',
          '&:hover': { bgcolor: 'grey.100' },
        }}
        onClick={handleToggleFavorite}
      >
        {isFavorite ? (
          <Favorite sx={{ color: 'error.main' }} />
        ) : (
          <FavoriteBorder />
        )}
      </IconButton>

      {/* Video Preview */}
      {lawyer.videoUrl && (
        <Box
          sx={{
            position: 'relative',
            paddingTop: '56.25%', // 16:9 aspect ratio
            bgcolor: 'grey.900',
            backgroundImage: lawyer.thumbnail
              ? `url(${lawyer.thumbnail})`
              : 'linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <IconButton
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'white',
              bgcolor: 'rgba(0,0,0,0.5)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
            onClick={(e) => {
              e.stopPropagation();
              onPlayVideo(lawyer);
            }}
          >
            <PlayCircleOutline sx={{ fontSize: 60 }} />
          </IconButton>
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.7)',
              color: 'white',
              px: 1,
              py: 0.5,
              borderRadius: 1,
            }}
          >
            Видео-визитка
          </Typography>
        </Box>
      )}

      <CardContent sx={{ flexGrow: 1, pt: 2 }}>
        {/* Avatar and Name */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
          <Avatar
            src={lawyer.avatar}
            sx={{
              width: 60,
              height: 60,
              mr: 2,
              bgcolor: 'primary.main',
              border: '3px solid',
              borderColor: 'secondary.main',
            }}
          >
            {lawyer.name.charAt(0)}
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              {lawyer.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Rating value={lawyer.rating} precision={0.1} size="small" readOnly />
              <Typography variant="body2" color="text.secondary">
                ({lawyer.rating})
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Specialization */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Специализация:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {lawyer.specializations.slice(0, 2).map((spec, index) => (
              <Chip key={index} label={spec} size="small" color="primary" />
            ))}
            {lawyer.specializations.length > 2 && (
              <Chip
                label={`+${lawyer.specializations.length - 2}`}
                size="small"
                variant="outlined"
              />
            )}
          </Box>
        </Box>

        {/* Experience */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Work sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary">
            Опыт: {lawyer.experience} лет
          </Typography>
        </Box>

        {/* Location */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary">
            {lawyer.region}
          </Typography>
        </Box>

        {/* Price */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            bgcolor: 'secondary.light',
            p: 1.5,
            borderRadius: 1,
            mt: 2,
          }}
        >
          <AttachMoney sx={{ fontSize: 20, color: 'white' }} />
          <Typography variant="h6" fontWeight="bold" color="white">
            {lawyer.priceFrom.toLocaleString()} сум/час
          </Typography>
        </Box>

        {/* Stats */}
        <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" fontWeight="bold" color="primary">
              {lawyer.completedConsultations}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Консультаций
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" fontWeight="bold" color="secondary">
              {lawyer.responseTime}ч
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Отклик
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" fontWeight="bold" color="success.main">
              {lawyer.successRate}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Успешность
            </Typography>
          </Box>
        </Box>
      </CardContent>

      <CardActions sx={{ p: 2, pt: 0 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<VideoCall />}
          onClick={(e) => {
            e.stopPropagation();
            onBook(lawyer);
          }}
          sx={{
            py: 1.5,
            fontWeight: 'bold',
            background: 'linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #0f2342 0%, #1a365d 100%)',
            },
          }}
        >
          Забронировать консультацию
        </Button>
      </CardActions>
    </Card>
  );
};

export default LawyerCard;
