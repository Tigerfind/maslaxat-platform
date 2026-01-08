/**
 * Dashboard Module - QuickActionCard Component
 * Card for quick navigation actions
 */

import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { ArrowForward } from '@mui/icons-material';

const QuickActionCard = ({
  title,
  description,
  icon,
  color = '#3d5a52',
  onClick,
}) => {
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 3,
        borderRadius: 3,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: `0 12px 24px ${color}20`,
          borderColor: color,
          '& .arrow-icon': {
            transform: 'translateX(4px)',
            opacity: 1,
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: `${color}15`,
            color: color,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <ArrowForward
          className="arrow-icon"
          sx={{
            color: color,
            opacity: 0.5,
            transition: 'all 0.3s ease',
          }}
        />
      </Box>
    </Paper>
  );
};

export default QuickActionCard;
