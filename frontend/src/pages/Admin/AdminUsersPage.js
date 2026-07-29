import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Container, Box, Typography, Grid, IconButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Tooltip, Stack, CircularProgress,
  Card, Button, Avatar,
} from '@mui/material';
import {
  ArrowBack, People, Gavel, Person, Block, LockOpen,
} from '@mui/icons-material';
import { adminUserService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

const AdminUsersPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState('');

  // Дебаунс-поиск по имени/email (бэкенд GET /admin/users?search=… уже поддерживает).
  // Первый прогон (search='') на монтировании грузит всех.
  useEffect(() => {
    const id = setTimeout(() => load(search), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = async (searchTerm = '') => {
    try {
      setLoading(true);
      const data = await adminUserService.getUsers(searchTerm ? { search: searchTerm } : {});
      setUsers(Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []));
    } catch (e) {
      toast.error(t('adminManage.loadError'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (u) => {
    setActing(u.id);
    try {
      await adminUserService.toggleUserStatus(u.id, u.isActive ? 'inactive' : 'active');
      toast.success(u.isActive ? t('adminManage.blocked') : t('adminManage.unblocked'));
      await load(search);
    } catch (e) {
      toast.error(t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  const clientsCount = users.filter((u) => u.role === 'client').length;
  const lawyersCount = users.filter((u) => u.role === 'lawyer').length;
  const blockedCount = users.filter((u) => !u.isActive).length;

  const initials = (name = '') =>
    name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
  const roleLabel = (r) => (r === 'lawyer' ? t('adminManage.roleLawyer') : r === 'admin' ? t('adminManage.roleAdmin') : t('adminManage.roleClient'));
  const roleColor = (r) => (r === 'lawyer' ? axelionColors.warning : r === 'admin' ? axelionColors.textDark : axelionColors.bronze);

  const stats = [
    { icon: <People sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminManage.statTotal'), value: users.length, bg: axelionColors.accentLight },
    { icon: <Person sx={{ fontSize: 32, color: axelionColors.bronze }} />, label: t('adminManage.statClients'), value: clientsCount, bg: axelionColors.bgBeige },
    { icon: <Gavel sx={{ fontSize: 32, color: axelionColors.warning }} />, label: t('adminManage.statLawyers'), value: lawyersCount, bg: axelionColors.bgBeige },
    { icon: <Block sx={{ fontSize: 32, color: axelionColors.error }} />, label: t('adminManage.statBlocked'), value: blockedCount, bg: axelionColors.errorLight },
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
                  {t('adminManage.usersTitle')}
                </Typography>
                <Typography variant="body2" sx={{ color: axelionColors.textMuted, mt: 0.5 }}>
                  {t('adminManage.usersSub')}
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
            <Grid item xs={12} sm={6} lg={3} key={i}>
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

        {/* Поиск по имени/email */}
        <Box sx={{ mb: 2 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminManage.searchPlaceholder')}
            style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', padding: '11px 14px', borderRadius: 8, border: `1px solid ${axelionColors.borderLight}`, background: axelionColors.bgLight, color: axelionColors.textDark, fontFamily: 'inherit', fontSize: 14, outline: 'none' }}
          />
        </Box>

        {/* Table */}
        <Card sx={{ background: axelionColors.bgLight, border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', boxShadow: 'none', overflow: 'hidden' }}>
          {users.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ background: axelionColors.bgCream, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colUser')}</TableCell>
                    <TableCell align="center" sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colRole')}</TableCell>
                    <TableCell align="center" sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colStatus')}</TableCell>
                    <TableCell sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colRegistered')}</TableCell>
                    <TableCell align="right" sx={{ color: axelionColors.textDark, fontWeight: 600 }}>{t('adminManage.colActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} sx={{ borderBottom: `1px solid ${axelionColors.borderLight}`, '&:hover': { background: axelionColors.bgWarm }, opacity: u.isActive ? 1 : 0.6 }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 40, height: 40, bgcolor: roleColor(u.role), fontSize: 14 }}>{initials(u.name)}</Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: axelionColors.textDark }}>{u.name}</Typography>
                            <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>{u.email}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={roleLabel(u.role)} sx={{ background: axelionColors.bgCream, color: roleColor(u.role), fontWeight: 600, border: `1px solid ${axelionColors.borderLight}` }} />
                      </TableCell>
                      <TableCell align="center">
                        {u.isActive ? (
                          <Chip size="small" label={t('adminManage.stActive')} sx={{ background: axelionColors.successLight, color: axelionColors.success, fontWeight: 600, border: `1px solid ${axelionColors.success}` }} />
                        ) : (
                          <Chip size="small" label={t('adminManage.stBlocked')} sx={{ background: axelionColors.errorLight, color: axelionColors.error, fontWeight: 600, border: `1px solid ${axelionColors.error}` }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>{fmtDate(u.createdAt)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {u.role !== 'admin' && (
                          <Button size="small" variant="outlined" disabled={acting === u.id} onClick={() => toggleStatus(u)}
                            startIcon={u.isActive ? <Block sx={{ fontSize: 16 }} /> : <LockOpen sx={{ fontSize: 16 }} />}
                            sx={{
                              color: u.isActive ? axelionColors.error : axelionColors.success,
                              borderColor: axelionColors.borderLight, textTransform: 'none', borderRadius: '8px',
                              '&:hover': { borderColor: u.isActive ? axelionColors.error : axelionColors.success, background: u.isActive ? axelionColors.errorLight : axelionColors.successLight },
                            }}>
                            {u.isActive ? t('adminManage.block') : t('adminManage.unblock')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>{t('adminManage.noUsers')}</Typography>
            </Box>
          )}
        </Card>
      </Container>
    </Box>
  );
};

export default AdminUsersPage;
