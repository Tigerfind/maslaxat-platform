import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  List, ListItem, ListItemText, IconButton, CircularProgress, Chip,
} from '@mui/material';
import {
  UploadFileOutlined, DownloadOutlined, DeleteOutline, DescriptionOutlined,
  FolderOpenOutlined, VisibilityOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import DocumentPreviewDialog from '../UI/DocumentPreviewDialog';

const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Рабочие документы по делу — общая папка юриста и клиента для одной консультации.
// Удалять может только автор загрузки; скачивать — оба участника.
const CaseDocuments = ({ consultationId, open, onClose, currentUserId }) => {
  const { t } = useTranslation();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const fileRef = useRef(null);

  // Загрузка файла как blob для предпросмотра (тот же эндпоинт, что и скачивание).
  const fetchBlob = useCallback(async () => {
    const res = await api.get(
      `/consultations/${consultationId}/documents/${previewDoc.id}/download`,
      { responseType: 'blob' },
    );
    return res.data;
  }, [consultationId, previewDoc]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/consultations/${consultationId}/documents`);
      setDocs(res.data.documents || []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [consultationId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/consultations/${consultationId}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('caseDocs.uploaded'));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('caseDocs.error'));
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc) => {
    setDownloading(doc.id);
    try {
      const res = await api.get(
        `/consultations/${consultationId}/documents/${doc.id}/download`,
        { responseType: 'blob' },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = doc.name;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t('caseDocs.error'));
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(t('caseDocs.confirmDelete'))) return;
    try {
      await api.delete(`/consultations/${consultationId}/documents/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      toast.error(err.response?.data?.error || t('caseDocs.error'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <FolderOpenOutlined sx={{ color: 'var(--accent)' }} />
        {t('caseDocs.title')}
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 13, color: 'var(--text2)', mb: 2 }}>
          {t('caseDocs.hint')}
        </Typography>

        <Button
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={uploading}
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={15} /> : <UploadFileOutlined />}
          sx={{ textTransform: 'none', mb: 2, borderRadius: '10px' }}
        >
          {t('caseDocs.upload')}
        </Button>
        <input ref={fileRef} type="file"
          accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp"
          onChange={onFile} style={{ display: 'none' }} />

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
        ) : docs.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text3)', py: 1 }}>{t('caseDocs.empty')}</Typography>
        ) : (
          <List disablePadding>
            {docs.map((d) => {
              const isMine = d.uploaderId === currentUserId;
              return (
                <ListItem key={d.id} divider
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <IconButton size="small" onClick={() => setPreviewDoc(d)} title={t('preview.view')}>
                        <VisibilityOutlined sx={{ fontSize: 19 }} />
                      </IconButton>
                      <IconButton size="small" disabled={downloading === d.id} onClick={() => download(d)} title={t('caseDocs.download')}>
                        {downloading === d.id ? <CircularProgress size={16} /> : <DownloadOutlined sx={{ fontSize: 19 }} />}
                      </IconButton>
                      {isMine && (
                        <IconButton size="small" onClick={() => remove(d)} title={t('caseDocs.delete')} sx={{ color: 'var(--error, #C0492F)' }}>
                          <DeleteOutline sx={{ fontSize: 19 }} />
                        </IconButton>
                      )}
                    </Box>
                  }
                >
                  <DescriptionOutlined sx={{ fontSize: 20, color: 'var(--accent)', mr: 1.5 }} />
                  <ListItemText
                    primary={d.name}
                    secondary={
                      <span>
                        {d.uploader?.name || ''}{d.size ? ` · ${fmtSize(d.size)}` : ''}
                      </span>
                    }
                    primaryTypographyProps={{ fontSize: 14, fontWeight: 500, noWrap: true }}
                    secondaryTypographyProps={{ fontSize: 12 }}
                  />
                  {isMine && <Chip size="small" label={t('caseDocs.mine')} sx={{ mr: 9, height: 20, fontSize: 10.5 }} />}
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: 'var(--text2)' }}>{t('caseDocs.close')}</Button>
      </DialogActions>

      <DocumentPreviewDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        name={previewDoc?.name}
        fetchBlob={previewDoc ? fetchBlob : null}
        onDownload={previewDoc ? () => download(previewDoc) : null}
      />
    </Dialog>
  );
};

export default CaseDocuments;
