import React from 'react';
import { Button } from '@mui/material';

const GlassButton = ({
  children,
  variant = 'glass',
  color = 'primary',
  fullWidth = false,
  startIcon,
  endIcon,
  onClick,
  disabled = false,
  size = 'medium',
  sx = {},
  ...props
}) => {
  const colorGradients = {
    primary: {
      from: '#667eea',
      to: '#764ba2',
      hover: '#5a67d8',
    },
    secondary: {
      from: '#f093fb',
      to: '#f5576c',
      hover: '#d77fe8',
    },
    success: {
      from: '#4ade80',
      to: '#22c55e',
      hover: '#16a34a',
    },
    error: {
      from: '#f87171',
      to: '#ef4444',
      hover: '#dc2626',
    },
    warning: {
      from: '#fbbf24',
      to: '#f59e0b',
      hover: '#d97706',
    },
    info: {
      from: '#60a5fa',
      to: '#3b82f6',
      hover: '#2563eb',
    },
  };

  const sizeMap = {
    small: { padding: '8px 16px', fontSize: '0.875rem' },
    medium: { padding: '10px 24px', fontSize: '0.95rem' },
    large: { padding: '12px 32px', fontSize: '1rem' },
  };

  const selectedColor = colorGradients[color] || colorGradients.primary;
  const selectedSize = sizeMap[size] || sizeMap.medium;

  const variantStyles = {
    glass: {
      background: 'rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      color: '#1f2937',
      '&:hover': {
        background: 'rgba(255, 255, 255, 0.3)',
        transform: 'translateY(-2px)',
        boxShadow: '0 8px 24px 0 rgba(31, 38, 135, 0.2)',
      },
    },
    gradient: {
      background: `linear-gradient(135deg, ${selectedColor.from} 0%, ${selectedColor.to} 100%)`,
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: 'none',
      color: 'white',
      boxShadow: `0 4px 15px 0 ${selectedColor.from}40`,
      '&:hover': {
        background: `linear-gradient(135deg, ${selectedColor.hover} 0%, ${selectedColor.to} 100%)`,
        transform: 'translateY(-2px)',
        boxShadow: `0 8px 25px 0 ${selectedColor.from}60`,
      },
    },
    outlined: {
      background: 'transparent',
      backdropFilter: 'blur(5px)',
      WebkitBackdropFilter: 'blur(5px)',
      border: `2px solid ${selectedColor.from}`,
      color: selectedColor.from,
      '&:hover': {
        background: `${selectedColor.from}15`,
        transform: 'translateY(-2px)',
        borderColor: selectedColor.hover,
      },
    },
  };

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      fullWidth={fullWidth}
      startIcon={startIcon}
      endIcon={endIcon}
      sx={{
        borderRadius: '12px',
        textTransform: 'none',
        fontWeight: 600,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        ...selectedSize,
        ...variantStyles[variant],
        '&:active': {
          transform: 'translateY(0)',
        },
        '&.Mui-disabled': {
          background: 'rgba(156, 163, 175, 0.3)',
          color: 'rgba(107, 114, 128, 0.5)',
          border: 'none',
        },
        ...sx,
      }}
      {...props}
    >
      {children}
    </Button>
  );
};

export default GlassButton;
