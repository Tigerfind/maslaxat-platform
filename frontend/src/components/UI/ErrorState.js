import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { ErrorOutline, Refresh } from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

/**
 * Состояние «данные не загрузились».
 *
 * Намеренно отличается от EmptyState: «список пуст» и «запрос упал» — разные
 * факты, и раньше админка показывала их одинаково («Пользователей пока нет»
 * при лежащем бэкенде). Здесь всегда есть кнопка повтора.
 *
 * @param {Error}    error   ошибка запроса (для текста от бэкенда)
 * @param {Function} onRetry повторить загрузку
 */
const ErrorState = ({ error, onRetry, title, subtitle }) => {
  const { t } = useTranslation();

  // Сообщение бэкенда информативнее общего текста — показываем его, если есть.
  const serverMessage = error?.response?.data?.error;
  const status = error?.response?.status;

  return (
    <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: axelionColors.errorLight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto',
          mb: 3,
          color: axelionColors.error,
        }}
      >
        <ErrorOutline sx={{ fontSize: 36 }} />
      </Box>

      <Typography variant="h6" sx={{ fontWeight: 400, color: axelionColors.textDark, mb: 1, letterSpacing: '0.02em' }}>
        {title || t('common.loadFailed')}
      </Typography>

      <Typography variant="body2" sx={{ color: axelionColors.textMuted, mb: 3, maxWidth: 420, mx: 'auto' }}>
        {subtitle || serverMessage || t('common.loadFailedHint')}
        {status ? ` (HTTP ${status})` : ''}
      </Typography>

      {onRetry && (
        <Button variant="outlined" startIcon={<Refresh />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </Box>
  );
};

export default ErrorState;
