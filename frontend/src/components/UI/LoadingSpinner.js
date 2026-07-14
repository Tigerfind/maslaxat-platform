import React from 'react';
import { Box, keyframes } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Loading Spinner
 * Elegant, minimalist loading animation with gold accent
 */

const rotate = keyframes`
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
`;

const LoadingSpinner = ({ size = 'medium', fullScreen = false }) => {
  const sizeMap = {
    small: { outer: 24, inner: 20, border: 2 },
    medium: { outer: 40, inner: 34, border: 2 },
    large: { outer: 56, inner: 48, border: 3 },
  };

  const dimensions = sizeMap[size] || sizeMap.medium;

  const spinner = (
    <Box
      sx={{
        position: 'relative',
        width: dimensions.outer,
        height: dimensions.outer,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Outer rotating ring */}
      <Box
        sx={{
          position: 'absolute',
          width: dimensions.outer,
          height: dimensions.outer,
          borderRadius: '50%',
          border: `${dimensions.border}px solid ${axelionColors.borderLight}`,
          borderTopColor: axelionColors.gold,
          animation: `${rotate} 1s linear infinite`,
        }}
      />

      {/* Inner pulsing dot */}
      <Box
        sx={{
          width: dimensions.border * 3,
          height: dimensions.border * 3,
          borderRadius: '50%',
          backgroundColor: axelionColors.gold,
          animation: `${pulse} 1.5s ease-in-out infinite`,
        }}
      />
    </Box>
  );

  if (fullScreen) {
    return (
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: axelionColors.bgCream,
          zIndex: 9999,
          gap: 3,
        }}
      >
        {spinner}
        <Box
          sx={{
            fontFamily: '"Inter", sans-serif',
            fontSize: '0.75rem',
            fontWeight: 300,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: axelionColors.textMuted,
          }}
        >
          Loading
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
      }}
    >
      {spinner}
    </Box>
  );
};

export default LoadingSpinner;
