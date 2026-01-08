import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  TextField,
  IconButton,
  Typography,
  Avatar,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  CircularProgress,
  Chip,
  keyframes,
  Fade,
  Tooltip,
  Card,
  Button,
} from '@mui/material';
import {
  Send,
  ArrowBack,
  SmartToy,
  Person,
  Add,
  ChatBubbleOutline,
  Circle,
  Mic,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import { toast } from 'react-toastify';

// Animations
const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const slideInRight = keyframes`
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInLeft = keyframes`
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
`;

const AIChatPageGlass = () => {
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversations list
  const loadConversations = async () => {
    try {
      const data = await clientService.aiChat.getConversations();
      setConversations(data);

      // If we have conversations, load the first one
      if (data.length > 0 && !currentConversationId) {
        loadConversationHistory(data[0].id);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      toast.error('Ошибка загрузки истории разговоров');
    }
  };

  // Load conversation history
  const loadConversationHistory = async (conversationId) => {
    setIsLoadingHistory(true);
    setCurrentConversationId(conversationId);

    try {
      const history = await clientService.aiChat.getChatHistory(conversationId);
      setMessages(history);
    } catch (error) {
      console.error('Error loading conversation history:', error);
      toast.error('Ошибка загрузки истории разговора');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Start new conversation
  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setInputMessage('');
  };

  // Send message
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = {
      text: inputMessage,
      isUser: true,
      timestamp: new Date().toISOString(),
    };

    // Add user message to UI immediately
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Send message to backend
      const response = await clientService.aiChat.sendMessage(
        inputMessage,
        currentConversationId
      );

      // Add AI response to messages
      const aiMessage = {
        text: response.message || response.reply,
        isUser: false,
        timestamp: new Date().toISOString(),
        category: response.category,
      };

      setMessages((prev) => [...prev, aiMessage]);

      // Update conversation ID if it's a new conversation
      if (response.conversationId && !currentConversationId) {
        setCurrentConversationId(response.conversationId);
        loadConversations(); // Reload conversations list
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Ошибка отправки сообщения');

      // Add error message
      setMessages((prev) => [
        ...prev,
        {
          text: 'Извините, произошла ошибка. Пожалуйста, попробуйте еще раз.',
          isUser: false,
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Enter key
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: '#F4F6F8',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Header */}
        <Card
          sx={{
            mb: 3,
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            borderRadius: '12px',
            p: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                color: '#0B1B2B',
                '&:hover': { background: '#F4F6F8' },
              }}
            >
              <ArrowBack />
            </IconButton>

            <Avatar
              sx={{
                background: '#2563EB',
                width: 48,
                height: 48,
              }}
            >
              <SmartToy />
            </Avatar>

            <Box>
              <Typography variant="h5" fontWeight="bold" color="#0B1B2B">
                AI Юридический Консультант
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                Получите мгновенную консультацию по вашему вопросу
              </Typography>
            </Box>
          </Box>
        </Card>

        {/* Main Content */}
        <Box sx={{ display: 'flex', gap: 3, height: 'calc(100vh - 200px)' }}>
          {/* Conversations Sidebar */}
          <Card
            sx={{
              width: 320,
              display: 'flex',
              flexDirection: 'column',
              background: '#FFFFFF',
              border: '1px solid #E6E9EE',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              borderRadius: '12px',
              p: 2,
            }}
          >
            <Box sx={{ mb: 2 }}>
              <Button
                variant="contained"
                fullWidth
                startIcon={<Add />}
                onClick={startNewConversation}
                sx={{
                  background: '#2563EB',
                  color: '#FFFFFF',
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px',
                  py: 1.5,
                  boxShadow: 'none',
                  '&:hover': {
                    background: '#1d4ed8',
                    boxShadow: 'none',
                  },
                }}
              >
                Новый разговор
              </Button>
            </Box>

            <Divider sx={{ borderColor: '#E6E9EE', mb: 2 }} />

            <Typography
              variant="subtitle2"
              sx={{
                color: '#6B7280',
                mb: 1,
                px: 1,
                textTransform: 'uppercase',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              История разговоров
            </Typography>

            <List sx={{ flexGrow: 1, overflowY: 'auto', px: 0 }}>
              {conversations.length === 0 ? (
                <Box
                  sx={{
                    textAlign: 'center',
                    py: 4,
                    color: '#6B7280',
                  }}
                >
                  <ChatBubbleOutline sx={{ fontSize: 48, mb: 1, color: '#E6E9EE' }} />
                  <Typography variant="body2">
                    Нет сохраненных разговоров
                  </Typography>
                </Box>
              ) : (
                conversations.map((conv, index) => (
                  <ListItem
                    key={conv.id}
                    disablePadding
                    sx={{ mb: 1 }}
                  >
                    <ListItemButton
                      onClick={() => loadConversationHistory(conv.id)}
                      selected={currentConversationId === conv.id}
                      sx={{
                        borderRadius: '8px',
                        '&.Mui-selected': {
                          background: '#EBF5FF',
                          borderLeft: '3px solid #2563EB',
                          '&:hover': {
                            background: '#DBEAFE',
                          },
                        },
                        '&:hover': {
                          background: '#F4F6F8',
                        },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            background: '#2563EB',
                            width: 36,
                            height: 36,
                          }}
                        >
                          <ChatBubbleOutline sx={{ fontSize: 20 }} />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            sx={{
                              color: '#0B1B2B',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {conv.title || 'Новый разговор'}
                          </Typography>
                        }
                        secondary={
                          <Typography
                            variant="caption"
                            sx={{ color: '#6B7280' }}
                          >
                            {new Date(conv.updatedAt || conv.createdAt).toLocaleDateString(
                              'ru-RU'
                            )}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))
              )}
            </List>
          </Card>

          {/* Chat Area */}
          <Card
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#FFFFFF',
              border: '1px solid #E6E9EE',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
              borderRadius: '12px',
              p: 0,
              overflow: 'hidden',
            }}
          >
            {/* Messages Area */}
            <Box
              sx={{
                flexGrow: 1,
                overflowY: 'auto',
                p: 3,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {isLoadingHistory ? (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                  }}
                >
                  <CircularProgress sx={{ color: '#2563EB' }} />
                </Box>
              ) : messages.length === 0 ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    textAlign: 'center',
                  }}
                >
                  <SmartToy sx={{ fontSize: 80, color: '#2563EB', mb: 2 }} />
                  <Typography variant="h5" fontWeight="bold" color="#0B1B2B" gutterBottom>
                    Добро пожаловать в AI Консультант!
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ color: '#6B7280', mb: 3, maxWidth: 500 }}
                  >
                    Задайте любой юридический вопрос, и я постараюсь помочь вам с
                    консультацией
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                    {[
                      'Гражданское право',
                      'Семейное право',
                      'Корпоративное право',
                      'Недвижимость',
                      'Трудовое право',
                    ].map((category) => (
                      <Chip
                        key={category}
                        label={category}
                        sx={{
                          background: '#F4F6F8',
                          color: '#0B1B2B',
                          border: '1px solid #E6E9EE',
                          fontWeight: 600,
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              ) : (
                <>
                  {messages.map((msg, index) => (
                    <Fade in={true} key={index} timeout={500}>
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: msg.isUser ? 'flex-end' : 'flex-start',
                          mb: 2,
                          animation: msg.isUser
                            ? `${slideInLeft} 0.3s ease-out`
                            : `${slideInRight} 0.3s ease-out`,
                        }}
                      >
                        {!msg.isUser && (
                          <Avatar
                            sx={{
                              background: '#2563EB',
                              mr: 1,
                              mt: 0.5,
                            }}
                          >
                            <SmartToy />
                          </Avatar>
                        )}

                        <Box
                          sx={{
                            maxWidth: '70%',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <Box
                            sx={{
                              background: msg.isUser
                                ? '#2563EB'
                                : msg.isError
                                ? '#FEF2F2'
                                : '#F4F6F8',
                              border: msg.isUser
                                ? 'none'
                                : msg.isError
                                ? '1px solid #FCA5A5'
                                : '1px solid #E6E9EE',
                              borderRadius: msg.isUser
                                ? '12px 12px 4px 12px'
                                : '12px 12px 12px 4px',
                              p: 2,
                              boxShadow: '0 2px 4px rgba(11, 27, 43, 0.04)',
                            }}
                          >
                            <Typography
                              variant="body1"
                              sx={{
                                color: msg.isUser ? '#FFFFFF' : msg.isError ? '#DC2626' : '#0B1B2B',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {msg.text}
                            </Typography>

                            {msg.category && (
                              <Chip
                                label={msg.category}
                                size="small"
                                sx={{
                                  mt: 1,
                                  background: '#DBEAFE',
                                  color: '#2563EB',
                                  border: '1px solid #93C5FD',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </Box>

                          <Typography
                            variant="caption"
                            sx={{
                              color: '#6B7280',
                              mt: 0.5,
                              px: 1,
                              alignSelf: msg.isUser ? 'flex-end' : 'flex-start',
                            }}
                          >
                            {formatTime(msg.timestamp)}
                          </Typography>
                        </Box>

                        {msg.isUser && (
                          <Avatar
                            sx={{
                              background: '#6B7280',
                              ml: 1,
                              mt: 0.5,
                            }}
                          >
                            <Person />
                          </Avatar>
                        )}
                      </Box>
                    </Fade>
                  ))}

                  {/* Typing indicator */}
                  {isLoading && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Avatar
                        sx={{
                          background: '#2563EB',
                          mr: 1,
                        }}
                      >
                        <SmartToy />
                      </Avatar>
                      <Box
                        sx={{
                          background: '#F4F6F8',
                          border: '1px solid #E6E9EE',
                          borderRadius: '12px 12px 12px 4px',
                          p: 2,
                          display: 'flex',
                          gap: 0.5,
                          boxShadow: '0 2px 4px rgba(11, 27, 43, 0.04)',
                        }}
                      >
                        {[0, 1, 2].map((i) => (
                          <Circle
                            key={i}
                            sx={{
                              fontSize: 8,
                              color: '#2563EB',
                              animation: `${pulse} 1.4s ease-in-out ${i * 0.2}s infinite`,
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </Box>

            {/* Input Area */}
            <Box
              sx={{
                p: 2,
                borderTop: '1px solid #E6E9EE',
                background: '#F9FAFB',
              }}
            >
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <TextField
                  fullWidth
                  multiline
                  maxRows={4}
                  placeholder="Введите ваш вопрос..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      background: '#FFFFFF',
                      borderRadius: '8px',
                      color: '#0B1B2B',
                      border: '1px solid #E6E9EE',
                      '& fieldset': {
                        border: 'none',
                      },
                      '&:hover': {
                        border: '1px solid #D1D5DB',
                      },
                      '&.Mui-focused': {
                        border: '1px solid #2563EB',
                        boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.1)',
                      },
                    },
                    '& .MuiInputBase-input': {
                      color: '#0B1B2B',
                      '&::placeholder': {
                        color: '#6B7280',
                        opacity: 1,
                      },
                    },
                  }}
                />

                <Tooltip title="Отправить">
                  <span>
                    <IconButton
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || isLoading}
                      sx={{
                        background: '#2563EB',
                        color: '#FFFFFF',
                        width: 48,
                        height: 48,
                        '&:hover': {
                          background: '#1d4ed8',
                          transform: 'scale(1.05)',
                        },
                        '&.Mui-disabled': {
                          background: '#E6E9EE',
                          color: '#9CA3AF',
                        },
                        transition: 'all 0.2s',
                      }}
                    >
                      <Send />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </Box>
          </Card>
        </Box>
      </Container>
    </Box>
  );
};

export default AIChatPageGlass;
