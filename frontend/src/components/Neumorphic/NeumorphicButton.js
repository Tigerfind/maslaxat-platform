import React from 'react';
import { Button } from '@mui/material';

const NeumorphicButton = ({
  children,
  variant = 'elevated',
  color = 'primary',
  fullWidth = false,
  startIcon,
  endIcon,
  onClick,
  sx = {},
  ...props
}) => {
  const colorMap = {
    primary: {
      bg: 'linear-gradient(145deg, #6aafb5, #5b9aa0)',
      shadow: '6px 6px 12px rgba(91, 154, 160, 0.4), -6px -6px 12px rgba(126, 180, 186, 0.4)',
      hoverShadow: '8px 8px 16px rgba(91, 154, 160, 0.5), -8px -8px 16px rgba(126, 180, 186, 0.5)',
      activeShadow: 'inset 4px 4px 8px rgba(68, 113, 118, 0.6), inset -4px -4px 8px rgba(91, 154, 160, 0.3)',
      color: '#ffffff',
    },
    secondary: {
      bg: 'linear-gradient(145deg, #e0ba92, #d4a574)',
      shadow: '6px 6px 12px rgba(184, 137, 94, 0.4), -6px -6px 12px rgba(224, 186, 146, 0.4)',
      hoverShadow: '8px 8px 16px rgba(184, 137, 94, 0.5), -8px -8px 16px rgba(224, 186, 146, 0.5)',
      activeShadow: 'inset 4px 4px 8px rgba(184, 137, 94, 0.6), inset -4px -4px 8px rgba(212, 165, 116, 0.3)',
      color: '#ffffff',
    },
    neutral: {
      bg: '#e4e9f2',
      shadow: '6px 6px 12px rgba(163, 177, 198, 0.6), -6px -6px 12px rgba(255, 255, 255, 0.5)',
      hoverShadow: '8px 8px 16px rgba(163, 177, 198, 0.6), -8px -8px 16px rgba(255, 255, 255, 0.5)',
      activeShadow: 'inset 4px 4px 8px rgba(163, 177, 198, 0.6), inset -4px -4px 8px rgba(255, 255, 255, 0.5)',
      color: '#2c3e50',
    },
    success: {
      bg: 'linear-gradient(145deg, #8fd38e, #6abf69)',
      shadow: '6px 6px 12px rgba(74, 151, 73, 0.4), -6px -6px 12px rgba(143, 211, 142, 0.4)',
      hoverShadow: '8px 8px 16px rgba(74, 151, 73, 0.5), -8px -8px 16px rgba(143, 211, 142, 0.5)',
      activeShadow: 'inset 4px 4px 8px rgba(74, 151, 73, 0.6), inset -4px -4px 8px rgba(106, 191, 105, 0.3)',
      color: '#ffffff',
    },
    error: {
      bg: 'linear-gradient(145deg, #e89884, #e07a5f)',
      shadow: '6px 6px 12px rgba(192, 98, 74, 0.4), -6px -6px 12px rgba(232, 152, 132, 0.4)',
      hoverShadow: '8px 8px 16px rgba(192, 98, 74, 0.5), -8px -8px 16px rgba(232, 152, 132, 0.5)',
      activeShadow: 'inset 4px 4px 8px rgba(192, 98, 74, 0.6), inset -4px -4px 8px rgba(224, 122, 95, 0.3)',
      color: '#ffffff',
    },
  };

  const colorStyle = colorMap[color] || colorMap.primary;

  return (
    <Button
      onClick={onClick}
      fullWidth={fullWidth}
      startIcon={startIcon}
      endIcon={endIcon}
      sx={{
        background: colorStyle.bg,
        color: colorStyle.color,
        borderRadius: '12px',
        padding: '10px 24px',
        fontWeight: 600,
        textTransform: 'none',
        border: 'none',
        boxShadow: colorStyle.shadow,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': {
          background: colorStyle.bg,
          boxShadow: colorStyle.hoverShadow,
          transform: 'translateY(-2px)',
        },
        '&:active': {
          boxShadow: colorStyle.activeShadow,
          transform: 'translateY(0)',
        },
        '&.Mui-disabled': {
          background: '#d1d5db',
          color: '#9ca3af',
          boxShadow: '2px 2px 4px rgba(163, 177, 198, 0.3), -2px -2px 4px rgba(255, 255, 255, 0.3)',
        },
        ...sx,
      }}
      {...props}
    >
      {children}
    </Button>
  );
};

export default NeumorphicButton;
