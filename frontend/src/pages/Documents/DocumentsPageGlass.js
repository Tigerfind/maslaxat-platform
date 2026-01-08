import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Divider,
  Alert,
  Snackbar,
  CircularProgress,
  Tooltip,
  Button,
  Card,
} from '@mui/material';
import {
  ArrowBack,
  CloudUpload,
  Description,
  VerifiedUser,
  AutoAwesome,
  Download,
  Delete,
  CheckCircle,
  Warning,
  Error as ErrorIcon,
  InsertDriveFile,
  Folder,
} from '@mui/icons-material';
import clientService from '../../services/clientService';

const DocumentsPageGlass = () => {
  const navigate = useNavigate();

  // State management
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [aiCheckResult, setAiCheckResult] = useState(null);

  // Snackbar state
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  });

  // Fetch documents on mount
  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      const data = await clientService.documents.getDocuments();
      setDocuments(data);
    } catch (error) {
      console.error('Error fetching documents:', error);
      showSnackbar('Ошибка при загрузке документов', 'error');
      // Set mock data as fallback
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        showSnackbar('Файл слишком большой. Максимальный размер: 10MB', 'error');
        return;
      }

      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];

      if (!allowedTypes.includes(file.type)) {
        showSnackbar('Неподдерживаемый формат файла. Используйте PDF, DOC или DOCX', 'error');
        return;
      }

      setSelectedFile(file);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      showSnackbar('Пожалуйста, выберите файл', 'error');
      return;
    }

    try {
      setUploadDialogOpen(false);
      setIsUploading(true);
      setUploadProgress(0);

      // Simulate progress for better UX
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
        uploadDate: new Date().toISOString(),
      };

      const result = await clientService.documents.uploadDocument(selectedFile, metadata);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Wait a bit to show 100% completion
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFile(null);
        showSnackbar('Документ успешно загружен!', 'success');
        fetchDocuments(); // Refresh the list
      }, 500);

    } catch (error) {
      console.error('Error uploading document:', error);
      setIsUploading(false);
      setUploadProgress(0);
      showSnackbar(
        error.response?.data?.message || 'Ошибка при загрузке документа',
        'error'
      );
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedDocument) return;

    try {
      await clientService.documents.deleteDocument(selectedDocument.id);
      setDeleteDialogOpen(false);
      setSelectedDocument(null);
      showSnackbar('Документ успешно удален!', 'success');
      fetchDocuments(); // Refresh the list
    } catch (error) {
      console.error('Error deleting document:', error);
      showSnackbar(
        error.response?.data?.message || 'Ошибка при удалении документа',
        'error'
      );
    }
  };

  const handleAICheck = async (document) => {
    try {
      setSelectedDocument(document);
      setAiDialogOpen(true);
      setAiCheckLoading(true);
      setAiCheckResult(null);

      const result = await clientService.documents.checkDocument(document.id);
      setAiCheckResult(result);
    } catch (error) {
      console.error('Error checking document:', error);
      showSnackbar(
        error.response?.data?.message || 'Ошибка при проверке документа',
        'error'
      );
      setAiDialogOpen(false);
    } finally {
      setAiCheckLoading(false);
    }
  };

  const handleDownload = (document) => {
    // In a real implementation, this would download the file
    console.log('Downloading document:', document);
    showSnackbar(`Загрузка "${document.filename || document.name}" начата`, 'info');
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'verified':
      case 'checked':
        return <CheckCircle sx={{ color: '#10b981' }} />;
      case 'warning':
        return <Warning sx={{ color: '#f59e0b' }} />;
      case 'error':
      case 'failed':
        return <ErrorIcon sx={{ color: '#ef4444' }} />;
      default:
        return <Folder sx={{ color: '#64748b' }} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'verified':
      case 'checked':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      case 'error':
      case 'failed':
        return '#ef4444';
      default:
        return '#64748b';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'verified':
      case 'checked':
        return 'Проверен';
      case 'warning':
        return 'Внимание';
      case 'error':
      case 'failed':
        return 'Ошибки';
      case 'pending':
        return 'В обработке';
      default:
        return 'Не проверен';
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return 'N/A';
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#F4F6F8',
        pb: 4,
      }}
    >
      {/* Header */}
      <Box sx={{ bgcolor: '#FFFFFF', borderBottom: '1px solid #E6E9EE', py: 3, px: 2 }}>
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => navigate('/dashboard')}
              sx={{
                border: '1px solid #E6E9EE',
                color: '#0B1B2B',
                '&:hover': {
                  bgcolor: '#F4F6F8',
                },
                transition: 'all 0.2s ease',
              }}
            >
              <ArrowBack />
            </IconButton>
            <Box sx={{ flexGrow: 1 }}>
              <Typography
                variant="h4"
                fontWeight="600"
                sx={{ color: '#0B1B2B', mb: 0.5 }}
              >
                Мои документы
              </Typography>
              <Typography variant="body1" sx={{ color: '#6B7280' }}>
                Управляйте документами и проверяйте их с помощью AI
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<CloudUpload />}
              onClick={() => setUploadDialogOpen(true)}
              sx={{
                bgcolor: '#2563EB',
                color: '#FFFFFF',
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                py: 1.25,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                '&:hover': {
                  bgcolor: '#1d4ed8',
                  boxShadow: '0 4px 8px rgba(11, 27, 43, 0.1)',
                },
              }}
            >
              Загрузить документ
            </Button>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Upload Progress */}
        {isUploading && (
          <Card
            sx={{
              mb: 3,
              p: 3,
              bgcolor: '#FFFFFF',
              border: '1px solid #E6E9EE',
              borderRadius: '12px',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <AutoAwesome sx={{ color: '#2563EB', fontSize: 32 }} />
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" fontWeight="600" sx={{ mb: 0.5, color: '#0B1B2B' }}>
                  Загрузка документа...
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                  {uploadProgress}% - Загрузка и анализ документа
                </Typography>
              </Box>
            </Box>
            <LinearProgress
              variant="determinate"
              value={uploadProgress}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: '#E6E9EE',
                '& .MuiLinearProgress-bar': {
                  bgcolor: '#2563EB',
                  borderRadius: 4,
                },
              }}
            />
          </Card>
        )}

        {/* Loading State */}
        {isLoading ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '400px',
            }}
          >
            <CircularProgress sx={{ color: '#2563EB' }} size={60} />
          </Box>
        ) : documents.length === 0 ? (
          // Empty State
          <Card
            sx={{
              textAlign: 'center',
              py: 8,
              px: 4,
              bgcolor: '#FFFFFF',
              border: '1px solid #E6E9EE',
              borderRadius: '12px',
              boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            }}
          >
            <Description sx={{ fontSize: 80, color: '#E6E9EE', mb: 2 }} />
            <Typography variant="h5" fontWeight="600" gutterBottom sx={{ color: '#0B1B2B' }}>
              Нет документов
            </Typography>
            <Typography variant="body1" sx={{ color: '#6B7280', mb: 3 }}>
              Загрузите первый документ для начала работы
            </Typography>
            <Button
              variant="contained"
              startIcon={<CloudUpload />}
              onClick={() => setUploadDialogOpen(true)}
              sx={{
                bgcolor: '#2563EB',
                color: '#FFFFFF',
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                py: 1.25,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                '&:hover': {
                  bgcolor: '#1d4ed8',
                },
              }}
            >
              Загрузить документ
            </Button>
          </Card>
        ) : (
          // Documents Grid
          <Grid container spacing={3}>
            {documents.map((doc) => (
              <Grid item xs={12} md={6} lg={4} key={doc.id}>
                <Card
                  sx={{
                    p: 3,
                    bgcolor: '#FFFFFF',
                    border: '1px solid #E6E9EE',
                    borderRadius: '12px',
                    boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(11, 27, 43, 0.1)',
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      mb: 2,
                    }}
                  >
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: '8px',
                        bgcolor: '#2563EB',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                      }}
                    >
                      <Description sx={{ fontSize: 32 }} />
                    </Box>
                    {getStatusIcon(doc.status)}
                  </Box>

                  <Tooltip title={doc.filename || doc.name}>
                    <Typography
                      variant="h6"
                      fontWeight="600"
                      gutterBottom
                      sx={{
                        color: '#0B1B2B',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.filename || doc.name}
                    </Typography>
                  </Tooltip>

                  {doc.type && (
                    <Chip
                      label={doc.type}
                      size="small"
                      sx={{
                        mb: 2,
                        bgcolor: '#F4F6F8',
                        color: '#2563EB',
                        border: '1px solid #E6E9EE',
                        fontWeight: 600,
                      }}
                    />
                  )}

                  {/* AI Score */}
                  {doc.aiScore !== undefined && (
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption" sx={{ color: '#6B7280' }}>
                          AI оценка:
                        </Typography>
                        <Typography
                          variant="caption"
                          fontWeight="600"
                          sx={{ color: getStatusColor(doc.status) }}
                        >
                          {doc.aiScore}% - {getStatusLabel(doc.status)}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={doc.aiScore}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: '#E6E9EE',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: getStatusColor(doc.status),
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>
                  )}

                  {/* File Info */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="caption" sx={{ color: '#6B7280' }}>
                      Размер: {formatFileSize(doc.size)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#6B7280' }}>
                      {formatDate(doc.uploadDate || doc.createdAt)}
                    </Typography>
                  </Box>

                  <Divider sx={{ my: 2, borderColor: '#E6E9EE' }} />

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Tooltip title="Скачать">
                      <IconButton
                        size="small"
                        sx={{
                          color: '#2563EB',
                          border: '1px solid #E6E9EE',
                          '&:hover': {
                            bgcolor: '#F4F6F8',
                          },
                        }}
                        onClick={() => handleDownload(doc)}
                      >
                        <Download />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Удалить">
                      <IconButton
                        size="small"
                        sx={{
                          color: '#ef4444',
                          border: '1px solid #E6E9EE',
                          '&:hover': {
                            bgcolor: '#FEF2F2',
                          },
                        }}
                        onClick={() => {
                          setSelectedDocument(doc);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Delete />
                      </IconButton>
                    </Tooltip>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<VerifiedUser />}
                      onClick={() => handleAICheck(doc)}
                      sx={{
                        ml: 'auto',
                        bgcolor: '#2563EB',
                        color: '#FFFFFF',
                        textTransform: 'none',
                        fontWeight: 600,
                        borderRadius: '8px',
                        px: 2,
                        '&:hover': {
                          bgcolor: '#1d4ed8',
                        },
                      }}
                    >
                      AI проверка
                    </Button>
                  </Box>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>

      {/* Upload Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '12px',
            bgcolor: '#FFFFFF',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CloudUpload sx={{ color: '#2563EB', fontSize: 32 }} />
            <Typography variant="h5" fontWeight="600" sx={{ color: '#0B1B2B' }}>
              Загрузка документа
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <input
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
              id="file-upload"
              type="file"
              onChange={handleFileSelect}
            />
            <label htmlFor="file-upload">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<InsertDriveFile />}
                sx={{
                  py: 4,
                  borderStyle: 'dashed',
                  borderWidth: 2,
                  borderColor: '#2563EB',
                  color: '#2563EB',
                  fontSize: '1rem',
                  fontWeight: 600,
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: '#1d4ed8',
                    bgcolor: '#F4F6F8',
                  },
                }}
              >
                {selectedFile
                  ? selectedFile.name
                  : 'Выберите файл (PDF, DOC, DOCX)'}
              </Button>
            </label>
            {selectedFile && (
              <Alert severity="success" sx={{ mt: 2, borderRadius: '8px' }}>
                <Typography variant="body2" fontWeight="600">
                  Файл выбран: {selectedFile.name}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6B7280' }}>
                  Размер: {formatFileSize(selectedFile.size)}
                </Typography>
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setUploadDialogOpen(false);
              setSelectedFile(null);
            }}
            sx={{
              borderColor: '#E6E9EE',
              color: '#6B7280',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 3,
              '&:hover': {
                borderColor: '#0B1B2B',
                bgcolor: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleUploadSubmit}
            disabled={!selectedFile}
            sx={{
              bgcolor: '#2563EB',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 3,
              '&:hover': {
                bgcolor: '#1d4ed8',
              },
              '&:disabled': {
                bgcolor: '#E6E9EE',
                color: '#6B7280',
              },
            }}
          >
            Загрузить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '12px',
            bgcolor: '#FFFFFF',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ErrorIcon sx={{ color: '#ef4444', fontSize: 32 }} />
            <Typography variant="h5" fontWeight="600" sx={{ color: '#0B1B2B' }}>
              Удалить документ?
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedDocument && (
            <Typography variant="body1" sx={{ color: '#6B7280' }}>
              Вы уверены, что хотите удалить документ "
              {selectedDocument.filename || selectedDocument.name}"? Это действие нельзя
              отменить.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setDeleteDialogOpen(false);
              setSelectedDocument(null);
            }}
            sx={{
              borderColor: '#E6E9EE',
              color: '#6B7280',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 3,
              '&:hover': {
                borderColor: '#0B1B2B',
                bgcolor: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleDeleteDocument}
            sx={{
              bgcolor: '#ef4444',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 3,
              '&:hover': {
                bgcolor: '#dc2626',
              },
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Check Dialog */}
      <Dialog
        open={aiDialogOpen}
        onClose={() => !aiCheckLoading && setAiDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '12px',
            bgcolor: '#FFFFFF',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <AutoAwesome sx={{ color: '#2563EB', fontSize: 32 }} />
            <Typography variant="h5" fontWeight="600" sx={{ color: '#0B1B2B' }}>
              AI-анализ документа
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {aiCheckLoading ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 6,
              }}
            >
              <CircularProgress sx={{ color: '#2563EB', mb: 2 }} size={60} />
              <Typography variant="h6" sx={{ color: '#0B1B2B' }}>
                Анализируем документ...
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                Это может занять несколько секунд
              </Typography>
            </Box>
          ) : aiCheckResult ? (
            <Box sx={{ pt: 2 }}>
              {/* Document Info */}
              <Card
                sx={{
                  mb: 3,
                  p: 3,
                  bgcolor: '#F4F6F8',
                  border: '1px solid #E6E9EE',
                  borderRadius: '8px',
                  boxShadow: 'none',
                }}
              >
                <Typography variant="subtitle2" sx={{ color: '#6B7280' }} gutterBottom>
                  Документ:
                </Typography>
                <Typography variant="h6" fontWeight="600" gutterBottom sx={{ color: '#0B1B2B' }}>
                  {selectedDocument?.filename || selectedDocument?.name}
                </Typography>
                {aiCheckResult.score !== undefined && (
                  <Chip
                    label={`AI оценка: ${aiCheckResult.score}%`}
                    sx={{
                      bgcolor:
                        aiCheckResult.score >= 80
                          ? '#10b981'
                          : aiCheckResult.score >= 50
                          ? '#f59e0b'
                          : '#ef4444',
                      color: 'white',
                      fontWeight: 'bold',
                    }}
                  />
                )}
              </Card>

              {/* Summary */}
              {aiCheckResult.summary && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" fontWeight="600" gutterBottom sx={{ color: '#0B1B2B' }}>
                    Резюме
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#6B7280' }}>
                    {aiCheckResult.summary}
                  </Typography>
                </Box>
              )}

              {/* Issues */}
              {aiCheckResult.issues && aiCheckResult.issues.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="h6"
                    fontWeight="600"
                    gutterBottom
                    sx={{ color: '#ef4444' }}
                  >
                    Обнаруженные проблемы
                  </Typography>
                  {aiCheckResult.issues.map((issue, index) => (
                    <Alert
                      key={index}
                      severity="error"
                      sx={{ mb: 1, borderRadius: '8px' }}
                    >
                      {issue}
                    </Alert>
                  ))}
                </Box>
              )}

              {/* Suggestions */}
              {aiCheckResult.suggestions && aiCheckResult.suggestions.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="h6"
                    fontWeight="600"
                    gutterBottom
                    sx={{ color: '#10b981' }}
                  >
                    Рекомендации
                  </Typography>
                  {aiCheckResult.suggestions.map((suggestion, index) => (
                    <Alert
                      key={index}
                      severity="success"
                      sx={{ mb: 1, borderRadius: '8px' }}
                    >
                      {suggestion}
                    </Alert>
                  ))}
                </Box>
              )}

              {/* Risk Level */}
              {aiCheckResult.risk && (
                <Alert
                  severity={
                    aiCheckResult.score >= 80
                      ? 'success'
                      : aiCheckResult.score >= 50
                      ? 'warning'
                      : 'error'
                  }
                  sx={{ borderRadius: '8px' }}
                >
                  <Typography variant="subtitle2" fontWeight="600">
                    Уровень риска: {aiCheckResult.risk}
                  </Typography>
                </Alert>
              )}
            </Box>
          ) : (
            <Alert severity="error" sx={{ borderRadius: '8px' }}>
              Не удалось получить результаты анализа
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            variant="contained"
            onClick={() => {
              setAiDialogOpen(false);
              setAiCheckResult(null);
            }}
            disabled={aiCheckLoading}
            sx={{
              bgcolor: '#2563EB',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 3,
              '&:hover': {
                bgcolor: '#1d4ed8',
              },
              '&:disabled': {
                bgcolor: '#E6E9EE',
                color: '#6B7280',
              },
            }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{
            width: '100%',
            borderRadius: '8px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DocumentsPageGlass;
