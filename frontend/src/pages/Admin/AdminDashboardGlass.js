import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Grid,
  Avatar,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  keyframes,
  CircularProgress,
  Card,
  Button,
  Alert,
} from '@mui/material';
import {
  Dashboard,
  People,
  Gavel,
  AttachMoney,
  TrendingUp,
  CheckCircle,
  PersonAdd,
  Close,
  Category,
  LocalOffer,
  SupportAgent,
  RateReview,
  Refresh,
} from '@mui/icons-material';
import adminService from '../../services/adminService';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import { axelionColors } from '../../theme/axelionTheme';

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const AdminDashboardGlass = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const { t, language } = useTranslation();

  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  // Ошибки по каждому блоку отдельно: раньше Promise.all был «всё или ничего» —
  // отказ одного запроса рисовал дашборд из нулей как достоверный.
  const [errors, setErrors] = useState({ stats: null, activity: null, reports: null });

  useEffect(() => {
    loadDashboardData();
    // Initial load only; actions call the same loader explicitly when needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    const [statsRes, activityRes, reportsRes] = await Promise.allSettled([
      adminService.dashboard.getStats(),
      adminService.dashboard.getRecentActivity(10),
      adminService.dashboard.getReports(),
    ]);

    setStats(statsRes.status === 'fulfilled' ? statsRes.value : null);
    // Array.isArray — на случай, если эндпоинт вернёт объект: .map по нему
    // уронил бы рендер целиком.
    setRecentActivity(
      activityRes.status === 'fulfilled' && Array.isArray(activityRes.value) ? activityRes.value : []
    );
    setReports(reportsRes.status === 'fulfilled' ? reportsRes.value : null);

    const next = {
      stats: statsRes.status === 'rejected' ? statsRes.reason : null,
      activity: activityRes.status === 'rejected' ? activityRes.reason : null,
      reports: reportsRes.status === 'rejected' ? reportsRes.reason : null,
    };
    setErrors(next);
    if (next.stats || next.activity || next.reports) toast.error(t('admin.loadError'));
    setLoading(false);
  };

  const hasError = Boolean(errors.stats || errors.activity || errors.reports);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(amount) + ' ' + t('admin.sum');
  };

  // Лента активности: бэкенд отдаёт данные, текст и дата собираются здесь —
  // иначе UZ/EN-админ видел русские строки и дату 'ru-RU'.
  const activityText = (a) => {
    switch (a.type) {
      case 'user_registration':
        return `${a.role === 'lawyer' ? t('admin.actNewLawyer') : a.role === 'admin' ? t('admin.actNewAdmin') : t('admin.actNewClient')}: ${a.userName || t('admin.userUnknown')}`;
      case 'consultation_pending':
        return `${t('admin.actRequest')} ${a.clientName || t('admin.userUnknown')}`;
      case 'consultation_accepted':
        return `${t('admin.actAccepted')} ${a.lawyerName || ''}`.trim();
      case 'consultation_completed':
        return `${t('admin.actCompleted')}: ${a.clientName || '—'} — ${a.lawyerName || '—'}`;
      case 'consultation_cancelled':
        return t('admin.actCancelled');
      default:
        return `${t('admin.actOther')}: ${a.clientName || '—'} — ${a.lawyerName || '—'}`;
    }
  };

  const fmtActivityDate = (iso) => {
    if (!iso) return t('admin.dateRecently');
    const locale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
    return new Date(iso).toLocaleDateString(locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  // Типы соответствуют тому, что реально отдаёт /admin/activity/recent.
  // Прежние ветки lawyer_approved/payment были недостижимы, а приходящие
  // consultation_pending/accepted/cancelled падали в серый default.
  const getActivityIcon = (type) => {
    switch (type) {
      case 'user_registration':
        return <PersonAdd />;
      case 'consultation_completed':
        return <CheckCircle />;
      case 'consultation_pending':
        return <Gavel />;
      case 'consultation_accepted':
        return <CheckCircle />;
      case 'consultation_cancelled':
        return <Close />;
      default:
        return <Dashboard />;
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'user_registration':
        return axelionColors.gold;
      case 'consultation_completed':
        return axelionColors.success;
      case 'consultation_pending':
        return axelionColors.warning;
      case 'consultation_accepted':
        return axelionColors.bronze;
      case 'consultation_cancelled':
        return axelionColors.error;
      default:
        return axelionColors.bronze;
    }
  };

  // Шапка (заголовок, язык, тема, РАБОЧИЙ колокольчик уведомлений, профиль, выход)
  // и сайдбар теперь приходят из GlassShell — своя шапка страницы удалена.
  if (loading) {
    return (
      <GlassShell active="/admin/dashboard" title={t('admin.title')} subtitle={`${user?.name || t('admin.adminFallback')} ${t('admin.fullAccess')}`} role="admin">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: axelionColors.gold }} size={60} />
        </Box>
      </GlassShell>
    );
  }

  return (
    <GlassShell active="/admin/dashboard" title={t('admin.title')} subtitle={`${user?.name || t('admin.adminFallback')} ${t('admin.fullAccess')}`} role="admin">
      <Container maxWidth="xl" disableGutters>

        {/* Постоянный баннер вместо исчезающего тоста: иначе админ видит дашборд
            нулей и не знает, что часть данных не пришла. */}
        {hasError && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <Button color="inherit" size="small" startIcon={<Refresh />} onClick={loadDashboardData}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('common.loadFailed')}
          </Alert>
        )}

        {/* Stats Cards. При ошибке — «—», а не 0: ноль читался бы как факт. */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: t('admin.totalUsers'),
              value: stats ? (stats.totalUsers ?? 0).toLocaleString() : '—',
              color: axelionColors.gold,
            },
            {
              icon: <Gavel sx={{ fontSize: 40 }} />,
              label: t('admin.lawyers'),
              value: stats ? (stats.totalLawyers ?? 0).toLocaleString() : '—',
              color: axelionColors.warning,
            },
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: t('admin.clients'),
              value: stats ? (stats.totalClients ?? 0).toLocaleString() : '—',
              color: axelionColors.bronze,
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              label: t('admin.activeConsultations'),
              value: stats ? (stats.activeConsultations ?? 0).toLocaleString() : '—',
              color: axelionColors.success,
            },
          ].map((stat, index) => (
            <Grid
              item
              xs={12}
              sm={6}
              lg={3}
              key={index}
              sx={{
                animation: `${fadeInUp} 0.6s ease-out`,
                animationDelay: `${index * 0.1}s`,
                animationFillMode: 'both',
              }}
            >
              <Card
                sx={{
                  background: axelionColors.bgLight,
                  border: `1px solid ${axelionColors.borderLight}`,
                  borderRadius: '8px',
                  boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                  p: 3,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(26, 26, 26, 0.1)',
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
                      background: stat.color,
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted }} gutterBottom>
                      {stat.label}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                      {stat.value}
                    </Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Revenue Stats */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6}>
            <Card
              sx={{
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                p: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: '0 4px 12px rgba(26, 26, 26, 0.1)',
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
                    background: axelionColors.success,
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AttachMoney sx={{ fontSize: 40 }} />
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: axelionColors.textMuted }} gutterBottom>
                    {t('admin.monthRevenue')}
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                    {stats ? formatCurrency(stats.monthlyRevenue || 0) : '—'}
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6}>
            <Card
              sx={{
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                p: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: '0 4px 12px rgba(26, 26, 26, 0.1)',
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
                    background: axelionColors.warning,
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp sx={{ fontSize: 40 }} />
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: axelionColors.textMuted }} gutterBottom>
                    {t('admin.totalRevenue')}
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                    {stats ? formatCurrency(stats.totalRevenue || 0) : '—'}
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Grid>
        </Grid>

        {/* Real reports / analytics */}
        {reports && (
          <Card
            sx={{
              background: axelionColors.bgLight,
              border: `1px solid ${axelionColors.borderLight}`,
              borderRadius: '8px',
              boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
              p: 3,
              mb: 4,
            }}
          >
            <Typography variant="h6" fontWeight="bold" sx={{ color: axelionColors.textDark }} gutterBottom>
              {t('admin.repTitle')}
            </Typography>
            <Grid container spacing={3} sx={{ mt: 0.5 }}>
              {/* Revenue by month */}
              <Grid item xs={12} md={7}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textMuted, mb: 2 }}>{t('admin.repRevenueByMonth')}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 150 }}>
                  {(() => {
                    const max = Math.max(1, ...reports.monthlyRevenue.map((m) => m.revenue));
                    // Короткие названия месяцев берём у Intl по текущему языку:
                    // прежний массив давал узбекскому админу русские месяцы.
                    const mLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
                    const ML = Array.from({ length: 12 }, (_, i) =>
                      new Date(2000, i, 1).toLocaleDateString(mLocale, { month: 'short' }));
                    return reports.monthlyRevenue.map((m) => {
                      const h = Math.round((m.revenue / max) * 120);
                      return (
                        <Box key={m.month} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', height: '100%' }}>
                          <Box title={formatCurrency(m.revenue)} sx={{ width: '100%', maxWidth: 44, height: Math.max(h, 4), borderRadius: '6px 6px 3px 3px', background: m.revenue > 0 ? `linear-gradient(180deg, ${axelionColors.gold}, ${axelionColors.bronze})` : axelionColors.borderLight }} />
                          <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>{ML[parseInt(m.month.split('-')[1], 10) - 1]}</Typography>
                        </Box>
                      );
                    });
                  })()}
                </Box>
              </Grid>
              {/* Top lawyers */}
              <Grid item xs={12} md={5}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textMuted, mb: 0.5 }}>{t('admin.repTopLawyers')}</Typography>
                {/* Рейтинг строится по LawyerProfile.completedCases, который на этой
                    базе засеян демо-значениями. Пока реальных завершённых консультаций
                    нет — честно помечаем, чтобы цифры не читались как факт. */}
                {(!reports?.consultationsByStatus?.completed) && (
                  <Typography variant="caption" sx={{ color: axelionColors.warning, display: 'block', mb: 1.5 }}>
                    {t('admin.repSeeded')}
                  </Typography>
                )}
                {reports.topLawyers && reports.topLawyers.length ? reports.topLawyers.map((l, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Typography sx={{ color: axelionColors.gold, fontWeight: 'bold', width: 18, flexShrink: 0 }}>{i + 1}</Typography>
                      <Typography variant="body2" noWrap sx={{ color: axelionColors.textDark }}>{l.name}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: axelionColors.textMuted, whiteSpace: 'nowrap', pl: 1 }}>{l.completedCases} {t('admin.repCases')} · ★{l.rating}</Typography>
                  </Box>
                )) : <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>—</Typography>}
              </Grid>
              {/* Рост пользователей: бэкенд считал usersGrowth (запрос + цикл по месяцам)
                  и никто это не выводил — работа впустую. Теперь показываем. */}
              <Grid item xs={12} md={7}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textMuted, mb: 2 }}>{t('admin.repUsersGrowth')}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 130 }}>
                  {(() => {
                    const rows = reports.usersGrowth || [];
                    const max = Math.max(1, ...rows.map((m) => m.clients + m.lawyers));
                    const mLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
                    const ML = Array.from({ length: 12 }, (_, i) =>
                      new Date(2000, i, 1).toLocaleDateString(mLocale, { month: 'short' }));
                    return rows.map((m) => {
                      const hc = Math.round((m.clients / max) * 96);
                      const hl = Math.round((m.lawyers / max) * 96);
                      return (
                        <Box key={m.month} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', height: '100%' }}>
                          <Box sx={{ width: '100%', maxWidth: 44, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                            <Box title={`${t('admin.repLawyers')}: ${m.lawyers}`} sx={{ height: Math.max(hl, m.lawyers ? 3 : 0), background: axelionColors.warning, borderRadius: '4px 4px 0 0' }} />
                            <Box title={`${t('admin.repClients')}: ${m.clients}`} sx={{ height: Math.max(hc, m.clients ? 3 : 2), background: axelionColors.bronze }} />
                          </Box>
                          <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>{ML[parseInt(m.month.split('-')[1], 10) - 1]}</Typography>
                        </Box>
                      );
                    });
                  })()}
                </Box>
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                  <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: axelionColors.bronze, marginRight: 5 }} />{t('admin.repClients')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: axelionColors.textMuted }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: axelionColors.warning, marginRight: 5 }} />{t('admin.repLawyers')}
                  </Typography>
                </Box>
              </Grid>

              {/* Consultations by status */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ color: axelionColors.textMuted, mb: 1.5 }}>{t('admin.repByStatus')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {Object.entries(reports.consultationsByStatus).map(([st, cnt]) => (
                    <Chip key={st} label={`${t('admin.st_' + st)}: ${cnt}`} size="small" sx={{ background: axelionColors.bgCream, color: axelionColors.textDark, border: `1px solid ${axelionColors.borderLight}` }} />
                  ))}
                </Box>
              </Grid>
            </Grid>
          </Card>
        )}

        {/* Quick Actions */}
        <Card
          sx={{
            background: axelionColors.bgLight,
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
            p: 3,
            mb: 4,
          }}
        >
          <Typography variant="h6" fontWeight="bold" sx={{ color: axelionColors.textDark }} gutterBottom>
            {t('admin.quickActions')}
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {[
              {
                icon: <People />,
                label: t('admin.manageUsers'),
                path: '/admin/users',
                color: axelionColors.gold,
              },
              {
                icon: <Gavel />,
                label: t('admin.manageLawyers'),
                path: '/admin/lawyers',
                color: axelionColors.warning,
              },
              {
                icon: <Category />,
                label: t('admin.specializations'),
                path: '/admin/specializations',
                color: axelionColors.bronze,
              },
              {
                icon: <LocalOffer />,
                label: t('admin.promos'),
                path: '/admin/promos',
                color: axelionColors.success,
              },
              {
                icon: <SupportAgent />,
                label: t('admin.support'),
                path: '/admin/support',
                color: axelionColors.info || axelionColors.gold,
              },
              {
                icon: <RateReview />,
                label: t('admin.reviews'),
                path: '/admin/reviews',
                color: axelionColors.bronze,
              },
            ].map((action, index) => (
              <Grid item xs={12} sm={6} md={4} key={index}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={action.icon}
                  onClick={() => navigate(action.path)}
                  sx={{
                    py: 2,
                    justifyContent: 'flex-start',
                    color: axelionColors.textDark,
                    borderColor: axelionColors.borderLight,
                    borderRadius: '8px',
                    textTransform: 'none',
                    fontWeight: 600,
                    '&:hover': {
                      background: action.color,
                      borderColor: action.color,
                      color: '#FFFFFF',
                      transform: 'translateY(-2px)',
                    },
                    transition: 'all 0.3s ease',
                  }}
                >
                  {action.label}
                </Button>
              </Grid>
            ))}
          </Grid>
        </Card>

        <Grid container spacing={3}>
          {/* Recent Activity */}
          <Grid item xs={12} lg={8}>
            <Card
              sx={{
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                p: 3,
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                  {t('admin.recentActivity')}
                </Typography>
                <Chip
                  label={`${recentActivity.length} ${t('admin.records')}`}
                  sx={{
                    background: axelionColors.bgCream,
                    color: axelionColors.textDark,
                    fontWeight: 'bold',
                    border: `1px solid ${axelionColors.borderLight}`,
                  }}
                />
              </Box>

              {recentActivity.length > 0 ? (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ color: axelionColors.textMuted, fontWeight: 'bold', borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                          {t('admin.colType')}
                        </TableCell>
                        <TableCell sx={{ color: axelionColors.textMuted, fontWeight: 'bold', borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                          {t('admin.colDesc')}
                        </TableCell>
                        <TableCell sx={{ color: axelionColors.textMuted, fontWeight: 'bold', borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                          {t('admin.colUser')}
                        </TableCell>
                        <TableCell sx={{ color: axelionColors.textMuted, fontWeight: 'bold', borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                          {t('admin.colDate')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentActivity.map((activity, index) => (
                        <TableRow
                          key={index}
                          hover
                          sx={{
                            '&:hover': {
                              background: axelionColors.bgCream,
                            },
                          }}
                        >
                          <TableCell sx={{ borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                            <Box
                              sx={{
                                width: 40,
                                height: 40,
                                borderRadius: '8px',
                                background: getActivityColor(activity.type),
                                color: '#FFFFFF',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {getActivityIcon(activity.type)}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                            <Typography variant="body2" sx={{ color: axelionColors.textDark }}>
                              {activityText(activity)}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32, bgcolor: axelionColors.gold }}>
                                {activity.userName?.charAt(0) || 'U'}
                              </Avatar>
                              <Typography variant="body2" sx={{ color: axelionColors.textDark }}>
                                {activity.userName || t('admin.userUnknown')}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ borderBottom: `1px solid ${axelionColors.borderLight}` }}>
                            <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                              {fmtActivityDate(activity.createdAt)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>
                    {t('admin.noActivity')}
                  </Typography>
                </Box>
              )}
            </Card>
          </Grid>

          {/* System Overview */}
          <Grid item xs={12} lg={4}>
            <Card
              sx={{
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                p: 3,
                mb: 3,
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: axelionColors.textDark }} gutterBottom>
                {t('admin.systemOverview')}
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                      {t('admin.totalUsers')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                      {stats ? (stats.totalUsers ?? 0).toLocaleString() : '—'}
                    </Typography>
                  </Box>
                  {/* Полоса убрана: она была захардкожена в 100% и ничего не показывала.
                      Две полосы ниже считаются от этого числа как от базы. */}
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                      {t('admin.activeLawyers')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                      {stats?.totalLawyers?.toLocaleString() || '0'}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      background: axelionColors.bgCream,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: stats?.totalUsers ? `${Math.round((stats.totalLawyers / stats.totalUsers) * 100)}%` : '0%',
                        background: axelionColors.warning,
                      }}
                    />
                  </Box>
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
                      {t('admin.consultations')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                      {stats?.activeConsultations?.toLocaleString() || '0'}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      background: axelionColors.bgCream,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: stats?.totalConsultations ? `${Math.round((stats.activeConsultations / stats.totalConsultations) * 100)}%` : '0%',
                        background: axelionColors.success,
                      }}
                    />
                  </Box>
                </Box>
              </Box>
            </Card>

            {/* System Health */}
            <Card
              sx={{
                background: axelionColors.bgLight,
                border: `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px',
                boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                p: 3,
              }}
            >
              <Typography variant="h6" fontWeight="bold" sx={{ color: axelionColors.textDark }} gutterBottom>
                {t('admin.systemHealth')}
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                {/* Статус выводится из фактического результата запросов этой страницы,
                    а не рисуется зелёным всегда: /admin/dashboard/stats ходит в БД,
                    поэтому его отказ — сигнал и по API, и по базе. */}
                {[
                  { label: t('admin.apiServer'), ok: !errors.stats && !errors.activity },
                  { label: t('admin.database'), ok: !errors.stats },
                ].map((system, index) => (
                  <Box
                    key={index}
                    sx={{
                      p: 2,
                      borderRadius: '8px',
                      background: axelionColors.bgCream,
                      border: `1px solid ${axelionColors.borderLight}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: system.ok ? axelionColors.success : axelionColors.error,
                        }}
                      />
                      <Typography variant="body2" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                        {system.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: system.ok ? axelionColors.success : axelionColors.error }}>
                      {system.ok ? t('admin.working') : t('admin.notResponding')}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </GlassShell>
  );
};

export default AdminDashboardGlass;
