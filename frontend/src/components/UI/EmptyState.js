import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

const EmptyState = ({ icon, title, subtitle, actionLabel, onAction }) => (
  <Box
    sx={{
      textAlign: 'center',
      py: 8,
      px: 3,
    }}
  >
    {icon && (
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: axelionColors.bgWarm,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto',
          mb: 3,
          color: axelionColors.textMuted,
        }}
      >
        {React.cloneElement(icon, { sx: { fontSize: 36 } })}
      </Box>
    )}
    <Typography
      variant="h6"
      sx={{
        fontWeight: 400,
        color: axelionColors.textDark,
        mb: 1,
        letterSpacing: '0.02em',
      }}
    >
      {title}
    </Typography>
    {subtitle && (
      <Typography
        variant="body2"
        sx={{ color: axelionColors.textMuted, mb: actionLabel ? 3 : 0, maxWidth: 400, mx: 'auto' }}
      >
        {subtitle}
      </Typography>
    )}
    {actionLabel && onAction && (
      <Button
        variant="contained"
        onClick={onAction}
        sx={{
          background: axelionColors.gold,
          color: 'white',
          textTransform: 'none',
          fontWeight: 500,
          px: 4,
          py: 1.2,
          borderRadius: '8px',
          boxShadow: 'none',
          '&:hover': {
            background: axelionColors.bronze,
            boxShadow: 'none',
          },
        }}
      >
        {actionLabel}
      </Button>
    )}
  </Box>
);

export default EmptyState;
