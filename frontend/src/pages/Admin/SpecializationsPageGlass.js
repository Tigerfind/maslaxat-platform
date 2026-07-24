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
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const SpecializationsPageGlass = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

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
      toast.error(t('specPage.loadError'));
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
      toast.error(t('specPage.fillAllFields'));
      return;
    }

    try {
      if (editMode) {
        await adminSpecializationService.updateSpecialization(
          currentSpec.id,
          currentSpec
        );
        toast.success(t('specPage.specUpdated'));
      } else {
        await adminSpecializationService.createSpecialization(currentSpec);
        toast.success(t('specPage.specCreated'));
      }
      handleCloseDialog();
      loadSpecializations();
    } catch (error) {
      console.error('Error saving specialization:', error);
      toast.error(t('specPage.saveError'));
    }
  };

  const handleDeleteClick = (id) => {
    setSelectedSpecId(id);
    setDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await adminSpecializationService.deleteSpecialization(selectedSpecId);
      toast.success(t('specPage.specDeleted'));
      setDeleteConfirm(false);
      setSelectedSpecId(null);
      loadSpecializations();
    } catch (error) {
      console.error('Error deleting specialization:', error);
      toast.error(t('specPage.deleteError'));
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
          !currentStatus ? t('specPage.specActivated') : t('specPage.specDeactivated')
        );
        loadSpecializations();
      }
    } catch (error) {
      console.error('Error toggling specialization:', error);
      toast.error(t('specPage.statusError'));
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
          background: axelionColors.bgCream,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress sx={{ color: axelionColors.gold }} size={60} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: axelionColors.bgCream,
        pb: 4,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: axelionColors.bgLight,
          borderBottom: `1px solid ${axelionColors.borderLight}`,
          py: 3,
          px: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tooltip title={t('specPage.back')}>
                <IconButton
                  onClick={() => navigate('/admin/dashboard')}
                  sx={{
                    background: axelionColors.bgCream,
                    color: axelionColors.textDark,
                    border: `1px solid ${axelionColors.borderLight}`,
                    '&:hover': {
                      background: axelionColors.bgBeige,
                      borderColor: axelionColors.gold,
                    },
                  }}
                >
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Box>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 300,
                    color: axelionColors.textDark,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('specPage.title')}
                </Typography>
                <Typography variant="body2" sx={{ color: axelionColors.textMuted, mt: 0.5 }}>
                  {t('specPage.subtitle')}
                </Typography>
              </Box>
            </Box>

            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => handleOpenDialog()}
              sx={{
                background: `linear-gradient(135deg, ${axelionColors.gold} 0%, ${axelionColors.goldDark} 100%)`,
                color: '#FFFFFF',
                fontWeight: 500,
                px: 3,
                py: 1.5,
                borderRadius: '8px',
                textTransform: 'none',
                letterSpacing: '0.05em',
                boxShadow: '0 2px 6px rgba(184, 149, 110, 0.25)',
                '&:hover': {
                  background: `linear-gradient(135deg, ${axelionColors.goldDark} 0%, ${axelionColors.bronze} 100%)`,
                  boxShadow: '0 4px 12px rgba(184, 149, 110, 0.35)',
                },
              }}
            >
              {t('specPage.addSpec')}
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <CheckCircle sx={{ fontSize: 40, color: axelionColors.gold }} />,
              label: t('specPage.totalSpec'),
              value: specializations.length.toString(),
              color: axelionColors.gold,
              bgColor: axelionColors.accentLight,
            },
            {
              icon: <Visibility sx={{ fontSize: 40, color: axelionColors.success }} />,
              label: t('specPage.active'),
              value: activeCount.toString(),
              color: axelionColors.success,
              bgColor: axelionColors.successLight,
            },
            {
              icon: <Person sx={{ fontSize: 40, color: axelionColors.bronze }} />,
              label: t('specPage.lawyers'),
              value: lawyerCount.toString(),
              color: axelionColors.bronze,
              bgColor: axelionColors.bgBeige,
            },
          ].map((stat, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card
                sx={{
                  background: axelionColors.bgLight,
                  border: `1px solid ${axelionColors.borderLight}`,
                  borderRadius: '8px',
                  boxShadow: 'none',
                  p: 3,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(184, 149, 110, 0.12)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '8px',
                      background: stat.bgColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted, fontWeight: 500 }} gutterBottom>
                      {stat.label}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 300, color: axelionColors.textDark }}>
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
            background: axelionColors.bgLight,
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            boxShadow: 'none',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ p: 3, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 300,
                color: axelionColors.textDark,
                letterSpacing: '0.05em',
              }}
            >
              {t('specPage.specializations')}
            </Typography>
          </Box>

          {specializations.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ background: axelionColors.bgCream, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600, fontSize: '14px' }}>
                      {t('specPage.colName')}
                    </TableCell>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600, fontSize: '14px' }}>
                      {t('specPage.colDesc')}
                    </TableCell>
                    <TableCell align="center" sx={{ color: axelionColors.textDark, fontWeight: 600, fontSize: '14px' }}>
                      {t('specPage.colLawyers')}
                    </TableCell>
                    <TableCell align="center" sx={{ color: axelionColors.textDark, fontWeight: 600, fontSize: '14px' }}>
                      {t('specPage.colStatus')}
                    </TableCell>
                    <TableCell align="right" sx={{ color: axelionColors.textDark, fontWeight: 600, fontSize: '14px' }}>
                      {t('specPage.colActions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {specializations.map((spec, index) => (
                    <TableRow
                      key={spec.id}
                      sx={{
                        borderBottom: `1px solid ${axelionColors.borderLight}`,
                        '&:hover': {
                          background: axelionColors.bgWarm,
                        },
                        opacity: spec.active ? 1 : 0.6,
                      }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight="600"
                          sx={{ color: axelionColors.textDark }}
                        >
                          {spec.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ color: axelionColors.textMuted }}
                        >
                          {spec.description}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          icon={<Person sx={{ fontSize: 16 }} />}
                          label={spec.lawyerCount || 0}
                          sx={{
                            background: axelionColors.accentLight,
                            color: axelionColors.gold,
                            fontWeight: 600,
                            border: `1px solid ${axelionColors.goldMuted}`,
                            borderRadius: '8px',
                            '& .MuiChip-icon': {
                              color: axelionColors.gold,
                            },
                          }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {spec.active ? (
                          <Chip
                            label={t('specPage.statusActive')}
                            size="small"
                            icon={<Visibility sx={{ fontSize: 16 }} />}
                            sx={{
                              background: axelionColors.successLight,
                              color: axelionColors.success,
                              fontWeight: 600,
                              border: `1px solid ${axelionColors.success}`,
                              borderRadius: '8px',
                              '& .MuiChip-icon': {
                                color: axelionColors.success,
                              },
                            }}
                          />
                        ) : (
                          <Chip
                            label={t('specPage.statusInactive')}
                            size="small"
                            icon={<VisibilityOff sx={{ fontSize: 16 }} />}
                            sx={{
                              background: axelionColors.bgCream,
                              color: axelionColors.textMuted,
                              fontWeight: 600,
                              border: `1px solid ${axelionColors.borderLight}`,
                              borderRadius: '8px',
                              '& .MuiChip-icon': {
                                color: axelionColors.textMuted,
                              },
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Tooltip title={spec.active ? t('specPage.deactivate') : t('specPage.activate')}>
                            <Switch
                              checked={spec.active}
                              onChange={() =>
                                handleToggleActive(spec.id, spec.active)
                              }
                              sx={{
                                '& .MuiSwitch-switchBase.Mui-checked': {
                                  color: axelionColors.success,
                                },
                                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                                {
                                  backgroundColor: axelionColors.success,
                                },
                              }}
                            />
                          </Tooltip>
                          <Tooltip title={t('specPage.edit')}>
                            <IconButton
                              onClick={() => handleOpenDialog(spec)}
                              sx={{
                                color: axelionColors.gold,
                                border: `1px solid ${axelionColors.borderLight}`,
                                borderRadius: '8px',
                                '&:hover': {
                                  background: axelionColors.accentLight,
                                  borderColor: axelionColors.gold,
                                },
                              }}
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('specPage.del')}>
                            <IconButton
                              onClick={() => handleDeleteClick(spec.id)}
                              sx={{
                                color: axelionColors.error,
                                border: `1px solid ${axelionColors.borderLight}`,
                                borderRadius: '8px',
                                '&:hover': {
                                  background: axelionColors.errorLight,
                                  borderColor: axelionColors.error,
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
              <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>
                {t('specPage.noSpec')}
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
            background: axelionColors.bgLight,
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(26, 26, 26, 0.15)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 300, color: axelionColors.textDark, borderBottom: `1px solid ${axelionColors.borderLight}`, letterSpacing: '0.05em' }}>
          {editMode ? t('specPage.editSpec') : t('specPage.addNewSpec')}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Stack spacing={3}>
            <TextField
              label={t('specPage.specNameLabel')}
              fullWidth
              value={currentSpec.name}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, name: e.target.value })
              }
              placeholder={t('specPage.specNamePlaceholder')}
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  '& fieldset': {
                    borderColor: axelionColors.borderLight,
                  },
                  '&:hover fieldset': {
                    borderColor: axelionColors.gold,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: axelionColors.gold,
                  },
                },
                '& .MuiInputLabel-root.Mui-focused': {
                  color: axelionColors.gold,
                },
              }}
            />
            <TextField
              label={t('specPage.descLabel')}
              fullWidth
              multiline
              rows={4}
              value={currentSpec.description}
              onChange={(e) =>
                setCurrentSpec({ ...currentSpec, description: e.target.value })
              }
              placeholder={t('specPage.descPlaceholder')}
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  '& fieldset': {
                    borderColor: axelionColors.borderLight,
                  },
                  '&:hover fieldset': {
                    borderColor: axelionColors.gold,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: axelionColors.gold,
                  },
                },
                '& .MuiInputLabel-root.Mui-focused': {
                  color: axelionColors.gold,
                },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ color: axelionColors.textDark, fontWeight: 500 }}>{t('specPage.activeLabel')}</Typography>
              <Switch
                checked={currentSpec.active}
                onChange={(e) =>
                  setCurrentSpec({ ...currentSpec, active: e.target.checked })
                }
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: axelionColors.success,
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: axelionColors.success,
                  },
                }}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
          <Button
            variant="outlined"
            onClick={handleCloseDialog}
            sx={{
              color: axelionColors.textMuted,
              borderColor: axelionColors.borderLight,
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 500,
              '&:hover': {
                borderColor: axelionColors.textMuted,
                background: axelionColors.bgCream,
              },
            }}
          >
            {t('specPage.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!currentSpec.name || !currentSpec.description}
            sx={{
              background: `linear-gradient(135deg, ${axelionColors.gold} 0%, ${axelionColors.goldDark} 100%)`,
              color: '#FFFFFF',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 500,
              '&:hover': {
                background: `linear-gradient(135deg, ${axelionColors.goldDark} 0%, ${axelionColors.bronze} 100%)`,
              },
              '&:disabled': {
                background: axelionColors.borderLight,
                color: axelionColors.textMuted,
              },
            }}
          >
            {editMode ? t('specPage.save') : t('specPage.add')}
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
            background: axelionColors.bgLight,
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(26, 26, 26, 0.15)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 300, color: axelionColors.textDark, borderBottom: `1px solid ${axelionColors.borderLight}`, letterSpacing: '0.05em' }}>
          {t('specPage.deleteConfirmTitle')}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography sx={{ color: axelionColors.textMuted }}>
            {t('specPage.deleteConfirmText')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
          <Button
            variant="outlined"
            onClick={() => setDeleteConfirm(false)}
            sx={{
              color: axelionColors.textMuted,
              borderColor: axelionColors.borderLight,
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 500,
              '&:hover': {
                borderColor: axelionColors.textMuted,
                background: axelionColors.bgCream,
              },
            }}
          >
            {t('specPage.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmDelete}
            sx={{
              background: axelionColors.error,
              color: '#FFFFFF',
              borderRadius: '8px',
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 500,
              '&:hover': {
                background: '#B91C1C',
              },
            }}
          >
            {t('specPage.del')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SpecializationsPageGlass;
