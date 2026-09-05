import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress, Button } from '@mui/material';
import { CloseOutlined, DownloadOutlined, InsertDriveFileOutlined } from '@mui/icons-material';
import { useTranslation } from '../../i18n';
import { consultationDialogPaperSx } from '../../utils/consultationLocale';
import { getPreviewKind } from '../../utils/documentFiles';

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
           const k = getPreviewKind(name, blob.type);
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
    <Dialog open={open} onClose={onClose} aria-labelledby="document-preview-title" maxWidth="md" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
      <DialogTitle id="document-preview-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <InsertDriveFileOutlined sx={{ color: 'var(--accent)' }} />
        <Typography component="span" sx={{ fontSize: 15, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Typography>
        <IconButton aria-label={t('preview.close')} onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseOutlined /></IconButton>
      </DialogTitle>
       <DialogContent dividers sx={{ minHeight: 200, overflow: 'auto' }}>
        {loading ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>
        ) : error ? (
          <Box sx={{ textAlign: 'center', py: 4 }}><Typography sx={{ color: 'var(--text3)', mb: 2 }}>{t('preview.error')}</Typography>{onDownload && <Button onClick={onDownload} variant="outlined" startIcon={<DownloadOutlined />}>{t('preview.download')}</Button>}</Box>
        ) : kind === 'image' ? (
          <Box sx={{ textAlign: 'center' }}>
            <img src={url} alt={name} style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 8 }} />
          </Box>
        ) : kind === 'pdf' ? (
          <Box><iframe src={url} title={name} style={{ width: '100%', height: '62dvh', border: 'none' }} /><Box sx={{ textAlign: 'center', pt: 1 }}>{onDownload && <Button onClick={onDownload} startIcon={<DownloadOutlined />}>{t('preview.download')}</Button>}<Button component="a" href={url} target="_blank" rel="noopener noreferrer">{t('documents.openPdf')}</Button></Box></Box>
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
