import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Rating,
} from '@mui/material';
import { Close, Star } from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';

const RatingDialog = ({ open, onClose, onSubmit, lawyerName }) => {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      await onSubmit({ rating, text });
      setRating(0);
      setText('');
      onClose();
    } catch {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: '0 16px 48px rgba(26, 26, 26, 0.12)',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 1,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 400, color: axelionColors.textDark }}>
          Как прошла консультация?
        </Typography>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {lawyerName && (
          <Typography variant="body2" sx={{ color: axelionColors.textMuted, mb: 3 }}>
            Оцените консультацию с юристом {lawyerName}
          </Typography>
        )}

        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Rating
            value={rating}
            onChange={(e, val) => setRating(val)}
            size="large"
            icon={<Star sx={{ fontSize: 48, color: axelionColors.gold }} />}
            emptyIcon={<Star sx={{ fontSize: 48, color: axelionColors.borderLight }} />}
          />
          <Typography variant="body2" sx={{ mt: 1, color: axelionColors.textMuted }}>
            {rating === 0 && 'Нажмите на звезду'}
            {rating === 1 && 'Плохо'}
            {rating === 2 && 'Ниже ожиданий'}
            {rating === 3 && 'Нормально'}
            {rating === 4 && 'Хорошо'}
            {rating === 5 && 'Отлично!'}
          </Typography>
        </Box>

        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="Расскажите подробнее о вашем опыте (необязательно)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              '& fieldset': { borderColor: axelionColors.borderLight },
              '&:hover fieldset': { borderColor: axelionColors.gold },
              '&.Mui-focused fieldset': { borderColor: axelionColors.gold },
            },
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onClose}
          sx={{ color: axelionColors.textMuted, textTransform: 'none' }}
        >
          Пропустить
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          sx={{
            background: axelionColors.gold,
            color: 'white',
            textTransform: 'none',
            fontWeight: 500,
            px: 4,
            borderRadius: '8px',
            boxShadow: 'none',
            '&:hover': { background: axelionColors.bronze, boxShadow: 'none' },
            '&.Mui-disabled': { bgcolor: axelionColors.borderLight },
          }}
        >
          {submitting ? 'Отправка...' : 'Отправить отзыв'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RatingDialog;
