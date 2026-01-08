import { createTheme } from '@mui/material/styles';

// Glassmorphism Theme - Modern Glass Effect Design
const glassmorphismTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#667eea',
      light: '#818cf8',
      dark: '#5a67d8',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#f093fb',
      light: '#f5a7ff',
      dark: '#d77fe8',
      contrastText: '#ffffff',
    },
    background: {
      default: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      paper: 'rgba(255, 255, 255, 0.1)',
    },
    success: {
      main: '#4ade80',
      light: '#86efac',
      dark: '#22c55e',
    },
    error: {
      main: '#f87171',
      light: '#fca5a5',
      dark: '#ef4444',
    },
    warning: {
      main: '#fbbf24',
      light: '#fcd34d',
      dark: '#f59e0b',
    },
    info: {
      main: '#60a5fa',
      light: '#93c5fd',
      dark: '#3b82f6',
    },
    text: {
      primary: '#1f2937',
      secondary: '#6b7280',
    },
  },
  typography: {
    fontFamily: '"Inter", "Poppins", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '3rem',
      fontWeight: 800,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontSize: '2rem',
      fontWeight: 700,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 16,
  },
  shadows: [
    'none',
    '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
    '0 8px 32px 0 rgba(31, 38, 135, 0.20)',
    '0 8px 32px 0 rgba(31, 38, 135, 0.25)',
    '0 8px 32px 0 rgba(31, 38, 135, 0.30)',
    '0 8px 32px 0 rgba(31, 38, 135, 0.35)',
    ...Array(19).fill('none'),
  ],
});

// Glassmorphism styling utilities
export const glassStyles = {
  // Standard glass card
  card: {
    background: 'rgba(255, 255, 255, 0.15)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
  },

  // Strong glass effect
  cardStrong: {
    background: 'rgba(255, 255, 255, 0.25)',
    backdropFilter: 'blur(15px)',
    WebkitBackdropFilter: 'blur(15px)',
    borderRadius: '20px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.25)',
  },

  // Subtle glass effect
  cardSubtle: {
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: '0 4px 16px 0 rgba(31, 38, 135, 0.1)',
  },

  // Glass button
  button: {
    background: 'rgba(255, 255, 255, 0.2)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '12px',
    transition: 'all 0.3s ease',
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.3)',
      transform: 'translateY(-2px)',
      boxShadow: '0 8px 24px 0 rgba(31, 38, 135, 0.2)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
  },

  // Gradient glass button
  buttonGradient: (color1, color2) => ({
    background: `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    transition: 'all 0.3s ease',
    boxShadow: `0 4px 15px 0 ${color1}40`,
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: `0 8px 25px 0 ${color1}60`,
    },
    '&:active': {
      transform: 'translateY(0)',
    },
  }),

  // Glass input
  input: {
    background: 'rgba(255, 255, 255, 0.15)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '12px',
    '&:focus': {
      border: '1px solid rgba(255, 255, 255, 0.4)',
      background: 'rgba(255, 255, 255, 0.2)',
    },
  },

  // Frosted glass overlay
  overlay: {
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  },

  // Background gradients
  gradients: {
    purple: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    blue: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    pink: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    orange: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    green: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
    sunset: 'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 100%)',
    ocean: 'linear-gradient(135deg, #2e3192 0%, #1bffff 100%)',
  },
};

export default glassmorphismTheme;
