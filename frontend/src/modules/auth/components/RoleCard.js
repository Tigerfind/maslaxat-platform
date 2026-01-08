/**
 * Auth Module - RoleCard Component
 * Reusable card for role selection on login page
 */

import React from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Box,
  Typography,
  Button,
  Avatar,
} from '@mui/material';
import { ArrowForward } from '@mui/icons-material';

const RoleCard = ({
  title,
  subtitle,
  icon,
  color,
  gradient,
  features,
  onLogin,
  onQuickLogin,
  loginButtonText,
  quickLoginText,
}) => {
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 4,
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        border: '2px solid transparent',
        '&:hover': {
          transform: 'translateY(-8px)',
          borderColor: color,
          boxShadow: `0 12px 40px ${color}40`,
        },
      }}
    >
      {/* Card Header */}
      <Box
        sx={{
          background: gradient,
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
            color: color,
          }}
        >
          {icon}
        </Avatar>
        <Typography variant="h5" fontWeight="bold" color="white">
          {title}
        </Typography>
        <Typography variant="body2" color="rgba(255,255,255,0.9)" sx={{ mt: 1 }}>
          {subtitle}
        </Typography>
      </Box>

      {/* Card Content */}
      <CardContent sx={{ flexGrow: 1, p: 3 }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
          Возможности:
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {features.map((feature, idx) => (
            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: color,
                }}
              />
              <Typography variant="body2" color="text.secondary">
                {feature}
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
          onClick={onLogin}
          sx={{
            py: 1.5,
            background: gradient,
            fontWeight: 'bold',
            '&:hover': {
              opacity: 0.9,
            },
          }}
        >
          {loginButtonText}
        </Button>
        <Button
          fullWidth
          variant="outlined"
          size="medium"
          onClick={onQuickLogin}
          sx={{
            py: 1,
            borderColor: color,
            color: color,
            fontWeight: 'bold',
            '&:hover': {
              borderColor: color,
              backgroundColor: `${color}10`,
            },
          }}
        >
          {quickLoginText}
        </Button>
      </CardActions>
    </Card>
  );
};

export default RoleCard;
