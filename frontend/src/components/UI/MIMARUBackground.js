import React from 'react';
import { Box } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * MaslaXat Premium Background Component
 * Elegant minimalist background inspired by luxury brand aesthetics
 */
const MIMARUBackground = () => {
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
      {/* Subtle texture overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
            linear-gradient(90deg, rgba(184, 149, 110, 0.015) 1px, transparent 1px),
            linear-gradient(rgba(184, 149, 110, 0.015) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Top gradient accent */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '400px',
          background: `linear-gradient(180deg, rgba(184, 149, 110, 0.03) 0%, transparent 100%)`,
        }}
      />

      {/* Decorative vertical line - right */}
      <Box
        sx={{
          position: 'absolute',
          top: '15%',
          right: '6%',
          width: '1px',
          height: '250px',
          backgroundColor: 'rgba(184, 149, 110, 0.1)',
        }}
      />

      {/* Decorative horizontal line - left */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '25%',
          left: '5%',
          width: '180px',
          height: '1px',
          backgroundColor: 'rgba(139, 115, 85, 0.1)',
        }}
      />

      {/* Corner accent - top right */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '120px',
          height: '120px',
          borderTop: `2px solid rgba(184, 149, 110, 0.08)`,
          borderRight: `2px solid rgba(184, 149, 110, 0.08)`,
        }}
      />

      {/* Corner accent - bottom left */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '120px',
          height: '120px',
          borderBottom: `2px solid rgba(139, 115, 85, 0.08)`,
          borderLeft: `2px solid rgba(139, 115, 85, 0.08)`,
        }}
      />

      {/* Subtle gold circle accent */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '800px',
          height: '800px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(184, 149, 110, 0.03) 0%, transparent 50%)',
          filter: 'blur(100px)',
        }}
      />

      {/* Small decorative element - top left */}
      <Box
        sx={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: 'rgba(184, 149, 110, 0.15)',
        }}
      />

      {/* Small decorative element - bottom right */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '15%',
          right: '12%',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: 'rgba(139, 115, 85, 0.12)',
        }}
      />
    </Box>
  );
};

export default MIMARUBackground;
