import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  Avatar,
  Rating,
} from '@mui/material';
import { Close, PlayArrow } from '@mui/icons-material';

const VideoIntroModal = ({ open, onClose, lawyer }) => {
  if (!lawyer) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle sx={{ p: 0, position: 'relative' }}>
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            bgcolor: 'rgba(0,0,0,0.5)',
            color: 'white',
            zIndex: 2,
            '&:hover': {
              bgcolor: 'rgba(0,0,0,0.7)',
            },
          }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Video Player */}
        <Box
          sx={{
            position: 'relative',
            paddingTop: '56.25%', // 16:9
            bgcolor: 'black',
            backgroundImage: lawyer.thumbnail
              ? `url(${lawyer.thumbnail})`
              : 'linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {lawyer.videoUrl ? (
            <video
              controls
              autoPlay
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
              }}
            >
              <source src={lawyer.videoUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          ) : (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                color: 'white',
              }}
            >
              <PlayArrow sx={{ fontSize: 80, mb: 2, opacity: 0.5 }} />
              <Typography variant="h6">Видео временно недоступно</Typography>
            </Box>
          )}
        </Box>

        {/* Lawyer Info */}
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
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
              {lawyer.name?.charAt(0)}
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" fontWeight="bold">
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

          <Typography variant="body2" color="text.secondary" paragraph>
            {lawyer.bio || 'Опытный юрист с многолетним стажем работы в области права.'}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Опыт
              </Typography>
              <Typography variant="body1" fontWeight="bold">
                {lawyer.experience} лет
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Консультаций
              </Typography>
              <Typography variant="body1" fontWeight="bold">
                {lawyer.completedConsultations}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Успешность
              </Typography>
              <Typography variant="body1" fontWeight="bold" color="success.main">
                {lawyer.successRate}%
              </Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={onClose} variant="outlined">
          Закрыть
        </Button>
        <Button
          variant="contained"
          sx={{
            background: 'linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #0f2342 0%, #1a365d 100%)',
            },
          }}
        >
          Забронировать консультацию
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VideoIntroModal;
