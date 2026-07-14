import { createTheme } from '@mui/material/styles';

/**
 * AXELION Premium Theme
 * Elegant, minimalist design with gold/bronze accents
 * Typography: Inter Light with wide letter-spacing
 * Inspired by luxury brand aesthetics
 */

// AXELION Color Palette - extracted from brand guidelines
export const axelionColors = {
  // Primary Gold/Bronze tones
  gold: '#B8956E',
  goldLight: '#C9A980',
  goldDark: '#9A7B5A',
  goldMuted: '#D4C5B5',

  // Bronze/Tan variations
  bronze: '#8B7355',
  bronzeLight: '#A68B6A',
  bronzeDark: '#6B5A45',

  // Background colors
  bgLight: '#FFFFFF',
  bgCream: '#F5F1EB',
  bgWarm: '#FAF8F5',
  bgBeige: '#E8DFD5',
  bgSand: '#D4C5B5',

  // Dark mode colors
  bgDark: '#1A1A1A',
  bgDarkCard: '#2D2D2D',
  bgDarkElevated: '#3A3A3A',

  // Text colors
  textDark: '#1A1A1A',
  textPrimary: '#2D2D2D',
  textSecondary: '#6B6B6B',
  textMuted: '#9A9A9A',
  textLight: '#FFFFFF',
  textGold: '#B8956E',

  // Borders
  borderLight: '#E8E4DE',
  borderMedium: '#D4C5B5',
  borderDark: '#3A3A3A',

  // Status colors - muted, elegant versions
  success: '#7A9A6B',
  successLight: '#E8F0E4',
  warning: '#C4A35A',
  warningLight: '#F5EFE0',
  error: '#B07070',
  errorLight: '#F5E8E8',
  info: '#6A8A9A',
  infoLight: '#E4EEF2',

  // Accent colors for UI elements
  accent: '#B8956E',
  accentHover: '#9A7B5A',
  accentLight: 'rgba(184, 149, 110, 0.1)',
  accentMedium: 'rgba(184, 149, 110, 0.2)',
};

