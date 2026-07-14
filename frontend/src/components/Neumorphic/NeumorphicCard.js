import React from 'react';
import { Box } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Card Component (Neumorphic variant)
 * Now uses the elegant minimalist AXELION-inspired design
 */
const NeumorphicCard = ({
  children,
  sx = {},
  variant = 'default',
  onClick,
  hover = false,
  accentBorder = false,
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: '0 4px 16px rgba(26, 26, 26, 0.06)',
        };
      case 'pressed':
        return {
          backgroundColor: axelionColors.bgWarm,
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: 'inset 0 2px 4px rgba(26, 26, 26, 0.06)',
        };
      case 'flat':
        return {
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: 'none',
        };
      case 'cream':
        return {
          backgroundColor: axelionColors.bgCream,
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        };
      case 'dark':
        return {
          backgroundColor: axelionColors.bgDarkCard,
          border: `1px solid ${axelionColors.borderDark}`,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
          color: axelionColors.textLight,
        };
      default:
        return {
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        };
    }
  };

  const accentBorderStyles = accentBorder ? {
    borderLeft: `3px solid ${axelionColors.gold}`,
    borderRadius: '0 8px 8px 0',
  } : {};

  return (
    <Box
      onClick={onClick}
      sx={{
        borderRadius: '8px',
        padding: '24px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: onClick ? 'pointer' : 'default',
        ...getVariantStyles(),
        ...accentBorderStyles,
        ...(hover && {
          '&:hover': {
            boxShadow: '0 8px 24px rgba(26, 26, 26, 0.08)',
            borderColor: axelionColors.gold,
            transform: 'translateY(-2px)',
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

export default NeumorphicCard;
