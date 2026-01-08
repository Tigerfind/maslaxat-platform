import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container,
  Box,
  Typography,
  Switch,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Slider,
  IconButton,
  Divider,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  Button,
} from '@mui/material';
import {
  ArrowBack,
  Notifications,
  Language,
  Brightness4,
  Lock,
  TextFields,
  RestartAlt,
  Logout,
  Check,
  Close,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { logout } from '../../store/slices/authSlice';

const SettingsPageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Default settings
  const defaultSettings = {
    emailNotifications: true,
    pushNotifications: true,
    language: 'ru',
    darkMode: false,
    profileVisibility: 'public',
    dataSharing: false,
    showEmail: true,
    showPhone: false,
    fontSize: 16,
    compactMode: false,
  };

  // Load settings from localStorage or use defaults
  const loadSettings = () => {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  };

  // State management
  const [settings, setSettings] = useState(loadSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // Detect changes
  useEffect(() => {
    const saved = loadSettings();
    const isChanged = JSON.stringify(saved) !== JSON.stringify(settings);
    setHasChanges(isChanged);
  }, [settings]);

  // Handler functions
  const handleToggle = (key, label) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleLanguageChange = (event) => {
    const newLang = event.target.value;
    setSettings((prev) => ({
      ...prev,
      language: newLang,
    }));
  };

  const handleVisibilityChange = (event) => {
    const newVisibility = event.target.value;
    setSettings((prev) => ({
      ...prev,
      profileVisibility: newVisibility,
    }));
  };

  const handleFontSizeChange = (event, newValue) => {
    setSettings((prev) => ({
      ...prev,
      fontSize: newValue,
    }));
  };

  const handleSaveSettings = () => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
    setHasChanges(false);
    toast.success('Настройки сохранены успешно', {
      position: 'bottom-center',
      autoClose: 2000,
    });
  };

  const handleResetToDefaults = () => {
    setSettings(defaultSettings);
    toast.success('Настройки сброшены к значениям по умолчанию', {
      position: 'bottom-center',
      autoClose: 2000,
    });
  };

  // Section component for consistent styling
  const SettingSection = ({ icon, title, subtitle, children }) => (
    <Card
      sx={{
        bgcolor: '#FFFFFF',
        border: '1px solid #E6E9EE',
        borderRadius: '12px',
        boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
        p: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 3 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: '10px',
            color: '#2563EB',
            mr: 3,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography
            variant="h6"
            fontWeight="700"
            sx={{
              color: '#0B1B2B',
              mb: 0.5,
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: '#6B7280' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
      {children}
    </Card>
  );

  // Toggle item component
  const ToggleItem = ({ label, description, checked, onChange }) => (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 2,
        '&:not(:last-child)': {
          borderBottom: '1px solid #E6E9EE',
        },
      }}
    >
      <Box>
        <Typography variant="body2" fontWeight="600" sx={{ color: '#0B1B2B', mb: 0.5 }}>
          {label}
        </Typography>
        {description && (
          <Typography variant="caption" sx={{ color: '#6B7280' }}>
            {description}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        onChange={onChange}
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': {
            color: '#2563EB',
          },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
            backgroundColor: '#2563EB',
          },
          '& .MuiSwitch-track': {
            backgroundColor: '#E6E9EE',
          },
        }}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#F4F6F8',
        pb: 6,
      }}
    >

      {/* Header */}
      <Box
        sx={{
          bgcolor: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          pt: 3,
          pb: 3,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate(-1)}
              sx={{
                color: '#0B1B2B',
                bgcolor: '#FFFFFF',
                border: '1px solid #E6E9EE',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                '&:hover': {
                  bgcolor: '#F4F6F8',
                  borderColor: '#2563EB',
                },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Box>
              <Typography
                variant="h4"
                fontWeight="700"
                sx={{
                  color: '#0B1B2B',
                  letterSpacing: '-0.02em',
                }}
              >
                Настройки
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                Управление параметрами приложения
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Stack spacing={3}>
          {/* Notifications Section */}
          <SettingSection
            icon={<Notifications sx={{ fontSize: 28 }} />}
            title="Уведомления"
            subtitle="Управление параметрами уведомлений"
          >
            <ToggleItem
              label="Email уведомления"
              description="Получать уведомления на электронную почту"
              checked={settings.emailNotifications}
              onChange={() => handleToggle('emailNotifications')}
            />
            <ToggleItem
              label="Push-уведомления"
              description="Получать push-уведомления в браузере"
              checked={settings.pushNotifications}
              onChange={() => handleToggle('pushNotifications')}
            />
          </SettingSection>

          {/* Privacy Section */}
          <SettingSection
            icon={<Lock sx={{ fontSize: 28 }} />}
            title="Приватность"
            subtitle="Управление видимостью вашего профиля"
          >
            <FormControl component="fieldset" sx={{ width: '100%' }}>
              <FormLabel
                component="legend"
                sx={{
                  color: '#0B1B2B',
                  fontWeight: 600,
                  mb: 2,
                  fontSize: '0.95rem',
                  '&.Mui-focused': {
                    color: '#0B1B2B',
                  },
                }}
              >
                Видимость профиля
              </FormLabel>
              <RadioGroup value={settings.profileVisibility} onChange={handleVisibilityChange}>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    value="public"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={
                      <Box sx={{ ml: 1 }}>
                        <Typography
                          variant="body2"
                          fontWeight="600"
                          sx={{ color: '#0B1B2B', mb: 0.25 }}
                        >
                          Публичный
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#6B7280' }}>
                          Ваш профиль виден всем пользователям
                        </Typography>
                      </Box>
                    }
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    value="contacts"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={
                      <Box sx={{ ml: 1 }}>
                        <Typography
                          variant="body2"
                          fontWeight="600"
                          sx={{ color: '#0B1B2B', mb: 0.25 }}
                        >
                          Только контакты
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#6B7280' }}>
                          Только ваши контакты могут видеть профиль
                        </Typography>
                      </Box>
                    }
                  />
                </Box>
                <Box>
                  <FormControlLabel
                    value="private"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={
                      <Box sx={{ ml: 1 }}>
                        <Typography
                          variant="body2"
                          fontWeight="600"
                          sx={{ color: '#0B1B2B', mb: 0.25 }}
                        >
                          Приватный
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#6B7280' }}>
                          Ваш профиль скрыт от всех
                        </Typography>
                      </Box>
                    }
                  />
                </Box>
              </RadioGroup>
            </FormControl>

            <Divider sx={{ my: 3, borderColor: '#E6E9EE' }} />

            <ToggleItem
              label="Показывать email"
              description="Ваш email будет виден другим пользователям"
              checked={settings.showEmail}
              onChange={() => handleToggle('showEmail')}
            />

            <ToggleItem
              label="Показывать телефон"
              description="Ваш номер телефона будет виден другим пользователям"
              checked={settings.showPhone}
              onChange={() => handleToggle('showPhone')}
            />

            <Divider sx={{ my: 3, borderColor: '#E6E9EE' }} />

            <ToggleItem
              label="Общий доступ данных"
              description="Разрешить анализ данных для улучшения сервиса"
              checked={settings.dataSharing}
              onChange={() => handleToggle('dataSharing')}
            />
          </SettingSection>

          {/* Language Section */}
          <SettingSection
            icon={<Language sx={{ fontSize: 28 }} />}
            title="Язык"
            subtitle="Выберите язык интерфейса"
          >
            <FormControl component="fieldset" sx={{ width: '100%' }}>
              <RadioGroup value={settings.language} onChange={handleLanguageChange}>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    value="ru"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={<Typography sx={{ color: '#0B1B2B', fontWeight: 500 }}>Русский</Typography>}
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    value="uz"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={<Typography sx={{ color: '#0B1B2B', fontWeight: 500 }}>O'zbekcha</Typography>}
                  />
                </Box>
                <Box>
                  <FormControlLabel
                    value="en"
                    control={
                      <Radio
                        sx={{
                          color: '#6B7280',
                          '&.Mui-checked': {
                            color: '#2563EB',
                          },
                        }}
                      />
                    }
                    label={<Typography sx={{ color: '#0B1B2B', fontWeight: 500 }}>English</Typography>}
                  />
                </Box>
              </RadioGroup>
            </FormControl>
          </SettingSection>

          {/* Theme Section */}
          <SettingSection
            icon={<Brightness4 sx={{ fontSize: 28 }} />}
            title="Тема"
            subtitle="Параметры отображения интерфейса"
          >
            <ToggleItem
              label="Темная тема"
              description="Включить темный режим интерфейса"
              checked={settings.darkMode}
              onChange={() => handleToggle('darkMode')}
            />
            <Box
              sx={{
                mt: 3,
                p: 3,
                bgcolor: settings.darkMode ? '#1F2937' : '#F9FAFB',
                border: '1px solid #E6E9EE',
                borderRadius: '10px',
                transition: 'all 0.3s ease',
              }}
            >
              <Typography variant="body2" sx={{ color: settings.darkMode ? '#F9FAFB' : '#0B1B2B', fontWeight: 500 }}>
                Предварительный просмотр темы
              </Typography>
            </Box>
          </SettingSection>

          {/* Display Section */}
          <SettingSection
            icon={<TextFields sx={{ fontSize: 28 }} />}
            title="Отображение"
            subtitle="Настройки размера и расположения элементов"
          >
            <Box sx={{ mb: 4 }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 3,
                }}
              >
                <Typography variant="body2" fontWeight="600" sx={{ color: '#0B1B2B' }}>
                  Размер шрифта
                </Typography>
                <Box
                  sx={{
                    bgcolor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    color: '#2563EB',
                    px: 2,
                    py: 0.75,
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                  }}
                >
                  {settings.fontSize}px
                </Box>
              </Box>
              <Slider
                value={settings.fontSize}
                onChange={handleFontSizeChange}
                min={12}
                max={24}
                step={1}
                marks={[
                  { value: 12, label: '12px' },
                  { value: 16, label: '16px' },
                  { value: 20, label: '20px' },
                  { value: 24, label: '24px' },
                ]}
                sx={{
                  color: '#2563EB',
                  '& .MuiSlider-thumb': {
                    backgroundColor: '#2563EB',
                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.2)',
                  },
                  '& .MuiSlider-track': {
                    backgroundColor: '#2563EB',
                  },
                  '& .MuiSlider-rail': {
                    backgroundColor: '#E6E9EE',
                  },
                  '& .MuiSlider-mark': {
                    backgroundColor: '#9CA3AF',
                  },
                  '& .MuiSlider-markLabel': {
                    color: '#6B7280',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  },
                }}
              />
              <Box
                sx={{
                  mt: 4,
                  p: 3,
                  bgcolor: '#F9FAFB',
                  border: '1px solid #E6E9EE',
                  borderRadius: '10px',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: `${settings.fontSize}px`,
                    color: '#0B1B2B',
                    fontWeight: 500,
                  }}
                >
                  Пример текста с выбранным размером шрифта
                </Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 3, borderColor: '#E6E9EE' }} />

            <ToggleItem
              label="Компактный режим"
              description="Уменьшить отступы для более плотного интерфейса"
              checked={settings.compactMode}
              onChange={() => handleToggle('compactMode')}
            />
          </SettingSection>

          {/* Action Buttons */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 3 }}>
            {/* Save Button */}
            <Card
              sx={{
                bgcolor: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
              }}
            >
              <Button
                variant="contained"
                fullWidth
                size="large"
                startIcon={<Check />}
                onClick={handleSaveSettings}
                disabled={!hasChanges}
                sx={{
                  bgcolor: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  textTransform: 'none',
                  py: 1.5,
                  borderRadius: '8px',
                  boxShadow: hasChanges ? '0 2px 6px rgba(37, 99, 235, 0.2)' : 'none',
                  '&:hover': {
                    bgcolor: '#1D4ED8',
                  },
                  '&:disabled': {
                    bgcolor: '#E6E9EE',
                    color: '#9CA3AF',
                  },
                }}
              >
                Сохранить изменения
              </Button>
              {hasChanges && (
                <Typography
                  variant="caption"
                  sx={{
                    color: '#2563EB',
                    display: 'block',
                    mt: 2,
                    textAlign: 'center',
                    fontWeight: 600,
                  }}
                >
                  У вас есть несохраненные изменения
                </Typography>
              )}
            </Card>

            {/* Reset Button */}
            <Card
              sx={{
                bgcolor: '#FFFFFF',
                border: '1px solid #E6E9EE',
                borderRadius: '12px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                p: 3,
              }}
            >
              <Button
                variant="outlined"
                fullWidth
                size="large"
                startIcon={<RestartAlt />}
                onClick={handleResetToDefaults}
                sx={{
                  borderColor: '#E6E9EE',
                  color: '#0B1B2B',
                  fontWeight: 600,
                  textTransform: 'none',
                  py: 1.5,
                  borderRadius: '8px',
                  '&:hover': {
                    borderColor: '#2563EB',
                    bgcolor: '#F4F6F8',
                  },
                }}
              >
                Сбросить
              </Button>
            </Card>
          </Box>

          {/* Logout Section */}
          <Card
            sx={{
              bgcolor: '#FFFFFF',
              border: '1px solid #E6E9EE',
              borderRadius: '12px',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              p: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Logout sx={{ color: '#DC2626', mr: 1.5, fontSize: 24 }} />
                  <Typography variant="h6" fontWeight="700" sx={{ color: '#0B1B2B' }}>
                    Выйти из аккаунта
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: '#6B7280', display: 'block' }}>
                  Завершить текущий сеанс и вернуться на страницу входа
                </Typography>
              </Box>
              <Button
                variant="contained"
                onClick={() => setConfirmDialog(true)}
                sx={{
                  bgcolor: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  textTransform: 'none',
                  px: 3,
                  py: 1,
                  borderRadius: '8px',
                  '&:hover': {
                    bgcolor: '#B91C1C',
                  },
                }}
              >
                Выйти
              </Button>
            </Box>
          </Card>

          {/* Info Card */}
          <Card
            sx={{
              bgcolor: '#F9FAFB',
              border: '1px solid #E6E9EE',
              borderRadius: '12px',
              boxShadow: 'none',
              p: 3,
            }}
          >
            <Typography variant="body2" sx={{ color: '#6B7280', textAlign: 'center' }}>
              Все настройки сохраняются в локальном хранилище браузера
            </Typography>
          </Card>
        </Stack>
      </Container>

      {/* Logout Confirmation Dialog */}
      <Dialog
        open={confirmDialog}
        onClose={() => setConfirmDialog(false)}
        PaperProps={{
          sx: {
            bgcolor: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(11, 27, 43, 0.12)',
          },
        }}
      >
        <DialogTitle
          sx={{
            color: '#0B1B2B',
            fontWeight: 700,
            fontSize: '1.25rem',
          }}
        >
          Подтверждение выхода
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#6B7280', mt: 2 }}>
            Вы уверены, что хотите выйти из аккаунта?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            variant="outlined"
            onClick={() => setConfirmDialog(false)}
            startIcon={<Close />}
            sx={{
              borderColor: '#E6E9EE',
              color: '#0B1B2B',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
              py: 1,
              borderRadius: '8px',
              '&:hover': {
                borderColor: '#2563EB',
                bgcolor: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              dispatch(logout());
              toast.success('Вы вышли из аккаунта');
              navigate('/login');
            }}
            startIcon={<Check />}
            sx={{
              bgcolor: '#DC2626',
              color: '#FFFFFF',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
              py: 1,
              borderRadius: '8px',
              '&:hover': {
                bgcolor: '#B91C1C',
              },
            }}
          >
            Выйти
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SettingsPageGlass;
