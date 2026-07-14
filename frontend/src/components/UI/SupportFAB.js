import React, { useState } from 'react';
import {
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  TextField,
  Button,
  IconButton,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  HelpOutline,
  Close,
  ExpandMore,
  Email,
  Phone,
  Telegram,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { axelionColors } from '../../theme/axelionTheme';

const FAQ_ITEMS = [
  {
    q: 'Как записаться на консультацию?',
    a: 'Перейдите на страницу "Юристы", выберите специалиста и нажмите "Записаться". Выберите дату, время и опишите вашу ситуацию.',
  },
  {
    q: 'Как пользоваться AI-консультантом?',
    a: 'Перейдите в раздел "AI Консультант" и опишите вашу юридическую ситуацию. ИИ проанализирует вопрос на основе законодательства РУз и даст рекомендации.',
  },
  {
    q: 'Как загрузить документ для AI анализа?',
    a: 'Перейдите в "Документы", нажмите "Загрузить", выберите файл (PDF, DOC, JPG). После загрузки нажмите "AI Анализ" для проверки документа.',
  },
  {
    q: 'Безопасны ли мои данные?',
    a: 'Да. Все данные зашифрованы, видеозвонки проходят напрямую между участниками (P2P), документы хранятся на защищённых серверах.',
  },
  {
    q: 'Как отменить консультацию?',
    a: 'Перейдите в "Мои консультации", найдите нужную запись и нажмите "Отменить". Отмена бесплатна если сделана за 24 часа до консультации.',
  },
  {
    q: 'Как связаться с поддержкой?',
    a: 'Напишите нам на support@maslaxat.uz или через Telegram @maslaxat_support. Мы отвечаем в рабочие дни с 9:00 до 18:00.',
  },
];

const SupportFAB = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('faq'); // 'faq' | 'contact'
  const [message, setMessage] = useState('');

  const handleSendMessage = () => {
    if (!message.trim()) {
      toast.error('Введите сообщение');
      return;
    }
    toast.success('Сообщение отправлено! Мы ответим в течение 24 часов.');
    setMessage('');
    setOpen(false);
  };

  return (
    <>
      <Fab
        onClick={() => setOpen(true)}
        sx={{
          position: 'fixed',
          bottom: { xs: 80, md: 24 },
          right: 24,
          background: axelionColors.gold,
          color: 'white',
          zIndex: 1100,
          boxShadow: '0 4px 16px rgba(26, 26, 26, 0.15)',
          '&:hover': { background: axelionColors.bronze },
        }}
      >
        <HelpOutline />
      </Fab>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '12px',
            border: `1px solid ${axelionColors.borderLight}`,
            maxHeight: '80vh',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 400, color: axelionColors.textDark }}>
            Помощь и поддержка
          </Typography>
          <IconButton onClick={() => setOpen(false)} size="small">
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {/* Tab buttons */}
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            {[
              { key: 'faq', label: 'Частые вопросы' },
              { key: 'contact', label: 'Написать нам' },
            ].map((t) => (
              <Button
                key={t.key}
                variant={tab === t.key ? 'contained' : 'outlined'}
                onClick={() => setTab(t.key)}
                sx={{
                  flex: 1,
                  textTransform: 'none',
                  borderRadius: '8px',
                  ...(tab === t.key
                    ? { background: axelionColors.gold, color: 'white', boxShadow: 'none', '&:hover': { background: axelionColors.bronze, boxShadow: 'none' } }
                    : { borderColor: axelionColors.borderLight, color: axelionColors.textMuted }),
                }}
              >
                {t.label}
              </Button>
            ))}
          </Box>

          {tab === 'faq' ? (
            FAQ_ITEMS.map((item, i) => (
              <Accordion
                key={i}
                disableGutters
                elevation={0}
                sx={{
                  border: `1px solid ${axelionColors.borderLight}`,
                  borderRadius: '8px !important',
                  mb: 1,
                  '&:before': { display: 'none' },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: axelionColors.textDark }}>
                    {item.q}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                    {item.a}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))
          ) : (
            <Box>
              <TextField
                fullWidth
                multiline
                rows={4}
                placeholder="Опишите вашу проблему или вопрос..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                sx={{
                  mb: 3,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                    '& fieldset': { borderColor: axelionColors.borderLight },
                    '&:hover fieldset': { borderColor: axelionColors.gold },
                    '&.Mui-focused fieldset': { borderColor: axelionColors.gold },
                  },
                }}
              />
              <Button
                fullWidth
                variant="contained"
                onClick={handleSendMessage}
                sx={{
                  background: axelionColors.gold,
                  color: 'white',
                  textTransform: 'none',
                  borderRadius: '8px',
                  py: 1.5,
                  boxShadow: 'none',
                  '&:hover': { background: axelionColors.bronze, boxShadow: 'none' },
                }}
              >
                Отправить сообщение
              </Button>

              <Box sx={{ mt: 3, pt: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textDark, mb: 2 }}>
                  Другие способы связи:
                </Typography>
                {[
                  { icon: <Email />, text: 'support@maslaxat.uz' },
                  { icon: <Phone />, text: '+998 71 200 00 00' },
                  { icon: <Telegram />, text: '@maslaxat_support' },
                ].map((item, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <Box sx={{ color: axelionColors.gold }}>{item.icon}</Box>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                      {item.text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SupportFAB;
