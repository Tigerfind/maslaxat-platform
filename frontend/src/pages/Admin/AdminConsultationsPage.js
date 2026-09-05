import React, { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Chip, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper, Pagination, Button, Dialog, DialogTitle, DialogContent, DialogActions, Stack, useMediaQuery,
} from '@mui/material';
import { adminConsultationService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import ErrorState from '../../components/UI/ErrorState';
import ResponsiveDataView, { MobileDataField } from '../../components/UI/ResponsiveDataView';

const PAGE_SIZE = 25;

// Те же статусы, что использует дашборд (admin.st_*) — не заводим второй словарь.
const STATUSES = ['all', 'payment_pending', 'pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'];

const STATUS_COLOR = {
  payment_pending: axelionColors.warning,
  pending: axelionColors.gold,
  accepted: axelionColors.bronze,
  in_progress: axelionColors.gold,
  completed: axelionColors.success,
  rejected: axelionColors.error,
  cancelled: axelionColors.error,
};

/**
 * Консультации (/admin/consultations).
 *
 * GET /admin/consultations с фильтром и пагинацией существовал на бэкенде, но
 * ни одна страница его не вызывала — админ не видел, что происходит на платформе.
 */
const AdminConsultationsPage = () => {
  const { t, language } = useTranslation();
  const phone = useMediaQuery('(max-width:599px)');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const openDiagnostics = async (id) => {
    setDiagnosticsLoading(true);
    try { setDiagnostics(await adminConsultationService.getMeetingDiagnostics(id)); }
    catch (e) { setError(e); }
    finally { setDiagnosticsLoading(false); }
  };

  const load = async (pageNum = 1, st = status) => {
    setLoading(true);
    try {
      const data = await adminConsultationService.getConsultations({
        page: pageNum,
        limit: PAGE_SIZE,
        ...(st !== 'all' ? { status: st } : {}),
      });
      setItems(Array.isArray(data?.consultations) ? data.consultations : []);
      setTotalPages(data?.totalPages || 1);
      setTotal(data?.total || 0);
      setError(null);
    } catch (e) {
      setError(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); load(1, status); }, [status]);

  const locale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtMoney = (v) => (v ? `${Number(v).toLocaleString(locale)} ${t('adminConsult.sum')}` : '—');

  return (
    <GlassShell active="/admin/consultations" title={t('adminConsult.title')} subtitle={total ? String(total) : undefined} role="admin">
      <Container maxWidth="xl" disableGutters>
        <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <Chip
              key={s}
              label={s === 'all' ? t('common.all') : t(`admin.st_${s}`)}
              onClick={() => setStatus(s)}
              variant={status === s ? 'filled' : 'outlined'}
              sx={{
                cursor: 'pointer',
                background: status === s ? axelionColors.accentLight : 'transparent',
                borderColor: axelionColors.borderLight,
                color: axelionColors.textDark,
                fontWeight: status === s ? 600 : 400,
              }}
            />
          ))}
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: axelionColors.gold }} /></Box>
        ) : error ? (
          <ErrorState error={error} onRetry={() => load(page, status)} />
        ) : (
          <ResponsiveDataView
            items={items}
            mobileLabel={t('adminConsult.title')}
            emptyLabel={t('adminConsult.empty')}
            renderMobileItem={(c) => (
              <Stack spacing={1.5}>
                <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                  <MobileDataField label={t('adminConsult.client')}><b>{c.client?.name || '—'}</b><Typography sx={{ fontSize: 12, color: axelionColors.textMuted, overflowWrap: 'anywhere' }}>{c.client?.email}</Typography></MobileDataField>
                  <MobileDataField label={t('adminConsult.lawyer')}><b>{c.lawyer?.name || '—'}</b><Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{c.lawyer?.profile?.specialization}</Typography></MobileDataField>
                  <MobileDataField label={t('adminConsult.scheduled')}>{fmtDate(c.scheduledDate)}{c.scheduledTime ? `, ${c.scheduledTime}` : ''}</MobileDataField>
                  <MobileDataField label={t('adminConsult.status')}><Chip size="small" label={t(`admin.st_${c.status}`)} /></MobileDataField>
                  <MobileDataField label={t('adminConsult.price')}>{fmtMoney(c.price)}</MobileDataField>
                  <MobileDataField label={t('adminConsult.provider')}>{c.meetingProvider || '—'}</MobileDataField>
                  <MobileDataField label={t('adminConsult.created')}>{fmtDate(c.createdAt)}</MobileDataField>
                </Box>
                <Button fullWidth variant="outlined" onClick={() => openDiagnostics(c.id)} sx={{ minHeight: 44 }}>{t('adminConsult.openDiagnostics')}</Button>
              </Stack>
            )}
            desktop={(
              <Paper sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', overflow: 'hidden', boxShadow: 'none' }}>
                <TableContainer>
                  <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: axelionColors.bgCream }}>
                  <TableCell>{t('adminConsult.client')}</TableCell>
                  <TableCell>{t('adminConsult.lawyer')}</TableCell>
                  <TableCell>{t('adminConsult.scheduled')}</TableCell>
                  <TableCell>{t('adminConsult.price')}</TableCell>
                  <TableCell>{t('adminConsult.status')}</TableCell>
                  <TableCell>{t('adminConsult.created')}</TableCell>
                  <TableCell>{t('adminConsult.provider')}</TableCell>
                  <TableCell>{t('adminConsult.diagnostics')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminConsult.empty')}</TableCell></TableRow>
                ) : items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Typography sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{c.client?.name || '—'}</Typography>
                      <Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{c.client?.email}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{c.lawyer?.name || '—'}</Typography>
                      <Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{c.lawyer?.profile?.specialization}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textSecondary }}>
                      {fmtDate(c.scheduledDate)}{c.scheduledTime ? `, ${c.scheduledTime}` : ''}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textDark }}>{fmtMoney(c.price)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={t(`admin.st_${c.status}`)}
                        sx={{ color: STATUS_COLOR[c.status] || axelionColors.textMuted, bgcolor: axelionColors.bgCream, fontWeight: 600 }} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textMuted }}>{fmtDate(c.createdAt)}</TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{c.meetingProvider || '—'}</TableCell>
                    <TableCell><Button size="small" onClick={() => openDiagnostics(c.id)}>{t('adminConsult.open')}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
          />
        )}
        <Dialog open={Boolean(diagnostics) || diagnosticsLoading} onClose={() => setDiagnostics(null)} maxWidth="md" fullWidth fullScreen={phone} PaperProps={{ sx: { maxHeight: { xs: '100dvh', sm: 'calc(100dvh - 64px)' } } }}>
          <DialogTitle>{t('adminConsult.diagnosticsTitle')}</DialogTitle>
          <DialogContent>
            {diagnosticsLoading ? <CircularProgress /> : diagnostics && <Box sx={{ display: 'grid', gap: 1, fontSize: 14, overflowWrap: 'anywhere' }}>
              <div>ID: {diagnostics.consultation.id}</div>
              <div>{t('adminConsult.status')}: {diagnostics.consultation.lifecycleStatus} / {diagnostics.consultation.status}</div>
              <div>{t('adminConsult.provider')}: {diagnostics.consultation.meetingProvider}</div>
              <div>{t('adminConsult.duration')}: {diagnostics.consultation.duration} {t('adminConsult.minutes')}</div>
              <div>{t('adminConsult.timezone')}: {diagnostics.consultation.scheduleTimezone || '—'}</div>
              <div>Zoom: {diagnostics.consultation.meeting?.status || t('adminConsult.notCreated')}; {t('adminConsult.operation')}: {diagnostics.consultation.meeting?.pendingOperation || '—'}</div>
              <div>{t('adminConsult.attempts')}: {diagnostics.consultation.meeting?.attemptCount || 0}; {t('adminConsult.error')}: {diagnostics.consultation.meeting?.lastSafeError || '—'}</div>
              <div>{t('adminConsult.lawyerJoined')}: {diagnostics.consultation.lawyerFirstJoinedAt ? fmtDate(diagnostics.consultation.lawyerFirstJoinedAt) : '—'}</div>
              <div>{t('adminConsult.clientJoined')}: {diagnostics.consultation.clientFirstJoinedAt ? fmtDate(diagnostics.consultation.clientFirstJoinedAt) : '—'}</div>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>{t('adminConsult.technicalEvents')}</Typography>
              {(diagnostics.events || []).map((event) => <div key={event.id}>{fmtDate(event.occurredAt)} · {event.eventType} · {event.participantRole || 'system'}</div>)}
            </Box>}
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1, pb: 'max(8px, env(safe-area-inset-bottom))', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
            {diagnostics?.consultation?.meetingProvider === 'zoom' && <Button onClick={async () => { await adminConsultationService.retryMeeting(diagnostics.consultation.id); setDiagnostics(null); }}>{t('adminConsult.retryCreate')}</Button>}
            <Button onClick={() => setDiagnostics(null)}>{t('common.close')}</Button>
          </DialogActions>
        </Dialog>

        {!loading && !error && totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination count={totalPages} page={page} onChange={(e, p) => { setPage(p); load(p, status); }} shape="rounded" />
          </Box>
        )}
      </Container>
    </GlassShell>
  );
};

export default AdminConsultationsPage;
