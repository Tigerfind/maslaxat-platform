import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, Alert, Button, Collapse } from '@mui/material';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { axelionColors } from '../../theme/axelionTheme';
import SupportFAB from '../UI/SupportFAB';
import MobileBottomNav from '../UI/MobileBottomNav';
import { useTranslation } from '../../i18n';

const EmailVerificationBanner = () => {
  const { t } = useTranslation();
  const { user } = useSelector((state) => state.auth);
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.isVerified || dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await api.post('/auth/resend-verification');
      setSent(true);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  return (
    <Collapse in>
      <Alert
        severity="warning"
        onClose={() => setDismissed(true)}
        action={
          !sent ? (
            <Button
              size="small"
              disabled={sending}
              onClick={handleResend}
              sx={{ color: '#B8956E', fontWeight: 500 }}
            >
              {sending ? t('emailBanner.sending') : t('emailBanner.resend')}
            </Button>
          ) : null
        }
        sx={{ borderRadius: 0 }}
      >
        {sent ? t('emailBanner.sent') : t('emailBanner.prompt')}
      </Alert>
    </Collapse>
  );
};

const Layout = () => {
  const location = useLocation();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: axelionColors.bgCream,
        pb: { xs: '72px', md: 0 },
      }}
    >
      <EmailVerificationBanner />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
      <SupportFAB />
      <MobileBottomNav />
    </Box>
  );
};

export default Layout;
