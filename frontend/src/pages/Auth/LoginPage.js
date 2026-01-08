import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container,
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  Avatar,
} from '@mui/material';
import {
  Person,
  Gavel,
  Shield,
  ArrowForward,
} from '@mui/icons-material';
import { loginStart, loginSuccess } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

const LoginPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { t } = useTranslation();

  const roles = [
    {
      titleKey: 'client',
      subtitleKey: 'clientSubtitle',
      icon: <Person sx={{ fontSize: 48 }} />,
      color: '#3d5a52',
      gradient: 'linear-gradient(135deg, #3d5a52 0%, #5a7d72 100%)',
      path: '/login/client',
      featureKeys: ['clientFeature1', 'clientFeature2', 'clientFeature3'],
      quickLogin: {
        email: 'client@maslaxat.uz',
        password: 'client123',
        role: 'client',
        dashboardPath: '/dashboard',
        mockUser: {
          id: 1,
          name: 'Клиент Тестовый',
          email: 'client@maslaxat.uz',
          role: 'client',
        },
      },
    },
    {
      titleKey: 'lawyer',
      subtitleKey: 'lawyerSubtitle',
      icon: <Gavel sx={{ fontSize: 48 }} />,
      color: '#a67c52',
      gradient: 'linear-gradient(135deg, #a67c52 0%, #c29a6e 100%)',
      path: '/login/lawyer',
      featureKeys: ['lawyerFeature1', 'lawyerFeature2', 'lawyerFeature3'],
      quickLogin: {
        email: 'lawyer@maslaxat.uz',
        password: 'lawyer123',
        role: 'lawyer',
        dashboardPath: '/lawyer/dashboard',
        mockUser: {
          id: 10,
          name: 'Иванов Иван Иванович',
          email: 'ivanov@maslaxat.uz',
          role: 'lawyer',
        },
      },
    },
    {
      titleKey: 'admin',
      subtitleKey: 'adminSubtitle',
      icon: <Shield sx={{ fontSize: 48 }} />,
      color: '#ef4444',
      gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      path: '/login/admin',
      featureKeys: ['adminFeature1', 'adminFeature2', 'adminFeature3'],
      quickLogin: {
        email: 'admin@maslaxat.uz',
        password: 'admin123',
        role: 'admin',
        dashboardPath: '/admin/dashboard',
        mockUser: {
          id: 3,
          name: 'Администратор Тестовый',
          email: 'admin@maslaxat.uz',
          role: 'admin',
        },
      },
    },
  ];

  const handleQuickLogin = async (role) => {
    dispatch(loginStart());

    try {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      dispatch(
        loginSuccess({
          user: role.quickLogin.mockUser,
          token: `mock-jwt-token-${role.quickLogin.role}`,
          role: role.quickLogin.role,
        })
      );

      navigate(role.quickLogin.dashboardPath);
    } catch (err) {
      console.error('Quick login error:', err);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a2b4a 0%, #2d4a7c 100%)',
        display: 'flex',
        alignItems: 'center',
        py: 4,
        position: 'relative',
      }}
    >
      {/* Language Switcher - Top Right */}
      <Box
        sx={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 10,
        }}
      >
        <LanguageSwitcher variant="buttons" />
      </Box>

      <Container maxWidth="lg">
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Box
            sx={{
              width: 100,
              height: 100,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3d5a52 0%, #a67c52 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              mb: 3,
              boxShadow: '0 8px 32px rgba(255, 255, 255, 0.1)',
            }}
          >
            <Typography sx={{ fontSize: 60 }}>⚖️</Typography>
          </Box>
          <Typography
            variant="h2"
            fontWeight="bold"
            sx={{
              color: 'white',
              mb: 2,
              textShadow: '0 2px 10px rgba(0,0,0,0.3)',
            }}
          >
            {t('login.title')}
          </Typography>
          <Typography
            variant="h6"
            sx={{
              color: 'rgba(255,255,255,0.9)',
              mb: 1,
            }}
          >
            {t('login.subtitle')}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            {t('login.subtitleEn')}
          </Typography>
        </Box>

        {/* Role Selection Cards */}
        <Typography
          variant="h5"
          fontWeight="bold"
          textAlign="center"
          sx={{ color: 'white', mb: 4 }}
        >
          {t('login.selectRole')}
        </Typography>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          {roles.map((role, index) => (
            <Grid item xs={12} md={4} key={index}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 4,
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  border: `2px solid transparent`,
                  '&:hover': {
                    transform: 'translateY(-8px)',
                    borderColor: role.color,
                    boxShadow: `0 12px 40px ${role.color}40`,
                  },
                }}
              >
                {/* Card Header */}
                <Box
                  sx={{
                    background: role.gradient,
                    p: 3,
                    textAlign: 'center',
                  }}
                >
                  <Avatar
                    sx={{
                      width: 80,
                      height: 80,
                      margin: '0 auto',
                      mb: 2,
                      bgcolor: 'white',
                      color: role.color,
                    }}
                  >
                    {role.icon}
                  </Avatar>
                  <Typography variant="h5" fontWeight="bold" color="white">
                    {t(`login.${role.titleKey}`)}
                  </Typography>
                  <Typography variant="body2" color="rgba(255,255,255,0.9)" sx={{ mt: 1 }}>
                    {t(`login.${role.subtitleKey}`)}
                  </Typography>
                </Box>

                {/* Card Content */}
                <CardContent sx={{ flexGrow: 1, p: 3 }}>
                  <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                    {t('login.features')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {role.featureKeys.map((featureKey, idx) => (
                      <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: role.color,
                          }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {t(`login.${featureKey}`)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </CardContent>

                {/* Card Actions */}
                <CardActions sx={{ p: 3, pt: 0, flexDirection: 'column', gap: 1.5 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    endIcon={<ArrowForward />}
                    onClick={() => navigate(role.path)}
                    sx={{
                      py: 1.5,
                      background: role.gradient,
                      fontWeight: 'bold',
                      '&:hover': {
                        opacity: 0.9,
                      },
                    }}
                  >
                    {t('login.loginAs')} {t(`login.${role.titleKey}`)}
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    size="medium"
                    onClick={() => handleQuickLogin(role)}
                    sx={{
                      py: 1,
                      borderColor: role.color,
                      color: role.color,
                      fontWeight: 'bold',
                      '&:hover': {
                        borderColor: role.color,
                        backgroundColor: `${role.color}10`,
                      },
                    }}
                  >
                    {t('login.quickLogin')}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Footer */}
        <Typography
          variant="body2"
          color="white"
          align="center"
          sx={{ mt: 4, opacity: 0.7 }}
        >
          {t('login.copyright')}
        </Typography>
      </Container>
    </Box>
  );
};

export default LoginPage;
