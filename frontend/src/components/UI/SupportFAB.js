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
import api from '../../services/api';
import { useTranslation } from '../../i18n';

const SupportFAB = () => {
  const { t } = useTranslation();
  const FAQ_ITEMS = t('support.faq');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('faq'); // 'faq' | 'contact'
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSendMessage = async () => {
    if (!message.trim()) {
      toast.error(t('support.toastEmpty'));
      return;
    }
    setSending(true);
    try {
      await api.post('/support', { message });
      toast.success(t('support.toastSent'));
      setMessage('');
      setOpen(false);
    } catch (e) {
      toast.error(t('support.toastError'));
    } finally {
      setSending(false);
    }
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
            {t('support.title')}
          </Typography>
          <IconButton onClick={() => setOpen(false)} size="small">
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {/* Tab buttons */}
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            {[
              { key: 'faq', label: t('support.tabFaq') },
              { key: 'contact', label: t('support.tabContact') },
            ].map((tb) => (
              <Button
                key={tb.key}
                variant={tab === tb.key ? 'contained' : 'outlined'}
                onClick={() => setTab(tb.key)}
                sx={{
                  flex: 1,
                  textTransform: 'none',
                  borderRadius: '8px',
                  ...(tab === tb.key
                    ? { background: axelionColors.gold, color: 'white', boxShadow: 'none', '&:hover': { background: axelionColors.bronze, boxShadow: 'none' } }
                    : { borderColor: axelionColors.borderLight, color: axelionColors.textMuted }),
                }}
              >
                {tb.label}
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
                placeholder={t('support.messagePlaceholder')}
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
                disabled={sending}
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
                {sending ? t('support.sending') : t('support.send')}
              </Button>

              <Box sx={{ mt: 3, pt: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textDark, mb: 2 }}>
                  {t('support.otherWays')}
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
