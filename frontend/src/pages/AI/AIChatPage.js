import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  Container,
  Box,
  Paper,
  TextField,
  IconButton,
  Typography,
  Button,
  Chip,
  Grid,
  Card,
  CardContent,
  Avatar,
  Rating,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {
  Send,
  ArrowBack,
  SmartToy,
  DeleteOutline,
  Person,
  Category,
} from '@mui/icons-material';
import ChatMessage from '../../components/AI/ChatMessage';
import VoiceRecorder from '../../components/AI/VoiceRecorder';
import { aiActions } from '../../store/slices/aiSlice';

const AIChatPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { messages, isTyping, currentCategory, recommendedLawyers } = useSelector(
    (state) => state.ai
  );
  const { specializations } = useSelector((state) => state.specializations);

  const [inputMessage, setInputMessage] = useState('');
  const [selectedSpecialization, setSelectedSpecialization] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const categories = [
    { name: 'Гражданское право', color: '#1a365d' },
    { name: 'Семейное право', color: '#2d4a7c' },
    { name: 'Корпоративное право', color: '#d4af37' },
    { name: 'Недвижимость', color: '#aa8a2e' },
    { name: 'Трудовое право', color: '#2e7d32' },
    { name: 'Уголовное право', color: '#c62828' },
  ];

  // Функция анализа текста пользователя для определения страны и специализации
  const analyzeUserMessage = (text) => {
    const lowerText = text.toLowerCase();

    // Определение страны
    let country = 'Узбекистан'; // по умолчанию

    if (lowerText.includes('англи') || lowerText.includes('великобритан') || lowerText.includes('uk') || lowerText.includes('лондон')) {
      country = 'Англия';
    } else if (lowerText.includes('дубай') || lowerText.includes('дубае') || lowerText.includes('оаэ') || lowerText.includes('эмират')) {
      country = 'ОАЭ';
    } else if (lowerText.includes('росси') || lowerText.includes('москв') || lowerText.includes('питер')) {
      country = 'Россия';
    } else if (lowerText.includes('узбек') || lowerText.includes('ташкент') || lowerText.includes('самарканд')) {
      country = 'Узбекистан';
    }

    // Определение категории/специализации
    let category = 'Гражданское право'; // по умолчанию

    if (lowerText.includes('уголовн') || lowerText.includes('тюрьм') || lowerText.includes('арест') ||
        lowerText.includes('полици') || lowerText.includes('преступлени') || lowerText.includes('суд') ||
        lowerText.includes('обвинени') || lowerText.includes('следстви')) {
      category = 'Уголовное право';
    } else if (lowerText.includes('семейн') || lowerText.includes('развод') || lowerText.includes('брак') ||
               lowerText.includes('алимент') || lowerText.includes('опека') || lowerText.includes('ребен') ||
               lowerText.includes('супруг')) {
      category = 'Семейное право';
    } else if (lowerText.includes('бизнес') || lowerText.includes('компани') || lowerText.includes('ооо') ||
               lowerText.includes('корпоративн') || lowerText.includes('учредител') || lowerText.includes('регистрац') ||
               lowerText.includes('предпринимател') || lowerText.includes('фирм')) {
      category = 'Корпоративное право';
    } else if (lowerText.includes('недвижимост') || lowerText.includes('квартир') || lowerText.includes('дом') ||
               lowerText.includes('земл') || lowerText.includes('покупк') || lowerText.includes('продаж') ||
               lowerText.includes('аренд') || lowerText.includes('ипотек')) {
      category = 'Недвижимость';
    } else if (lowerText.includes('труд') || lowerText.includes('работ') || lowerText.includes('увольнени') ||
               lowerText.includes('зарплат') || lowerText.includes('отпуск') || lowerText.includes('работодател')) {
      category = 'Трудовое право';
    }

    return { country, category };
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    // Add user message
    dispatch(aiActions.addMessage({
      text: inputMessage,
      isUser: true,
    }));

    setInputMessage('');
    dispatch(aiActions.setTyping(true));

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        {
          text: 'Спасибо за ваш вопрос. Я понимаю, что вы интересуетесь вопросами гражданского права. Позвольте мне дать вам рекомендации.\n\nВ Узбекистане гражданское право регулируется Гражданским кодексом. Ваш вопрос относится к категории имущественных отношений.\n\nЯ могу порекомендовать вам специалистов в этой области.',
          category: 'Гражданское право',
        },
        {
          text: 'Основываясь на вашем вопросе, я вижу что это касается семейного права. Вот что я могу вам посоветовать:\n\n1. Согласно Семейному кодексу Узбекистана\n2. Необходимо собрать следующие документы\n3. Рекомендую проконсультироваться со специалистом',
          category: 'Семейное право',
        },
        {
          text: 'Ваш вопрос связан с корпоративным правом. Это важная тема для бизнеса в Узбекистане.\n\nРекомендую обратить внимание на:\n- Закон о хозяйственных обществах\n- Налоговый кодекс\n- Законодательство о государственной регистрации',
          category: 'Корпоративное право',
        },
      ];

      const randomResponse = responses[Math.floor(Math.random() * responses.length)];

      dispatch(aiActions.setTyping(false));
      dispatch(aiActions.addMessage({
        text: randomResponse.text,
        isUser: false,
        category: randomResponse.category,
      }));
      dispatch(aiActions.setCategory(randomResponse.category));

      // Simulate recommended lawyers
      setTimeout(() => {
        dispatch(aiActions.setRecommendedLawyers([
          {
            id: 1,
            name: 'Иванов Иван Иванович',
            specialty: randomResponse.category,
            rating: 4.8,
            experience: 15,
            price: 50000,
            avatar: null,
          },
          {
            id: 2,
            name: 'Петрова Мария Сергеевна',
            specialty: randomResponse.category,
            rating: 4.9,
            experience: 12,
            price: 60000,
            avatar: null,
          },
        ]));
      }, 1000);
    }, 2000);
  };

  const handleVoiceMessage = (audioBase64, transcriptText) => {
    // If we have transcript text, use it; otherwise show voice message indicator
    const messageText = transcriptText || '🎤 Голосовое сообщение';

    // Add user message with transcript
    dispatch(aiActions.addMessage({
      text: messageText,
      isUser: true,
      audioUrl: audioBase64,
    }));

    dispatch(aiActions.setTyping(true));

    // Simulate AI response based on the transcript
    setTimeout(() => {
      const responses = [
        {
          text: `Спасибо за ваш вопрос. ${transcriptText ? `Вы сказали: "${transcriptText}". ` : ''}Я понимаю, что вас интересуют вопросы гражданского права. Позвольте мне дать вам рекомендации.\n\nВ Узбекистане гражданское право регулируется Гражданским кодексом. Ваш вопрос относится к категории имущественных отношений.\n\nЯ могу порекомендовать вам специалистов в этой области.`,
          category: 'Гражданское право',
        },
        {
          text: `Основываясь на вашем вопросе, я вижу что это касается семейного права. Вот что я могу вам посоветовать:\n\n1. Согласно Семейному кодексу Узбекистана\n2. Необходимо собрать следующие документы\n3. Рекомендую проконсультироваться со специалистом`,
          category: 'Семейное право',
        },
        {
          text: `Ваш вопрос связан с корпоративным правом. Это важная тема для бизнеса в Узбекистане.\n\nРекомендую обратить внимание на:\n- Закон о хозяйственных обществах\n- Налоговый кодекс\n- Законодательство о государственной регистрации`,
          category: 'Корпоративное право',
        },
      ];

      const randomResponse = responses[Math.floor(Math.random() * responses.length)];

      dispatch(aiActions.setTyping(false));
      dispatch(aiActions.addMessage({
        text: randomResponse.text,
        isUser: false,
        category: randomResponse.category,
      }));
      dispatch(aiActions.setCategory(randomResponse.category));

      // Simulate recommended lawyers
      setTimeout(() => {
        dispatch(aiActions.setRecommendedLawyers([
          {
            id: 1,
            name: 'Иванов Иван Иванович',
            specialty: randomResponse.category,
            rating: 4.8,
            experience: 15,
            price: 50000,
            avatar: null,
          },
          {
            id: 2,
            name: 'Петрова Мария Сергеевна',
            specialty: randomResponse.category,
            rating: 4.9,
            experience: 12,
            price: 60000,
            avatar: null,
          },
        ]));
      }, 1000);
    }, 2000);
  };

  const handleClearChat = () => {
    dispatch(aiActions.clearChat());
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          bgcolor: 'primary.main',
          color: 'white',
          py: 2,
          px: 2,
          boxShadow: 3,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton color="inherit" onClick={() => navigate('/dashboard')}>
              <ArrowBack />
            </IconButton>
            <SmartToy sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6" fontWeight="bold">
                AI Юридический Консультант
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Получите мгновенную консультацию
              </Typography>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<DeleteOutline />}
              onClick={handleClearChat}
            >
              Очистить
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: 3 }}>
        <Grid container spacing={3}>
          {/* Chat Area */}
          <Grid item xs={12} md={8}>
            <Paper
              sx={{
                height: '70vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Messages */}
              <Box
                sx={{
                  flexGrow: 1,
                  overflowY: 'auto',
                  p: 2,
                  bgcolor: 'grey.50',
                }}
              >
                {messages.length === 0 ? (
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
                    <SmartToy sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
                    <Typography variant="h5" gutterBottom color="primary.main" fontWeight="bold">
                      Добро пожаловать в AI Консультант!
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                      Задайте любой юридический вопрос текстом или голосом
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                      {categories.map((cat) => (
                        <Chip
                          key={cat.name}
                          label={cat.name}
                          sx={{ bgcolor: cat.color, color: 'white' }}
                        />
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <>
                    {messages.map((msg, index) => (
                      <ChatMessage
                        key={index}
                        message={msg.text}
                        isUser={msg.isUser}
                        category={msg.category}
                        audioUrl={msg.audioUrl}
                      />
                    ))}
                    {isTyping && <ChatMessage isTyping={true} />}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </Box>

              {/* Input Area */}
              <Divider />
              <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
                {/* Specialization Selector */}
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Category fontSize="small" />
                      Выберите специализацию (опционально)
                    </Box>
                  </InputLabel>
                  <Select
                    value={selectedSpecialization}
                    onChange={(e) => setSelectedSpecialization(e.target.value)}
                    label="Выберите специализацию (опционально)"
                    sx={{
                      borderRadius: 2,
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'primary.light',
                      },
                    }}
                  >
                    <MenuItem value="">
                      <em>Общая консультация</em>
                    </MenuItem>
                    {specializations
                      .filter((spec) => spec.active)
                      .sort((a, b) => a.order - b.order)
                      .map((spec) => (
                        <MenuItem key={spec.id} value={spec.id}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={spec.name}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                            <Typography variant="caption" color="text.secondary">
                              {spec.nameUz}
                            </Typography>
                          </Box>
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                  <TextField
                    fullWidth
                    multiline
                    maxRows={3}
                    placeholder="Введите ваш вопрос..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    variant="outlined"
                    disabled={isTyping}
                  />
                  <VoiceRecorder onSendVoice={handleVoiceMessage} disabled={isTyping} />
                  <Tooltip title="Отправить">
                    <IconButton
                      color="primary"
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || isTyping}
                      sx={{
                        bgcolor: 'primary.main',
                        color: 'white',
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                      }}
                    >
                      <Send />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Selected Specialization Indicator */}
                {selectedSpecialization && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Консультация по:
                    </Typography>
                    <Chip
                      label={
                        specializations.find((s) => s.id === selectedSpecialization)?.name
                      }
                      size="small"
                      color="primary"
                      onDelete={() => setSelectedSpecialization('')}
                    />
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} md={4}>
            {/* Current Category */}
            {currentCategory && (
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Категория вашего вопроса
                </Typography>
                <Chip
                  label={currentCategory}
                  color="primary"
                  sx={{ mt: 1, fontWeight: 'bold' }}
                />
              </Paper>
            )}

            {/* Recommended Lawyers */}
            {recommendedLawyers.length > 0 && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom color="primary.main" fontWeight="bold">
                  Рекомендуемые юристы
                </Typography>
                <Divider sx={{ mb: 2 }} />
                {recommendedLawyers.map((lawyer) => (
                  <Card
                    key={lawyer.id}
                    sx={{
                      mb: 2,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'scale(1.02)',
                        boxShadow: 4,
                      },
                    }}
                    onClick={() => navigate(`/lawyers/${lawyer.id}`)}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Avatar sx={{ bgcolor: 'primary.main', mr: 1 }}>
                          <Person />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle2" fontWeight="bold">
                            {lawyer.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {lawyer.specialty}
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Rating value={lawyer.rating} precision={0.1} size="small" readOnly />
                        <Typography variant="caption">{lawyer.rating}</Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        Опыт: {lawyer.experience} лет
                      </Typography>
                      <Typography variant="body2" color="primary" fontWeight="bold">
                        от {lawyer.price.toLocaleString()} сум/час
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => navigate('/lawyers')}
                >
                  Посмотреть всех юристов
                </Button>
              </Paper>
            )}

            {/* Tips */}
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'secondary.light', color: 'white' }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                💡 Совет
              </Typography>
              <Typography variant="body2">
                Для более точной консультации опишите вашу ситуацию максимально подробно.
                Вы также можете использовать голосовой ввод для удобства.
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default AIChatPage;
