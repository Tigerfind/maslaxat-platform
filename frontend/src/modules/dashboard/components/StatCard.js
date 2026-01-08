/**
 * Dashboard Module - StatCard Component
 * Reusable statistics card
 */

import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const StatCard = ({
  title,
  value,
  subtitle,
  icon,
  color = '#3d5a52',
  bgColor,
  trend,
  onClick,
}) => {
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 3,
        borderRadius: 3,
        background: bgColor || `linear-gradient(135deg, ${color}15 0%, ${color}05 100%)`,
        border: `1px solid ${color}20`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        '&:hover': onClick
          ? {
              transform: 'translateY(-4px)',
              boxShadow: `0 8px 24px ${color}20`,
            }
          : {},
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography
            variant="h3"
            fontWeight="bold"
            sx={{ color: color, mb: 0.5 }}
          >
            {value}
          </Typography>
          <Typography variant="subtitle1" fontWeight="medium" color="text.primary">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
          {trend && (
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  color: trend.positive ? 'success.main' : 'error.main',
                  fontWeight: 'medium',
                }}
              >
                {trend.positive ? '+' : ''}{trend.value}%
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {trend.label}
              </Typography>
            </Box>
          )}
        </Box>
        {icon && (
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: `${color}20`,
              color: color,
            }}
          >
            {icon}
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default StatCard;
