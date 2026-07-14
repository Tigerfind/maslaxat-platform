import React from 'react';
import { Button } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Button Component
 * Elegant, minimalist design with gold accents
 */
const GlassButton = ({
  children,
  variant = 'primary',
  color = 'gold',
  fullWidth = false,
  startIcon,
  endIcon,
  onClick,
  disabled = false,
  size = 'medium',
  sx = {},
  ...props
}) => {
  const colorStyles = {
    gold: {
      primary: {
        backgroundColor: axelionColors.gold,
        color: '#FFFFFF',
        border: 'none',
        '&:hover': {
          backgroundColor: axelionColors.goldDark,
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.gold,
        border: `1px solid ${axelionColors.gold}`,
        '&:hover': {
          backgroundColor: axelionColors.accentLight,
          borderColor: axelionColors.goldDark,
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.gold,
        border: 'none',
        '&:hover': {
          backgroundColor: axelionColors.accentLight,
        },
      },
    },
    dark: {
      primary: {
        backgroundColor: axelionColors.textDark,
        color: '#FFFFFF',
        border: 'none',
        '&:hover': {
          backgroundColor: '#2D2D2D',
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.textDark,
        border: `1px solid ${axelionColors.textDark}`,
        '&:hover': {
          backgroundColor: 'rgba(26, 26, 26, 0.05)',
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.textDark,
        border: 'none',
        '&:hover': {
          backgroundColor: 'rgba(26, 26, 26, 0.05)',
        },
      },
    },
    bronze: {
      primary: {
        backgroundColor: axelionColors.bronze,
        color: '#FFFFFF',
        border: 'none',
        '&:hover': {
          backgroundColor: axelionColors.bronzeDark,
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.bronze,
        border: `1px solid ${axelionColors.bronze}`,
        '&:hover': {
          backgroundColor: 'rgba(139, 115, 85, 0.1)',
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.bronze,
        border: 'none',
        '&:hover': {
          backgroundColor: 'rgba(139, 115, 85, 0.1)',
        },
      },
    },
    light: {
      primary: {
        backgroundColor: axelionColors.bgLight,
        color: axelionColors.textDark,
        border: `1px solid ${axelionColors.borderLight}`,
        '&:hover': {
          backgroundColor: axelionColors.bgWarm,
          borderColor: axelionColors.gold,
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.textSecondary,
        border: `1px solid ${axelionColors.borderLight}`,
        '&:hover': {
          borderColor: axelionColors.gold,
          color: axelionColors.gold,
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.textSecondary,
        border: 'none',
        '&:hover': {
          color: axelionColors.gold,
          backgroundColor: axelionColors.bgWarm,
        },
      },
    },
    success: {
      primary: {
        backgroundColor: axelionColors.success,
        color: '#FFFFFF',
        border: 'none',
        '&:hover': {
          backgroundColor: '#6A8A5B',
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.success,
        border: `1px solid ${axelionColors.success}`,
        '&:hover': {
          backgroundColor: axelionColors.successLight,
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.success,
        border: 'none',
        '&:hover': {
          backgroundColor: axelionColors.successLight,
        },
      },
    },
    error: {
      primary: {
        backgroundColor: axelionColors.error,
        color: '#FFFFFF',
        border: 'none',
        '&:hover': {
          backgroundColor: '#9A5A5A',
        },
      },
      outlined: {
        backgroundColor: 'transparent',
        color: axelionColors.error,
        border: `1px solid ${axelionColors.error}`,
        '&:hover': {
          backgroundColor: axelionColors.errorLight,
        },
      },
      text: {
        backgroundColor: 'transparent',
        color: axelionColors.error,
        border: 'none',
        '&:hover': {
          backgroundColor: axelionColors.errorLight,
        },
      },
    },
  };

  const sizeMap = {
    small: { padding: '8px 20px', fontSize: '0.75rem' },
    medium: { padding: '12px 32px', fontSize: '0.875rem' },
    large: { padding: '14px 40px', fontSize: '0.9375rem' },
  };

  const selectedColorStyles = colorStyles[color] || colorStyles.gold;
  const selectedVariantStyles = selectedColorStyles[variant] || selectedColorStyles.primary;
  const selectedSize = sizeMap[size] || sizeMap.medium;

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      fullWidth={fullWidth}
      startIcon={startIcon}
      endIcon={endIcon}
      sx={{
        borderRadius: '8px',
        textTransform: 'uppercase',
        fontWeight: 500,
        letterSpacing: '0.1em',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: 'none',
        ...selectedSize,
        ...selectedVariantStyles,
        '&:active': {
          transform: 'translateY(1px)',
        },
        '&.Mui-disabled': {
          backgroundColor: axelionColors.bgBeige,
          color: axelionColors.textMuted,
          border: 'none',
        },
        ...sx,
      }}
      {...props}
    >
      {children}
    </Button>
  );
};

export default GlassButton;
