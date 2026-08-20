import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import {
  Container, Box, Typography, Grid, IconButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Stack, CircularProgress,
  Card, Button, Avatar, Dialog, DialogTitle, DialogContent, DialogActions, List,
  ListItem, ListItemText, Pagination,
} from '@mui/material';
import {
  CheckCircle, Block, Gavel, Verified, HourglassEmpty,
  DescriptionOutlined, DownloadOutlined, FolderOpenOutlined, VisibilityOutlined,
} from '@mui/icons-material';
import { adminLawyerService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import DocumentPreviewDialog from '../../components/UI/DocumentPreviewDialog';
import ErrorState from '../../components/UI/ErrorState';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

const PAGE_SIZE = 25;

const AdminLawyersPage = () => {
  const { t, language } = useTranslation();

  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState(null);
  const loadedOnce = useRef(false);
  // Подтверждения необратимых действий модерации
  const [confirmApprove, setConfirmApprove] = useState(null);
  const [confirmReject, setConfirmReject] = useState(null);
  // Диалог верификационных документов юриста
  const [docsFor, setDocsFor] = useState(null); // юрист, чьи документы открыты
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [verifyingDoc, setVerifyingDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null); // документ для предпросмотра
  const [moderation, setModeration] = useState(null);
  const [moderationLoading, setModerationLoading] = useState(false);

  // Blob документа для предпросмотра (тот же эндпоинт, что и скачивание).
  const previewFetch = React.useCallback(async () => {
    return adminLawyerService.getVerificationDocumentBlob(docsFor.id, previewDoc.id);
  }, [docsFor, previewDoc]);

  // Дебаунс на поиск; смена фильтра статуса перезагружает сразу. Оба сбрасывают
  // страницу на первую.
  useEffect(() => {
    const id = setTimeout(() => { setPage(1); load(1); }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const openDocs = async (lawyer) => {
    setDocsFor(lawyer);
    setDocs([]);
    setDocsLoading(true);
    try {
      const data = await adminLawyerService.getVerificationDocuments(lawyer.id);
      setDocs(Array.isArray(data?.documents) ? data.documents : []);
    } catch {
      toast.error(t('adminManage.docsError'));
    } finally {
      setDocsLoading(false);
    }
  };
  const openModeration = async (lawyer) => {
    setModerationLoading(true);
    setModeration({ lawyer });
    try { setModeration(await adminLawyerService.getModeration(lawyer.id)); }
    catch { toast.error(t('adminManage.loadError')); setModeration(null); }
    finally { setModerationLoading(false); }
  };

  const download = async (docId, name) => {
    setDownloading(docId);
    try {
      await adminLawyerService.downloadVerificationDocument(docsFor.id, docId, name);
    } catch {
      toast.error(t('adminManage.docsError'));
    } finally {
      setDownloading(null);
    }
  };
  const verifyDocument = async (docId) => {
    setVerifyingDoc(docId);
    try {
      const data = await adminLawyerService.verifyDocument(docsFor.id, docId);
      setDocs((current) => current.map((doc) => (doc.id === docId ? { ...doc, verifiedAt: data.document.verifiedAt } : doc)));
      toast.success(t('adminManage.docVerified'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('adminManage.actionError'));
    } finally {
      setVerifyingDoc(null);
    }
  };

  const DOC_TYPE_LABEL = {
    diploma: t('adminManage.docDiploma'),
    license: t('adminManage.docLicense'),
    certificate: 'Сертификат',
    id: t('adminManage.docId'),
    other: t('adminManage.docOther'),
  };

  const load = async (pageNum = 1) => {
    if (!loadedOnce.current) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await adminLawyerService.getLawyers({
        page: pageNum,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      setLawyers(Array.isArray(data?.lawyers) ? data.lawyers : (Array.isArray(data) ? data : []));
      setTotalPages(data?.totalPages || 1);
      setCounts(data?.counts || null);
      setError(null);
    } catch (e) {
      // Ошибка загрузки больше не маскируется под «юристов нет».
      setError(e);
      setLawyers([]);
      setCounts(null);
      toast.error(t('adminManage.loadError'));
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  };

  const goToPage = (p) => { setPage(p); load(p); };

  // Одобрение и отказ — необратимые для юриста действия (профиль появляется или
  // исчезает из каталога), поэтому оба идут через подтверждение.
  const approve = async () => {
    const id = confirmApprove.id;
    setActing(id);
    try {
      await adminLawyerService.approveLawyer(id);
      toast.success(t('adminManage.approved'));
      setConfirmApprove(null);
      await load(page);
    } catch (e) {
      toast.error(e.response?.data?.error || t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  const reject = async (reason) => {
    // Причина уходит юристу в уведомление, чтобы он исправил профиль и подал снова —
    // поэтому она обязательна (раньше window.prompt пропускал пустую строку).
    const id = confirmReject.id;
    setActing(id);
    try {
      await adminLawyerService.rejectLawyer(id, reason);
      toast.success(t('adminManage.rejected'));
      setConfirmReject(null);
      await load(page);
    } catch (e) {
      toast.error(e.response?.data?.error || t('adminManage.actionError'));
    } finally {
      setActing(null);
    }
  };

  // Статус модерации — источник истины на профиле (не User.isVerified, тот про email).
  const stOf = (l) => l.profile?.verificationStatus || 'draft';

  // Очередь проверки: pending → rejected → approved, внутри — новые сверху.
  // Сортировка клиентская и действует только в пределах страницы — поэтому
  // для работы с очередью есть серверный фильтр по статусу (чипы ниже).
  const ORDER = { pending_review: 0, rejected: 1, draft: 2, approved: 3, suspended: 4 };
  const sortedLawyers = [...lawyers].sort((a, b) => {
    const d = (ORDER[stOf(a)] ?? 3) - (ORDER[stOf(b)] ?? 3);
    if (d !== 0) return d;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const initials = (name = '') =>
    name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const specOf = (l) => l.profile?.specialization || t('adminManage.noSpec');
  const completenessLabel = {
    photo: t('verification.chkPhoto'),
    description: t('verification.chkDescription'),
    specialization: t('verification.chkSpecialization'),
    price: t('verification.chkPrice'),
    schedule: t('verification.chkSchedule'),
    documents: t('verification.chkDocuments'),
  };
  // Даты по текущему языку интерфейса: раньше здесь была захардкожена 'ru-RU',
  // и в узбекской/английской версии даты оставались русскими.
  const dateLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(dateLocale) : '—');
  const fmtSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Счётчики — с сервера по всей базе, а не по выданной странице.
  const kpi = (v) => (counts ? v : '—');
  const stats = [
    { icon: <Gavel sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminManage.statTotal'), value: kpi(counts?.all), bg: axelionColors.accentLight },
    { icon: <Verified sx={{ fontSize: 32, color: axelionColors.success }} />, label: t('adminManage.statVerified'), value: kpi(counts?.approved), bg: axelionColors.successLight },
    { icon: <HourglassEmpty sx={{ fontSize: 32, color: axelionColors.warning }} />, label: t('adminManage.statPending'), value: kpi(counts?.pending), bg: axelionColors.bgBeige, highlight: (counts?.pending || 0) > 0 },
  ];

  // Шапку (заголовок, язык, уведомления, выход) даёт GlassShell.
  if (loading) {
    return (
      <GlassShell active="/admin/lawyers" title={t('adminManage.lawyersTitle')} subtitle={t('adminManage.lawyersSub')} role="admin">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: axelionColors.gold }} size={56} />
        </Box>
      </GlassShell>
    );
  }

  return (
    <GlassShell active="/admin/lawyers" title={t('adminManage.lawyersTitle')} subtitle={t('adminManage.lawyersSub')} role="admin">
      <Container maxWidth="xl" disableGutters>
        {/* Stats */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {stats.map((s, i) => (
            <Grid item xs={12} sm={4} key={i}>
              <Card sx={{ background: axelionColors.bgLight, border: s.highlight ? `1.5px solid ${axelionColors.warning}` : `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', boxShadow: s.highlight ? `0 0 0 3px ${axelionColors.warning}22` : 'none', p: 3 }}>
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

        {/* Поиск и фильтр очереди модерации. Фильтр серверный: клиентская
            сортировка pending-первыми работает только внутри страницы, поэтому
            без него юрист «на проверке» с 60-й позиции был недостижим. */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminManage.searchPlaceholder')}
            style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', padding: '11px 14px', borderRadius: 8, border: `1px solid ${axelionColors.borderLight}`, background: axelionColors.bgLight, color: axelionColors.textDark, fontFamily: 'inherit', fontSize: 14, outline: 'none' }}
          />
          {[
            { key: 'all', label: t('common.all') },
            { key: 'pending_review', label: t('adminManage.stPending'), count: counts?.pending },
            { key: 'approved', label: t('adminManage.stApproved'), count: counts?.approved },
            { key: 'rejected', label: t('adminManage.stRejected'), count: counts?.rejected },
          ].map((f) => (
            <Chip
              key={f.key}
              label={f.count != null ? `${f.label} (${f.count})` : f.label}
              onClick={() => setStatusFilter(f.key)}
              variant={statusFilter === f.key ? 'filled' : 'outlined'}
              sx={{
                cursor: 'pointer',
                background: statusFilter === f.key ? axelionColors.accentLight : 'transparent',
                borderColor: axelionColors.borderLight,
                color: axelionColors.textDark,
                fontWeight: statusFilter === f.key ? 600 : 400,
              }}
            />
          ))}
          {refreshing && <CircularProgress size={18} sx={{ color: axelionColors.gold }} />}
        </Box>

        {/* Table */}
        <Card sx={{ background: axelionColors.bgLight, border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', boxShadow: 'none', overflow: 'hidden' }}>
          {sortedLawyers.length > 0 ? (
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
                  {sortedLawyers.map((l) => (
                    <TableRow key={l.id} sx={{ borderBottom: `1px solid ${axelionColors.borderLight}`, '&:hover': { background: axelionColors.bgWarm } }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar src={l.avatar || undefined} alt={l.name} sx={{ width: 40, height: 40, bgcolor: axelionColors.gold, fontSize: 14 }}>{initials(l.name)}</Avatar>
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
                        {stOf(l) === 'pending_review' && (
                          <Chip size="small" icon={<HourglassEmpty sx={{ fontSize: 15 }} />} label={t('adminManage.stPending')} sx={{ background: axelionColors.bgBeige, color: axelionColors.bronze, fontWeight: 600, border: `1px solid ${axelionColors.goldMuted}`, '& .MuiChip-icon': { color: axelionColors.bronze } }} />
                        )}
                        {stOf(l) === 'rejected' && (
                          <Chip size="small" icon={<Block sx={{ fontSize: 15 }} />} label={t('adminManage.stRejected')} sx={{ background: axelionColors.errorLight, color: axelionColors.error, fontWeight: 600, border: `1px solid ${axelionColors.error}`, '& .MuiChip-icon': { color: axelionColors.error } }} />
                        )}
                        {/* Причина отказа сохранялась в БД, но нигде не показывалась —
                            админ не видел, за что сам же отклонил юриста. */}
                        {stOf(l) === 'rejected' && l.profile?.rejectionReason && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: axelionColors.textMuted, maxWidth: 220, mx: 'auto' }}>
                            {l.profile.rejectionReason}
                          </Typography>
                        )}
                        {!l.profileCompleteness?.complete && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: axelionColors.warning, maxWidth: 240, mx: 'auto' }}>
                            {l.profileCompleteness?.missing?.map((key) => completenessLabel[key] || key).join(', ')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>{fmtDate(l.createdAt)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button size="small" variant="outlined" onClick={() => openDocs(l)}
                            startIcon={<FolderOpenOutlined sx={{ fontSize: 16 }} />}
                            sx={{ color: axelionColors.bronze, borderColor: axelionColors.borderLight, textTransform: 'none', borderRadius: '8px', '&:hover': { borderColor: axelionColors.bronze, background: axelionColors.bgBeige } }}>
                            {t('adminManage.docs')}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => openModeration(l)} startIcon={<VisibilityOutlined sx={{ fontSize: 16 }} />}>Резюме</Button>
                          {stOf(l) === 'pending_review' && (
                            <Button size="small" variant="contained" disabled={acting === l.id || !l.profileCompleteness?.complete} onClick={() => setConfirmApprove(l)}
                              startIcon={<CheckCircle sx={{ fontSize: 16 }} />}
                              sx={{ background: axelionColors.success, color: '#fff', textTransform: 'none', boxShadow: 'none', borderRadius: '8px', '&:hover': { background: '#1F7A4A', boxShadow: 'none' } }}>
                              {t('adminManage.approve')}
                            </Button>
                          )}
                          {stOf(l) === 'pending_review' && (
                            <Button size="small" variant="outlined" disabled={acting === l.id} onClick={() => setConfirmReject(l)}
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
          ) : error ? (
            <ErrorState error={error} onRetry={() => load(page)} />
          ) : (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body1" sx={{ color: axelionColors.textMuted }}>{t('adminManage.noLawyers')}</Typography>
            </Box>
          )}
        </Card>

        {!error && totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination count={totalPages} page={page} onChange={(e, p) => goToPage(p)} disabled={refreshing} shape="rounded" />
          </Box>
        )}
      </Container>

      <Dialog open={!!moderation} onClose={() => setModeration(null)} maxWidth="md" fullWidth>
        <DialogTitle>Проверка резюме{moderation?.lawyer?.name ? ` — ${moderation.lawyer.name}` : ''}</DialogTitle>
        <DialogContent dividers>
          {moderationLoading ? <CircularProgress /> : moderation?.lawyer && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Typography variant="h6">{moderation.lawyer.profile?.professionalTitle}</Typography>
              <Typography>{moderation.lawyer.profile?.description}</Typography>
              <Typography><b>Лицензия:</b> {moderation.lawyer.profile?.licenseNumber} · {moderation.lawyer.profile?.licenseIssuer}</Typography>
              <Typography><b>Специализации:</b> {(moderation.lawyer.profile?.specializations || []).join(', ')}</Typography>
              <Typography sx={{ color: moderation.completeness?.missing?.includes('schedule') ? axelionColors.error : axelionColors.success }}>
                <b>{t('adminManage.scheduleStatus')}:</b> {t('adminManage.scheduleSlots', { count: moderation.completeness?.scheduleSlots || 0, required: moderation.completeness?.requiredScheduleSlots || 3 })}
              </Typography>
              <Typography variant="subtitle1">Опыт работы</Typography>
              {(moderation.lawyer.lawyerExperiences || []).map((item) => <Typography key={item.id}>{item.position} — {item.organization} ({item.startDate} — {item.isCurrent ? 'сейчас' : item.endDate})</Typography>)}
              <Typography variant="subtitle1">Образование</Typography>
              {(moderation.lawyer.lawyerEducations || []).map((item) => <Typography key={item.id}>{item.university} — {item.specialty}</Typography>)}
              <Typography variant="subtitle1">Сертификаты</Typography>
              {(moderation.lawyer.lawyerCertificates || []).map((item) => <Typography key={item.id}>{item.title} · {item.organization}</Typography>)}
              <Typography variant="subtitle1">История статусов</Typography>
              {(moderation.history || []).map((item) => <Typography key={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.fromStatus || '—'} → {item.toStatus}{item.reason ? ` · ${item.reason}` : ''}</Typography>)}
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setModeration(null)}>Закрыть</Button></DialogActions>
      </Dialog>

      {/* Диалог верификационных документов юриста */}
      <Dialog open={!!docsFor} onClose={() => setDocsFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <DescriptionOutlined sx={{ color: axelionColors.bronze }} />
          {t('adminManage.docsTitle')}{docsFor ? ` — ${docsFor.name}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          {docsLoading ? (
            <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : docs.length === 0 ? (
            <Typography variant="body2" sx={{ color: axelionColors.textMuted, py: 2 }}>
              {t('adminManage.docsEmpty')}
            </Typography>
          ) : (
            <List disablePadding>
              {docs.map((d) => (
                <ListItem key={d.id} divider
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <IconButton size="small" onClick={() => setPreviewDoc(d)} title={t('preview.view')} sx={{ color: axelionColors.bronze }}>
                        <VisibilityOutlined sx={{ fontSize: 19 }} />
                      </IconButton>
                      <Button size="small" variant="text" disabled={downloading === d.id}
                        onClick={() => download(d.id, d.name)}
                        startIcon={downloading === d.id ? <CircularProgress size={14} /> : <DownloadOutlined sx={{ fontSize: 18 }} />}
                        sx={{ textTransform: 'none', color: axelionColors.bronze }}>
                        {t('adminManage.docDownload')}
                      </Button>
                      {!d.verifiedAt && (
                        <Button size="small" variant="text" disabled={verifyingDoc === d.id} onClick={() => verifyDocument(d.id)} sx={{ textTransform: 'none', color: axelionColors.success }}>
                          {t('adminManage.docVerify')}
                        </Button>
                      )}
                    </Box>
                  }
                >
                  <ListItemText
                    primary={d.name}
                    // Размер бэкенд отдавал всегда, но он не выводился: нельзя было
                    // отличить настоящий скан от мусорного файла до скачивания.
                    secondary={[DOC_TYPE_LABEL[d.type] || d.type, fmtSize(d.size), d.verifiedAt ? t('adminManage.docVerified') : null].filter(Boolean).join(' · ')}
                    primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                    secondaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocsFor(null)} sx={{ textTransform: 'none', color: axelionColors.textMuted }}>
            {t('adminManage.docsClose')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Предпросмотр документа юриста */}
      <DocumentPreviewDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        name={previewDoc?.name}
        fetchBlob={previewDoc ? previewFetch : null}
        onDownload={previewDoc ? () => download(previewDoc.id, previewDoc.name) : null}
      />

      <ConfirmDialog
        open={Boolean(confirmApprove)}
        title={t('adminManage.confirmApproveTitle')}
        message={`${confirmApprove?.name || ''} — ${t('adminManage.confirmApproveMsg')}`}
        confirmLabel={t('adminManage.approve')}
        busy={acting === confirmApprove?.id}
        onConfirm={approve}
        onClose={() => setConfirmApprove(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmReject)}
        title={t('adminManage.confirmRejectTitle')}
        message={confirmReject?.name}
        confirmLabel={t('adminManage.reject')}
        danger
        withReason
        reasonRequired
        reasonLabel={t('adminManage.rejectReasonPrompt')}
        busy={acting === confirmReject?.id}
        onConfirm={reject}
        onClose={() => setConfirmReject(null)}
      />
    </GlassShell>
  );
};

export default AdminLawyersPage;
