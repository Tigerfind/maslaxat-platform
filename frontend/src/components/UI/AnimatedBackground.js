import React from 'react';
import { Box, keyframes } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Background Component
 * Elegant, minimalist animated background with gold accents
 */

const float = keyframes`
  0%, 100% {
    transform: translateY(0px);
    opacity: 0.3;
  }
  50% {
    transform: translateY(-30px);
    opacity: 0.5;
  }
`;

const drift = keyframes`
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(50px, -25px);
  }
  50% {
    transform: translate(25px, -50px);
  }
  75% {
    transform: translate(-25px, -25px);
  }
  100% {
    transform: translate(0, 0);
  }
`;

const shimmer = keyframes`
  0% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.5;
  }
  100% {
    opacity: 0.3;
  }
`;

const AnimatedBackground = ({ variant = 'default' }) => {
  if (variant === 'none') return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        backgroundColor: axelionColors.bgCream,
      }}
    >
      {/* Subtle gradient overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `linear-gradient(135deg, ${axelionColors.bgCream} 0%, ${axelionColors.bgWarm} 50%, ${axelionColors.bgCream} 100%)`,
        }}
      />

      {/* Elegant gold accent circle - top left */}
      <Box
        sx={{
          position: 'absolute',
          top: '-5%',
          left: '-5%',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(184, 149, 110, 0.08) 0%, transparent 70%)`,
          animation: `${float} 25s ease-in-out infinite`,
          filter: 'blur(60px)',
        }}
      />

      {/* Elegant bronze accent circle - bottom right */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '-10%',
          right: '-5%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(139, 115, 85, 0.06) 0%, transparent 70%)`,
          animation: `${float} 30s ease-in-out infinite`,
          animationDelay: '5s',
          filter: 'blur(60px)',
        }}
      />

      {/* Center subtle accent */}
      <Box
        sx={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(212, 197, 181, 0.1) 0%, transparent 60%)`,
          animation: `${shimmer} 20s ease-in-out infinite`,
          filter: 'blur(80px)',
        }}
      />

      {/* Minimal floating particles - gold tones */}
      {[...Array(8)].map((_, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            top: `${15 + (i * 10)}%`,
            left: `${10 + (i * 12)}%`,
            width: `${4 + (i % 3)}px`,
            height: `${4 + (i % 3)}px`,
            borderRadius: '50%',
            backgroundColor: i % 2 === 0
              ? 'rgba(184, 149, 110, 0.2)'
              : 'rgba(139, 115, 85, 0.15)',
            animation: `${drift} ${25 + (i * 3)}s ease-in-out infinite`,
            animationDelay: `${i * 2}s`,
          }}
        />
      ))}

      {/* Subtle grid pattern */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
            linear-gradient(rgba(184, 149, 110, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(184, 149, 110, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          opacity: 0.5,
        }}
      />

      {/* Decorative corner elements */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '150px',
          height: '150px',
          borderTop: `1px solid rgba(184, 149, 110, 0.1)`,
          borderRight: `1px solid rgba(184, 149, 110, 0.1)`,
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '150px',
          height: '150px',
          borderBottom: `1px solid rgba(184, 149, 110, 0.1)`,
          borderLeft: `1px solid rgba(184, 149, 110, 0.1)`,
        }}
      />

      {/* Vertical decorative line */}
      <Box
        sx={{
          position: 'absolute',
          top: '15%',
          right: '8%',
          width: '1px',
          height: '200px',
          background: `linear-gradient(180deg, transparent 0%, rgba(184, 149, 110, 0.15) 50%, transparent 100%)`,
        }}
      />

      {/* Horizontal decorative line */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '20%',
          left: '5%',
          width: '150px',
          height: '1px',
          background: `linear-gradient(90deg, transparent 0%, rgba(139, 115, 85, 0.15) 50%, transparent 100%)`,
        }}
      />
    </Box>
  );
};

export default AnimatedBackground;
