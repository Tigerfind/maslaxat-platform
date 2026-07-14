import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  IconButton,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Send,
  SmartToy,
  OpenInNew,
  Gavel,
  Home as HomeIcon,
  Business,
  Speed,
  LocalAtm,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { axelionColors } from '../theme/axelionTheme';
import clientService from '../services/clientService';

const QuickAIChat = () => {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const quickQuestions = [
    { icon: <Gavel sx={{ fontSize: 16 }} />, text: 'Трудовые споры', query: 'Меня незаконно уволили. Что делать?' },
    { icon: <HomeIcon sx={{ fontSize: 16 }} />, text: 'Аренда', query: 'Арендодатель не возвращает залог. Как действовать?' },
    { icon: <Business sx={{ fontSize: 16 }} />, text: 'Бизнес', query: 'Хочу открыть ИП. С чего начать?' },
    { icon: <Speed sx={{ fontSize: 16 }} />, text: 'Штрафы', query: 'Получил штраф, как его обжаловать?' },
    { icon: <LocalAtm sx={{ fontSize: 16 }} />, text: 'Долги', query: 'Банк требует долг, который я не брал. Что делать?' },
  ];

  const handleSendMessage = async (queryText = message) => {
    if (!queryText.trim()) return;

    try {
      setLoading(true);
      const userMsg = { isUser: true, text: queryText };
      setMessages((prev) => [...prev, userMsg]);
      setMessage('');

      const response = await clientService.aiChat.sendMessage(queryText);
      const aiMsg = { isUser: false, text: response.response || response.message };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Ошибка отправки сообщения');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickQuestion = (query) => {
    handleSendMessage(query);
  };

  return (
    <Card
      sx={{
        bgcolor: axelionColors.bgLight,
        border: `1px solid ${axelionColors.borderLight}`,
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(26, 26, 26, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2.5,
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '8px',
              bgcolor: axelionColors.accentLight,
              color: axelionColors.gold,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SmartToy sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography
              sx={{
                fontWeight: 500,
                fontSize: '0.9rem',
                color: axelionColors.textDark,
                letterSpacing: '0.05em',
              }}
            >
              AI Консультант
            </Typography>
            <Typography
              sx={{
                fontSize: '0.7rem',
                color: axelionColors.textMuted,
              }}
            >
              Бесплатные юридические советы
            </Typography>
          </Box>
        </Box>
        <IconButton
          onClick={() => navigate('/ai-chat')}
          sx={{
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            '&:hover': {
              borderColor: axelionColors.gold,
              bgcolor: axelionColors.bgWarm,
            },
          }}
        >
          <OpenInNew sx={{ fontSize: 18, color: axelionColors.textDark }} />
        </IconButton>
      </Box>

      {/* Quick Questions */}
      {messages.length === 0 && (
        <Box sx={{ p: 2.5, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
          <Typography
            sx={{
              fontSize: '0.7rem',
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: axelionColors.textMuted,
              mb: 1.5,
            }}
          >
            Быстрые вопросы
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {quickQuestions.map((q, index) => (
              <Chip
                key={index}
                icon={q.icon}
                label={q.text}
                onClick={() => handleQuickQuestion(q.query)}
                sx={{
                  bgcolor: axelionColors.bgWarm,
                  border: `1px solid ${axelionColors.borderLight}`,
                  color: axelionColors.textDark,
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: axelionColors.accentLight,
                    borderColor: axelionColors.gold,
                    color: axelionColors.gold,
                  },
                  '& .MuiChip-icon': {
                    color: 'inherit',
                  },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <Box
          sx={{
            p: 2.5,
            maxHeight: 300,
            overflowY: 'auto',
            borderBottom: `1px solid ${axelionColors.borderLight}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {messages.slice(-3).map((msg, index) => (
            <Box
              key={index}
              sx={{
                display: 'flex',
                justifyContent: msg.isUser ? 'flex-end' : 'flex-start',
              }}
            >
              <Box
                sx={{
                  maxWidth: '75%',
                  p: 1.5,
                  borderRadius: '8px',
                  bgcolor: msg.isUser ? axelionColors.gold : axelionColors.bgWarm,
                  color: msg.isUser ? '#FFFFFF' : axelionColors.textDark,
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                }}
              >
                {msg.text}
              </Box>
            </Box>
          ))}
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: '8px',
                  bgcolor: axelionColors.bgWarm,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <CircularProgress size={16} sx={{ color: axelionColors.gold }} />
                <Typography sx={{ fontSize: '0.85rem', color: axelionColors.textMuted }}>
                  AI думает...
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Input */}
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            fullWidth
            placeholder="Опишите вашу ситуацию..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={loading}
            multiline
            maxRows={3}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: axelionColors.bgLight,
                borderRadius: '8px',
                fontSize: '0.85rem',
                '& fieldset': {
                  borderColor: axelionColors.borderLight,
                },
                '&:hover fieldset': {
                  borderColor: axelionColors.gold,
                },
                '&.Mui-focused fieldset': {
                  borderColor: axelionColors.gold,
                  borderWidth: 1,
                },
              },
            }}
          />
          <IconButton
            onClick={() => handleSendMessage()}
            disabled={!message.trim() || loading}
            sx={{
              bgcolor: axelionColors.gold,
              color: '#FFFFFF',
              borderRadius: '8px',
              width: 48,
              height: 48,
              flexShrink: 0,
              '&:hover': {
                bgcolor: axelionColors.goldDark,
              },
              '&.Mui-disabled': {
                bgcolor: axelionColors.borderLight,
                color: axelionColors.textMuted,
              },
            }}
          >
            <Send sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>

        {messages.length > 0 && (
          <Button
            fullWidth
            onClick={() => navigate('/ai-chat')}
            sx={{
              mt: 1.5,
              color: axelionColors.gold,
              fontSize: '0.75rem',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              '&:hover': {
                bgcolor: axelionColors.bgWarm,
              },
            }}
          >
            Открыть полный чат
          </Button>
        )}
      </Box>
    </Card>
  );
};

export default QuickAIChat;
