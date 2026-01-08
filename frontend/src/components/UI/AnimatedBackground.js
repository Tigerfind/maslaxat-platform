import React from 'react';
import { Box, keyframes } from '@mui/material';

const float = keyframes`
  0%, 100% {
    transform: translateY(0px) rotate(0deg);
  }
  50% {
    transform: translateY(-20px) rotate(180deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
`;

const drift = keyframes`
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(100px, -50px);
  }
  50% {
    transform: translate(50px, -100px);
  }
  75% {
    transform: translate(-50px, -50px);
  }
  100% {
    transform: translate(0, 0);
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
      }}
    >
      {/* Gradient Background */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.05) 50%, rgba(236, 72, 153, 0.05) 100%)',
        }}
      />

      {/* Animated Circles */}
      <Box
        sx={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '300px',
          height: '300px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
          animation: `${float} 20s ease-in-out infinite`,
          filter: 'blur(40px)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          top: '60%',
          right: '15%',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(236, 72, 153, 0.15) 0%, transparent 70%)',
          animation: `${float} 25s ease-in-out infinite`,
          animationDelay: '5s',
          filter: 'blur(40px)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          bottom: '10%',
          left: '50%',
          width: '350px',
          height: '350px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
          animation: `${float} 30s ease-in-out infinite`,
          animationDelay: '10s',
          filter: 'blur(40px)',
        }}
      />

      {/* Floating Particles */}
      {[...Array(15)].map((_, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 10 + 5}px`,
            height: `${Math.random() * 10 + 5}px`,
            borderRadius: '50%',
            background: `rgba(${Math.random() > 0.5 ? '99, 102, 241' : '236, 72, 153'}, ${Math.random() * 0.3 + 0.1})`,
            animation: `${drift} ${Math.random() * 20 + 15}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 5}s`,
          }}
        />
      ))}

      {/* Grid Pattern */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          opacity: 0.5,
        }}
      />
    </Box>
  );
};

export default AnimatedBackground;
