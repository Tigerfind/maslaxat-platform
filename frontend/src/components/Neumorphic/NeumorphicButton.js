import React from 'react';
import { Button } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Button Component (Neumorphic variant)
 * Now uses the elegant minimalist AXELION-inspired design
 */
const NeumorphicButton = ({
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
  const colorMap = {
    gold: {
      bg: axelionColors.gold,
      hover: axelionColors.goldDark,
      color: '#FFFFFF',
    },
    dark: {
      bg: axelionColors.textDark,
      hover: '#2D2D2D',
      color: '#FFFFFF',
    },
    bronze: {
      bg: axelionColors.bronze,
      hover: axelionColors.bronzeDark,
      color: '#FFFFFF',
    },
    neutral: {
      bg: axelionColors.bgLight,
      hover: axelionColors.bgWarm,
      color: axelionColors.textDark,
      border: `1px solid ${axelionColors.borderLight}`,
    },
    success: {
      bg: axelionColors.success,
      hover: '#6A8A5B',
      color: '#FFFFFF',
    },
    error: {
      bg: axelionColors.error,
      hover: '#9A5A5A',
      color: '#FFFFFF',
    },
  };

  const sizeMap = {
    small: { padding: '8px 20px', fontSize: '0.75rem' },
    medium: { padding: '12px 32px', fontSize: '0.875rem' },
    large: { padding: '14px 40px', fontSize: '0.9375rem' },
  };

  const colorStyle = colorMap[color] || colorMap.gold;
  const selectedSize = sizeMap[size] || sizeMap.medium;

  const getVariantStyles = () => {
    switch (variant) {
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          color: color === 'neutral' ? axelionColors.textDark : colorStyle.bg,
          border: `1px solid ${color === 'neutral' ? axelionColors.borderLight : colorStyle.bg}`,
          '&:hover': {
            backgroundColor: color === 'neutral' ? axelionColors.bgWarm : `${colorStyle.bg}10`,
            borderColor: color === 'neutral' ? axelionColors.gold : colorStyle.hover,
          },
        };
      case 'text':
        return {
          backgroundColor: 'transparent',
          color: color === 'neutral' ? axelionColors.textSecondary : colorStyle.bg,
          border: 'none',
          '&:hover': {
            backgroundColor: color === 'neutral' ? axelionColors.bgWarm : `${colorStyle.bg}10`,
          },
        };
      default:
        return {
          backgroundColor: colorStyle.bg,
          color: colorStyle.color,
          border: colorStyle.border || 'none',
          '&:hover': {
            backgroundColor: colorStyle.hover,
          },
        };
    }
  };

  return (
    <Button
      onClick={onClick}
      fullWidth={fullWidth}
      disabled={disabled}
      startIcon={startIcon}
      endIcon={endIcon}
      sx={{
        borderRadius: '8px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        boxShadow: 'none',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        ...selectedSize,
        ...getVariantStyles(),
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

export default NeumorphicButton;
