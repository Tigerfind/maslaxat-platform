import React from 'react';
import { Box } from '@mui/material';

const NeumorphicCard = ({
  children,
  sx = {},
  variant = 'elevated',
  onClick,
  hover = false,
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'elevated':
        return {
          boxShadow: '10px 10px 20px rgba(163, 177, 198, 0.6), -10px -10px 20px rgba(255, 255, 255, 0.5)',
          '&:hover': hover ? {
            boxShadow: '14px 14px 28px rgba(163, 177, 198, 0.6), -14px -14px 28px rgba(255, 255, 255, 0.5)',
            transform: 'translateY(-2px)',
          } : {},
        };
      case 'pressed':
        return {
          boxShadow: 'inset 6px 6px 12px rgba(163, 177, 198, 0.6), inset -6px -6px 12px rgba(255, 255, 255, 0.5)',
        };
      case 'flat':
        return {
          boxShadow: '4px 4px 8px rgba(163, 177, 198, 0.4), -4px -4px 8px rgba(255, 255, 255, 0.5)',
        };
      default:
        return {};
    }
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        background: '#e4e9f2',
        borderRadius: '20px',
        padding: '24px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: onClick ? 'pointer' : 'default',
        ...getVariantStyles(),
        ...sx,
      }}
      {...props}
    >
      {children}
    </Box>
  );
};

export default NeumorphicCard;
