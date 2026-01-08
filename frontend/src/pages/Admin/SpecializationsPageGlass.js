import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  Stack,
  CircularProgress,
  Card,
  Button,
  Paper,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  ArrowBack,
  Visibility,
  VisibilityOff,
  CheckCircle,
  Person,
} from '@mui/icons-material';
import { adminSpecializationService } from '../../services/adminService';

const SpecializationsPageGlass = () => {
  const navigate = useNavigate();

  const [specializations, setSpecializations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedSpecId, setSelectedSpecId] = useState(null);
  const [currentSpec, setCurrentSpec] = useState({
    id: '',
    name: '',
    description: '',
    active: true,
  });

  useEffect(() => {
    loadSpecializations();
  }, []);

  const loadSpecializations = async () => {
    try {
      setLoading(true);
      const data = await adminSpecializationService.getSpecializations();
      setSpecializations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading specializations:', error);
      toast.error('Ошибка загрузки специализаций');
      setSpecializations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (spec = null) => {
    if (spec) {
      setCurrentSpec(spec);
      setEditMode(true);
    } else {
      setCurrentSpec({
        id: '',
        name: '',
        description: '',
        active: true,
      });
      setEditMode(false);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setCurrentSpec({
      id: '',
      name: '',
      description: '',
      active: true,
    });
    setEditMode(false);
  };

  const handleSave = async () => {
    if (!currentSpec.name || !currentSpec.description) {
      toast.error('Пожалуйста, заполните все поля');
      return;
    }

    try {
      if (editMode) {
        await adminSpecializationService.updateSpecialization(
          currentSpec.id,
          currentSpec
        );
        toast.success('Специализация обновлена');
      } else {
        await adminSpecializationService.createSpecialization(currentSpec);
        toast.success('Специализация создана');
      }
      handleCloseDialog();
      loadSpecializations();
    } catch (error) {
      console.error('Error saving specialization:', error);
      toast.error('Ошибка при сохранении');
    }
  };

  const handleDeleteClick = (id) => {
    setSelectedSpecId(id);
    setDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await adminSpecializationService.deleteSpecialization(selectedSpecId);
      toast.success('Специализация удалена');
      setDeleteConfirm(false);
      setSelectedSpecId(null);
      loadSpecializations();
    } catch (error) {
      console.error('Error deleting specialization:', error);
      toast.error('Ошибка при удалении');
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    try {
      const spec = specializations.find((s) => s.id === id);
      if (spec) {
        await adminSpecializationService.updateSpecialization(id, {
          ...spec,
          active: !currentStatus,
        });
        toast.success(
          !currentStatus ? 'Специализация активирована' : 'Специализация деактивирована'
        );
        loadSpecializations();
      }
    } catch (error) {
      console.error('Error toggling specialization:', error);
      toast.error('Ошибка при изменении статуса');
    }
  };

  const activeCount = specializations.filter((s) => s.active).length;
  const lawyerCount = specializations.reduce(
    (sum, s) => sum + (s.lawyerCount || 0),
    0
  );

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#F4F6F8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress sx={{ color: '#2563EB' }} size={60} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: '#F4F6F8',
        pb: 4,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tooltip title="Назад">
                <IconButton
                  onClick={() => navigate('/admin/dashboard')}
                  sx={{
                    background: '#F4F6F8',
                    color: '#0B1B2B',
                    border: '1px solid #E6E9EE',
                    '&:hover': {
                      background: '#E6E9EE',
                      borderColor: '#2563EB',
                    },
                  }}
                >
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Box>
                <Typography variant="h5" fontWeight="700" sx={{ color: '#0B1B2B' }}>
                  Управление специализациями
                </Typography>
                <Typography variant="body2" sx={{ color: '#6B7280', mt: 0.5 }}>
                  Добавляйте, редактируйте и управляйте специализациями юристов
                </Typography>
              </Box>
            </Box>

            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => handleOpenDialog()}
              sx={{
                background: '#DC2626',
                color: '#FFFFFF',
                fontWeight: 600,
                px: 3,
                py: 1.5,
                borderRadius: '8px',
                textTransform: 'none',
                boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                '&:hover': {
                  background: '#B91C1C',
                  boxShadow: '0 4px 12px rgba(220, 38, 38, 0.35)',
                },
              }}
            >
              Добавить специализацию
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <CheckCircle sx={{ fontSize: 40, color: '#2563EB' }} />,
              label: 'Всего специализаций',
              value: specializations.length.toString(),
              color: '#2563EB',
              bgColor: '#EFF6FF',
            },
            {
              icon: <Visibility sx={{ fontSize: 40, color: '#059669' }} />,
              label: 'Активных',
              value: activeCount.toString(),
              color: '#059669',
              bgColor: '#ECFDF5',
            },
            {
              icon: <Person sx={{ fontSize: 40, color: '#DC2626' }} />,
              label: 'Юристов',
              value: lawyerCount.toString(),
              color: '#DC2626',
              bgColor: '#FEF2F2',
            },
          ].map((stat, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card
                sx={{
                  background: '#FFFFFF',
                  border: '1px solid #E6E9EE',
                  borderRadius: '12px',
                  boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
                  p: 3,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '12px',
                      background: stat.bgColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: '#6B7280', fontWeight: 500 }} gutterBottom>
                      {stat.label}
                    </Typography>
                    <Typography variant="h5" fontWeight="700" sx={{ color: '#0B1B2B' }}>
                      {stat.value}
                    </Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Specializations Table */}
        <Card
          sx={{
            background: '#FFFFFF',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ p: 3, borderBottom: '1px solid #E6E9EE' }}>
            <Typography variant="h6" fontWeight="700" sx={{ color: '#0B1B2B' }}>
              Специализации
            </Typography>
          </Box>

          {specializations.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ background: '#F4F6F8', borderBottom: '1px solid #E6E9EE' }}>
                    <TableCell sx={{ color: '#0B1B2B', fontWeight: 700, fontSize: '14px' }}>
                      Название
                    </TableCell>
                    <TableCell sx={{ color: '#0B1B2B', fontWeight: 700, fontSize: '14px' }}>
                      Описание
                    </TableCell>
                    <TableCell align="center" sx={{ color: '#0B1B2B', fontWeight: 700, fontSize: '14px' }}>
                      Юристов
                    </TableCell>
                    <TableCell align="center" sx={{ color: '#0B1B2B', fontWeight: 700, fontSize: '14px' }}>
                      Статус
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#0B1B2B', fontWeight: 700, fontSize: '14px' }}>
                      Действия
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {specializations.map((spec, index) => (
                    <TableRow
                      key={spec.id}
                      sx={{
                        borderBottom: '1px solid #E6E9EE',
                        '&:hover': {
                          background: '#F9FAFB',
                        },
                        opacity: spec.active ? 1 : 0.6,
                      }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight="600"
                          sx={{ color: '#0B1B2B' }}
                        >
                          {spec.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ color: '#6B7280' }}
                        >
                          {spec.description}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          icon={<Person sx={{ fontSize: 16 }} />}
                          label={spec.lawyerCount || 0}
                          sx={{
                            background: '#EFF6FF',
                            color: '#2563EB',
                            fontWeight: 600,
                            border: '1px solid #BFDBFE',
                            borderRadius: '6px',
                          }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {spec.active ? (
                          <Chip
                            label="Активна"
                            size="small"
                            icon={<Visibility sx={{ fontSize: 16 }} />}
                            sx={{
                              background: '#ECFDF5',
                              color: '#059669',
                              fontWeight: 600,
                              border: '1px solid #A7F3D0',
                              borderRadius: '6px',
                            }}
                          />
                        ) : (
                          <Chip
                            label="Неактивна"
                            size="small"
                            icon={<VisibilityOff sx={{ fontSize: 16 }} />}
                            sx={{
                              background: '#F4F6F8',
                              color: '#6B7280',
                              fontWeight: 600,
                              border: '1px solid #E6E9EE',
                              borderRadius: '6px',
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Tooltip title={spec.active ? 'Деактивировать' : 'Активировать'}>
                            <Switch
                              checked={spec.active}
                              onChange={() =>
                                handleToggleActive(spec.id, spec.active)
                              }
                              sx={{
                                '& .MuiSwitch-switchBase.Mui-checked': {
                                  color: '#059669',
                                },
                                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                                {
                                  backgroundColor: '#059669',
                                },
                              }}
                            />
                          </Tooltip>
                          <Tooltip title="Редактировать">
                            <IconButton
                              onClick={() => handleOpenDialog(spec)}
                              sx={{
                                color: '#2563EB',
                                border: '1px solid #E6E9EE',
                                borderRadius: '6px',
                                '&:hover': {
                                  background: '#EFF6FF',
                                  borderColor: '#2563EB',
                                },
                              }}
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Удалить">
                            <IconButton
                              onClick={() => handleDeleteClick(spec.id)}
                              sx={{
                                color: '#DC2626',
                                border: '1px solid #E6E9EE',
                                borderRadius: '6px',
                                '&:hover': {
                                  background: '#FEF2F2',
                                  borderColor: '#DC2626',
                                },
                              }}
                            >
                              <Delete fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" sx={{ color: '#6B7280' }}>
                Нет специализаций. Добавьте первую!
              </Typography>
            </Box>
          )}
        </Card>
      </Container>

      {/* Add/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            background: '#FFFFFF',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(11, 27, 43, 0.15)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#0B1B2B', borderBottom: '1px solid #E6E9EE' }}>
          {editMode ? 'Редактировать специализацию' : 'Добавить новую специализацию'}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Stack spacing={3}>
            <TextField
              label="Название специализации"
              fullWidth
              value={currentSpec.name}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, name: e.target.value })
              }
              placeholder="Например: Гражданское право"
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  '& fieldset': {
                    borderColor: '#E6E9EE',
                  },
                  '&:hover fieldset': {
                    borderColor: '#2563EB',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#2563EB',
                  },
                },
              }}
            />
            <TextField
              label="Описание"
              fullWidth
              multiline
              rows={4}
              value={currentSpec.description}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, description: e.target.value })
              }
              placeholder="Опишите эту специализацию..."
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  '& fieldset': {
                    borderColor: '#E6E9EE',
                  },
                  '&:hover fieldset': {
                    borderColor: '#2563EB',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#2563EB',
                  },
                },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ color: '#0B1B2B', fontWeight: 600 }}>Активна:</Typography>
              <Switch
                checked={currentSpec.active}
                onChange={(e) =>
                  setCurrentSpec({ ...currentSpec, active: e.target.checked })
                }
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: '#059669',
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: '#059669',
                  },
                }}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid #E6E9EE' }}>
          <Button
            variant="outlined"
            onClick={handleCloseDialog}
            sx={{
              color: '#6B7280',
              borderColor: '#E6E9EE',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                borderColor: '#6B7280',
                background: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!currentSpec.name || !currentSpec.description}
            sx={{
              background: '#DC2626',
              color: '#FFFFFF',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background: '#B91C1C',
              },
              '&:disabled': {
                background: '#E6E9EE',
                color: '#6B7280',
              },
            }}
          >
            {editMode ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            background: '#FFFFFF',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(11, 27, 43, 0.15)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#0B1B2B', borderBottom: '1px solid #E6E9EE' }}>
          Подтверждение удаления
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography sx={{ color: '#6B7280' }}>
            Вы уверены, что хотите удалить эту специализацию? Это действие нельзя отменить.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid #E6E9EE' }}>
          <Button
            variant="outlined"
            onClick={() => setDeleteConfirm(false)}
            sx={{
              color: '#6B7280',
              borderColor: '#E6E9EE',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                borderColor: '#6B7280',
                background: '#F4F6F8',
              },
            }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmDelete}
            sx={{
              background: '#DC2626',
              color: '#FFFFFF',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background: '#B91C1C',
              },
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SpecializationsPageGlass;
