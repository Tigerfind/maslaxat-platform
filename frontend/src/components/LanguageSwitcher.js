import React, { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { KeyboardArrowDown, LanguageOutlined } from '@mui/icons-material';
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

  // Default dropdown variant — trigger + список полных названий с кодом
  return (
    <>
      <Button
        onClick={handleClick}
        endIcon={<KeyboardArrowDown sx={{ fontSize: '1rem' }} />}
        sx={{
          color: axelionColors.textPrimary,
          backgroundColor: axelionColors.bgLight,
          border: `1px solid ${axelionColors.borderLight}`,
          borderRadius: '10px',
          px: 1.75,
          py: 0.9,
          textTransform: 'none',
          fontWeight: 500,
          '&:hover': {
            backgroundColor: axelionColors.bgWarm,
            borderColor: axelionColors.gold,
          },
          ...sx,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LanguageOutlined sx={{ fontSize: 18, color: axelionColors.goldDark }} />
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
            minWidth: 190,
            borderRadius: '14px',
            p: 0.75,
            border: `1px solid ${axelionColors.borderLight}`,
            boxShadow: '0 12px 34px rgba(26, 26, 26, 0.14)',
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {languages.map((lang) => {
          const active = language === lang.code;
          return (
            <MenuItem
              key={lang.code}
              onClick={() => handleLanguageSelect(lang.code)}
              selected={active}
              disableRipple
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 3,
                py: 1.1,
                px: 1.5,
                borderRadius: '9px',
                '&.Mui-selected': {
                  bgcolor: axelionColors.accentLight,
                  '&:hover': { bgcolor: axelionColors.accentMedium },
                },
                '&:hover': { bgcolor: axelionColors.bgWarm },
              }}
            >
              <Typography
                sx={{
                  fontWeight: active ? 600 : 400,
                  color: active ? axelionColors.goldDark : axelionColors.textPrimary,
                  fontSize: '0.9rem',
                }}
              >
                {lang.nativeName}
              </Typography>
              <Typography
                sx={{
                  color: active ? axelionColors.gold : axelionColors.textMuted,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                }}
              >
                {lang.code.toUpperCase()}
              </Typography>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

export default LanguageSwitcher;
