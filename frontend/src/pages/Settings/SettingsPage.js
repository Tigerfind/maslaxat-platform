import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container,
  Box,
  Typography,
  Card,
  CardContent,
  Switch,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Slider,
  Button,
  IconButton,
  Divider,
  Stack,
} from '@mui/material';
import {
  ArrowBack,
  Notifications,
  Language,
  Brightness4,
  Lock,
  TextFields,
  ViewCompact,
  RestartAlt,
  Logout,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { logout } from '../../store/slices/authSlice';
import MIMARUBackground from '../../components/UI/MIMARUBackground';

const SettingsPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Default settings
  const defaultSettings = {
    emailNotifications: true,
    pushNotifications: true,
    language: 'ru',
    darkMode: false,
    profileVisibility: 'public',
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

  // Save to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
  }, [settings]);

  // Handler functions
  const handleToggle = (key, label) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    toast.success(`${label} ${!settings[key] ? 'включены' : 'выключены'}`, {
      position: 'bottom-center',
      autoClose: 2000,
    });
  };

  const handleLanguageChange = (event) => {
    const newLang = event.target.value;
    setSettings((prev) => ({
      ...prev,
      language: newLang,
    }));
    const langNames = {
      ru: 'Русский',
      uz: "O'zbekcha",
      en: 'English',
    };
    toast.success(`Язык изменен на ${langNames[newLang]}`, {
      position: 'bottom-center',
      autoClose: 2000,
    });
  };

  const handleVisibilityChange = (event) => {
    const newVisibility = event.target.value;
    setSettings((prev) => ({
      ...prev,
      profileVisibility: newVisibility,
    }));
    const visibilityNames = {
      public: 'Публичный',
      contacts: 'Только контакты',
      private: 'Приватный',
    };
    toast.success(`Видимость профиля: ${visibilityNames[newVisibility]}`, {
      position: 'bottom-center',
      autoClose: 2000,
    });
  };

  const handleFontSizeChange = (event, newValue) => {
    setSettings((prev) => ({
      ...prev,
      fontSize: newValue,
    }));
  };

  const handleFontSizeCommit = (event, newValue) => {
    toast.success(`Размер шрифта: ${newValue}px`, {
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
  const SettingSection = ({ icon, title, children }) => (
    <Card
      sx={{
        mb: 3,
        border: '2px solid rgba(61, 90, 82, 0.08)',
        transition: 'all 0.2s ease',
        '&:hover': {
          borderColor: 'rgba(61, 90, 82, 0.2)',
        },
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(61, 90, 82, 0.1)',
              color: '#3d5a52',
              borderRadius: 1,
              mr: 2,
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6" fontWeight="600" sx={{ color: '#3d5a52' }}>
            {title}
          </Typography>
        </Box>
        {children}
      </CardContent>
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
      }}
    >
      <Box>
        <Typography variant="body1" fontWeight="500" sx={{ color: '#3d5a52' }}>
          {label}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        onChange={onChange}
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': {
            color: '#3d5a52',
          },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
            backgroundColor: '#3d5a52',
          },
        }}
      />
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', position: 'relative', pb: 6 }}>
      <MIMARUBackground />

      {/* Header with Gradient */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #3d5a52 0%, #2a4039 100%)',
          color: 'white',
          py: 4,
          position: 'relative',
          zIndex: 1,
          boxShadow: '0 4px 20px rgba(61, 90, 82, 0.15)',
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate(-1)}
              sx={{
                color: 'white',
                bgcolor: 'rgba(255, 255, 255, 0.1)',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.2)',
                },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Box>
              <Typography variant="h4" fontWeight="bold">
                Настройки
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                Управление параметрами приложения
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1, mt: 4 }}>
        {/* Notifications Section */}
        <SettingSection icon={<Notifications />} title="Уведомления">
          <ToggleItem
            label="Email уведомления"
            description="Получать уведомления на электронную почту"
            checked={settings.emailNotifications}
            onChange={() => handleToggle('emailNotifications', 'Email уведомления')}
          />
          <Divider />
          <ToggleItem
            label="Push-уведомления"
            description="Получать push-уведомления в браузере"
            checked={settings.pushNotifications}
            onChange={() => handleToggle('pushNotifications', 'Push-уведомления')}
          />
        </SettingSection>

        {/* Language Section */}
        <SettingSection icon={<Language />} title="Язык">
          <FormControl component="fieldset">
            <FormLabel
              component="legend"
              sx={{
                color: '#3d5a52',
                fontWeight: 500,
                '&.Mui-focused': {
                  color: '#3d5a52',
                },
              }}
            >
              Выберите язык интерфейса
            </FormLabel>
            <RadioGroup value={settings.language} onChange={handleLanguageChange} sx={{ mt: 2 }}>
              <FormControlLabel
                value="ru"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label="Русский"
              />
              <FormControlLabel
                value="uz"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label="O'zbekcha"
              />
              <FormControlLabel
                value="en"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label="English"
              />
            </RadioGroup>
          </FormControl>
        </SettingSection>

        {/* Theme Section */}
        <SettingSection icon={<Brightness4 />} title="Тема">
          <ToggleItem
            label="Темная тема"
            description="Включить темный режим интерфейса"
            checked={settings.darkMode}
            onChange={() => handleToggle('darkMode', 'Темная тема')}
          />
          <Box
            sx={{
              mt: 2,
              p: 2,
              bgcolor: settings.darkMode ? '#2a2a2a' : '#faf8f6',
              borderRadius: 1,
              transition: 'all 0.3s ease',
            }}
          >
            <Typography variant="body2" sx={{ color: settings.darkMode ? '#fff' : '#3d5a52' }}>
              Предварительный просмотр темы
            </Typography>
          </Box>
        </SettingSection>

        {/* Privacy Section */}
        <SettingSection icon={<Lock />} title="Приватность">
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <FormLabel
              component="legend"
              sx={{
                color: '#3d5a52',
                fontWeight: 500,
                mb: 2,
                '&.Mui-focused': {
                  color: '#3d5a52',
                },
              }}
            >
              Видимость профиля
            </FormLabel>
            <RadioGroup value={settings.profileVisibility} onChange={handleVisibilityChange}>
              <FormControlLabel
                value="public"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body1">Публичный</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ваш профиль виден всем пользователям
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="contacts"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body1">Только контакты</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Только ваши контакты могут видеть профиль
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="private"
                control={
                  <Radio
                    sx={{
                      color: '#3d5a52',
                      '&.Mui-checked': {
                        color: '#3d5a52',
                      },
                    }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body1">Приватный</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ваш профиль скрыт от всех
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>

          <Divider sx={{ my: 3 }} />

          <ToggleItem
            label="Показывать email"
            description="Ваш email будет виден другим пользователям"
            checked={settings.showEmail}
            onChange={() => handleToggle('showEmail', 'Показывать email')}
          />
          <Divider />
          <ToggleItem
            label="Показывать телефон"
            description="Ваш номер телефона будет виден другим пользователям"
            checked={settings.showPhone}
            onChange={() => handleToggle('showPhone', 'Показывать телефон')}
          />
        </SettingSection>

        {/* Display Section */}
        <SettingSection icon={<TextFields />} title="Отображение">
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="body1" fontWeight="500" sx={{ color: '#3d5a52' }}>
                Размер шрифта
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  bgcolor: 'rgba(61, 90, 82, 0.1)',
                  color: '#3d5a52',
                  px: 2,
                  py: 0.5,
                  borderRadius: 1,
                  fontWeight: 600,
                }}
              >
                {settings.fontSize}px
              </Typography>
            </Box>
            <Slider
              value={settings.fontSize}
              onChange={handleFontSizeChange}
              onChangeCommitted={handleFontSizeCommit}
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
                color: '#3d5a52',
                '& .MuiSlider-thumb': {
                  backgroundColor: '#3d5a52',
                },
                '& .MuiSlider-track': {
                  backgroundColor: '#3d5a52',
                },
                '& .MuiSlider-rail': {
                  backgroundColor: 'rgba(61, 90, 82, 0.2)',
                },
                '& .MuiSlider-mark': {
                  backgroundColor: '#3d5a52',
                },
                '& .MuiSlider-markLabel': {
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                },
              }}
            />
            <Box
              sx={{
                mt: 3,
                p: 2,
                bgcolor: '#faf8f6',
                borderRadius: 1,
                border: '1px solid rgba(61, 90, 82, 0.1)',
              }}
            >
              <Typography variant="body2" sx={{ fontSize: `${settings.fontSize}px`, color: '#3d5a52' }}>
                Пример текста с выбранным размером шрифта
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ my: 3 }} />

          <ToggleItem
            label="Компактный режим"
            description="Уменьшить отступы для более плотного интерфейса"
            checked={settings.compactMode}
            onChange={() => handleToggle('compactMode', 'Компактный режим')}
          />
        </SettingSection>

        {/* Reset Button */}
        <Card
          sx={{
            mb: 3,
            border: '2px solid rgba(211, 47, 47, 0.1)',
            transition: 'all 0.2s ease',
            '&:hover': {
              borderColor: 'rgba(211, 47, 47, 0.3)',
            },
          }}
        >
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <RestartAlt sx={{ color: '#d32f2f', mr: 1 }} />
                  <Typography variant="h6" fontWeight="600" sx={{ color: '#d32f2f' }}>
                    Сбросить настройки
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Восстановить все настройки к значениям по умолчанию
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="error"
                startIcon={<RestartAlt />}
                onClick={handleResetToDefaults}
                sx={{
                  borderWidth: 2,
                  '&:hover': {
                    borderWidth: 2,
                  },
                }}
              >
                Сбросить
              </Button>
            </Box>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card
          sx={{
            mb: 3,
            bgcolor: 'rgba(61, 90, 82, 0.05)',
            border: '2px solid rgba(61, 90, 82, 0.1)',
          }}
        >
          <CardContent sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              Все настройки сохраняются автоматически в локальном хранилище браузера
            </Typography>
          </CardContent>
        </Card>

        {/* Logout Button */}
        <Card
          sx={{
            mb: 3,
            border: '2px solid rgba(211, 47, 47, 0.15)',
            transition: 'all 0.2s ease',
            '&:hover': {
              borderColor: 'rgba(211, 47, 47, 0.4)',
              boxShadow: '0 4px 12px rgba(211, 47, 47, 0.15)',
            },
          }}
        >
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Logout sx={{ color: '#d32f2f', mr: 1 }} />
                  <Typography variant="h6" fontWeight="600" sx={{ color: '#d32f2f' }}>
                    Выйти из аккаунта
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Завершить текущий сеанс и вернуться на страницу входа
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="error"
                startIcon={<Logout />}
                onClick={() => {
                  dispatch(logout());
                  toast.success('Вы вышли из аккаунта');
                  navigate('/login');
                }}
                sx={{
                  bgcolor: '#d32f2f',
                  '&:hover': {
                    bgcolor: '#c62828',
                  },
                }}
              >
                Выйти
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
};

export default SettingsPage;
