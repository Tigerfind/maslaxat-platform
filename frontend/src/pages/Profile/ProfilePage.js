import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Button,
  TextField,
  Avatar,
  IconButton,
  Tabs,
  Tab,
  Paper,
  Grid,
  Divider,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  InputAdornment,
  Chip,
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

// Tab Panel Component
const TabPanel = ({ children, value, index }) => (
  <div hidden={value !== index}>
    {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
  </div>
);

const ProfilePage = () => {
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
      color: '#3d5a52',
    },
    {
      id: 2,
      type: 'document',
      title: 'Документ загружен',
      description: 'Договор купли-продажи.pdf',
      date: '2024-12-07 10:15',
      icon: <Description />,
      color: '#a67c52',
    },
    {
      id: 3,
      type: 'consultation',
      title: 'Консультация запланирована',
      description: 'Встреча с Петровой М.С.',
      date: '2024-12-06 14:00',
      icon: <Schedule />,
      color: '#5a8b7d',
    },
    {
      id: 4,
      type: 'document',
      title: 'Анализ документа завершен',
      description: 'AI анализ договора',
      date: '2024-12-05 09:45',
      icon: <CheckCircle />,
      color: '#3d5a52',
    },
    {
      id: 5,
      type: 'profile',
      title: 'Профиль обновлен',
      description: 'Изменены личные данные',
      date: '2024-12-04 16:20',
      icon: <Person />,
      color: '#a67c52',
    },
  ];

  // Account stats
  const accountStats = [
    {
      label: 'Зарегистрирован',
      value: 'Ноябрь 2024',
      icon: <EventNote />,
      color: '#3d5a52',
    },
    {
      label: 'Консультаций',
      value: '12',
      icon: <VideoCall />,
      color: '#5a8b7d',
    },
    {
      label: 'Документов',
      value: '8',
      icon: <Description />,
      color: '#a67c52',
    },
    {
      label: 'Рейтинг',
      value: '4.8',
      icon: <TrendingUp />,
      color: '#d4a574',
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
    <Box sx={{ minHeight: '100vh', bgcolor: '#faf8f6', pb: 6 }}>
      {/* Header with Gradient */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #3d5a52 0%, #5a7d72 100%)',
          color: 'white',
          pt: 3,
          pb: 8,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative background pattern */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.1,
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                color: 'white',
                bgcolor: 'rgba(255,255,255,0.1)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
                mr: 2,
              }}
            >
              <ArrowBack />
            </IconButton>
            <Typography variant="h4" fontWeight="bold">
              Профиль
            </Typography>
          </Box>

          {/* Profile Avatar and Basic Info */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={formData.avatar}
                sx={{
                  width: 120,
                  height: 120,
                  border: '4px solid white',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  cursor: isEditMode ? 'pointer' : 'default',
                  transition: 'all 0.3s ease',
                  '&:hover': isEditMode
                    ? {
                        transform: 'scale(1.05)',
                        boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
                      }
                    : {},
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
                    bgcolor: 'white',
                    color: '#3d5a52',
                    '&:hover': { bgcolor: '#f0f0f0' },
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
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
              <Typography variant="h4" fontWeight="bold" sx={{ mb: 1 }}>
                {formData.name}
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.9, mb: 2 }}>
                {formData.email}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  label="Активный аккаунт"
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    fontWeight: 600,
                  }}
                />
                <Chip
                  label="Клиент"
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    fontWeight: 600,
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ mt: -4, position: 'relative', zIndex: 2 }}>
        <Paper
          elevation={0}
          sx={{
            borderRadius: 4,
            overflow: 'hidden',
            border: '1px solid rgba(61, 90, 82, 0.1)',
          }}
        >
          {/* Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'white' }}>
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              sx={{
                px: 3,
                '& .MuiTab-root': {
                  fontWeight: 600,
                  fontSize: '1rem',
                  textTransform: 'none',
                  color: '#636e72',
                  '&.Mui-selected': {
                    color: '#3d5a52',
                  },
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#3d5a52',
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
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3, gap: 2 }}>
                {isEditMode ? (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<Cancel />}
                      onClick={handleEditToggle}
                      sx={{
                        borderColor: '#d36969',
                        color: '#d36969',
                        '&:hover': {
                          borderColor: '#b84f4f',
                          bgcolor: 'rgba(211, 105, 105, 0.04)',
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
                        bgcolor: '#3d5a52',
                        '&:hover': { bgcolor: '#2a403a' },
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
                      bgcolor: '#3d5a52',
                      '&:hover': { bgcolor: '#2a403a' },
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
                          <Person sx={{ color: '#3d5a52' }} />
                        </InputAdornment>
                      ),
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
                          <Email sx={{ color: '#3d5a52' }} />
                        </InputAdornment>
                      ),
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
                          <Phone sx={{ color: '#3d5a52' }} />
                        </InputAdornment>
                      ),
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
                          <LocationOn sx={{ color: '#3d5a52' }} />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 4 }} />

              {/* Account Statistics */}
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 3, color: '#2d3436' }}>
                Статистика аккаунта
              </Typography>

              <Grid container spacing={3}>
                {accountStats.map((stat, index) => (
                  <Grid item xs={12} sm={6} md={3} key={index}>
                    <Card
                      sx={{
                        border: `2px solid ${stat.color}15`,
                        boxShadow: 'none',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          borderColor: `${stat.color}40`,
                          transform: 'translateY(-4px)',
                        },
                      }}
                    >
                      <CardContent sx={{ textAlign: 'center' }}>
                        <Box
                          sx={{
                            width: 50,
                            height: 50,
                            borderRadius: '50%',
                            bgcolor: `${stat.color}10`,
                            color: stat.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto',
                            mb: 2,
                          }}
                        >
                          {stat.icon}
                        </Box>
                        <Typography variant="h4" fontWeight="bold" sx={{ color: '#2d3436', mb: 1 }}>
                          {stat.value}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {stat.label}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          </TabPanel>

          {/* Tab 2: Security (Password Change) */}
          <TabPanel value={activeTab} index={1}>
            <Box sx={{ p: 4, maxWidth: 600 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 1, color: '#2d3436' }}>
                Изменить пароль
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
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
                        <Lock sx={{ color: '#3d5a52' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowOldPassword(!showOldPassword)}
                          edge="end"
                        >
                          {showOldPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
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
                        <Lock sx={{ color: '#3d5a52' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          edge="end"
                        >
                          {showNewPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
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
                        <Lock sx={{ color: '#3d5a52' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          edge="end"
                        >
                          {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Button
                  variant="contained"
                  size="large"
                  onClick={handlePasswordSubmit}
                  sx={{
                    bgcolor: '#3d5a52',
                    '&:hover': { bgcolor: '#2a403a' },
                    mt: 2,
                  }}
                >
                  Изменить пароль
                </Button>
              </Box>

              <Divider sx={{ my: 4 }} />

              {/* Additional Security Info */}
              <Box
                sx={{
                  p: 3,
                  bgcolor: '#f0fdf4',
                  borderRadius: 2,
                  border: '1px solid #bbf7d0',
                }}
              >
                <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#3d5a52', mb: 1 }}>
                  Советы по безопасности
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  • Используйте комбинацию букв, цифр и специальных символов
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  • Не используйте один и тот же пароль на разных сайтах
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  • Регулярно меняйте пароль для повышения безопасности
                </Typography>
              </Box>
            </Box>
          </TabPanel>

          {/* Tab 3: Activity History */}
          <TabPanel value={activeTab} index={2}>
            <Box sx={{ p: 4 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 1, color: '#2d3436' }}>
                Недавняя активность
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                Отслеживайте все действия в вашем аккаунте
              </Typography>

              <List sx={{ bgcolor: 'white' }}>
                {activityLog.map((activity, index) => (
                  <React.Fragment key={activity.id}>
                    <ListItem
                      sx={{
                        py: 2.5,
                        px: 0,
                        '&:hover': {
                          bgcolor: 'rgba(61, 90, 82, 0.02)',
                        },
                      }}
                    >
                      <ListItemIcon>
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: '50%',
                            bgcolor: `${activity.color}10`,
                            color: activity.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {activity.icon}
                        </Box>
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography variant="subtitle1" fontWeight="600" sx={{ color: '#2d3436' }}>
                            {activity.title}
                          </Typography>
                        }
                        secondary={
                          <>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {activity.description}
                            </Typography>
                            <Typography variant="caption" sx={{ color: activity.color, mt: 0.5, display: 'block' }}>
                              {activity.date}
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                    {index < activityLog.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>

              {/* Load More Button */}
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Button
                  variant="outlined"
                  onClick={() => toast.info('Загрузка дополнительных данных...')}
                  sx={{
                    borderColor: '#3d5a52',
                    color: '#3d5a52',
                    '&:hover': {
                      borderColor: '#2a403a',
                      bgcolor: 'rgba(61, 90, 82, 0.04)',
                    },
                  }}
                >
                  Загрузить больше
                </Button>
              </Box>
            </Box>
          </TabPanel>
        </Paper>
      </Container>
    </Box>
  );
};

export default ProfilePage;
