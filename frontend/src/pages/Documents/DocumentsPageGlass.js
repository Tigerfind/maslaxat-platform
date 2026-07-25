import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Dialog,
  DialogContent,
  Alert,
  Snackbar,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  CloudUploadOutlined,
  DescriptionOutlined,
  DownloadOutlined,
  DeleteOutlined,
  AutoAwesomeOutlined,
  CloseOutlined,
  GavelOutlined,
  WarningAmberOutlined,
  LightbulbOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';

/*
  ─────────────────────────────────────────────────────────────
  CLIENT DOCUMENTS  (/documents)
  Ported 1:1 from ClaudeDesign → client/07_DOCUMENTS + 08_DOCUMENT_UPLOAD.
  What it shows / how it works:
   • Grid of glass document cards  ← clientService.documents.getDocuments()
       (icon, status pill, name, type·size·date, AI-score bar, actions)
   • Upload dialog (dropzone, category, ≤10MB PDF/DOC/DOCX, progress)
                                    → clientService.documents.uploadDocument()
   • Per-doc: download (GET /documents/:id/download) · delete dialog → deleteDocument()
              "AI-проверка" dialog (loader → analysis) → checkDocument()
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  ─────────────────────────────────────────────────────────────
*/

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const goldGradientBtn = {
  background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
  color: '#FFFFFF',
  border: 'none',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// value — хранится на сервере, k — ключ перевода для отображения
const DOC_CATEGORIES = [
  { v: 'Договор', k: 'typeContract' },
  { v: 'Доверенность', k: 'typePOA' },
  { v: 'Заявление', k: 'typeStatement' },
  { v: 'Иск', k: 'typeClaim' },
  { v: 'Другое', k: 'typeOther' },
];

// status enum from backend: pending | verified | issues | rejected
const STATUS_MAP = {
  verified: { key: 'docStatusVerified', color: 'var(--success)', bg: 'rgba(122,154,107,0.15)' },
  issues: { key: 'docStatusIssues', color: 'var(--warning)', bg: 'rgba(196,163,90,0.16)' },
  rejected: { key: 'docStatusRejected', color: 'var(--error)', bg: 'rgba(176,112,112,0.16)' },
  pending: { key: 'docStatusPending', color: 'var(--text2)', bg: 'rgba(154,154,154,0.15)' },
};
const statusMeta = (status) => STATUS_MAP[status] || STATUS_MAP.pending;

const scoreColor = (score) =>
  score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--error)';

