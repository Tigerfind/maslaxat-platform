import React from 'react';
import { Box } from '@mui/material';

const GlassCard = ({
  children,
  variant = 'default',
  hover = false,
  onClick,
  sx = {},
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'strong':
        return {
          background: 'rgba(255, 255, 255, 0.25)',
          backdropFilter: 'blur(15px)',
          WebkitBackdropFilter: 'blur(15px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.25)',
        };
      case 'subtle':
        return {
          background: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 16px 0 rgba(31, 38, 135, 0.1)',
        };
      case 'dark':
        return {
          background: 'rgba(0, 0, 0, 0.2)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
        };
      default:
        return {
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
        };
    }
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        borderRadius: '16px',
        padding: '24px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: onClick ? 'pointer' : 'default',
        ...getVariantStyles(),
        ...(hover && {
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 12px 40px 0 rgba(31, 38, 135, 0.25)',
            background: variant === 'dark'
              ? 'rgba(0, 0, 0, 0.3)'
              : 'rgba(255, 255, 255, 0.22)',
          },
        }),
        ...sx,
      }}
      {...props}
    >
      {children}
    </Box>
  );
};

export default GlassCard;
