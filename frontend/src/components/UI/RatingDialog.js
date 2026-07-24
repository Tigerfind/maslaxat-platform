import React, { useState } from 'react';
import {
  Dialog,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Rating,
} from '@mui/material';
import { Close, Star } from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

const RatingDialog = ({ open, onClose, onSubmit, lawyerName }) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reactions = ['', t('rating.r1'), t('rating.r2'), t('rating.r3'), t('rating.r4'), t('rating.r5')];

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
          borderRadius: '20px',
          overflow: 'hidden',
          background: axelionColors.bgLight,
          boxShadow: '0 20px 60px rgba(26, 26, 26, 0.22)',
        },
      }}
    >
      {/* Gradient header with overlapping lawyer avatar */}
      <Box
        sx={{
          position: 'relative',
          background: 'linear-gradient(135deg, #C9A36E 0%, #9A7B52 100%)',
          px: 3.5,
          pt: 3.25,
          pb: 5.5,
        }}
      >
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', top: 12, right: 12, color: 'rgba(255,255,255,0.85)', '&:hover': { color: '#FFFFFF' } }}
        >
          <Close fontSize="small" />
        </IconButton>

        <Typography sx={{ color: '#FFFFFF', fontSize: '1.2rem', fontWeight: 600, letterSpacing: '0.01em' }}>
          {t('rating.title')}
        </Typography>
        {lawyerName && (
          <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.85rem', mt: 0.4 }}>
            {t('rating.rateWith', { name: lawyerName })}
          </Typography>
        )}

        <Box
          sx={{
            position: 'absolute',
            left: 28,
            bottom: -26,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6A8A9A, #4A6A7A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontSize: '1.05rem',
            fontWeight: 500,
            border: `4px solid ${axelionColors.bgLight}`,
            boxShadow: '0 4px 12px rgba(26,26,26,0.14)',
          }}
        >
          {initialsOf(lawyerName)}
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ px: 3.5, pt: 4.75, pb: 3 }}>
        <Rating
          value={rating}
          onChange={(e, val) => setRating(val)}
          size="large"
          icon={<Star sx={{ fontSize: 40, color: axelionColors.gold }} />}
          emptyIcon={<Star sx={{ fontSize: 40, color: axelionColors.borderLight }} />}
        />
        <Typography sx={{ mt: 1, minHeight: 20, color: axelionColors.textMuted, fontWeight: 500, fontSize: '0.9rem' }}>
          {reactions[rating] || t('rating.tapStar')}
        </Typography>

        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder={t('rating.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          sx={{
            mt: 2.5,
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              '& fieldset': { borderColor: axelionColors.borderLight },
              '&:hover fieldset': { borderColor: axelionColors.gold },
              '&.Mui-focused fieldset': { borderColor: axelionColors.gold },
            },
          }}
        />

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, mt: 3 }}>
          <Button onClick={onClose} sx={{ color: axelionColors.textMuted, textTransform: 'none' }}>
            {t('rating.skip')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={rating === 0 || submitting}
            sx={{
              background: `linear-gradient(135deg, ${axelionColors.gold}, ${axelionColors.bronze})`,
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              px: 3.5,
              py: 1.25,
              borderRadius: '12px',
              boxShadow: '0 6px 18px rgba(184, 149, 110, 0.3)',
              '&:hover': { boxShadow: '0 9px 24px rgba(184, 149, 110, 0.42)' },
              '&.Mui-disabled': { background: axelionColors.borderLight, color: axelionColors.textMuted, boxShadow: 'none' },
            }}
          >
            {submitting ? t('rating.sending') : t('rating.submit')}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default RatingDialog;
