import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress, Button } from '@mui/material';
import { CloseOutlined, DownloadOutlined, InsertDriveFileOutlined } from '@mui/icons-material';
import { useTranslation } from '../../i18n';

// Универсальный предпросмотр документа без скачивания.
// fetchBlob: async () => Blob — загружает файл (у разных мест разные эндпоинты).
// onDownload: опциональный колбэк для кнопки «скачать» (для форматов без предпросмотра).
const DocumentPreviewDialog = ({ open, onClose, name = '', fetchBlob, onDownload }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState(null);
  const [kind, setKind] = useState(null); // image | pdf | other
  const [error, setError] = useState(false);

  useEffect(() => {
    let objUrl = null;
    let alive = true;
    if (open && fetchBlob) {
      setLoading(true); setUrl(null); setKind(null); setError(false);
      (async () => {
        try {
          const blob = await fetchBlob();
          if (!alive) return;
          const mime = blob.type || '';
          const lower = (name || '').toLowerCase();
          let k = 'other';
          if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) k = 'image';
          else if (mime === 'application/pdf' || lower.endsWith('.pdf')) k = 'pdf';
          setKind(k);
          if (k === 'image' || k === 'pdf') {
            objUrl = window.URL.createObjectURL(blob);
            setUrl(objUrl);
          }
        } catch {
          if (alive) setError(true);
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }
    return () => {
      alive = false;
      if (objUrl) window.URL.revokeObjectURL(objUrl);
    };
  }, [open, fetchBlob, name]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <InsertDriveFileOutlined sx={{ color: 'var(--accent)' }} />
        <Typography component="span" sx={{ fontSize: 15, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Typography>
        <IconButton onClick={onClose} size="small" sx={{ position: 'absolute', right: 8, top: 8 }}><CloseOutlined /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 200 }}>
        {loading ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>
        ) : error ? (
          <Typography sx={{ py: 4, textAlign: 'center', color: 'var(--text3)' }}>{t('preview.error')}</Typography>
        ) : kind === 'image' ? (
          <Box sx={{ textAlign: 'center' }}>
            <img src={url} alt={name} style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 8 }} />
          </Box>
        ) : kind === 'pdf' ? (
          <iframe src={url} title={name} style={{ width: '100%', height: '72vh', border: 'none' }} />
        ) : (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <InsertDriveFileOutlined sx={{ fontSize: 48, color: 'var(--text3)', mb: 1 }} />
            <Typography sx={{ color: 'var(--text2)', mb: 2 }}>{t('preview.noInline')}</Typography>
            {onDownload && (
              <Button onClick={onDownload} variant="outlined" startIcon={<DownloadOutlined />} sx={{ textTransform: 'none' }}>
                {t('preview.download')}
              </Button>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DocumentPreviewDialog;
