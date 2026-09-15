import React, { useState } from 'react';
import { Alert, Button, Collapse } from '@mui/material';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../../i18n';

const EmailVerificationBanner = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useSelector((state) => state.auth);
  const [dismissed, setDismissed] = useState(false);

  const hiddenRoute = /^\/consultations\/(video|zoom)\//.test(location.pathname) || location.pathname === '/verify-email';
  if (!user || user.isVerified || dismissed || hiddenRoute) return null;

  return (
    <Collapse in>
      <Alert
        severity="warning"
        onClose={() => setDismissed(true)}
        action={(
          <Button size="small" onClick={() => navigate('/verify-email')} sx={{ color: '#8A6848', fontWeight: 600 }}>
            {t('emailBanner.enterCode')}
          </Button>
        )}
        sx={{ borderRadius: 0 }}
      >
        {t('emailBanner.prompt')}
      </Alert>
    </Collapse>
  );
};

export default EmailVerificationBanner;