const DocumentsPageGlass = () => {
  const { t } = useTranslation();
  // State management
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [aiCheckResult, setAiCheckResult] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewKind, setPreviewKind] = useState(null); // 'image' | 'pdf' | 'other'
  const [previewLoading, setPreviewLoading] = useState(false);

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      const data = await clientService.documents.getDocuments();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      showSnackbar(t('documents.loadError'), 'error');
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const validateAndSetFile = (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showSnackbar(t('documents.fileTooBig', { size: '10MB' }), 'error');
      return;
    }
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedTypes.includes(file.type)) {
      showSnackbar(t('documents.unsupportedFormat', { formats: 'PDF, DOC, DOCX' }), 'error');
      return;
    }
    setSelectedFile(file);
  };

  const handleFileSelect = (event) => validateAndSetFile(event.target.files[0]);

  const handleDrop = (event) => {
    event.preventDefault();
    validateAndSetFile(event.dataTransfer.files?.[0]);
  };

  const closeUploadDialog = () => {
    setUploadDialogOpen(false);
    setSelectedFile(null);
    setSelectedCategory(null);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      showSnackbar(t('documents.selectFileFirst'), 'error');
      return;
    }

    try {
      setUploadDialogOpen(false);
      setIsUploading(true);
      setUploadProgress(0);

      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const metadata = {
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
        category: selectedCategory || undefined,
        uploadDate: new Date().toISOString(),
      };

      await clientService.documents.uploadDocument(selectedFile, metadata);

      clearInterval(progressInterval);
      setUploadProgress(100);

      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFile(null);
        setSelectedCategory(null);
        showSnackbar(t('documents.uploadSuccess'), 'success');
        fetchDocuments();
      }, 500);
    } catch (error) {
      console.error('Error uploading document:', error);
      setIsUploading(false);
      setUploadProgress(0);
      showSnackbar(error.response?.data?.message || t('documents.uploadError'), 'error');
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedDocument) return;
    try {
      await clientService.documents.deleteDocument(selectedDocument.id);
      setDeleteDialogOpen(false);
      setSelectedDocument(null);
      showSnackbar(t('documents.deleteSuccess'), 'success');
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      showSnackbar(error.response?.data?.message || t('documents.deleteError'), 'error');
    }
  };

  const handleAICheck = async (doc) => {
    try {
      setSelectedDocument(doc);
      setAiDialogOpen(true);
      setAiCheckLoading(true);
      setAiCheckResult(null);

      const result = await clientService.documents.checkDocument(doc.id);
      setAiCheckResult(result);
      fetchDocuments(); // status/score may update after analysis
    } catch (error) {
      console.error('Error checking document:', error);
      showSnackbar(error.response?.data?.message || t('documents.analyzeError'), 'error');
      setAiDialogOpen(false);
    } finally {
      setAiCheckLoading(false);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const blob = await clientService.documents.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = doc.name || 'document';
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      showSnackbar(t('documents.downloadError'), 'error');
    }
  };

  const handlePreview = async (doc) => {
    setPreviewDoc(doc);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewUrl(null);
    setPreviewKind(null);
    try {
      const blob = await clientService.documents.downloadDocument(doc.id);
      // Тип берём из blob (сервер ставит Content-Type), иначе — по расширению имени
      const mime = blob.type || '';
      const name = (doc.name || '').toLowerCase();
      let kind = 'other';
      if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) kind = 'image';
      else if (mime === 'application/pdf' || name.endsWith('.pdf')) kind = 'pdf';
      setPreviewKind(kind);
      if (kind === 'image' || kind === 'pdf') {
        setPreviewUrl(window.URL.createObjectURL(blob));
      }
    } catch (e) {
      showSnackbar(t('documents.previewError'), 'error');
      setPreviewKind('other');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setPreviewDoc(null);
    setPreviewKind(null);
  };

  const docScore = (doc) =>
    doc.aiAnalysis?.score ?? doc.aiScore ?? null;

  const fileBadge = (name = '') => {
    const ext = name.split('.').pop();
    return ext && ext !== name ? ext.toUpperCase().slice(0, 4) : 'FILE';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // ── AI result field mapping (backend keys) ──────────────────
  const aiRisks = aiCheckResult?.risks?.length ? aiCheckResult.risks : aiCheckResult?.issues || [];
  const aiRecs = aiCheckResult?.recommendations?.length
    ? aiCheckResult.recommendations
    : aiCheckResult?.suggestions || [];
  const aiLaws = aiCheckResult?.relevantLaws || [];

  return (
    <GlassShell
      active="/documents"
      title={t('documents.title')}
      subtitle={t('documents.subtitle')}
    >
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        {/* Upload CTA */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 22 }}>
          <button
            onClick={() => setUploadDialogOpen(true)}
            style={{ ...goldGradientBtn, padding: '13px 24px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <CloudUploadOutlined sx={{ fontSize: 18 }} /> {t('documents.uploadDocument')}
          </button>
        </div>

        {/* Upload progress */}
        {isUploading && (
          <div style={{ ...glassCard, padding: 22, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <AutoAwesomeOutlined sx={{ color: 'var(--accent)', fontSize: 28 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
                  {t('documents.uploadModalTitle')}…
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {uploadProgress}% · {t('documents.analyzingDoc')}
                </div>
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s ease' }} />
            </div>
          </div>
        )}

        {/* Content states */}
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
            <CircularProgress sx={{ color: 'var(--accent)' }} size={56} />
          </Box>
        ) : documents.length === 0 ? (
          <div style={{ ...glassCard, textAlign: 'center', padding: '64px 32px' }}>
            <DescriptionOutlined sx={{ fontSize: 72, color: 'var(--border-strong)', mb: 2 }} />
            <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.04em', color: 'var(--text)', marginBottom: 8 }}>
              {t('documents.emptyTitle')}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>
              {t('documents.emptySub')}
            </div>
            <button
              onClick={() => setUploadDialogOpen(true)}
              style={{ ...goldGradientBtn, padding: '13px 24px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <CloudUploadOutlined sx={{ fontSize: 18 }} /> {t('documents.uploadDoc')}
            </button>
          </div>
        ) : (
          <Grid container spacing={2.25}>
            {documents.map((doc) => {
              const meta = statusMeta(doc.status);
              const score = docScore(doc);
              return (
                <Grid item xs={12} sm={6} lg={4} key={doc.id}>
                  <div style={{ ...glassCard, padding: 22, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div
                        style={{
                          width: 44, height: 44, borderRadius: 'var(--radius)',
                          background: 'var(--accent-tint, rgba(184,149,110,0.16))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
                        }}
                      >
                        <DescriptionOutlined sx={{ fontSize: 24 }} />
                      </div>
                      <span
                        style={{
                          fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase',
                          color: meta.color, background: meta.bg, padding: '5px 11px', borderRadius: 'var(--radius)',
                        }}
                      >
                        {t('documents.' + meta.key)}
                      </span>
                    </div>

                    {/* Name */}
                    <Tooltip title={doc.name}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {doc.name}
                      </div>
                    </Tooltip>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                      {[doc.type, formatFileSize(doc.size), formatDate(doc.createdAt || doc.uploadDate)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>

                    {/* AI score */}
                    {score !== null && score !== undefined && (
                      <>
                        <div style={{ margin: '18px 0 6px', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)' }}>
                          <span>AI-{t('documents.score')}</span>
                          <span style={{ color: scoreColor(score), fontWeight: 600 }}>{score}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ width: `${score}%`, height: '100%', background: scoreColor(score) }} />
                        </div>
                      </>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: score !== null ? 18 : 'auto', paddingTop: score !== null ? 0 : 18 }}>
                      <button
                        onClick={() => handleAICheck(doc)}
                        style={{
                          flex: 1, background: 'var(--canvas)', border: '1px solid var(--accent)', color: 'var(--text)',
                          fontSize: 12, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
                          padding: 10, borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        <AutoAwesomeOutlined sx={{ fontSize: 16 }} /> {t('documents.aiAnalysis')}
                      </button>
                      <Tooltip title={t('documents.preview')}>
                        <button
                          onClick={() => handlePreview(doc)}
                          style={{ width: 40, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--radius)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <VisibilityOutlined sx={{ fontSize: 18 }} />
                        </button>
                      </Tooltip>
                      <Tooltip title={t('documents.download')}>
                        <button
                          onClick={() => handleDownload(doc)}
                          style={{ width: 40, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--radius)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <DownloadOutlined sx={{ fontSize: 18 }} />
                        </button>
                      </Tooltip>
                      <Tooltip title={t('documents.delete')}>
                        <button
                          onClick={() => {
                            setSelectedDocument(doc);
                            setDeleteDialogOpen(true);
                          }}
                          style={{ width: 40, background: 'transparent', border: '1px solid var(--border)', color: 'var(--error)', borderRadius: 'var(--radius)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <DeleteOutlined sx={{ fontSize: 18 }} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </Grid>
              );
            })}
          </Grid>
        )}
      </div>

      {/* ── Upload dialog (07 CTA → 08 layout) ─────────────────── */}
      <Dialog
        open={uploadDialogOpen}
        onClose={closeUploadDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { ...glassCard, backgroundImage: 'none' } }}
      >
        <DialogContent sx={{ p: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.02em' }}>
              {t('documents.uploadModalTitle')}
            </div>
            <button onClick={closeUploadDialog} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
              <CloseOutlined sx={{ fontSize: 22 }} />
            </button>
          </div>

          {/* Category */}
          <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 12 }}>
            {t('documents.docCategory')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {DOC_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.v;
              return (
                <button
                  key={cat.v}
                  onClick={() => setSelectedCategory(active ? null : cat.v)}
                  style={{
                    fontSize: 13, fontWeight: 500, padding: '9px 16px', borderRadius: 'var(--radius)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))' : 'transparent',
                    color: active ? '#FFFFFF' : 'var(--text2)',
                    border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                  }}
                >
                  {t('documents.' + cat.k)}
                </button>
              );
            })}
          </div>

          {/* Dropzone */}
          <label htmlFor="doc-file-input">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                ...glassCard, border: '1.5px dashed var(--accent)', padding: '40px 28px',
                textAlign: 'center', marginBottom: 22, cursor: 'pointer', display: 'block',
              }}
            >
              <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: '50%', background: 'var(--accent-tint, rgba(184,149,110,0.18))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                <CloudUploadOutlined sx={{ fontSize: 30 }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
                {t('documents.dropHere')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
                PDF, DOC, DOCX · {t('documents.maxTo')} 10 MB
              </div>
              <span style={{ ...goldGradientBtn, padding: '11px 22px', display: 'inline-block' }}>
                {t('documents.chooseFile')}
              </span>
            </div>
          </label>
          <input
            id="doc-file-input"
            accept=".pdf,.doc,.docx"
            type="file"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Selected file with progress placeholder */}
          {selectedFile && (
            <>
              <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 12 }}>
                {t('documents.fileLabel')} (1)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...glassCard, padding: '14px 16px', marginBottom: 24 }}>
                <span style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: 'var(--accent-tint, rgba(184,149,110,0.16))', color: 'var(--accent)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {fileBadge(selectedFile.name)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedFile.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>{formatFileSize(selectedFile.size)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: 'var(--success)' }} />
                  </div>
                </div>
                <button onClick={() => setSelectedFile(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', flexShrink: 0, display: 'flex' }}>
                  <CloseOutlined sx={{ fontSize: 20 }} />
                </button>
              </div>
            </>
          )}

          <button
            onClick={handleUploadSubmit}
            disabled={!selectedFile}
            style={{
              ...goldGradientBtn, width: '100%', padding: 15, fontSize: 14,
              opacity: selectedFile ? 1 : 0.5, cursor: selectedFile ? 'pointer' : 'not-allowed',
            }}
          >
            {t('documents.uploadAndAnalyze')}
          </button>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ────────────────────────────────── */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { ...glassCard, backgroundImage: 'none' } }}
      >
        <DialogContent sx={{ p: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(176,112,112,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--error)', flexShrink: 0 }}>
              <DeleteOutlined sx={{ fontSize: 22 }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>{t('documents.deleteModalTitle')}?</div>
          </div>
          {selectedDocument && (
            <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
              {t('documents.deleteConfirmQ')} «{selectedDocument.name}»? {t('documents.deleteIrreversible')}.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setDeleteDialogOpen(false);
                setSelectedDocument(null);
              }}
              style={{ ...ghostBtn, padding: '11px 20px' }}
            >
              {t('documents.cancel')}
            </button>
            <button
              onClick={handleDeleteDocument}
              style={{ background: 'var(--error)', color: '#FFFFFF', border: 'none', fontSize: 13, fontWeight: 500, padding: '11px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('documents.delete')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── AI check dialog ────────────────────────────────────── */}
      <Dialog
        open={aiDialogOpen}
        onClose={() => !aiCheckLoading && setAiDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { ...glassCard, backgroundImage: 'none' } }}
      >
        <DialogContent sx={{ p: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AutoAwesomeOutlined sx={{ color: 'var(--accent)', fontSize: 26 }} />
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.02em' }}>
                {t('documents.aiAnalysis')}
              </div>
            </div>
            {!aiCheckLoading && (
              <button onClick={() => { setAiDialogOpen(false); setAiCheckResult(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
                <CloseOutlined sx={{ fontSize: 22 }} />
              </button>
            )}
          </div>

          {aiCheckLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
              <CircularProgress sx={{ color: 'var(--accent)', mb: 2 }} size={52} />
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{t('documents.analyzingDoc')}…</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{t('documents.analyzingSub')}</div>
            </div>
          ) : aiCheckResult ? (
            <div className="ai-reveal">
              {/* Summary card */}
              <div style={{ ...glassCard, background: 'var(--canvas)', boxShadow: 'none', padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>
                  {aiCheckResult.documentType || t('documents.fileLabel')}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>
                  {selectedDocument?.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {aiCheckResult.score !== undefined && aiCheckResult.score !== null && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#FFFFFF', background: scoreColor(aiCheckResult.score), padding: '5px 12px', borderRadius: 'var(--radius)' }}>
                      AI-{t('documents.score')}: {aiCheckResult.score}%
                    </span>
                  )}
                  {aiCheckResult.risk && (
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 'var(--radius)' }}>
                      {t('documents.risk')}: {aiCheckResult.risk}
                    </span>
                  )}
                </div>
              </div>

              {/* Summary */}
              {aiCheckResult.summary && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('documents.summary')}</div>
                  <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.65 }}>{aiCheckResult.summary}</div>
                </div>
              )}

              {/* Risks */}
              {aiRisks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 500, color: 'var(--error)', marginBottom: 10 }}>
                    <WarningAmberOutlined sx={{ fontSize: 20 }} /> {t('documents.risksTitle')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {aiRisks.map((risk, i) => (
                      <div key={i} style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, padding: '11px 14px', borderRadius: 'var(--radius)', background: 'rgba(176,112,112,0.10)', border: '1px solid rgba(176,112,112,0.25)' }}>
                        {risk}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {aiRecs.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 500, color: 'var(--success)', marginBottom: 10 }}>
                    <LightbulbOutlined sx={{ fontSize: 20 }} /> {t('documents.recommendations')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {aiRecs.map((rec, i) => (
                      <div key={i} style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, padding: '11px 14px', borderRadius: 'var(--radius)', background: 'rgba(122,154,107,0.10)', border: '1px solid rgba(122,154,107,0.25)' }}>
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Relevant laws */}
              {aiLaws.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 500, color: 'var(--accent)', marginBottom: 10 }}>
                    <GavelOutlined sx={{ fontSize: 20 }} /> {t('documents.relevantLaws')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {aiLaws.map((law, i) => (
                      <span key={i} style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-dark)', background: 'var(--accent-tint, rgba(184,149,110,0.14))', padding: '6px 12px', borderRadius: 'var(--radius)' }}>
                        {law}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Alert severity="error" sx={{ borderRadius: 'var(--radius)' }}>
              {t('documents.analysisResultError')}
            </Alert>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ─────────────────────────────────────── */}
      <Dialog
        open={previewOpen}
        onClose={closePreview}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px', background: 'var(--surface)', backgroundImage: 'none' } }}
      >
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <VisibilityOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {previewDoc?.name}
            </span>
          </div>
          <button onClick={closePreview} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
            <CloseOutlined sx={{ fontSize: 20 }} />
          </button>
        </div>
        <DialogContent sx={{ p: 0, background: 'var(--canvas)', minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {previewLoading ? (
            <div style={{ padding: 60 }}><CircularProgress sx={{ color: 'var(--accent)' }} /></div>
          ) : previewKind === 'image' && previewUrl ? (
            <img src={previewUrl} alt={previewDoc?.name} style={{ maxWidth: '100%', maxHeight: '72vh', display: 'block', margin: '0 auto' }} />
          ) : previewKind === 'pdf' && previewUrl ? (
            <iframe src={previewUrl} title={previewDoc?.name} style={{ width: '100%', height: '72vh', border: 'none' }} />
          ) : (
            <div style={{ padding: '56px 32px', textAlign: 'center' }}>
              <DescriptionOutlined sx={{ fontSize: 48, color: 'var(--text3)', mb: 1.5 }} />
              <div style={{ fontSize: 15, color: 'var(--text2)', marginBottom: 6 }}>{t('documents.previewUnavailable')}</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>{t('documents.previewUnavailableSub')}</div>
              <button
                onClick={() => { if (previewDoc) handleDownload(previewDoc); }}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))', color: '#FFFFFF', border: 'none',
                  fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '11px 22px',
                  borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8,
                }}
              >
                <DownloadOutlined sx={{ fontSize: 16 }} /> {t('documents.download')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%', borderRadius: 'var(--radius)' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </GlassShell>
  );
};

export default DocumentsPageGlass;
