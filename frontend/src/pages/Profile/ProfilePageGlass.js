import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  TextField,
  Avatar,
  IconButton,
  Tabs,
  Tab,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  InputAdornment,
  Chip,
  keyframes,
  CircularProgress,
  Card,
  Button,
} from '@mui/material';
import {
  ArrowBack,
  Edit,
  Save,
  Cancel,
  PhotoCamera,
  Person,
  Email,
  Phone,
  LocationOn,
  Lock,
  Visibility,
  VisibilityOff,
  EventNote,
  Description,
  VideoCall,
  CheckCircle,
  Schedule,
  TrendingUp,
} from '@mui/icons-material';
import { updateProfile } from '../../store/slices/authSlice';

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

// Tab Panel Component
const TabPanel = ({ children, value, index }) => (
  <div hidden={value !== index}>
    {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
  </div>
);

const ProfilePageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);

  // Get user from Redux
  const user = useSelector((state) => state.auth.user);

  // State management
  const [activeTab, setActiveTab] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form state for personal info
  const [formData, setFormData] = useState({
    name: user?.name || 'Имя Пользователя',
    email: user?.email || 'user@maslaxat.uz',
    phone: user?.phone || '+998 90 123 45 67',
    address: user?.address || 'Ташкент, Узбекистан',
    avatar: user?.avatar || null,
  });

  // Password change state
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Mock activity data
  const activityLog = [
    {
      id: 1,
      type: 'consultation',
      title: 'Консультация завершена',
      description: 'Консультация с Ивановым И.И.',
      date: '2024-12-08 15:30',
      icon: <VideoCall />,
      color: '#60a5fa',
    },
    {
      id: 2,
      type: 'document',
      title: 'Документ загружен',
      description: 'Договор купли-продажи.pdf',
      date: '2024-12-07 10:15',
      icon: <Description />,
      color: '#f59e0b',
    },
    {
      id: 3,
      type: 'consultation',
      title: 'Консультация запланирована',
      description: 'Встреча с Петровой М.С.',
      date: '2024-12-06 14:00',
      icon: <Schedule />,
      color: '#4ade80',
    },
    {
      id: 4,
      type: 'document',
      title: 'Анализ документа завершен',
      description: 'AI анализ договора',
      date: '2024-12-05 09:45',
      icon: <CheckCircle />,
      color: '#60a5fa',
    },
    {
      id: 5,
      type: 'profile',
      title: 'Профиль обновлен',
      description: 'Изменены личные данные',
      date: '2024-12-04 16:20',
      icon: <Person />,
      color: '#f093fb',
    },
  ];

  // Account stats
  const accountStats = [
    {
      label: 'Зарегистрирован',
      value: 'Ноябрь 2024',
      icon: <EventNote />,
      color: '#2563EB',
    },
    {
      label: 'Консультаций',
      value: '12',
      icon: <VideoCall />,
      color: '#2563EB',
    },
    {
      label: 'Документов',
      value: '8',
      icon: <Description />,
      color: '#2563EB',
    },
    {
      label: 'Рейтинг',
      value: '4.8',
      icon: <TrendingUp />,
      color: '#2563EB',
    },
  ];

  // Handlers
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
    setIsEditMode(false);
  };

  const handleEditToggle = () => {
    if (isEditMode) {
      // Cancel edit - reset form
      setFormData({
        name: user?.name || 'Имя Пользователя',
        email: user?.email || 'user@maslaxat.uz',
        phone: user?.phone || '+998 90 123 45 67',
        address: user?.address || 'Ташкент, Узбекистан',
        avatar: user?.avatar || null,
      });
      setIsEditMode(false);
      toast.info('Изменения отменены');
    } else {
      setIsEditMode(true);
      toast.info('Режим редактирования активирован');
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAvatarClick = () => {
    if (isEditMode) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Размер файла не должен превышать 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({
          ...prev,
          avatar: reader.result,
        }));
        toast.success('Фото профиля обновлено');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveChanges = () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error('Имя не может быть пустым');
      return;
    }

    if (!formData.email.trim() || !formData.email.includes('@')) {
      toast.error('Введите корректный email');
      return;
    }

    // Update Redux state
    dispatch(updateProfile(formData));
    setIsEditMode(false);
    toast.success('Профиль успешно обновлен!');
  };

  const handlePasswordSubmit = () => {
    // Validation
    if (!passwordData.oldPassword) {
      toast.error('Введите текущий пароль');
      return;
    }

    if (!passwordData.newPassword) {
      toast.error('Введите новый пароль');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }

    // Here you would typically make an API call
    // For now, we'll just show a success message
    toast.success('Пароль успешно изменен!');

    // Reset form
    setPasswordData({
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: '#F4F6F8',
        pb: 4,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                background: '#FFFFFF',
                border: '1px solid #E6E9EE',
                color: '#0B1B2B',
                '&:hover': {
                  background: '#F4F6F8',
                },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Box>
              <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                Мой профиль
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                Управление вашей учетной записью
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        {/* Profile Header with Avatar */}
        <Card
          sx={{
            mb: 4,
            animation: `${fadeInUp} 0.6s ease-out`,
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            p: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={formData.avatar}
                sx={{
                  width: 100,
                  height: 100,
                  border: '2px solid #E6E9EE',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  cursor: isEditMode ? 'pointer' : 'default',
                  transition: 'all 0.3s ease',
                  '&:hover': isEditMode
                    ? {
                        transform: 'scale(1.05)',
                        boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
                      }
                    : {},
                  background: '#2563EB',
                  fontSize: '2.5rem',
                  fontWeight: 'bold',
                }}
                onClick={handleAvatarClick}
              >
                {!formData.avatar && formData.name.charAt(0).toUpperCase()}
              </Avatar>
              {isEditMode && (
                <IconButton
                  onClick={handleAvatarClick}
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    background: '#2563EB',
                    color: 'white',
                    '&:hover': {
                      background: '#1d4ed8',
                    },
                    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  }}
                  size="small"
                >
                  <PhotoCamera fontSize="small" />
                </IconButton>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </Box>

            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h4" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                {formData.name}
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280', mb: 2 }}>
                {formData.email}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  label="Активный"
                  sx={{
                    background: '#22c55e',
                    color: 'white',
                    fontWeight: 600,
                    border: '1px solid #E6E9EE',
                  }}
                />
                <Chip
                  label="Клиент"
                  sx={{
                    background: '#F4F6F8',
                    color: '#0B1B2B',
                    fontWeight: 600,
                    border: '1px solid #E6E9EE',
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Card>

        {/* Tabs Section */}
        <Card
          sx={{
            animation: `${fadeInUp} 0.6s ease-out 0.1s both`,
            p: 0,
            overflow: 'hidden',
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          }}
        >
          {/* Tabs */}
          <Box sx={{ borderBottom: '1px solid #E6E9EE' }}>
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              sx={{
                px: 3,
                '& .MuiTab-root': {
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  textTransform: 'none',
                  color: '#6B7280',
                  transition: 'all 0.3s ease',
                  '&.Mui-selected': {
                    color: '#0B1B2B',
                  },
                  '&:hover': {
                    color: '#0B1B2B',
                  },
                },
                '& .MuiTabs-indicator': {
                  background: '#2563EB',
                  height: 3,
                },
              }}
            >
              <Tab label="Личная информация" />
              <Tab label="Безопасность" />
              <Tab label="История активности" />
            </Tabs>
          </Box>

          {/* Tab 1: Personal Information */}
          <TabPanel value={activeTab} index={0}>
            <Box sx={{ p: 4 }}>
              {/* Edit/Save Buttons */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 4, gap: 2 }}>
                {isEditMode ? (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<Cancel />}
                      onClick={handleEditToggle}
                      sx={{
                        borderColor: '#E6E9EE',
                        color: '#6B7280',
                        '&:hover': {
                          borderColor: '#0B1B2B',
                          background: '#F4F6F8',
                        },
                      }}
                    >
                      Отмена
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<Save />}
                      onClick={handleSaveChanges}
                      sx={{
                        background: '#2563EB',
                        color: 'white',
                        '&:hover': {
                          background: '#1d4ed8',
                        },
                        boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                      }}
                    >
                      Сохранить изменения
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="contained"
                    startIcon={<Edit />}
                    onClick={handleEditToggle}
                    sx={{
                      background: '#2563EB',
                      color: 'white',
                      '&:hover': {
                        background: '#1d4ed8',
                      },
                      boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                    }}
                  >
                    Редактировать профиль
                  </Button>
                )}
              </Box>

              {/* Personal Info Form */}
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Полное имя"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Person sx={{ color: '#6B7280' }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        color: '#0B1B2B',
                        '& fieldset': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover fieldset': {
                          borderColor: '#6B7280',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#2563EB',
                        },
                      },
                      '& .MuiInputBase-input.Mui-disabled': {
                        color: '#6B7280',
                        WebkitTextFillColor: '#6B7280',
                      },
                    }}
                    InputLabelProps={{
                      sx: {
                        color: '#6B7280',
                        '&.Mui-focused': {
                          color: '#2563EB',
                        },
                      },
                    }}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Email sx={{ color: '#6B7280' }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        color: '#0B1B2B',
                        '& fieldset': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover fieldset': {
                          borderColor: '#6B7280',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#2563EB',
                        },
                      },
                      '& .MuiInputBase-input.Mui-disabled': {
                        color: '#6B7280',
                        WebkitTextFillColor: '#6B7280',
                      },
                    }}
                    InputLabelProps={{
                      sx: {
                        color: '#6B7280',
                        '&.Mui-focused': {
                          color: '#2563EB',
                        },
                      },
                    }}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Телефон"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Phone sx={{ color: '#6B7280' }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        color: '#0B1B2B',
                        '& fieldset': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover fieldset': {
                          borderColor: '#6B7280',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#2563EB',
                        },
                      },
                      '& .MuiInputBase-input.Mui-disabled': {
                        color: '#6B7280',
                        WebkitTextFillColor: '#6B7280',
                      },
                    }}
                    InputLabelProps={{
                      sx: {
                        color: '#6B7280',
                        '&.Mui-focused': {
                          color: '#2563EB',
                        },
                      },
                    }}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Адрес"
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LocationOn sx={{ color: '#6B7280' }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        color: '#0B1B2B',
                        '& fieldset': {
                          borderColor: '#E6E9EE',
                        },
                        '&:hover fieldset': {
                          borderColor: '#6B7280',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#2563EB',
                        },
                      },
                      '& .MuiInputBase-input.Mui-disabled': {
                        color: '#6B7280',
                        WebkitTextFillColor: '#6B7280',
                      },
                    }}
                    InputLabelProps={{
                      sx: {
                        color: '#6B7280',
                        '&.Mui-focused': {
                          color: '#2563EB',
                        },
                      },
                    }}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 4, borderColor: '#E6E9EE' }} />

              {/* Account Statistics */}
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 3, color: '#0B1B2B' }}>
                Статистика аккаунта
              </Typography>

              <Grid container spacing={3}>
                {accountStats.map((stat, index) => (
                  <Grid
                    item
                    xs={12}
                    sm={6}
                    md={3}
                    key={index}
                    sx={{
                      animation: `${fadeInUp} 0.6s ease-out`,
                      animationDelay: `${index * 0.1}s`,
                      animationFillMode: 'both',
                    }}
                  >
                    <Card
                      sx={{
                        p: 3,
                        background: '#FFFFFF',
                        border: '1px solid #E6E9EE',
                        borderRadius: '8px',
                        boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
                          transform: 'translateY(-2px)',
                        },
                      }}
                    >
                      <Box sx={{ textAlign: 'center' }}>
                        <Box
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '8px',
                            background: stat.color,
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto',
                            mb: 2,
                            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                          }}
                        >
                          {stat.icon}
                        </Box>
                        <Typography variant="h5" fontWeight="bold" sx={{ color: '#0B1B2B', mb: 1 }}>
                          {stat.value}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#6B7280' }}>
                          {stat.label}
                        </Typography>
                      </Box>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          </TabPanel>

          {/* Tab 2: Security (Password Change) */}
          <TabPanel value={activeTab} index={1}>
            <Box sx={{ p: 4, maxWidth: 600 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 1, color: '#0B1B2B' }}>
                Изменить пароль
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280', mb: 4 }}>
                Обеспечьте безопасность вашего аккаунта, используя надежный пароль
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TextField
                  fullWidth
                  label="Текущий пароль"
                  name="oldPassword"
                  type={showOldPassword ? 'text' : 'password'}
                  value={passwordData.oldPassword}
                  onChange={handlePasswordChange}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock sx={{ color: '#6B7280' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowOldPassword(!showOldPassword)}
                          edge="end"
                          sx={{ color: '#6B7280' }}
                        >
                          {showOldPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: '#0B1B2B',
                      '& fieldset': {
                        borderColor: '#E6E9EE',
                      },
                      '&:hover fieldset': {
                        borderColor: '#6B7280',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#2563EB',
                      },
                    },
                  }}
                  InputLabelProps={{
                    sx: {
                      color: '#6B7280',
                      '&.Mui-focused': {
                        color: '#2563EB',
                      },
                    },
                  }}
                />

                <TextField
                  fullWidth
                  label="Новый пароль"
                  name="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  helperText="Минимум 6 символов"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock sx={{ color: '#6B7280' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          edge="end"
                          sx={{ color: '#6B7280' }}
                        >
                          {showNewPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: '#0B1B2B',
                      '& fieldset': {
                        borderColor: '#E6E9EE',
                      },
                      '&:hover fieldset': {
                        borderColor: '#6B7280',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#2563EB',
                      },
                    },
                    '& .MuiFormHelperText-root': {
                      color: '#6B7280',
                    },
                  }}
                  InputLabelProps={{
                    sx: {
                      color: '#6B7280',
                      '&.Mui-focused': {
                        color: '#2563EB',
                      },
                    },
                  }}
                />

                <TextField
                  fullWidth
                  label="Подтвердите новый пароль"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock sx={{ color: '#6B7280' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          edge="end"
                          sx={{ color: '#6B7280' }}
                        >
                          {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: '#0B1B2B',
                      '& fieldset': {
                        borderColor: '#E6E9EE',
                      },
                      '&:hover fieldset': {
                        borderColor: '#6B7280',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#2563EB',
                      },
                    },
                  }}
                  InputLabelProps={{
                    sx: {
                      color: '#6B7280',
                      '&.Mui-focused': {
                        color: '#2563EB',
                      },
                    },
                  }}
                />

                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  onClick={handlePasswordSubmit}
                  sx={{
                    mt: 2,
                    background: '#2563EB',
                    color: 'white',
                    '&:hover': {
                      background: '#1d4ed8',
                    },
                    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  }}
                >
                  Изменить пароль
                </Button>
              </Box>

              <Divider sx={{ my: 4, borderColor: '#E6E9EE' }} />

              {/* Security Tips */}
              <Card
                sx={{
                  p: 3,
                  background: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                  borderRadius: '8px',
                  boxShadow: 'none',
                }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight="bold"
                  sx={{ color: '#0B1B2B', mb: 2 }}
                >
                  Советы по безопасности
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280', mb: 1 }}>
                  • Используйте комбинацию букв, цифр и специальных символов
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280', mb: 1 }}>
                  • Не используйте один и тот же пароль на разных сайтах
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                  • Регулярно меняйте пароль для повышения безопасности
                </Typography>
              </Card>
            </Box>
          </TabPanel>

          {/* Tab 3: Activity History */}
          <TabPanel value={activeTab} index={2}>
            <Box sx={{ p: 4 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 1, color: '#0B1B2B' }}>
                Недавняя активность
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280', mb: 4 }}>
                Отслеживайте все действия в вашем аккаунте
              </Typography>

              <List sx={{ bgcolor: 'transparent' }}>
                {activityLog.map((activity, index) => (
                  <React.Fragment key={activity.id}>
                    <ListItem
                      sx={{
                        py: 2.5,
                        px: 0,
                        '&:hover': {
                          bgcolor: '#F4F6F8',
                        },
                        transition: 'all 0.3s ease',
                      }}
                    >
                      <ListItemIcon>
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: '50%',
                            background: activity.color,
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                          }}
                        >
                          {activity.icon}
                        </Box>
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography variant="subtitle1" fontWeight="600" sx={{ color: '#0B1B2B' }}>
                            {activity.title}
                          </Typography>
                        }
                        secondary={
                          <>
                            <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                              {activity.description}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#2563EB', mt: 0.5, display: 'block' }}>
                              {activity.date}
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                    {index < activityLog.length - 1 && (
                      <Divider sx={{ borderColor: '#E6E9EE' }} />
                    )}
                  </React.Fragment>
                ))}
              </List>

              {/* Load More Button */}
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Button
                  variant="outlined"
                  onClick={() => toast.info('Загрузка дополнительных данных...')}
                  sx={{
                    borderColor: '#E6E9EE',
                    color: '#6B7280',
                    '&:hover': {
                      borderColor: '#2563EB',
                      background: '#F4F6F8',
                      color: '#2563EB',
                    },
                  }}
                >
                  Загрузить больше
                </Button>
              </Box>
            </Box>
          </TabPanel>
        </Card>
      </Container>
    </Box>
  );
};

export default ProfilePageGlass;
