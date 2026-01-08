import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  Chip,
  Tooltip,
  Stack,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  ArrowBack,
  DragIndicator,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { specializationsActions } from '../../store/slices/specializationsSlice';

const SpecializationsPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { specializations } = useSelector((state) => state.specializations);

  const [openDialog, setOpenDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentSpec, setCurrentSpec] = useState({
    id: '',
    name: '',
    nameUz: '',
    nameEn: '',
    active: true,
  });

  const handleOpenDialog = (spec = null) => {
    if (spec) {
      setCurrentSpec(spec);
      setEditMode(true);
    } else {
      setCurrentSpec({ id: '', name: '', nameUz: '', nameEn: '', active: true });
      setEditMode(false);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setCurrentSpec({ id: '', name: '', nameUz: '', nameEn: '', active: true });
    setEditMode(false);
  };

  const handleSave = () => {
    if (editMode) {
      dispatch(specializationsActions.updateSpecialization(currentSpec));
    } else {
      dispatch(specializationsActions.addSpecialization(currentSpec));
    }
    handleCloseDialog();
  };

  const handleDelete = (id) => {
    if (window.confirm('Вы уверены, что хотите удалить эту специализацию?')) {
      dispatch(specializationsActions.deleteSpecialization(id));
    }
  };

  const handleToggleActive = (id) => {
    dispatch(specializationsActions.toggleSpecialization(id));
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: 'white',
          py: 3,
          px: 2,
          boxShadow: '0px 4px 20px rgba(99, 102, 241, 0.3)',
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton color="inherit" onClick={() => navigate('/dashboard')}>
              <ArrowBack />
            </IconButton>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h5" fontWeight="bold">
                Управление специализациями
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                Добавляйте, редактируйте и управляйте специализациями юристов
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => handleOpenDialog()}
              sx={{
                bgcolor: 'white',
                color: 'primary.main',
                '&:hover': {
                  bgcolor: 'grey.100',
                },
              }}
            >
              Добавить специализацию
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        {/* Stats */}
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Paper
            sx={{
              p: 3,
              flexGrow: 1,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              color: 'white',
              borderRadius: 3,
            }}
          >
            <Typography variant="h3" fontWeight="bold">
              {specializations.length}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Всего специализаций
            </Typography>
          </Paper>
          <Paper
            sx={{
              p: 3,
              flexGrow: 1,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white',
              borderRadius: 3,
            }}
          >
            <Typography variant="h3" fontWeight="bold">
              {specializations.filter((s) => s.active).length}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Активных
            </Typography>
          </Paper>
          <Paper
            sx={{
              p: 3,
              flexGrow: 1,
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'white',
              borderRadius: 3,
            }}
          >
            <Typography variant="h3" fontWeight="bold">
              {specializations.filter((s) => !s.active).length}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Неактивных
            </Typography>
          </Paper>
        </Stack>

        {/* Table */}
        <TableContainer
          component={Paper}
          sx={{
            borderRadius: 3,
            boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.08)',
          }}
        >
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell width={50}>
                  <DragIndicator sx={{ color: 'text.secondary' }} />
                </TableCell>
                <TableCell>
                  <Typography fontWeight="bold">Русский</Typography>
                </TableCell>
                <TableCell>
                  <Typography fontWeight="bold">O'zbekcha</Typography>
                </TableCell>
                <TableCell>
                  <Typography fontWeight="bold">English</Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography fontWeight="bold">Статус</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold">Действия</Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...specializations]
                .sort((a, b) => a.order - b.order)
                .map((spec) => (
                  <TableRow
                    key={spec.id}
                    sx={{
                      '&:hover': {
                        bgcolor: 'grey.50',
                      },
                      opacity: spec.active ? 1 : 0.6,
                    }}
                  >
                    <TableCell>
                      <DragIndicator
                        sx={{ color: 'text.secondary', cursor: 'grab' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight="medium">{spec.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography color="text.secondary">{spec.nameUz}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography color="text.secondary">{spec.nameEn}</Typography>
                    </TableCell>
                    <TableCell align="center">
                      {spec.active ? (
                        <Chip
                          label="Активна"
                          color="success"
                          size="small"
                          icon={<Visibility />}
                        />
                      ) : (
                        <Chip
                          label="Неактивна"
                          color="default"
                          size="small"
                          icon={<VisibilityOff />}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={spec.active ? 'Деактивировать' : 'Активировать'}>
                        <Switch
                          checked={spec.active}
                          onChange={() => handleToggleActive(spec.id)}
                          color="success"
                        />
                      </Tooltip>
                      <Tooltip title="Редактировать">
                        <IconButton
                          onClick={() => handleOpenDialog(spec)}
                          color="primary"
                        >
                          <Edit />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Удалить">
                        <IconButton
                          onClick={() => handleDelete(spec.id)}
                          color="error"
                        >
                          <Delete />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Container>

      {/* Add/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle>
          <Typography variant="h6" fontWeight="bold">
            {editMode ? 'Редактировать специализацию' : 'Добавить специализацию'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <TextField
              label="Название (Русский)"
              fullWidth
              value={currentSpec.name}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, name: e.target.value })
              }
              placeholder="Гражданское право"
            />
            <TextField
              label="Название (O'zbekcha)"
              fullWidth
              value={currentSpec.nameUz}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, nameUz: e.target.value })
              }
              placeholder="Fuqarolik huquqi"
            />
            <TextField
              label="Название (English)"
              fullWidth
              value={currentSpec.nameEn}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, nameEn: e.target.value })
              }
              placeholder="Civil Law"
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography>Активна:</Typography>
              <Switch
                checked={currentSpec.active}
                onChange={(e) =>
                  setCurrentSpec({ ...currentSpec, active: e.target.checked })
                }
                color="success"
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={handleCloseDialog} variant="outlined">
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!currentSpec.name || !currentSpec.nameUz || !currentSpec.nameEn}
            sx={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            }}
          >
            {editMode ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SpecializationsPage;
