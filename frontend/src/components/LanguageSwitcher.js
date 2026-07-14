import React, { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import { Language, Check, KeyboardArrowDown } from '@mui/icons-material';
import { useTranslation } from '../i18n';
import { axelionColors } from '../theme/axelionTheme';

/**
 * MaslaXat Premium Language Switcher Component
 * Elegant, minimalist language selection
 */
const LanguageSwitcher = ({ variant = 'dropdown', sx = {} }) => {
  const { language, setLanguage, getAvailableLanguages, getCurrentLanguage } =
    useTranslation();
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLanguageSelect = (langCode) => {
    setLanguage(langCode);
    handleClose();
  };

  const currentLang = getCurrentLanguage();
  const languages = getAvailableLanguages();

  // Button variant - three separate buttons
  if (variant === 'buttons') {
    return (
      <Box sx={{ display: 'flex', gap: 1, ...sx }}>
        {languages.map((lang) => (
          <Button
            key={lang.code}
            variant={language === lang.code ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setLanguage(lang.code)}
            sx={{
              minWidth: 'auto',
              px: 2,
              py: 0.75,
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              bgcolor: language === lang.code ? axelionColors.gold : 'transparent',
              borderColor: language === lang.code ? axelionColors.gold : axelionColors.borderLight,
              color: language === lang.code ? '#FFFFFF' : axelionColors.textSecondary,
              '&:hover': {
                bgcolor: language === lang.code ? axelionColors.goldDark : axelionColors.accentLight,
                borderColor: axelionColors.gold,
                color: language === lang.code ? '#FFFFFF' : axelionColors.gold,
              },
            }}
          >
            {lang.flag} {lang.code.toUpperCase()}
          </Button>
        ))}
      </Box>
    );
  }

  // Minimal variant - just flag
  if (variant === 'minimal') {
    return (
      <Button
        onClick={handleClick}
        sx={{
          minWidth: 'auto',
          color: axelionColors.textPrimary,
          fontSize: '1rem',
          padding: '8px',
          borderRadius: '8px',
          '&:hover': {
            backgroundColor: axelionColors.accentLight,
          },
          ...sx,
        }}
      >
        {currentLang.flag}
      </Button>
    );
  }

  // Default dropdown variant
  return (
    <>
      <Button
        onClick={handleClick}
        endIcon={<KeyboardArrowDown sx={{ fontSize: '1rem' }} />}
        sx={{
          color: axelionColors.textPrimary,
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          borderRadius: '8px',
          px: 2,
          py: 1,
          textTransform: 'none',
          fontWeight: 500,
          letterSpacing: '0.02em',
          '&:hover': {
            backgroundColor: axelionColors.bgWarm,
            borderColor: axelionColors.gold,
          },
          ...sx,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '1.1rem' }}>{currentLang.flag}</Typography>
          <Typography sx={{ fontWeight: 500, fontSize: '0.875rem' }}>
            {currentLang.nativeName}
          </Typography>
        </Box>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 200,
            borderRadius: '8px',
            border: `1px solid ${axelionColors.borderLight}`,
            boxShadow: '0 8px 24px rgba(26, 26, 26, 0.08)',
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography
            sx={{
              color: axelionColors.textMuted,
              fontWeight: 500,
              fontSize: '0.7rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Language sx={{ fontSize: 14 }} />
            Select language
          </Typography>
        </Box>
        <Divider sx={{ borderColor: axelionColors.borderLight }} />
        {languages.map((lang) => (
          <MenuItem
            key={lang.code}
            onClick={() => handleLanguageSelect(lang.code)}
            selected={language === lang.code}
            sx={{
              py: 1.5,
              px: 2,
              '&.Mui-selected': {
                bgcolor: axelionColors.accentLight,
                '&:hover': {
                  bgcolor: axelionColors.accentMedium,
                },
              },
              '&:hover': {
                bgcolor: axelionColors.bgWarm,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <Typography sx={{ fontSize: '1.2rem' }}>{lang.flag}</Typography>
            </ListItemIcon>
            <ListItemText
              primary={lang.nativeName}
              secondary={lang.name !== lang.nativeName ? lang.name : null}
              primaryTypographyProps={{
                fontWeight: language === lang.code ? 600 : 400,
                color: axelionColors.textPrimary,
                fontSize: '0.9rem',
              }}
              secondaryTypographyProps={{
                color: axelionColors.textMuted,
                fontSize: '0.75rem',
              }}
            />
            {language === lang.code && (
              <Check sx={{ color: axelionColors.gold, ml: 1, fontSize: '1.1rem' }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default LanguageSwitcher;
