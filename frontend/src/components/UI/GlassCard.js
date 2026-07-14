import React from 'react';
import { Card, keyframes } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Card Component (UI variant)
 * Elegant, minimalist card with subtle animations
 */

const shimmer = keyframes`
  0% {
    background-position: -500px 0;
  }
  100% {
    background-position: 500px 0;
  }
`;

const glow = keyframes`
  0%, 100% {
    box-shadow: 0 2px 8px rgba(26, 26, 26, 0.04);
  }
  50% {
    box-shadow: 0 4px 16px rgba(184, 149, 110, 0.12);
  }
`;

const GlassCard = ({
  children,
  sx = {},
  hover = true,
  glow: glowEffect = false,
  shimmer: shimmerEffect = false,
  accentBorder = false,
  variant = 'default',
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: axelionColors.bgLight,
          boxShadow: '0 4px 16px rgba(26, 26, 26, 0.06)',
        };
      case 'cream':
        return {
          backgroundColor: axelionColors.bgCream,
          boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        };
      case 'dark':
        return {
          backgroundColor: axelionColors.bgDarkCard,
          color: axelionColors.textLight,
          border: `1px solid ${axelionColors.borderDark}`,
        };
      default:
        return {
          backgroundColor: axelionColors.bgLight,
          boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        };
    }
  };

  return (
    <Card
      {...props}
      sx={{
        border: `1px solid ${axelionColors.borderLight}`,
        borderRadius: '8px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        ...getVariantStyles(),
        ...(accentBorder && {
          borderLeft: `3px solid ${axelionColors.gold}`,
          borderRadius: '0 8px 8px 0',
        }),
        ...(hover && {
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 24px rgba(26, 26, 26, 0.08)',
            borderColor: axelionColors.gold,
          },
        }),
        ...(glowEffect && {
          animation: `${glow} 3s ease-in-out infinite`,
        }),
        ...(shimmerEffect && {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: '-100%',
            width: '100%',
            height: '100%',
            background: `linear-gradient(90deg, transparent, rgba(184, 149, 110, 0.1), transparent)`,
            animation: `${shimmer} 2s infinite`,
            pointerEvents: 'none',
          },
        }),
        ...sx,
      }}
    >
      {children}
    </Card>
  );
};

export default GlassCard;
