import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Container,
  Box,
  Typography,
  Grid,
  IconButton,
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
} from '@mui/material';
import {
  Dashboard,
  People,
  Gavel,
  AttachMoney,
  Description,
  Settings,
  Logout,
  Notifications,
  Shield,
  TrendingUp,
  CheckCircle,
  PersonAdd,
  Category,
  LocalOffer,
  SupportAgent,
  RateReview,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import adminService from '../../services/adminService';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';
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
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { t, language } = useTranslation();

  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, activityData, reportsData] = await Promise.all([
        adminService.dashboard.getStats(),
        adminService.dashboard.getRecentActivity(10),
        adminService.dashboard.getReports(),
      ]);

      setStats(statsData);
      setRecentActivity(activityData);
      setReports(reportsData);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error(t('admin.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uz-UZ', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(amount) + ' ' + t('admin.sum');
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'user_registration':
        return <PersonAdd />;
      case 'consultation_completed':
        return <CheckCircle />;
      case 'lawyer_approved':
        return <Gavel />;
      case 'payment':
        return <AttachMoney />;
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
      case 'lawyer_approved':
        return axelionColors.warning;
      case 'payment':
        return axelionColors.success;
      default:
        return axelionColors.bronze;
    }
  };

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
          boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  background: axelionColors.textDark,
                  boxShadow: '0 2px 6px rgba(26, 26, 26, 0.06)',
                }}
              >
                <Shield sx={{ fontSize: 36 }} />
              </Avatar>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                    {t('admin.title')}
                  </Typography>
                  <Chip
                    label="ADMIN"
                    size="small"
                    sx={{
                      background: axelionColors.textDark,
                      color: '#FFFFFF',
                      fontWeight: 'bold',
                      border: 'none',
                    }}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: axelionColors.textMuted, mt: 0.5 }}>
                  {user?.name || t('admin.adminFallback')} {t('admin.fullAccess')}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <LanguageSwitcher
                variant="dropdown"
                sx={{
                  color: axelionColors.textDark,
                  bgcolor: axelionColors.bgCream,
                  '&:hover': { bgcolor: axelionColors.bgBeige },
                }}
              />
              <IconButton
                sx={{
                  background: axelionColors.bgLight,
                  border: `1px solid ${axelionColors.borderLight}`,
                  color: axelionColors.textDark,
                  '&:hover': {
                    background: axelionColors.bgCream,
                  },
                }}
              >
                <Notifications />
              </IconButton>
              <IconButton
                sx={{
                  background: axelionColors.bgLight,
                  border: `1px solid ${axelionColors.borderLight}`,
                  color: axelionColors.textDark,
                  '&:hover': {
                    background: axelionColors.bgCream,
                  },
                }}
                onClick={() => navigate('/settings')}
              >
                <Settings />
              </IconButton>
              <Button
                variant="contained"
                startIcon={<Logout />}
                onClick={handleLogout}
                sx={{
                  background: axelionColors.textDark,
                  color: '#FFFFFF',
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 3,
                  borderRadius: '8px',
                  boxShadow: 'none',
                  '&:hover': {
                    background: '#2D2D2D',
                    boxShadow: 'none',
                  },
                }}
              >
                {t('nav.logout')}
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: t('admin.totalUsers'),
              value: stats?.totalUsers?.toLocaleString() || '0',
              color: axelionColors.gold,
            },
            {
              icon: <Gavel sx={{ fontSize: 40 }} />,
              label: t('admin.lawyers'),
              value: stats?.totalLawyers?.toLocaleString() || '0',
              color: axelionColors.warning,
            },
            {
              icon: <People sx={{ fontSize: 40 }} />,
              label: t('admin.clients'),
              value: stats?.totalClients?.toLocaleString() || '0',
              color: axelionColors.bronze,
            },
            {
              icon: <CheckCircle sx={{ fontSize: 40 }} />,
              label: t('admin.activeConsultations'),
              value: stats?.activeConsultations?.toLocaleString() || '0',
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
                    {formatCurrency(stats?.monthlyRevenue || 0)}
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
                    {formatCurrency(stats?.totalRevenue || 0)}
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
                    const ML = language === 'en'
                      ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                      : ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
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
                <Typography variant="subtitle2" sx={{ color: axelionColors.textMuted, mb: 2 }}>{t('admin.repTopLawyers')}</Typography>
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
                              {activity.description}
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
                              {activity.date || t('admin.dateRecently')}
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
                      {stats?.totalUsers?.toLocaleString() || '0'}
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
                        width: '100%',
                        background: axelionColors.gold,
                      }}
                    />
                  </Box>
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
                {/* Честный статус: панель загрузилась → API и БД доступны сейчас.
                    Выдуманные аптаймы и непроверяемые Video/AI убраны. */}
                {[
                  { label: t('admin.apiServer') },
                  { label: t('admin.database') },
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
                          bgcolor: axelionColors.success,
                        }}
                      />
                      <Typography variant="body2" fontWeight="bold" sx={{ color: axelionColors.textDark }}>
                        {system.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: axelionColors.success }}>
                      {t('admin.working')}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default AdminDashboardGlass;
