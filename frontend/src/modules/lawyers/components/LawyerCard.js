/**
 * Lawyers Module - LawyerCard Component
 * Card displaying lawyer summary
 */

import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Avatar,
  Chip,
  Rating,
  Button,
  IconButton,
} from '@mui/material';
import {
  Verified,
  Star,
  Schedule,
  Bookmark,
  BookmarkBorder,
} from '@mui/icons-material';

const LawyerCard = ({
  lawyer,
  onView,
  onBook,
  onSave,
  isSaved = false,
}) => {
  const {
    name,
    specializations,
    rating,
    reviewsCount,
    experience,
    price,
    avatar,
    verified,
    available,
  } = lawyer;

  return (
    <Card
      sx={{
        borderRadius: 3,
        transition: 'all 0.3s ease',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 12px 24px rgba(0,0,0,0.1)',
        },
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Avatar
            src={avatar}
            sx={{
              width: 64,
              height: 64,
              bgcolor: '#3d5a52',
              fontSize: '1.5rem',
            }}
          >
            {name.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" fontWeight="bold">
                {name}
              </Typography>
              {verified && (
                <Verified sx={{ color: '#3d5a52', fontSize: 20 }} />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Rating value={rating} precision={0.1} size="small" readOnly />
              <Typography variant="body2" color="text.secondary">
                {rating} ({reviewsCount} отзывов)
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => onSave?.(lawyer.id)}>
            {isSaved ? (
              <Bookmark sx={{ color: '#a67c52' }} />
            ) : (
              <BookmarkBorder />
            )}
          </IconButton>
        </Box>

        {/* Specializations */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
          {specializations.map((spec, idx) => (
            <Chip
              key={idx}
              label={spec}
              size="small"
              sx={{
                bgcolor: '#3d5a5215',
                color: '#3d5a52',
                fontWeight: 500,
              }}
            />
          ))}
        </Box>

        {/* Info */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              Опыт: {experience} лет
            </Typography>
          </Box>
          <Typography variant="h6" fontWeight="bold" color="#a67c52">
            {price.toLocaleString()} сум
          </Typography>
        </Box>

        {/* Status & Actions */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            onClick={() => onView?.(lawyer.id)}
            sx={{
              borderColor: '#3d5a52',
              color: '#3d5a52',
              '&:hover': {
                borderColor: '#3d5a52',
                bgcolor: '#3d5a5210',
              },
            }}
          >
            Подробнее
          </Button>
          <Button
            fullWidth
            variant="contained"
            disabled={!available}
            onClick={() => onBook?.(lawyer.id)}
            sx={{
              bgcolor: '#3d5a52',
              '&:hover': { bgcolor: '#2d4a42' },
              '&.Mui-disabled': {
                bgcolor: '#ccc',
              },
            }}
          >
            {available ? 'Записаться' : 'Занят'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

export default LawyerCard;
