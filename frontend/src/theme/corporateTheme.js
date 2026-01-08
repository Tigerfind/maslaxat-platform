import { createTheme } from '@mui/material/styles';

/**
 * Corporate Minimalism Theme
 * Professional, clean design for legal/fintech SaaS
 * Based on strict grid system, high readability, minimal decoration
 */

export const corporateColors = {
  // Primary palette
  bg: '#FFFFFF',
  surface: '#F4F6F8',
  text: '#0B1B2B',
  muted: '#6B7280',
  border: '#E6E9EE',

  // Accent colors
  accent: '#2563EB',      // Royal blue - primary CTA
  accentHover: '#1d4ed8',
  accent2: '#0EA5A4',     // Teal - alternative accent

  // Status colors
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#3B82F6',

  // Grays
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
};

export const corporateTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: corporateColors.accent,
      dark: corporateColors.accentHover,
      light: '#60A5FA',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: corporateColors.accent2,
      dark: '#0d9488',
      light: '#14b8a6',
      contrastText: '#FFFFFF',
    },
    error: {
      main: corporateColors.danger,
      light: '#F87171',
      dark: '#B91C1C',
    },
    warning: {
      main: corporateColors.warning,
      light: '#FCD34D',
      dark: '#D97706',
    },
    success: {
      main: corporateColors.success,
      light: '#34D399',
      dark: '#059669',
    },
    info: {
      main: corporateColors.info,
      light: '#60A5FA',
      dark: '#2563EB',
    },
    background: {
      default: corporateColors.bg,
      paper: corporateColors.surface,
    },
    text: {
      primary: corporateColors.text,
      secondary: corporateColors.muted,
    },
    divider: corporateColors.border,
  },

  typography: {
    fontFamily: '"Inter", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: '2.5rem',      // 40px
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: '-0.02em',
      color: corporateColors.text,
    },
    h2: {
      fontSize: '2rem',        // 32px
      fontWeight: 700,
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
      color: corporateColors.text,
    },
    h3: {
      fontSize: '1.5rem',      // 24px
      fontWeight: 600,
      lineHeight: 1.4,
      color: corporateColors.text,
    },
    h4: {
      fontSize: '1.25rem',     // 20px
      fontWeight: 600,
      lineHeight: 1.5,
      color: corporateColors.text,
    },
    h5: {
      fontSize: '1.125rem',    // 18px
      fontWeight: 600,
      lineHeight: 1.5,
      color: corporateColors.text,
    },
    h6: {
      fontSize: '1rem',        // 16px
      fontWeight: 600,
      lineHeight: 1.5,
      color: corporateColors.text,
    },
    body1: {
      fontSize: '1rem',        // 16px
      fontWeight: 400,
      lineHeight: 1.5,
      color: corporateColors.text,
    },
    body2: {
      fontSize: '0.875rem',    // 14px
      fontWeight: 400,
      lineHeight: 1.5,
      color: corporateColors.muted,
    },
    caption: {
      fontSize: '0.75rem',     // 12px
      fontWeight: 500,
      lineHeight: 1.4,
      color: corporateColors.muted,
    },
    button: {
      fontSize: '0.875rem',    // 14px
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: '0.01em',
    },
  },

  shape: {
    borderRadius: 8,
  },

  shadows: [
    'none',
    '0 1px 3px rgba(11, 27, 43, 0.06)',
    '0 2px 6px rgba(11, 27, 43, 0.06)',
    '0 4px 12px rgba(11, 27, 43, 0.08)',
    '0 6px 16px rgba(11, 27, 43, 0.1)',
    '0 8px 24px rgba(11, 27, 43, 0.12)',
    '0 12px 32px rgba(11, 27, 43, 0.14)',
    '0 16px 40px rgba(11, 27, 43, 0.16)',
    '0 20px 48px rgba(11, 27, 43, 0.18)',
    '0 24px 56px rgba(11, 27, 43, 0.2)',
    ...Array(15).fill('none'),
  ],

  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '10px 18px',
          minHeight: 44,
          fontWeight: 600,
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
        contained: {
          backgroundColor: corporateColors.accent,
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: corporateColors.accentHover,
          },
        },
        outlined: {
          borderColor: corporateColors.border,
          color: corporateColors.text,
          borderWidth: 1,
          '&:hover': {
            borderColor: corporateColors.accent,
            backgroundColor: 'rgba(37, 99, 235, 0.04)',
            borderWidth: 1,
          },
        },
        text: {
          color: corporateColors.accent,
          '&:hover': {
            backgroundColor: 'rgba(37, 99, 235, 0.04)',
          },
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: corporateColors.surface,
          border: `1px solid ${corporateColors.border}`,
          borderRadius: 12,
          boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: corporateColors.surface,
          backgroundImage: 'none',
        },
        outlined: {
          border: `1px solid ${corporateColors.border}`,
        },
      },
    },

    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#FFFFFF',
            borderRadius: 8,
            '& fieldset': {
              borderColor: corporateColors.border,
            },
            '&:hover fieldset': {
              borderColor: corporateColors.accent,
            },
            '&.Mui-focused fieldset': {
              borderColor: corporateColors.accent,
              borderWidth: 1,
            },
          },
          '& .MuiInputBase-input': {
            padding: '10px 12px',
            fontSize: '0.875rem',
          },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: corporateColors.gray50,
          color: corporateColors.muted,
          fontWeight: 600,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: `1px solid ${corporateColors.border}`,
          padding: '12px 16px',
        },
        body: {
          fontSize: '0.875rem',
          borderBottom: `1px dashed ${corporateColors.border}`,
          padding: '12px 16px',
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          fontSize: '0.75rem',
        },
        outlined: {
          borderColor: corporateColors.border,
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: corporateColors.border,
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: corporateColors.text,
          boxShadow: '0 1px 3px rgba(11, 27, 43, 0.06)',
          borderBottom: `1px solid ${corporateColors.border}`,
        },
      },
    },
  },
});

