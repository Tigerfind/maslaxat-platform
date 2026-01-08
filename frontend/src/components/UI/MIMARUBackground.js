import React from 'react';
import { Box } from '@mui/material';

// MIMARU Hotel Style - Minimalist Japanese Background
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
        backgroundColor: '#f5f5f0', // Warm off-white (Japanese paper)
      }}
    >
      {/* Subtle wood grain texture overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
            linear-gradient(90deg, rgba(139, 115, 85, 0.02) 1px, transparent 1px),
            linear-gradient(rgba(139, 115, 85, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          opacity: 0.5,
        }}
      />

      {/* Subtle gradient accent - top */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '300px',
          background: 'linear-gradient(180deg, rgba(26, 43, 74, 0.03) 0%, transparent 100%)',
        }}
      />

      {/* Decorative line elements - MIMARU style */}
      <Box
        sx={{
          position: 'absolute',
          top: '20%',
          right: '5%',
          width: '2px',
          height: '200px',
          backgroundColor: 'rgba(26, 43, 74, 0.06)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          bottom: '30%',
          left: '8%',
          width: '150px',
          height: '2px',
          backgroundColor: 'rgba(139, 115, 85, 0.08)',
        }}
      />

      {/* Subtle corner accents */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '100px',
          height: '100px',
          borderTop: '3px solid rgba(26, 43, 74, 0.05)',
          borderRight: '3px solid rgba(26, 43, 74, 0.05)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100px',
          height: '100px',
          borderBottom: '3px solid rgba(139, 115, 85, 0.05)',
          borderLeft: '3px solid rgba(139, 115, 85, 0.05)',
        }}
      />
    </Box>
  );
};

export default MIMARUBackground;