// Create the main AXELION theme
export const axelionTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: axelionColors.gold,
      light: axelionColors.goldLight,
      dark: axelionColors.goldDark,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: axelionColors.bronze,
      light: axelionColors.bronzeLight,
      dark: axelionColors.bronzeDark,
      contrastText: '#FFFFFF',
    },
    background: {
      default: axelionColors.bgCream,
      paper: axelionColors.bgLight,
    },
    text: {
      primary: axelionColors.textPrimary,
      secondary: axelionColors.textSecondary,
    },
    divider: axelionColors.borderLight,
    error: {
      main: axelionColors.error,
      light: axelionColors.errorLight,
    },
    warning: {
      main: axelionColors.warning,
      light: axelionColors.warningLight,
    },
    success: {
      main: axelionColors.success,
      light: axelionColors.successLight,
    },
    info: {
      main: axelionColors.info,
      light: axelionColors.infoLight,
    },
  },

  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',

    // Brand heading - wide letter spacing like AXELION logo
    h1: {
      fontSize: '2.5rem',
      fontWeight: 300,
      letterSpacing: '0.2em',
      lineHeight: 1.2,
      color: axelionColors.textDark,
      textTransform: 'uppercase',
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 300,
      letterSpacing: '0.15em',
      lineHeight: 1.3,
      color: axelionColors.textDark,
      textTransform: 'uppercase',
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 300,
      letterSpacing: '0.1em',
      lineHeight: 1.4,
      color: axelionColors.textDark,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 400,
      letterSpacing: '0.05em',
      lineHeight: 1.5,
      color: axelionColors.textDark,
    },
    h5: {
      fontSize: '1.125rem',
      fontWeight: 400,
      letterSpacing: '0.03em',
      lineHeight: 1.5,
      color: axelionColors.textDark,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 500,
      letterSpacing: '0.02em',
      lineHeight: 1.5,
      color: axelionColors.textDark,
    },
    subtitle1: {
      fontSize: '1rem',
      fontWeight: 300,
      letterSpacing: '0.05em',
      color: axelionColors.textSecondary,
    },
    subtitle2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      letterSpacing: '0.03em',
      color: axelionColors.textSecondary,
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.6,
      letterSpacing: '0.01em',
      color: axelionColors.textPrimary,
    },
    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.6,
      letterSpacing: '0.01em',
      color: axelionColors.textSecondary,
    },
    caption: {
      fontSize: '0.75rem',
      fontWeight: 400,
      letterSpacing: '0.03em',
      color: axelionColors.textMuted,
    },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 500,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: axelionColors.gold,
    },
    button: {
      fontSize: '0.875rem',
      fontWeight: 500,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
    },
  },

  shape: {
    borderRadius: 8,
  },

  shadows: [
    'none',
    '0 1px 3px rgba(26, 26, 26, 0.04)',
    '0 2px 6px rgba(26, 26, 26, 0.04)',
    '0 4px 12px rgba(26, 26, 26, 0.06)',
    '0 6px 16px rgba(26, 26, 26, 0.08)',
    '0 8px 24px rgba(26, 26, 26, 0.08)',
    '0 12px 32px rgba(26, 26, 26, 0.1)',
    '0 16px 40px rgba(26, 26, 26, 0.1)',
    '0 20px 48px rgba(26, 26, 26, 0.12)',
    '0 24px 56px rgba(26, 26, 26, 0.12)',
    ...Array(15).fill('none'),
  ],

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: axelionColors.bgCream,
          color: axelionColors.textPrimary,
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          padding: '12px 32px',
          minHeight: 48,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          boxShadow: 'none',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: 'none',
          },
        },
        contained: {
          backgroundColor: axelionColors.gold,
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: axelionColors.goldDark,
          },
        },
        containedSecondary: {
          backgroundColor: axelionColors.textDark,
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: '#2D2D2D',
          },
        },
        outlined: {
          borderColor: axelionColors.gold,
          borderWidth: 1,
          color: axelionColors.gold,
          '&:hover': {
            borderColor: axelionColors.goldDark,
            backgroundColor: axelionColors.accentLight,
            borderWidth: 1,
          },
        },
        text: {
          color: axelionColors.gold,
          '&:hover': {
            backgroundColor: axelionColors.accentLight,
          },
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgLight,
          backgroundImage: 'none',
        },
        outlined: {
          border: `1px solid ${axelionColors.borderLight}`,
        },
      },
    },

    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: axelionColors.bgLight,
            borderRadius: 2,
            '& fieldset': {
              borderColor: axelionColors.borderLight,
              borderWidth: 1,
            },
            '&:hover fieldset': {
              borderColor: axelionColors.gold,
            },
            '&.Mui-focused fieldset': {
              borderColor: axelionColors.gold,
              borderWidth: 1,
            },
          },
          '& .MuiInputBase-input': {
            padding: '14px 16px',
            fontSize: '0.9375rem',
            letterSpacing: '0.01em',
          },
          '& .MuiInputLabel-root': {
            letterSpacing: '0.02em',
            '&.Mui-focused': {
              color: axelionColors.gold,
            },
          },
        },
      },
    },

    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: axelionColors.bgWarm,
          color: axelionColors.textSecondary,
          fontWeight: 500,
          fontSize: '0.75rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          padding: '16px',
        },
        body: {
          fontSize: '0.875rem',
          letterSpacing: '0.01em',
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          padding: '16px',
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          fontWeight: 500,
          fontSize: '0.75rem',
          letterSpacing: '0.05em',
        },
        outlined: {
          borderColor: axelionColors.borderMedium,
        },
        filled: {
          backgroundColor: axelionColors.bgBeige,
          color: axelionColors.textPrimary,
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: axelionColors.borderLight,
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgLight,
          color: axelionColors.textDark,
          boxShadow: 'none',
          borderBottom: `1px solid ${axelionColors.borderLight}`,
        },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: axelionColors.bgLight,
          borderRight: `1px solid ${axelionColors.borderLight}`,
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          boxShadow: '0 24px 48px rgba(26, 26, 26, 0.15)',
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: axelionColors.gold,
          height: 2,
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontWeight: 500,
          fontSize: '0.8125rem',
          minHeight: 48,
          '&.Mui-selected': {
            color: axelionColors.gold,
          },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          minWidth: 44,
          minHeight: 44,
          '&:hover': {
            backgroundColor: axelionColors.accentLight,
          },
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: axelionColors.textDark,
          fontSize: '0.75rem',
          letterSpacing: '0.02em',
          borderRadius: 2,
        },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgBeige,
          color: axelionColors.gold,
        },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgBeige,
          borderRadius: 2,
        },
        bar: {
          backgroundColor: axelionColors.gold,
          borderRadius: 2,
        },
      },
    },

    MuiCircularProgress: {
      styleOverrides: {
        root: {
          color: axelionColors.gold,
        },
      },
    },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: axelionColors.gold,
            '& + .MuiSwitch-track': {
              backgroundColor: axelionColors.goldLight,
            },
          },
        },
      },
    },

    MuiCheckbox: {
      styleOverrides: {
        root: {
          '&.Mui-checked': {
            color: axelionColors.gold,
          },
        },
      },
    },

    MuiRadio: {
      styleOverrides: {
        root: {
          '&.Mui-checked': {
            color: axelionColors.gold,
          },
        },
      },
    },

    MuiSlider: {
      styleOverrides: {
        root: {
          color: axelionColors.gold,
        },
        thumb: {
          '&:hover, &.Mui-focusVisible': {
            boxShadow: `0 0 0 8px ${axelionColors.accentLight}`,
          },
        },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
        standardSuccess: {
          backgroundColor: axelionColors.successLight,
          color: axelionColors.success,
        },
        standardError: {
          backgroundColor: axelionColors.errorLight,
          color: axelionColors.error,
        },
        standardWarning: {
          backgroundColor: axelionColors.warningLight,
          color: axelionColors.warning,
        },
        standardInfo: {
          backgroundColor: axelionColors.infoLight,
          color: axelionColors.info,
        },
      },
    },

    MuiBadge: {
      styleOverrides: {
        badge: {
          backgroundColor: axelionColors.gold,
          color: '#FFFFFF',
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          '&.Mui-selected': {
            backgroundColor: axelionColors.accentLight,
            '&:hover': {
              backgroundColor: axelionColors.accentMedium,
            },
          },
          '&:hover': {
            backgroundColor: axelionColors.bgWarm,
          },
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(26, 26, 26, 0.12)',
          border: `1px solid ${axelionColors.borderLight}`,
        },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          letterSpacing: '0.01em',
          '&:hover': {
            backgroundColor: axelionColors.bgWarm,
          },
          '&.Mui-selected': {
            backgroundColor: axelionColors.accentLight,
            '&:hover': {
              backgroundColor: axelionColors.accentMedium,
            },
          },
        },
      },
    },

    MuiSkeleton: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgBeige,
        },
      },
    },

    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(26, 26, 26, 0.5)',
        },
      },
    },
  },
});