// Utility styles for common patterns
export const corporateStyles = {
  card: {
    backgroundColor: corporateColors.surface,
    border: `1px solid ${corporateColors.border}`,
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
  },

  cardHeader: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: corporateColors.text,
    marginBottom: '16px',
  },

  input: {
    backgroundColor: '#FFFFFF',
    border: `1px solid ${corporateColors.border}`,
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '0.875rem',
    outline: 'none',
    '&:focus': {
      borderColor: corporateColors.accent,
      boxShadow: `0 0 0 4px rgba(37, 99, 235, 0.08)`,
    },
  },

  buttonPrimary: {
    backgroundColor: corporateColors.accent,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 18px',
    minHeight: '44px',
    fontWeight: 600,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: corporateColors.accentHover,
    },
  },

  buttonOutline: {
    backgroundColor: 'transparent',
    color: corporateColors.text,
    border: `1px solid ${corporateColors.border}`,
    borderRadius: '8px',
    padding: '10px 18px',
    minHeight: '44px',
    fontWeight: 600,
    cursor: 'pointer',
    '&:hover': {
      borderColor: corporateColors.accent,
      backgroundColor: 'rgba(37, 99, 235, 0.04)',
    },
  },

  statusBadge: (status) => {
    const colors = {
      success: { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
      warning: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
      danger: { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
      info: { bg: '#DBEAFE', color: '#1E3A8A', border: '#BFDBFE' },
      default: { bg: corporateColors.gray100, color: corporateColors.gray700, border: corporateColors.gray200 },
    };
    const color = colors[status] || colors.default;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 12px',
      borderRadius: '6px',
      backgroundColor: color.bg,
      color: color.color,
      border: `1px solid ${color.border}`,
      fontSize: '0.75rem',
      fontWeight: 500,
    };
  },
};

export default corporateTheme;
