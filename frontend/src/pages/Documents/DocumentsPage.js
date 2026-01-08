import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Button,
  Tabs,
  Tab,
  Chip,
  LinearProgress,
  Paper,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  ArrowBack,
  Add,
  Description,
  CloudUpload,
  VerifiedUser,
  AutoAwesome,
  Download,
  Edit,
  Delete,
  CheckCircle,
  Warning,
  Error as ErrorIcon,
  Close,
  InsertDriveFile,
  Gavel,
} from '@mui/icons-material';

const DOCUMENT_TEMPLATES = [
  {
    id: 1,
    name: 'Договор купли-продажи недвижимости',
    category: 'Недвижимость',
    description: 'Стандартный договор для покупки/продажи квартиры или дома',
    icon: '🏠',
  },
  {
    id: 2,
    name: 'Трудовой договор',
    category: 'Трудовое право',
    description: 'Договор между работником и работодателем',
    icon: '💼',
  },
  {
    id: 3,
    name: 'Исковое заявление',
    category: 'Гражданское право',
    description: 'Заявление в суд для защиты прав',
    icon: '⚖️',
  },
  {
    id: 4,
    name: 'Договор аренды жилья',
    category: 'Недвижимость',
    description: 'Договор найма квартиры или дома',
    icon: '🔑',
  },
  {
    id: 5,
    name: 'Доверенность',
    category: 'Гражданское право',
    description: 'Документ на представление интересов',
    icon: '📄',
  },
  {
    id: 6,
    name: 'Договор оказания услуг',
    category: 'Корпоративное право',
    description: 'Договор между заказчиком и исполнителем',
    icon: '🤝',
  },
];

