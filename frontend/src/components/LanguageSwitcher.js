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

/**
 * Компонент переключения языка
 *
 * Варианты использования:
 * - <LanguageSwitcher /> - кнопка с выпадающим меню
 * - <LanguageSwitcher variant="buttons" /> - три отдельные кнопки
 * - <LanguageSwitcher variant="minimal" /> - только флаг и код
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

  // Вариант с отдельными кнопками
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
              px: 1.5,
              py: 0.5,
              borderRadius: 2,
              fontSize: '0.85rem',
              fontWeight: language === lang.code ? 'bold' : 'normal',
              bgcolor: language === lang.code ? 'rgba(255,255,255,0.2)' : 'transparent',
              borderColor: 'rgba(255,255,255,0.3)',
              color: 'white',
              '&:hover': {
                bgcolor: 'rgba(255,255,255,0.15)',
                borderColor: 'rgba(255,255,255,0.5)',
              },
            }}
          >
            {lang.flag} {lang.code.toUpperCase()}
          </Button>
        ))}
      </Box>
    );
  }

  // Минимальный вариант
  if (variant === 'minimal') {
    return (
      <Button
        onClick={handleClick}
        sx={{
          minWidth: 'auto',
          color: 'white',
          fontSize: '1rem',
          ...sx,
        }}
      >
        {currentLang.flag}
      </Button>
    );
  }

  // Стандартный вариант с выпадающим меню
  return (
    <>
      <Button
        onClick={handleClick}
        endIcon={<KeyboardArrowDown />}
        sx={{
          color: 'white',
          bgcolor: 'rgba(255,255,255,0.1)',
          borderRadius: 2,
          px: 2,
          py: 1,
          textTransform: 'none',
          '&:hover': {
            bgcolor: 'rgba(255,255,255,0.2)',
          },
          ...sx,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '1.2rem' }}>{currentLang.flag}</Typography>
          <Typography sx={{ fontWeight: 500 }}>{currentLang.nativeName}</Typography>
        </Box>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 180,
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontWeight: 500 }}
          >
            <Language sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            Выберите язык / Тилни танланг / Select language
          </Typography>
        </Box>
        <Divider />
        {languages.map((lang) => (
          <MenuItem
            key={lang.code}
            onClick={() => handleLanguageSelect(lang.code)}
            selected={language === lang.code}
            sx={{
              py: 1.5,
              '&.Mui-selected': {
                bgcolor: 'primary.light',
                '&:hover': {
                  bgcolor: 'primary.light',
                },
              },
            }}
          >
            <ListItemIcon>
              <Typography sx={{ fontSize: '1.3rem' }}>{lang.flag}</Typography>
            </ListItemIcon>
            <ListItemText
              primary={lang.nativeName}
              secondary={lang.name !== lang.nativeName ? lang.name : null}
              primaryTypographyProps={{
                fontWeight: language === lang.code ? 'bold' : 'normal',
              }}
            />
            {language === lang.code && (
              <Check sx={{ color: 'primary.main', ml: 1 }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default LanguageSwitcher;
