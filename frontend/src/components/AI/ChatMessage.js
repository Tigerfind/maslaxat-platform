import React from 'react';
import { Box, Paper, Typography, Avatar, Chip } from '@mui/material';
import { Person, SmartToy, VolumeUp } from '@mui/icons-material';
import { keyframes } from '@mui/system';

const typingAnimation = keyframes`
  0%, 60%, 100% { opacity: 0; }
  30% { opacity: 1; }
`;

const ChatMessage = ({ message, isUser, isTyping, category, audioUrl }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 2,
        animation: 'fadeIn 0.3s ease-in',
        '@keyframes fadeIn': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      {!isUser && (
        <Avatar
          sx={{
            bgcolor: 'secondary.main',
            mr: 1,
            width: 40,
            height: 40,
          }}
        >
          <SmartToy />
        </Avatar>
      )}

      <Box sx={{ maxWidth: '70%' }}>
        <Paper
          sx={{
            p: 2,
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'white' : 'text.primary',
            borderRadius: 2,
            boxShadow: 2,
            position: 'relative',
          }}
        >
          {isTyping ? (
            <Box sx={{ display: 'flex', gap: 0.5, py: 1 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'text.secondary',
                  animation: `${typingAnimation} 1.4s infinite`,
                }}
              />
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'text.secondary',
                  animation: `${typingAnimation} 1.4s infinite 0.2s`,
                }}
              />
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'text.secondary',
                  animation: `${typingAnimation} 1.4s infinite 0.4s`,
                }}
              />
            </Box>
          ) : (
            <>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {message}
              </Typography>

              {audioUrl && (
                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VolumeUp sx={{ fontSize: 20 }} />
                  <Typography variant="caption">Голосовое сообщение</Typography>
                </Box>
              )}

              {category && (
                <Chip
                  label={category}
                  size="small"
                  sx={{
                    mt: 1,
                    bgcolor: 'secondary.light',
                    color: 'white',
                    fontSize: '0.7rem',
                  }}
                />
              )}
            </>
          )}
        </Paper>

        {!isTyping && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1, mt: 0.5, display: 'block' }}
          >
            {new Date().toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Typography>
        )}
      </Box>

      {isUser && (
        <Avatar
          sx={{
            bgcolor: 'primary.light',
            ml: 1,
            width: 40,
            height: 40,
          }}
        >
          <Person />
        </Avatar>
      )}
    </Box>
  );
};

export default ChatMessage;
