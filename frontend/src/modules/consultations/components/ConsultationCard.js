/**
 * Consultations Module - ConsultationCard Component
 * Card displaying consultation summary
 */

import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Avatar,
  Chip,
  Button,
  Rating,
} from '@mui/material';
import {
  VideoCall,
  Chat,
  AccessTime,
  CalendarToday,
  Cancel,
} from '@mui/icons-material';

const statusConfig = {
  upcoming: { label: 'Предстоящая', color: '#3d5a52', bgColor: '#3d5a5220' },
  completed: { label: 'Завершена', color: '#22c55e', bgColor: '#22c55e20' },
  cancelled: { label: 'Отменена', color: '#ef4444', bgColor: '#ef444420' },
  in_progress: { label: 'В процессе', color: '#f59e0b', bgColor: '#f59e0b20' },
};

const ConsultationCard = ({
  consultation,
  onJoin,
  onCancel,
  onReschedule,
  onReview,
  onView,
}) => {
  const {
    lawyerName,
    lawyerSpecialization,
    date,
    time,
    duration,
    status,
    type,
    price,
    topic,
    rating,
  } = consultation;

  const statusInfo = statusConfig[status] || statusConfig.upcoming;
  const isUpcoming = status === 'upcoming';
  const isCompleted = status === 'completed';

  return (
    <Card
      sx={{
        borderRadius: 3,
        transition: 'all 0.3s ease',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        },
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Avatar
              sx={{
                width: 48,
                height: 48,
                bgcolor: '#3d5a52',
              }}
            >
              {lawyerName?.charAt(0)}
            </Avatar>
            <Box>
              <Typography variant="subtitle1" fontWeight="bold">
                {lawyerName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {lawyerSpecialization}
              </Typography>
            </Box>
          </Box>
          <Chip
            label={statusInfo.label}
            size="small"
            sx={{
              bgcolor: statusInfo.bgColor,
              color: statusInfo.color,
              fontWeight: 600,
            }}
          />
        </Box>

        {/* Topic */}
        {topic && (
          <Typography variant="body2" sx={{ mb: 2, color: 'text.primary' }}>
            {topic}
          </Typography>
        )}

        {/* Info Row */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CalendarToday sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {new Date(date).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
              })}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AccessTime sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {time} ({duration} мин)
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {type === 'video' ? (
              <VideoCall sx={{ fontSize: 18, color: '#3d5a52' }} />
            ) : (
              <Chat sx={{ fontSize: 18, color: '#3d5a52' }} />
            )}
            <Typography variant="body2" color="text.secondary">
              {type === 'video' ? 'Видео' : 'Чат'}
            </Typography>
          </Box>
        </Box>

        {/* Price & Rating */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold" color="#a67c52">
            {price?.toLocaleString()} сум
          </Typography>
          {isCompleted && rating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Rating value={rating} size="small" readOnly />
              <Typography variant="body2" color="text.secondary">
                ({rating})
              </Typography>
            </Box>
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {isUpcoming && (
            <>
              <Button
                fullWidth
                variant="contained"
                startIcon={type === 'video' ? <VideoCall /> : <Chat />}
                onClick={() => onJoin?.(consultation)}
                sx={{
                  bgcolor: '#3d5a52',
                  '&:hover': { bgcolor: '#2d4a42' },
                }}
              >
                {type === 'video' ? 'Присоединиться' : 'Открыть чат'}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => onCancel?.(consultation)}
                sx={{ minWidth: 'auto', px: 2 }}
              >
                <Cancel />
              </Button>
            </>
          )}
          {isCompleted && !rating && (
            <Button
              fullWidth
              variant="outlined"
              onClick={() => onReview?.(consultation)}
              sx={{
                borderColor: '#a67c52',
                color: '#a67c52',
                '&:hover': { borderColor: '#a67c52', bgcolor: '#a67c5210' },
              }}
            >
              Оставить отзыв
            </Button>
          )}
          <Button
            variant="text"
            onClick={() => onView?.(consultation)}
            sx={{ color: 'text.secondary' }}
          >
            Подробнее
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

export default ConsultationCard;
