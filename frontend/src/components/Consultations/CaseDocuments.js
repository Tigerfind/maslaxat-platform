import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  List, ListItem, ListItemText, IconButton, CircularProgress, Chip, Alert,
} from '@mui/material';
import {
  UploadFileOutlined, DownloadOutlined, DeleteOutline, DescriptionOutlined,
  FolderOpenOutlined, VisibilityOutlined, AutoAwesomeOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import DocumentPreviewDialog from '../UI/DocumentPreviewDialog';
import DocumentAnalysisPanel from './DocumentAnalysisPanel';
import { consultationDialogPaperSx, localeForLanguage } from '../../utils/consultationLocale';
import { CASE_DOCUMENT_ACCEPT, CASE_DOCUMENT_FORMAT_LABEL, DOCUMENT_MAX_BYTES, isAllowedDocumentFile, normalizeDocumentFile } from '../../utils/documentFiles';

const fmtSize = (b, locale) => {
  if (!b) return '';
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: b < 1024 * 1024 ? 0 : 1 });
  if (b < 1024) return `${formatter.format(b)} B`;
  if (b < 1024 * 1024) return `${formatter.format(b / 1024)} KB`;
  return `${formatter.format(b / 1024 / 1024)} MB`;
};

// Рабочие документы по делу — общая папка юриста и клиента для одной консультации.
// Удалять может только автор загрузки; скачивать — оба участника.
const CaseDocuments = ({ consultationId, open, onClose, currentUserId, readOnly = false }) => {
  const { t, language } = useTranslation();
  const locale = localeForLanguage(language);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [serverWritable, setServerWritable] = useState(false);
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [analysisDoc, setAnalysisDoc] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzingIds, setAnalyzingIds] = useState(() => new Set());
  const analyzingRef = useRef(new Set());
  const analysisDocRef = useRef(null);
  const consultationRef = useRef(consultationId);
  const loadRequestRef = useRef(null);
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
    loadRequestRef.current?.abort();
    const controller = new AbortController();
    loadRequestRef.current = controller;
    const requestedConsultationId = consultationId;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/consultations/${consultationId}/documents`, { signal: controller.signal });
      if (consultationRef.current !== requestedConsultationId) return null;
      const nextDocs = res.data.documents || [];
      setDocs(nextDocs);
      setServerWritable(res.data.writable === true);
      setCanAnalyze(res.data.canAnalyze === true);
      return nextDocs;
    } catch (error) {
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return null;
      setLoadError(error);
      setServerWritable(false);
      setCanAnalyze(false);
      return null;
    } finally {
      if (consultationRef.current === requestedConsultationId) setLoading(false);
    }
  }, [consultationId]);

  const writable = !readOnly && serverWritable;

  useEffect(() => {
    consultationRef.current = consultationId;
    analysisDocRef.current = null;
    setAnalysisDoc(null);
    setAnalysisError('');
    analyzingRef.current.clear();
    setAnalyzingIds(new Set());
    setDocs([]);
    if (open) load();
    return () => loadRequestRef.current?.abort();
  }, [consultationId, open, load]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > DOCUMENT_MAX_BYTES) { toast.error(t('caseDocs.fileTooBig')); return; }
    if (!isAllowedDocumentFile(file, { allowWebp: true })) { toast.error(t('caseDocs.unsupportedFormat', { formats: CASE_DOCUMENT_FORMAT_LABEL })); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', normalizeDocumentFile(file));
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

  const analysisErrorMessage = (error) => {
    const code = error.response?.data?.code;
    if (code === 'AI_UNAVAILABLE') return t('caseDocs.analysisUnavailable');
    if (['SCANNED_PDF_UNSUPPORTED', 'OLD_DOC_UNSUPPORTED', 'DOCUMENT_FORMAT_UNSUPPORTED', 'DOCUMENT_TEXT_EMPTY', 'DOCUMENT_TOO_LONG', 'IMAGE_TOO_LARGE_FOR_AI'].includes(code)) return t('caseDocs.analysisUnsupported');
    if (code === 'AI_RATE_LIMIT') return t('caseDocs.analysisRateLimit');
    const serverMessage = error.response?.data?.message || error.response?.data?.error;
    if (serverMessage) return serverMessage;
    if (error.response?.status === 503) return t('caseDocs.analysisUnavailable');
    if (error.response?.status === 422) return t('caseDocs.analysisUnsupported');
    return t('caseDocs.analysisError');
  };

  const requestAnalysis = async (doc) => {
    if (analyzingRef.current.has(doc.id)) return;
    analyzingRef.current.add(doc.id);
    setAnalyzingIds((previous) => new Set(previous).add(doc.id));
    setAnalysisError('');
    const requestedConsultationId = consultationId;
    try {
      const response = await api.post(`/consultations/${consultationId}/documents/${doc.id}/ai-analysis`);
      const nextAnalysis = response.data.analysis;
      if (consultationRef.current !== requestedConsultationId) return;
      setDocs((previous) => previous.map((item) => (item.id === doc.id ? { ...item, analysis: nextAnalysis } : item)));
      setAnalysisDoc((current) => (current?.id === doc.id ? { ...current, analysis: nextAnalysis } : current));
    } catch (error) {
      if (consultationRef.current === requestedConsultationId && analysisDocRef.current === doc.id) setAnalysisError(analysisErrorMessage(error));
    } finally {
      analyzingRef.current.delete(doc.id);
      if (consultationRef.current === requestedConsultationId) setAnalyzingIds((previous) => {
        const next = new Set(previous);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const openAnalysis = (doc) => {
    analysisDocRef.current = doc.id;
    setAnalysisError('');
    setAnalysisDoc(doc);
    if (!doc.analysis) requestAnalysis(doc);
  };

  const refreshAnalysis = async () => {
    const nextDocs = await load();
    if (!nextDocs || !analysisDoc) return;
    const refreshed = nextDocs.find((doc) => doc.id === analysisDoc.id);
    if (refreshed && analysisDocRef.current === refreshed.id) setAnalysisDoc(refreshed);
  };

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="case-documents-title" maxWidth="sm" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
      <DialogTitle id="case-documents-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <FolderOpenOutlined sx={{ color: 'var(--accent)' }} />
        {t('caseDocs.title')}
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 13, color: 'var(--text2)', mb: 2 }}>
          {t('caseDocs.hint')}
        </Typography>

        {writable && <Button
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={uploading}
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={15} /> : <UploadFileOutlined />}
          sx={{ textTransform: 'none', mb: 2, borderRadius: '10px' }}
        >
          {t('caseDocs.upload')}
        </Button>}
        {writable && <input ref={fileRef} type="file"
          accept={CASE_DOCUMENT_ACCEPT}
          onChange={onFile} style={{ display: 'none' }} />}

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
        ) : loadError ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>{t('caseDocs.retry')}</Button>}>
            {t('caseDocs.loadError')}
          </Alert>
        ) : docs.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text3)', py: 1 }}>{t('caseDocs.empty')}</Typography>
        ) : (
          <List disablePadding>
            {docs.map((d) => {
              const isMine = d.uploaderId === currentUserId;
              return (
                <ListItem key={d.id} divider sx={{ px: 0, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' }, gap: 1 }}>
                  <DescriptionOutlined sx={{ fontSize: 20, color: 'var(--accent)', mr: 1.5 }} />
                  <ListItemText
                    primary={d.name}
                    secondary={
                      <span>
                        {d.uploader?.name || ''}{d.size ? ` · ${fmtSize(d.size, locale)}` : ''}
                      </span>
                    }
                    primaryTypographyProps={{ fontSize: 14, fontWeight: 500, sx: { overflowWrap: 'anywhere' } }}
                    secondaryTypographyProps={{ fontSize: 12 }}
                  />
                  {isMine && <Chip size="small" label={t('caseDocs.mine')} sx={{ height: 24, fontSize: 10.5 }} />}
                  <Box sx={{ display: 'flex', gap: 0.5, width: { xs: '100%', sm: 'auto' }, justifyContent: { xs: 'flex-end', sm: 'initial' }, alignItems: 'center', flexWrap: 'wrap' }}>
                    {canAnalyze && d.analysisSupported !== false && (
                      <Button
                        aria-label={t('caseDocs.analyzeAria', { name: d.name })}
                        disabled={analyzingIds.has(d.id)}
                        onClick={() => openAnalysis(d)}
                        startIcon={analyzingIds.has(d.id) ? <CircularProgress size={16} /> : <AutoAwesomeOutlined sx={{ fontSize: 18 }} />}
                        size="small"
                        sx={{ minHeight: 44, textTransform: 'none' }}
                      >
                        {t('caseDocs.analyze')}
                      </Button>
                    )}
                    <IconButton aria-label={t('preview.view')} onClick={() => setPreviewDoc(d)} title={t('preview.view')}>
                      <VisibilityOutlined sx={{ fontSize: 19 }} />
                    </IconButton>
                    <IconButton aria-label={t('caseDocs.download')} disabled={downloading === d.id} onClick={() => download(d)} title={t('caseDocs.download')}>
                      {downloading === d.id ? <CircularProgress size={16} /> : <DownloadOutlined sx={{ fontSize: 19 }} />}
                    </IconButton>
                    {isMine && writable && (
                      <IconButton aria-label={t('caseDocs.delete')} onClick={() => remove(d)} title={t('caseDocs.delete')} sx={{ color: 'var(--error, #C0492F)' }}>
                        <DeleteOutline sx={{ fontSize: 19 }} />
                      </IconButton>
                    )}
                  </Box>
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
      <DocumentAnalysisPanel
        open={Boolean(analysisDoc)}
        onClose={() => { analysisDocRef.current = null; setAnalysisDoc(null); setAnalysisError(''); }}
        documentName={analysisDoc?.name || ''}
        analysis={analysisDoc?.analysis}
        loading={analysisDoc ? analyzingIds.has(analysisDoc.id) : false}
        error={analysisError}
        onRetry={analysisDoc ? () => requestAnalysis(analysisDoc) : null}
        onRefresh={refreshAnalysis}
      />
    </Dialog>
  );
};

export default CaseDocuments;
