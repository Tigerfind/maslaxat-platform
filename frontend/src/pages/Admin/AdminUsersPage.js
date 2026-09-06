import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import {
  Container, Box, Typography, Grid, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Card, Button, Avatar, Pagination,
} from '@mui/material';
import {
  People, Gavel, Person, Block, LockOpen,
} from '@mui/icons-material';
import { adminUserService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import ErrorState from '../../components/UI/ErrorState';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

const PAGE_SIZE = 25;

const AdminUsersPage = () => {
  const { t, language } = useTranslation();

  const [users, setUsers] = useState([]);
  // loading — только первая загрузка (заменяет страницу спиннером).
  // refreshing — поиск/смена страницы: таблица остаётся смонтированной, иначе
  // input размонтируется на каждом дебаунс-тике и теряет фокус.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState(null);
  const loadedOnce = useRef(false);
  const [confirmToggle, setConfirmToggle] = useState(null);

  // Дебаунс-поиск по имени/email (бэкенд GET /admin/users?search=… уже поддерживает).
  // Первый прогон (search='') на монтировании грузит всех. Новый поиск сбрасывает
  // страницу на первую — иначе «page=3 + новый запрос» даёт пустой результат.
  useEffect(() => {
    const id = setTimeout(() => { setPage(1); load(search, 1); }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = async (searchTerm = '', pageNum = 1) => {
    // Первая загрузка — полноэкранный спиннер; последующие — мягкое обновление.
    // Признак «первая» — loadedOnce, а не пустой список: поиск без результатов
    // тоже даёт пустой список и снова разбирал бы страницу.
    if (!loadedOnce.current) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await adminUserService.getUsers({
        page: pageNum,
        limit: PAGE_SIZE,
        ...(searchTerm ? { search: searchTerm } : {}),
      });
      setUsers(Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []));
      setTotalPages(data?.totalPages || 1);
      setCounts(data?.counts || null);
      setError(null);
    } catch (e) {
      // Сервис больше не глотает ошибку: показываем состояние ошибки, а не «нет данных».
      setError(e);
      setUsers([]);
      setCounts(null);
      toast.error(t('adminManage.loadError'));
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  };

  const goToPage = (p) => { setPage(p); load(search, p); };

  // Блокировка отрезает пользователю доступ к платформе — раньше срабатывала
  // с одного клика без подтверждения.
  const toggleStatus = async () => {
    const u = confirmToggle;
    setActing(u.id);
    try {
      await adminUserService.toggleUserStatus(u.id, u.isActive ? 'inactive' : 'active');
      toast.success(u.isActive ? t('adminManage.blocked') : t('adminManage.unblocked'));
      setConfirmToggle(null);
      await load(search, page);
    } catch (e) {
      toast.error(e.response?.data?.error || t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  const initials = (name = '') =>
    name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  // Даты по текущему языку интерфейса: раньше здесь была захардкожена 'ru-RU',
  // и в узбекской/английской версии даты оставались русскими.
  const dateLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(dateLocale) : '—');
  const roleLabel = (r) => (r === 'lawyer' ? t('adminManage.roleLawyer') : r === 'admin' ? t('adminManage.roleAdmin') : t('adminManage.roleClient'));
  const roleColor = (r) => (r === 'lawyer' ? axelionColors.warning : r === 'admin' ? axelionColors.textDark : axelionColors.bronze);

  // Значения — с сервера по всей таблице. При ошибке загрузки показываем «—»,
  // а не 0: ноль здесь читался бы как факт «пользователей нет».
  const kpi = (v) => (counts ? v : '—');
  const stats = [
    { icon: <People sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminManage.statTotal'), value: kpi(counts?.all), bg: axelionColors.accentLight },
    { icon: <Person sx={{ fontSize: 32, color: axelionColors.bronze }} />, label: t('adminManage.statClients'), value: kpi(counts?.clients), bg: axelionColors.bgBeige },
    { icon: <Gavel sx={{ fontSize: 32, color: axelionColors.warning }} />, label: t('adminManage.statLawyers'), value: kpi(counts?.lawyers), bg: axelionColors.bgBeige },
    { icon: <Block sx={{ fontSize: 32, color: axelionColors.error }} />, label: t('adminManage.statBlocked'), value: kpi(counts?.blocked), bg: axelionColors.errorLight },
  ];

  // Заголовок, переключатель языка, уведомления и выход теперь даёт GlassShell —
  // собственная шапка страницы больше не нужна. Спиннер тоже внутри оболочки,
  // чтобы меню не пропадало на время загрузки.
  if (loading) {
    return (
      <GlassShell active="/admin/users" title={t('adminManage.usersTitle')} subtitle={t('adminManage.usersSub')} role="admin">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: axelionColors.gold }} size={56} />
        </Box>
      </GlassShell>
    );
  }

  return (
    <GlassShell active="/admin/users" title={t('adminManage.usersTitle')} subtitle={t('adminManage.usersSub')} role="admin">
      <Container maxWidth="xl" disableGutters>
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

        {/* Поиск по имени/email. Индикатор — рядом с полем, а не вместо страницы:
            полноэкранный спиннер размонтировал input и сбрасывал фокус на каждом тике. */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminManage.searchPlaceholder')}
            style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', padding: '11px 14px', borderRadius: 8, border: `1px solid ${axelionColors.borderLight}`, background: axelionColors.bgLight, color: axelionColors.textDark, fontFamily: 'inherit', fontSize: 14, outline: 'none' }}
          />
          {refreshing && <CircularProgress size={18} sx={{ color: axelionColors.gold }} />}
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
                        {/* isVerified приходил с бэкенда и не выводился: админ не мог
                            отличить подтверждённый контакт от неподтверждённого. */}
                        {!u.isVerified && (
                          <Chip size="small" label={t('adminManage.stUnverified')} sx={{ ml: 0.5, background: axelionColors.bgBeige, color: axelionColors.bronze, fontWeight: 600 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>{fmtDate(u.createdAt)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {u.role !== 'admin' && (
                          <Button size="small" variant="outlined" disabled={acting === u.id} onClick={() => setConfirmToggle(u)}
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
          ) : error ? (
            <ErrorState error={error} onRetry={() => load(search, page)} />
          ) : (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>{t('adminManage.noUsers')}</Typography>
            </Box>
          )}
        </Card>

        {/* Пагинация: без неё бэкенд отдавал только первые 50 записей, а остальные
            для админа просто не существовали. */}
        {!error && totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(e, p) => goToPage(p)}
              disabled={refreshing}
              shape="rounded"
            />
          </Box>
        )}
      </Container>

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={confirmToggle?.isActive ? t('adminManage.confirmBlockTitle') : t('adminManage.confirmUnblockTitle')}
        message={`${confirmToggle?.name || ''} — ${confirmToggle?.isActive ? t('adminManage.confirmBlockMsg') : t('adminManage.confirmUnblockMsg')}`}
        confirmLabel={confirmToggle?.isActive ? t('adminManage.block') : t('adminManage.unblock')}
        danger={Boolean(confirmToggle?.isActive)}
        busy={acting === confirmToggle?.id}
        onConfirm={toggleStatus}
        onClose={() => setConfirmToggle(null)}
      />
    </GlassShell>
  );
};

export default AdminUsersPage;
