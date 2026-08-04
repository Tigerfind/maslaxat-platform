import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Container, Box, Typography, Grid, IconButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Tooltip, Stack, CircularProgress,
  Card, Button, Avatar,
} from '@mui/material';
import {
  ArrowBack, CheckCircle, Block, Gavel, Verified, HourglassEmpty,
} from '@mui/icons-material';
import { adminLawyerService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

const AdminLawyersPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminLawyerService.getLawyers();
      setLawyers(Array.isArray(data?.lawyers) ? data.lawyers : (Array.isArray(data) ? data : []));
    } catch (e) {
      toast.error(t('adminManage.loadError'));
      setLawyers([]);
    } finally {
      setLoading(false);
    }
  };

  const approve = async (id) => {
    setActing(id);
    try {
      await adminLawyerService.approveLawyer(id);
      toast.success(t('adminManage.approved'));
      await load();
    } catch (e) {
      toast.error(t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  const reject = async (id) => {
    // Причина отклонения — уходит юристу в уведомление, чтобы он исправил и подал снова.
    const reason = window.prompt(t('adminManage.rejectReasonPrompt'));
    if (reason === null) return; // отмена
    setActing(id);
    try {
      await adminLawyerService.rejectLawyer(id, reason.trim());
      toast.success(t('adminManage.rejected'));
      await load();
    } catch (e) {
      toast.error(t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  // Статус модерации — источник истины на профиле (не User.isVerified, тот про email).
  const stOf = (l) => l.profile?.verificationStatus || 'pending';
  const verifiedCount = lawyers.filter((l) => stOf(l) === 'approved').length;
  const pendingCount = lawyers.filter((l) => stOf(l) === 'pending').length;

  const initials = (name = '') =>
    name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const specOf = (l) => l.profile?.specialization || t('adminManage.noSpec');
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');

  const stats = [
    { icon: <Gavel sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminManage.statTotal'), value: lawyers.length, bg: axelionColors.accentLight },
    { icon: <Verified sx={{ fontSize: 32, color: axelionColors.success }} />, label: t('adminManage.statVerified'), value: verifiedCount, bg: axelionColors.successLight },
    { icon: <HourglassEmpty sx={{ fontSize: 32, color: axelionColors.warning }} />, label: t('adminManage.statPending'), value: pendingCount, bg: axelionColors.bgBeige },
  ];

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', background: axelionColors.bgCream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress sx={{ color: axelionColors.gold }} size={56} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', background: axelionColors.bgCream, pb: 4 }}>
      {/* Header */}
      <Box sx={{ background: axelionColors.bgLight, borderBottom: `1px solid ${axelionColors.borderLight}`, py: 3, px: 2 }}>
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tooltip title={t('adminManage.back')}>
                <IconButton onClick={() => navigate('/admin/dashboard')} sx={{ background: axelionColors.bgCream, color: axelionColors.textDark, border: `1px solid ${axelionColors.borderLight}`, '&:hover': { background: axelionColors.bgBeige, borderColor: axelionColors.gold } }}>
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 300, color: axelionColors.textDark, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {t('adminManage.lawyersTitle')}
                </Typography>
                <Typography variant="body2" sx={{ color: axelionColors.textMuted, mt: 0.5 }}>
                  {t('adminManage.lawyersSub')}
                </Typography>
              </Box>
            </Box>
            <LanguageSwitcher variant="dropdown" sx={{ color: axelionColors.textDark, bgcolor: axelionColors.bgCream, '&:hover': { bgcolor: axelionColors.bgBeige } }} />
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Stats */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {stats.map((s, i) => (
            <Grid item xs={12} sm={4} key={i}>
              <Card sx={{ background: axelionColors.bgLight, border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', boxShadow: 'none', p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ width: 56, height: 56, borderRadius: '8px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted, fontWeight: 500 }} gutterBottom>{s.label}</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 300, color: axelionColors.textDark }}>{s.value}</Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Table */}
        <Card sx={{ background: axelionColors.bgLight, border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', boxShadow: 'none', overflow: 'hidden' }}>
          {lawyers.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ background: axelionColors.bgCream, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colLawyer')}</TableCell>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colSpec')}</TableCell>
                    <TableCell align="center" sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colStatus')}</TableCell>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colRegistered')}</TableCell>
                    <TableCell align="right" sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lawyers.map((l) => (
                    <TableRow key={l.id} sx={{ borderBottom: `1px solid ${axelionColors.borderLight}`, '&:hover': { background: axelionColors.bgWarm } }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 40, height: 40, bgcolor: axelionColors.gold, fontSize: 14 }}>{initials(l.name)}</Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: axelionColors.textDark }}>{l.name}</Typography>
                            <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>{l.email}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>{specOf(l)}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        {stOf(l) === 'approved' && (
                          <Chip size="small" icon={<CheckCircle sx={{ fontSize: 15 }} />} label={t('adminManage.stApproved')} sx={{ background: axelionColors.successLight, color: axelionColors.success, fontWeight: 600, border: `1px solid ${axelionColors.success}`, '& .MuiChip-icon': { color: axelionColors.success } }} />
                        )}
                        {stOf(l) === 'pending' && (
                          <Chip size="small" icon={<HourglassEmpty sx={{ fontSize: 15 }} />} label={t('adminManage.stPending')} sx={{ background: axelionColors.bgBeige, color: axelionColors.bronze, fontWeight: 600, border: `1px solid ${axelionColors.goldMuted}`, '& .MuiChip-icon': { color: axelionColors.bronze } }} />
                        )}
                        {stOf(l) === 'rejected' && (
                          <Chip size="small" icon={<Block sx={{ fontSize: 15 }} />} label={t('adminManage.stRejected')} sx={{ background: axelionColors.errorLight, color: axelionColors.error, fontWeight: 600, border: `1px solid ${axelionColors.error}`, '& .MuiChip-icon': { color: axelionColors.error } }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>{fmtDate(l.createdAt)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {stOf(l) !== 'approved' && (
                            <Button size="small" variant="contained" disabled={acting === l.id} onClick={() => approve(l.id)}
                              startIcon={<CheckCircle sx={{ fontSize: 16 }} />}
                              sx={{ background: axelionColors.success, color: '#fff', textTransform: 'none', boxShadow: 'none', borderRadius: '8px', '&:hover': { background: '#1F7A4A', boxShadow: 'none' } }}>
                              {t('adminManage.approve')}
                            </Button>
                          )}
                          {stOf(l) !== 'rejected' && (
                            <Button size="small" variant="outlined" disabled={acting === l.id} onClick={() => reject(l.id)}
                              startIcon={<Block sx={{ fontSize: 16 }} />}
                              sx={{ color: axelionColors.error, borderColor: axelionColors.borderLight, textTransform: 'none', borderRadius: '8px', '&:hover': { borderColor: axelionColors.error, background: axelionColors.errorLight } }}>
                              {t('adminManage.reject')}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>{t('adminManage.noLawyers')}</Typography>
            </Box>
          )}
        </Card>
      </Container>
    </Box>
  );
};

export default AdminLawyersPage;
