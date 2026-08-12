import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
  Button, TextField,
} from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

/**
 * Подтверждение необратимого действия админа.
 *
 * До этого блокировка пользователя, одобрение юриста и скрытие отзыва (тянущее
 * пересчёт рейтинга) срабатывали с одного клика, а причина отказа собиралась
 * через window.prompt — нестилизованный, блокируемый в webview/PWA и
 * пропускающий пустую строку.
 *
 * @param {boolean}  open
 * @param {string}   title
 * @param {string}   message
 * @param {string}   confirmLabel
 * @param {boolean}  danger        красная кнопка подтверждения
 * @param {boolean}  withReason    показать поле причины
 * @param {boolean}  reasonRequired причина обязательна (кнопка заблокирована, пока пусто)
 * @param {string}   reasonLabel
 * @param {Function} onConfirm     (reason) => void
 * @param {Function} onClose
 */
const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  withReason = false,
  reasonRequired = false,
  reasonLabel,
  busy = false,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  // Сбрасываем причину при каждом открытии, иначе текст протекает
  // из прошлого подтверждения в следующее.
  useEffect(() => { if (open) setReason(''); }, [open]);

  const blocked = withReason && reasonRequired && !reason.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {message && (
          <DialogContentText sx={{ color: axelionColors.textSecondary, mb: withReason ? 2 : 0 }}>
            {message}
          </DialogContentText>
        )}
        {withReason && (
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label={reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={reasonRequired && reason.length > 0 && !reason.trim()}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          onClick={() => onConfirm(reason.trim())}
          disabled={blocked || busy}
          sx={{ color: danger ? axelionColors.error : axelionColors.gold, fontWeight: 600 }}
        >
          {confirmLabel || t('common.yes')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
