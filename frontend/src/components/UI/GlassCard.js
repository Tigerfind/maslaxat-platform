import React from 'react';
import { Card, keyframes } from '@mui/material';

const shimmer = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

const glow = keyframes`
  0%, 100% {
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.1),
                0 0 40px rgba(236, 72, 153, 0.1);
  }
  50% {
    box-shadow: 0 0 30px rgba(99, 102, 241, 0.2),
                0 0 60px rgba(236, 72, 153, 0.2);
  }
`;

const GlassCard = ({
  children,
  sx = {},
  hover = true,
  glow: glowEffect = false,
  shimmer: shimmerEffect = false,
  ...props
}) => {
  return (
    <Card
      {...props}
      sx={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        ...(hover && {
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 12px 40px rgba(99, 102, 241, 0.2)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
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
            background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)',
            animation: `${shimmer} 3s infinite`,
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
