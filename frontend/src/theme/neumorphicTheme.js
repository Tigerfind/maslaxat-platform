import { createTheme } from '@mui/material/styles';

// Neumorphism 2.0 / Soft UI Theme
const neumorphicTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#5b9aa0',
      light: '#7eb4ba',
      dark: '#447176',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#d4a574',
      light: '#e0ba92',
      dark: '#b8895e',
      contrastText: '#ffffff',
    },
    background: {
      default: '#e4e9f2',
      paper: '#e4e9f2',
    },
    text: {
      primary: '#2c3e50',
      secondary: '#5a6c7d',
    },
    success: {
      main: '#6abf69',
      light: '#8fd38e',
      dark: '#4a9749',
    },
    error: {
      main: '#e07a5f',
      light: '#e89884',
      dark: '#c0624a',
    },
    warning: {
      main: '#f4a261',
      light: '#f7b885',
      dark: '#d88a4e',
    },
    info: {
      main: '#5b9aa0',
      light: '#7eb4ba',
      dark: '#447176',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontSize: '1.75rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
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
    // Neumorphic shadow (soft, elevated)
    '8px 8px 16px rgba(163, 177, 198, 0.6), -8px -8px 16px rgba(255, 255, 255, 0.5)',
    '10px 10px 20px rgba(163, 177, 198, 0.6), -10px -10px 20px rgba(255, 255, 255, 0.5)',
    '12px 12px 24px rgba(163, 177, 198, 0.6), -12px -12px 24px rgba(255, 255, 255, 0.5)',
    '14px 14px 28px rgba(163, 177, 198, 0.6), -14px -14px 28px rgba(255, 255, 255, 0.5)',
    '16px 16px 32px rgba(163, 177, 198, 0.6), -16px -16px 32px rgba(255, 255, 255, 0.5)',
    '18px 18px 36px rgba(163, 177, 198, 0.6), -18px -18px 36px rgba(255, 255, 255, 0.5)',
    '20px 20px 40px rgba(163, 177, 198, 0.6), -20px -20px 40px rgba(255, 255, 255, 0.5)',
    '22px 22px 44px rgba(163, 177, 198, 0.6), -22px -22px 44px rgba(255, 255, 255, 0.5)',
    '24px 24px 48px rgba(163, 177, 198, 0.6), -24px -24px 48px rgba(255, 255, 255, 0.5)',
    // Inset shadow for pressed state
    'inset 6px 6px 12px rgba(163, 177, 198, 0.6), inset -6px -6px 12px rgba(255, 255, 255, 0.5)',
    'inset 8px 8px 16px rgba(163, 177, 198, 0.6), inset -8px -8px 16px rgba(255, 255, 255, 0.5)',
    'inset 10px 10px 20px rgba(163, 177, 198, 0.6), inset -10px -10px 20px rgba(255, 255, 255, 0.5)',
    'inset 4px 4px 8px rgba(163, 177, 198, 0.6), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
    '6px 6px 12px rgba(163, 177, 198, 0.6), -6px -6px 12px rgba(255, 255, 255, 0.5)',
    '4px 4px 8px rgba(163, 177, 198, 0.6), -4px -4px 8px rgba(255, 255, 255, 0.5)',
    '2px 2px 4px rgba(163, 177, 198, 0.6), -2px -2px 4px rgba(255, 255, 255, 0.5)',
    '1px 1px 2px rgba(163, 177, 198, 0.6), -1px -1px 2px rgba(255, 255, 255, 0.5)',
    '0px 2px 4px rgba(163, 177, 198, 0.4)',
    '0px 4px 8px rgba(163, 177, 198, 0.4)',
    '0px 6px 12px rgba(163, 177, 198, 0.4)',
    '0px 8px 16px rgba(163, 177, 198, 0.4)',
    '0px 10px 20px rgba(163, 177, 198, 0.4)',
    '0px 12px 24px rgba(163, 177, 198, 0.4)',
    '0px 14px 28px rgba(163, 177, 198, 0.4)',
  ],
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: '10px 24px',
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
        },
      },
    },
  },
});

// Neumorphic styling utilities
export const neumorphicStyles = {
  // Elevated (raised) element
  elevated: {
    background: '#e4e9f2',
    boxShadow: '8px 8px 16px rgba(163, 177, 198, 0.6), -8px -8px 16px rgba(255, 255, 255, 0.5)',
    transition: 'all 0.3s ease',
    '&:hover': {
      boxShadow: '12px 12px 24px rgba(163, 177, 198, 0.6), -12px -12px 24px rgba(255, 255, 255, 0.5)',
    },
  },

  // Pressed (inset) element
  pressed: {
    background: '#e4e9f2',
    boxShadow: 'inset 6px 6px 12px rgba(163, 177, 198, 0.6), inset -6px -6px 12px rgba(255, 255, 255, 0.5)',
  },

  // Flat element with subtle shadow
  flat: {
    background: '#e4e9f2',
    boxShadow: '4px 4px 8px rgba(163, 177, 198, 0.4), -4px -4px 8px rgba(255, 255, 255, 0.5)',
  },

  // Card style
  card: {
    background: '#e4e9f2',
    borderRadius: '20px',
    boxShadow: '10px 10px 20px rgba(163, 177, 198, 0.6), -10px -10px 20px rgba(255, 255, 255, 0.5)',
    padding: '24px',
  },

  // Button style
  button: {
    background: '#e4e9f2',
    borderRadius: '12px',
    boxShadow: '6px 6px 12px rgba(163, 177, 198, 0.6), -6px -6px 12px rgba(255, 255, 255, 0.5)',
    padding: '10px 24px',
    border: 'none',
    transition: 'all 0.3s ease',
    '&:hover': {
      boxShadow: '8px 8px 16px rgba(163, 177, 198, 0.6), -8px -8px 16px rgba(255, 255, 255, 0.5)',
    },
    '&:active': {
      boxShadow: 'inset 4px 4px 8px rgba(163, 177, 198, 0.6), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
    },
  },

  // Input style
  input: {
    background: '#e4e9f2',
    borderRadius: '12px',
    boxShadow: 'inset 4px 4px 8px rgba(163, 177, 198, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
    border: 'none',
    padding: '12px 16px',
  },

  // Icon button style
  iconButton: {
    background: '#e4e9f2',
    borderRadius: '12px',
    boxShadow: '6px 6px 12px rgba(163, 177, 198, 0.6), -6px -6px 12px rgba(255, 255, 255, 0.5)',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
    '&:hover': {
      boxShadow: '8px 8px 16px rgba(163, 177, 198, 0.6), -8px -8px 16px rgba(255, 255, 255, 0.5)',
    },
    '&:active': {
      boxShadow: 'inset 4px 4px 8px rgba(163, 177, 198, 0.6), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
    },
  },

  // Gradient overlay for colored elements
  gradientOverlay: (color) => ({
    background: `linear-gradient(145deg, ${color}ee, ${color}dd)`,
    boxShadow: `8px 8px 16px ${color}66, -8px -8px 16px ${color}22`,
  }),
};

export default neumorphicTheme;