const DocumentsPage = () => {
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Documents state
  const [documents, setDocuments] = useState([
    {
      id: 1,
      name: 'Договор купли-продажи квартиры.pdf',
      type: 'Недвижимость',
      date: '2024-12-01',
      status: 'verified',
      aiScore: 95,
      size: '2.4 MB',
    },
    {
      id: 2,
      name: 'Трудовой договор ООО Техносфера.docx',
      type: 'Трудовое право',
      date: '2024-11-28',
      status: 'warning',
      aiScore: 78,
      size: '1.2 MB',
    },
    {
      id: 3,
      name: 'Исковое заявление в суд.pdf',
      type: 'Гражданское право',
      date: '2024-11-25',
      status: 'error',
      aiScore: 45,
      size: '856 KB',
    },
  ]);

  // Dialog states
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // Form states
  const [editDocumentName, setEditDocumentName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [templateFormData, setTemplateFormData] = useState({
    buyerName: '',
    sellerName: '',
    propertyAddress: '',
    price: '',
  });

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      console.log('File selected:', file.name);
    }
  };

  const handleUploadSubmit = () => {
    if (!selectedFile) {
      setSnackbar({ open: true, message: 'Пожалуйста, выберите файл', severity: 'error' });
      return;
    }

    setUploadDialogOpen(false);
    setIsUploading(true);
    setUploadProgress(0);

    console.log('Starting upload:', selectedFile.name);

    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);

          // Add new document to the list
          const newDoc = {
            id: documents.length + 1,
            name: selectedFile.name,
            type: 'Загруженный документ',
            date: new Date().toISOString().split('T')[0],
            status: 'verified',
            aiScore: Math.floor(Math.random() * 30) + 70,
            size: `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`,
          };
          setDocuments([...documents, newDoc]);
          setSelectedFile(null);
          setSnackbar({ open: true, message: 'Документ успешно загружен и проанализирован!', severity: 'success' });

          return 100;
        }
        return prev + 10;
      });
    }, 300);
  };

  const handleOpenEditDialog = (doc) => {
    setSelectedDocument(doc);
    setEditDocumentName(doc.name);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    console.log('Saving document edit:', { id: selectedDocument.id, newName: editDocumentName });

    setDocuments(documents.map(doc =>
      doc.id === selectedDocument.id ? { ...doc, name: editDocumentName } : doc
    ));

    setEditDialogOpen(false);
    setSnackbar({ open: true, message: 'Документ успешно изменен!', severity: 'success' });
  };

  const handleOpenAiDialog = (doc) => {
    setSelectedDocument(doc);
    setAiDialogOpen(true);
    console.log('Opening AI analysis for:', doc.name);
  };

  const handleDownload = (doc) => {
    console.log('Downloading document:', doc.name);
    setSnackbar({ open: true, message: `Загрузка "${doc.name}" начата`, severity: 'info' });
  };

  const handleOpenDeleteDialog = (doc) => {
    setSelectedDocument(doc);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    console.log('Deleting document:', selectedDocument.id);

    setDocuments(documents.filter(doc => doc.id !== selectedDocument.id));
    setDeleteDialogOpen(false);
    setSnackbar({ open: true, message: 'Документ успешно удален!', severity: 'success' });
  };

  const handleOpenTemplateDialog = (template) => {
    setSelectedTemplate(template);
    setTemplateFormData({
      buyerName: '',
      sellerName: '',
      propertyAddress: '',
      price: '',
    });
    setTemplateDialogOpen(true);
    console.log('Opening template form for:', template.name);
  };

  const handleCreateFromTemplate = () => {
    console.log('Creating document from template:', selectedTemplate.name, templateFormData);

    const newDoc = {
      id: documents.length + 1,
      name: `${selectedTemplate.name}.docx`,
      type: selectedTemplate.category,
      date: new Date().toISOString().split('T')[0],
      status: 'verified',
      aiScore: 100,
      size: '1.0 MB',
    };

    setDocuments([...documents, newDoc]);
    setTemplateDialogOpen(false);
    setSnackbar({ open: true, message: 'Документ успешно создан из шаблона!', severity: 'success' });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'verified':
        return <CheckCircle sx={{ color: '#10b981' }} />;
      case 'warning':
        return <Warning sx={{ color: '#f59e0b' }} />;
      case 'error':
        return <ErrorIcon sx={{ color: '#ef4444' }} />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'verified':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      case 'error':
        return '#ef4444';
      default:
        return '#64748b';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'verified':
        return 'Проверен';
      case 'warning':
        return 'Внимание';
      case 'error':
        return 'Ошибки';
      default:
        return 'Неизвестно';
    }
  };

  const getAiAnalysis = (score) => {
    if (score >= 80) {
      return {
        summary: 'Отличный документ',
        issues: [],
        suggestions: ['Документ составлен правильно и соответствует всем требованиям'],
        risks: 'Минимальный риск',
      };
    } else if (score >= 50) {
      return {
        summary: 'Документ требует доработки',
        issues: [
          'Отсутствует пункт о форс-мажорных обстоятельствах',
          'Нечеткая формулировка условий оплаты',
        ],
        suggestions: [
          'Добавить раздел о разрешении споров',
          'Уточнить сроки выполнения обязательств',
        ],
        risks: 'Средний риск',
      };
    } else {
      return {
        summary: 'Документ имеет серьезные недостатки',
        issues: [
          'Отсутствуют обязательные реквизиты сторон',
          'Не указаны существенные условия договора',
          'Нарушена структура документа',
        ],
        suggestions: [
          'Полностью переработать документ',
          'Использовать утвержденный шаблон',
          'Проконсультироваться с юристом',
        ],
        risks: 'Высокий риск',
      };
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#faf8f6', pb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
          color: 'white',
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              color="inherit"
              onClick={() => navigate('/dashboard')}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.1)',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' },
              }}
            >
              <ArrowBack />
            </IconButton>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h5" fontWeight="bold">
                Мои документы
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Управляйте документами и проверяйте их с помощью AI
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<CloudUpload />}
              onClick={() => setUploadDialogOpen(true)}
              sx={{
                bgcolor: 'white',
                color: '#3d5a52',
                fontWeight: 'bold',
                '&:hover': {
                  bgcolor: '#f0fdf4',
                },
              }}
            >
              Загрузить документ
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Upload Progress */}
        {isUploading && (
          <Paper
            sx={{
              p: 3,
              mb: 3,
              borderRadius: 3,
              bgcolor: '#f0fdf4',
              border: '1px solid #3d5a52',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <AutoAwesome sx={{ color: '#3d5a52' }} />
              <Typography variant="h6" fontWeight="bold" color="#3d5a52">
                Загрузка и AI-анализ документа...
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={uploadProgress}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: '#e0e0e0',
                '& .MuiLinearProgress-bar': {
                  background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
                },
              }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {uploadProgress}% - Проверка документа на ошибки и недостающие пункты
            </Typography>
          </Paper>
        )}

        {/* Tabs */}
        <Paper sx={{ mb: 3, borderRadius: 3, overflow: 'hidden' }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            sx={{
              bgcolor: '#faf8f6',
              '& .MuiTab-root': {
                fontWeight: 'bold',
                textTransform: 'none',
                fontSize: '1rem',
              },
            }}
          >
            <Tab label="Мои документы" />
            <Tab label="Шаблоны документов" />
          </Tabs>
        </Paper>

        {/* My Documents Tab */}
        {tabValue === 0 && (
          <Grid container spacing={3}>
            {documents.map((doc) => (
              <Grid item xs={12} md={6} lg={4} key={doc.id}>
                <Card sx={{ borderRadius: 3, height: '100%' }}>
                  <CardContent sx={{ p: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: 3,
                          background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
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

                    <Typography variant="h6" fontWeight="bold" gutterBottom noWrap>
                      {doc.name}
                    </Typography>

                    <Chip
                      label={doc.type}
                      size="small"
                      icon={<Gavel />}
                      sx={{
                        mb: 2,
                        bgcolor: '#f0fdf4',
                        color: '#3d5a52',
                        border: '1px solid #3d5a52',
                      }}
                    />

                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          AI оценка:
                        </Typography>
                        <Typography variant="caption" fontWeight="bold" sx={{ color: getStatusColor(doc.status) }}>
                          {doc.aiScore}% - {getStatusLabel(doc.status)}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={doc.aiScore}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: 'rgba(0, 0, 0, 0.05)',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: getStatusColor(doc.status),
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Размер: {doc.size}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(doc.date).toLocaleDateString('ru-RU')}
                      </Typography>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <IconButton
                        size="small"
                        sx={{ color: '#3d5a52' }}
                        onClick={() => handleDownload(doc)}
                      >
                        <Download />
                      </IconButton>
                      <IconButton
                        size="small"
                        sx={{ color: '#3d5a52' }}
                        onClick={() => handleOpenEditDialog(doc)}
                      >
                        <Edit />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleOpenDeleteDialog(doc)}
                      >
                        <Delete />
                      </IconButton>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VerifiedUser />}
                        sx={{
                          ml: 'auto',
                          borderColor: '#3d5a52',
                          color: '#3d5a52',
                          '&:hover': {
                            borderColor: '#2a403a',
                            bgcolor: '#f0fdf4',
                          },
                        }}
                        onClick={() => handleOpenAiDialog(doc)}
                      >
                        AI проверка
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Templates Tab */}
        {tabValue === 1 && (
          <Grid container spacing={3}>
            {DOCUMENT_TEMPLATES.map((template) => (
              <Grid item xs={12} md={6} lg={4} key={template.id}>
                <Card sx={{ borderRadius: 3, height: '100%' }}>
                  <CardContent sx={{ p: 3 }}>
                    <Box
                      sx={{
                        fontSize: '3rem',
                        mb: 2,
                        textAlign: 'center',
                      }}
                    >
                      {template.icon}
                    </Box>

                    <Typography variant="h6" fontWeight="bold" gutterBottom textAlign="center">
                      {template.name}
                    </Typography>

                    <Chip
                      label={template.category}
                      size="small"
                      sx={{
                        mb: 2,
                        display: 'block',
                        mx: 'auto',
                        width: 'fit-content',
                        bgcolor: '#fef3c7',
                        color: '#a67c52',
                        border: '1px solid #a67c52',
                      }}
                    />

                    <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mb: 3 }}>
                      {template.description}
                    </Typography>

                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={<Add />}
                      sx={{
                        background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
                        fontWeight: 'bold',
                        '&:hover': {
                          background: 'linear-gradient(135deg, #2a403a 0%, #1f302a 100%)',
                        },
                      }}
                      onClick={() => handleOpenTemplateDialog(template)}
                    >
                      Создать из шаблона
                    </Button>
                  </CardContent>
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
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Загрузка документа
          </Typography>
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
                  py: 3,
                  borderStyle: 'dashed',
                  borderWidth: 2,
                  borderColor: '#3d5a52',
                  color: '#3d5a52',
                  '&:hover': {
                    borderColor: '#2a403a',
                    bgcolor: '#f0fdf4',
                  },
                }}
              >
                {selectedFile ? selectedFile.name : 'Выберите файл (PDF, DOC, DOCX)'}
              </Button>
            </label>
            {selectedFile && (
              <Alert severity="success" sx={{ mt: 2 }}>
                Файл выбран: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setUploadDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleUploadSubmit}
            disabled={!selectedFile}
            sx={{
              background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
            }}
          >
            Загрузить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Изменить документ
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              label="Название документа"
              value={editDocumentName}
              onChange={(e) => setEditDocumentName(e.target.value)}
              fullWidth
              autoFocus
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setEditDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveEdit}
            sx={{
              background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
            }}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Analysis Dialog */}
      <Dialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesome sx={{ color: '#3d5a52' }} />
            <Typography variant="h5" fontWeight="bold">
              AI-анализ документа
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedDocument && (
            <Box sx={{ pt: 2 }}>
              <Paper sx={{ p: 2, mb: 3, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Документ:
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {selectedDocument.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                  <Chip
                    label={`AI оценка: ${selectedDocument.aiScore}%`}
                    sx={{
                      bgcolor: getStatusColor(selectedDocument.status),
                      color: 'white',
                      fontWeight: 'bold',
                    }}
                  />
                  <Chip
                    label={getStatusLabel(selectedDocument.status)}
                    variant="outlined"
                  />
                </Box>
              </Paper>

              {(() => {
                const analysis = getAiAnalysis(selectedDocument.aiScore);
                return (
                  <>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      {analysis.summary}
                    </Typography>

                    {analysis.issues.length > 0 && (
                      <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ color: '#ef4444' }}>
                          Обнаруженные проблемы:
                        </Typography>
                        <List>
                          {analysis.issues.map((issue, index) => (
                            <ListItem key={index}>
                              <ListItemIcon>
                                <ErrorIcon sx={{ color: '#ef4444' }} />
                              </ListItemIcon>
                              <ListItemText primary={issue} />
                            </ListItem>
                          ))}
                        </List>
                      </Box>
                    )}

                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ color: '#3d5a52' }}>
                        Рекомендации:
                      </Typography>
                      <List>
                        {analysis.suggestions.map((suggestion, index) => (
                          <ListItem key={index}>
                            <ListItemIcon>
                              <CheckCircle sx={{ color: '#10b981' }} />
                            </ListItemIcon>
                            <ListItemText primary={suggestion} />
                          </ListItem>
                        ))}
                      </List>
                    </Box>

                    <Alert severity={selectedDocument.aiScore >= 80 ? 'success' : selectedDocument.aiScore >= 50 ? 'warning' : 'error'}>
                      <Typography variant="subtitle2" fontWeight="bold">
                        Уровень риска: {analysis.risks}
                      </Typography>
                    </Alert>
                  </>
                );
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            onClick={() => setAiDialogOpen(false)}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
            }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Удалить документ?
          </Typography>
        </DialogTitle>
        <DialogContent>
          {selectedDocument && (
            <Typography variant="body1">
              Вы уверены, что хотите удалить документ "{selectedDocument.name}"? Это действие нельзя отменить.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteConfirm}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Template Creation Dialog */}
      <Dialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h5" fontWeight="bold">
            Создать документ из шаблона
          </Typography>
        </DialogTitle>
        <DialogContent>
          {selectedTemplate && (
            <Box sx={{ pt: 2 }}>
              <Paper sx={{ p: 2, mb: 3, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Шаблон:
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {selectedTemplate.name}
                </Typography>
                <Chip
                  label={selectedTemplate.category}
                  size="small"
                  sx={{ mt: 1, bgcolor: '#fef3c7', color: '#a67c52' }}
                />
              </Paper>

              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Заполните данные для документа:
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                <TextField
                  label="ФИО покупателя"
                  value={templateFormData.buyerName}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, buyerName: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="ФИО продавца"
                  value={templateFormData.sellerName}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, sellerName: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Адрес недвижимости"
                  value={templateFormData.propertyAddress}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, propertyAddress: e.target.value })}
                  fullWidth
                  multiline
                  rows={2}
                />
                <TextField
                  label="Цена"
                  value={templateFormData.price}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, price: e.target.value })}
                  fullWidth
                  type="number"
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setTemplateDialogOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateFromTemplate}
            disabled={!templateFormData.buyerName || !templateFormData.sellerName || !templateFormData.propertyAddress || !templateFormData.price}
            sx={{
              background: 'linear-gradient(135deg, #3d5a52 0%, #2a403a 100%)',
            }}
          >
            Создать документ
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
          sx={{ width: '100%' }}
          icon={snackbar.severity === 'success' ? <CheckCircle /> : undefined}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DocumentsPage;
