/**
 * Auth Module - LoginForm Component
 * Reusable login form with validation
 */

import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  IconButton,
  InputAdornment,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Visibility, VisibilityOff, Login } from '@mui/icons-material';

const LoginForm = ({
  onSubmit,
  loading = false,
  error = null,
  title = 'Вход в систему',
  subtitle = '',
  buttonText = 'Войти',
  color = '#3d5a52',
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  const validate = () => {
    const errors = {};

    if (!email) {
      errors.email = 'Email обязателен';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      errors.email = 'Неверный формат email';
    }

    if (!password) {
      errors.password = 'Пароль обязателен';
    } else if (password.length < 6) {
      errors.password = 'Пароль должен быть не менее 6 символов';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({ email, password });
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      {title && (
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h5" fontWeight="bold" gutterBottom>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        fullWidth
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={!!validationErrors.email}
        helperText={validationErrors.email}
        disabled={loading}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
          },
        }}
      />

      <TextField
        fullWidth
        label="Пароль"
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={!!validationErrors.password}
        helperText={validationErrors.password}
        disabled={loading}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowPassword(!showPassword)}
                edge="end"
              >
                {showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
          },
        }}
      />

      <Button
        type="submit"
        fullWidth
        variant="contained"
        size="large"
        disabled={loading}
        startIcon={loading ? <CircularProgress size={20} /> : <Login />}
        sx={{
          py: 1.5,
          borderRadius: 2,
          bgcolor: color,
          fontWeight: 'bold',
          '&:hover': {
            bgcolor: color,
            opacity: 0.9,
          },
        }}
      >
        {loading ? 'Вход...' : buttonText}
      </Button>
    </Box>
  );
};

export default LoginForm;