// AXELION utility styles for custom components
export const axelionStyles = {
  // Premium card with subtle shadow
  card: {
    backgroundColor: axelionColors.bgLight,
    border: `1px solid ${axelionColors.borderLight}`,
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // Card with hover effect
  cardHover: {
    backgroundColor: axelionColors.bgLight,
    border: `1px solid ${axelionColors.borderLight}`,
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    '&:hover': {
      boxShadow: '0 8px 24px rgba(26, 26, 26, 0.08)',
      borderColor: axelionColors.gold,
    },
  },

  // Dark card variant
  cardDark: {
    backgroundColor: axelionColors.bgDarkCard,
    border: `1px solid ${axelionColors.borderDark}`,
    borderRadius: '8px',
    padding: '24px',
    color: axelionColors.textLight,
  },

  // Gold accent card
  cardAccent: {
    backgroundColor: axelionColors.bgLight,
    borderLeft: `3px solid ${axelionColors.gold}`,
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
  },

  // Beige/tan card (like the logo variant)
  cardTan: {
    backgroundColor: axelionColors.bronze,
    borderRadius: '8px',
    padding: '24px',
    color: axelionColors.textLight,
  },

  // Header text with gold color
  headerGold: {
    color: axelionColors.gold,
    fontSize: '1.5rem',
    fontWeight: 300,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  },

  // Brand text style
  brandText: {
    fontWeight: 300,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: axelionColors.textDark,
  },

  // Input field style
  input: {
    backgroundColor: axelionColors.bgLight,
    border: `1px solid ${axelionColors.borderLight}`,
    borderRadius: '8px',
    padding: '14px 16px',
    fontSize: '0.9375rem',
    letterSpacing: '0.01em',
    outline: 'none',
    transition: 'border-color 0.3s ease',
    '&:focus': {
      borderColor: axelionColors.gold,
    },
  },

  // Primary button
  buttonPrimary: {
    backgroundColor: axelionColors.gold,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    '&:hover': {
      backgroundColor: axelionColors.goldDark,
    },
  },

  // Dark button
  buttonDark: {
    backgroundColor: axelionColors.textDark,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    '&:hover': {
      backgroundColor: '#2D2D2D',
    },
  },

  // Outline button
  buttonOutline: {
    backgroundColor: 'transparent',
    color: axelionColors.gold,
    border: `1px solid ${axelionColors.gold}`,
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    '&:hover': {
      backgroundColor: axelionColors.accentLight,
    },
  },

  // Status badges
  statusBadge: (status) => {
    const colors = {
      success: { bg: axelionColors.successLight, color: axelionColors.success },
      warning: { bg: axelionColors.warningLight, color: axelionColors.warning },
      error: { bg: axelionColors.errorLight, color: axelionColors.error },
      info: { bg: axelionColors.infoLight, color: axelionColors.info },
      pending: { bg: axelionColors.bgBeige, color: axelionColors.bronze },
      active: { bg: axelionColors.accentLight, color: axelionColors.gold },
      default: { bg: axelionColors.bgWarm, color: axelionColors.textSecondary },
    };
    const c = colors[status] || colors.default;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '6px 12px',
      borderRadius: '8px',
      backgroundColor: c.bg,
      color: c.color,
      fontSize: '0.75rem',
      fontWeight: 500,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    };
  },

  // Divider with gold accent
  dividerGold: {
    width: '60px',
    height: '2px',
    backgroundColor: axelionColors.gold,
    margin: '16px 0',
  },

  // Section header
  sectionHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '24px',
  },

  // Icon container
  iconContainer: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    backgroundColor: axelionColors.accentLight,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: axelionColors.gold,
  },

  // Logo style (A icon)
  logoIcon: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: 300,
    fontSize: '2rem',
    color: axelionColors.gold,
    letterSpacing: '0.05em',
  },

  // Navigation link
  navLink: {
    color: axelionColors.textSecondary,
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    textDecoration: 'none',
    transition: 'color 0.3s ease',
    '&:hover': {
      color: axelionColors.gold,
    },
    '&.active': {
      color: axelionColors.gold,
    },
  },

  // Sidebar item
  sidebarItem: {
    padding: '12px 16px',
    borderRadius: '8px',
    color: axelionColors.textSecondary,
    transition: 'all 0.3s ease',
    '&:hover': {
      backgroundColor: axelionColors.bgWarm,
      color: axelionColors.textPrimary,
    },
    '&.active': {
      backgroundColor: axelionColors.accentLight,
      color: axelionColors.gold,
    },
  },

  // Table styles
  table: {
    '& th': {
      backgroundColor: axelionColors.bgWarm,
      color: axelionColors.textSecondary,
      fontWeight: 500,
      fontSize: '0.75rem',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      padding: '16px',
      borderBottom: `1px solid ${axelionColors.borderLight}`,
    },
    '& td': {
      padding: '16px',
      borderBottom: `1px solid ${axelionColors.borderLight}`,
      fontSize: '0.875rem',
    },
    '& tr:hover': {
      backgroundColor: axelionColors.bgWarm,
    },
  },

  // Avatar with gold border
  avatarGold: {
    border: `2px solid ${axelionColors.gold}`,
    backgroundColor: axelionColors.bgBeige,
    color: axelionColors.gold,
  },

  // Decorative elements
  decorativeLine: {
    width: '1px',
    height: '100%',
    backgroundColor: axelionColors.borderLight,
  },

  decorativeCorner: {
    position: 'absolute',
    width: '20px',
    height: '20px',
    border: `2px solid ${axelionColors.gold}`,
  },

  // Gradient overlay (for images)
  gradientOverlay: {
    background: `linear-gradient(180deg, transparent 0%, ${axelionColors.bgDark}80 100%)`,
  },

  // Glass effect with AXELION colors
  glass: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: `1px solid ${axelionColors.borderLight}`,
    borderRadius: '8px',
  },

  // Subtle animation keyframes reference
  animations: {
    fadeIn: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    slideUp: {
      from: { transform: 'translateY(20px)', opacity: 0 },
      to: { transform: 'translateY(0)', opacity: 1 },
    },
  },
};

// Dark mode variant
export const axelionDarkTheme = createTheme({
  ...axelionTheme,
  palette: {
    mode: 'dark',
    primary: {
      main: axelionColors.gold,
      light: axelionColors.goldLight,
      dark: axelionColors.goldDark,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: axelionColors.bronzeLight,
      light: axelionColors.goldMuted,
      dark: axelionColors.bronze,
      contrastText: '#FFFFFF',
    },
    background: {
      default: axelionColors.bgDark,
      paper: axelionColors.bgDarkCard,
    },
    text: {
      primary: axelionColors.textLight,
      secondary: axelionColors.textMuted,
    },
    divider: axelionColors.borderDark,
  },
  components: {
    ...axelionTheme.components,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: axelionColors.bgDark,
          color: axelionColors.textLight,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgDarkCard,
          border: `1px solid ${axelionColors.borderDark}`,
          borderRadius: 8,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgDarkCard,
          backgroundImage: 'none',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: axelionColors.bgDark,
          borderBottom: `1px solid ${axelionColors.borderDark}`,
        },
      },
    },
  },
});

export default axelionTheme;
