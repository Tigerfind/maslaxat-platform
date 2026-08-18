import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  Box, Container, Typography, Grid, Card, Chip, Button, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Paper, Pagination, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import { AccountBalanceWallet, CheckCircle, HourglassEmpty, ReceiptLong } from '@mui/icons-material';
import { adminFinanceService } from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import ErrorState from '../../components/UI/ErrorState';

const PAGE_SIZE = 25;

const WITHDRAWAL_STATUS = {
  pending: { key: 'stPending', c: axelionColors.warning, bg: 'rgba(196,163,90,0.16)' },
  processing: { key: 'stProcessing', c: axelionColors.bronze, bg: axelionColors.bgBeige },
  paid: { key: 'stPaid', c: axelionColors.success, bg: 'rgba(122,154,107,0.16)' },
  cancelled: { key: 'stCancelled', c: axelionColors.error, bg: 'rgba(176,112,112,0.16)' },
  failed: { key: 'stFailed', c: axelionColors.error, bg: 'rgba(176,112,112,0.16)' },
};

const PAYMENT_STATUS = {
  paid: 'payStPaid', pending: 'payStPending', failed: 'payStFailed', refunded: 'payStRefunded',
};

/**
 * Финансы админа (/admin/finance).
 *
 * Закрывает дыру: POST /payments/withdraw списывал баланс юриста и создавал
 * заявку со статусом pending, но обработать её было негде — деньги списаны,
 * заявка висит вечно. Здесь админ отмечает выплату или отклоняет её (с возвратом
 * суммы на баланс). Вторая вкладка — журнал платежей: раньше админ видел только
 * итоговую сумму выручки без расшифровки.
 */
const AdminFinancePage = () => {
  const { t, language } = useTranslation();

  const [tab, setTab] = useState(0);
  const [withdrawals, setWithdrawals] = useState([]);
  const [wCounts, setWCounts] = useState(null);
  const [payments, setPayments] = useState([]);
  const [pCounts, setPCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [acting, setActing] = useState(null);
  // Диалог отказа: причина уходит юристу в уведомлении, поэтому обязательна.
  const [confirmPaid, setConfirmPaid] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [providerTransactionId, setProviderTransactionId] = useState('');
  const [providerReference, setProviderReference] = useState('');

  const load = useCallback(async (pageNum = 1, currentTab = tab) => {
    setLoading(true);
    try {
      if (currentTab === 0) {
        const data = await adminFinanceService.getWithdrawals({ page: pageNum, limit: PAGE_SIZE });
        setWithdrawals(Array.isArray(data?.withdrawals) ? data.withdrawals : []);
        setWCounts(data?.counts || null);
        setTotalPages(data?.totalPages || 1);
      } else {
        const data = await adminFinanceService.getPayments({ page: pageNum, limit: PAGE_SIZE });
        setPayments(Array.isArray(data?.payments) ? data.payments : []);
        setPCounts(data?.counts || null);
        setTotalPages(data?.totalPages || 1);
      }
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { setPage(1); load(1, tab); }, [tab, load]);

  const fmtMoney = (v) => `${Number(v || 0).toLocaleString(language === 'en' ? 'en-US' : 'ru-RU')} ${t('adminFinance.sum')}`;
  const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString(language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU',
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—');

  const markPaid = async () => {
    const w = confirmPaid;
    if (!providerTransactionId.trim() || !providerReference.trim()) {
      toast.error(t('adminFinance.needReference')); return;
    }
    setActing(w.id);
    try {
      await adminFinanceService.processWithdrawal(w.id, 'paid', '', {
        provider: 'manual_bank',
        providerTransactionId: providerTransactionId.trim(),
        providerReference: providerReference.trim(),
      });
      toast.success(t('adminFinance.paid'));
      setConfirmPaid(null);
      setProviderTransactionId(''); setProviderReference('');
      await load(page, 0);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally {
      setActing(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectNote.trim()) { toast.error(t('adminFinance.needNote')); return; }
    setActing(rejectFor.id);
    try {
      const targetStatus = rejectFor.status === 'processing' ? 'failed' : 'cancelled';
      await adminFinanceService.processWithdrawal(rejectFor.id, targetStatus, rejectNote.trim());
      toast.success(t('adminFinance.rejected'));
      setRejectFor(null);
      setRejectNote('');
      await load(page, 0);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally {
      setActing(null);
    }
  };

  const startProcessing = async (withdrawal) => {
    setActing(withdrawal.id);
    try {
      await adminFinanceService.processWithdrawal(withdrawal.id, 'processing');
      await load(page, 0);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally {
      setActing(null);
    }
  };

  const kpi = tab === 0
    ? [
      // «К переводу» — главная цифра: столько денег заморожено в необработанных заявках.
      { icon: <AccountBalanceWallet sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminFinance.toPay'), value: wCounts ? fmtMoney(wCounts.pendingAmount) : '—', bg: axelionColors.accentLight, highlight: (wCounts?.pending || 0) > 0 },
      { icon: <HourglassEmpty sx={{ fontSize: 32, color: axelionColors.warning }} />, label: t('adminFinance.pendingCount'), value: wCounts ? wCounts.pending : '—', bg: axelionColors.bgBeige },
      { icon: <CheckCircle sx={{ fontSize: 32, color: axelionColors.success }} />, label: t('adminFinance.paidCount'), value: wCounts ? wCounts.paid : '—', bg: axelionColors.successLight },
    ]
    : [
      { icon: <ReceiptLong sx={{ fontSize: 32, color: axelionColors.gold }} />, label: t('adminFinance.totalPaid'), value: pCounts ? fmtMoney(pCounts.paidAmount) : '—', bg: axelionColors.accentLight },
      { icon: <CheckCircle sx={{ fontSize: 32, color: axelionColors.success }} />, label: t('adminFinance.payStPaid'), value: pCounts ? pCounts.paid : '—', bg: axelionColors.successLight },
    ];

  return (
    <GlassShell active="/admin/finance" title={t('adminFinance.title')} role="admin">
      <Container maxWidth="xl" disableGutters>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 3 }}>
          <Tab label={t('adminFinance.withdrawalsTab')} />
          <Tab label={t('adminFinance.paymentsTab')} />
        </Tabs>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          {kpi.map((s, i) => (
            <Grid item xs={12} sm={6} lg={4} key={i}>
              <Card sx={{
                background: axelionColors.bgLight,
                border: s.highlight ? `1.5px solid ${axelionColors.warning}` : `1px solid ${axelionColors.borderLight}`,
                borderRadius: '8px', boxShadow: s.highlight ? `0 0 0 3px ${axelionColors.warning}22` : 'none', p: 3,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ width: 56, height: 56, borderRadius: '8px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</Box>
                  <Box>
                    <Typography variant="body2" sx={{ color: axelionColors.textMuted, fontWeight: 500 }} gutterBottom>{s.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 300, color: axelionColors.textDark }}>{s.value}</Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: axelionColors.gold }} /></Box>
        ) : error ? (
          <ErrorState error={error} onRetry={() => load(page, tab)} />
        ) : (
          <Paper sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', overflow: 'auto', boxShadow: 'none' }}>
            {tab === 0 ? (
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: axelionColors.bgCream }}>
                    <TableCell>{t('adminFinance.lawyer')}</TableCell>
                    <TableCell>{t('adminFinance.amount')}</TableCell>
                    <TableCell>{t('adminFinance.date')}</TableCell>
                    <TableCell>{t('adminFinance.status')}</TableCell>
                    <TableCell>{t('adminFinance.note')}</TableCell>
                    <TableCell align="right">{t('adminFinance.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {withdrawals.length === 0 ? (
                    <TableRow><TableCell colSpan={6} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminFinance.emptyWithdrawals')}</TableCell></TableRow>
                  ) : withdrawals.map((w) => {
                    const st = WITHDRAWAL_STATUS[w.status] || WITHDRAWAL_STATUS.pending;
                    return (
                      <TableRow key={w.id} data-testid={`withdrawal-${w.id}`}>
                        <TableCell>
                          <Typography sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{w.lawyer?.name || '—'}</Typography>
                          <Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{w.lawyer?.email}</Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: axelionColors.textDark }}>{fmtMoney(w.amount)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textMuted }}>{fmtDate(w.createdAt)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={t(`adminFinance.${st.key}`)} sx={{ color: st.c, bgcolor: st.bg, fontWeight: 600 }} />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 220, fontSize: 13, color: axelionColors.textSecondary }}>{w.note || '—'}</TableCell>
                        <TableCell align="right">
                          {['pending', 'processing'].includes(w.status) && (
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                              {w.status === 'pending' ? (
                                <Button size="small" variant="outlined" disabled={acting === w.id} onClick={() => startProcessing(w)}
                                  sx={{ color: axelionColors.bronze, borderColor: axelionColors.borderLight, textTransform: 'none' }}>
                                  {t('adminFinance.startProcessing')}
                                </Button>
                              ) : (
                              <Button size="small" variant="outlined" disabled={acting === w.id} onClick={() => { setConfirmPaid(w); setProviderTransactionId(''); setProviderReference(''); }}
                                sx={{ color: axelionColors.success, borderColor: axelionColors.borderLight, textTransform: 'none' }}>
                                {t('adminFinance.markPaid')}
                              </Button>)}
                              <Button size="small" variant="outlined" disabled={acting === w.id} onClick={() => { setRejectFor(w); setRejectNote(''); }}
                                sx={{ color: axelionColors.error, borderColor: axelionColors.borderLight, textTransform: 'none' }}>
                                {t('adminFinance.reject')}
                              </Button>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: axelionColors.bgCream }}>
                    <TableCell>{t('adminFinance.client')}</TableCell>
                    <TableCell>{t('adminFinance.amount')}</TableCell>
                    <TableCell>{t('adminFinance.provider')}</TableCell>
                    <TableCell>{t('adminFinance.date')}</TableCell>
                    <TableCell>{t('adminFinance.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={5} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminFinance.emptyPayments')}</TableCell></TableRow>
                  ) : payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{p.user?.name || '—'}</Typography>
                        <Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{p.user?.email}</Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: axelionColors.textDark }}>{fmtMoney(p.amount)}</TableCell>
                      <TableCell sx={{ fontSize: 13, color: axelionColors.textSecondary }}>{p.provider || '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textMuted }}>{fmtDate(p.createdAt)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={t(`adminFinance.${PAYMENT_STATUS[p.status] || 'payStPending'}`)}
                          sx={{ bgcolor: axelionColors.bgCream, color: axelionColors.textDark, fontWeight: 600 }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        )}

        {!loading && !error && totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination count={totalPages} page={page} onChange={(e, p) => { setPage(p); load(p, tab); }} shape="rounded" />
          </Box>
        )}
      </Container>

      <Dialog open={Boolean(confirmPaid)} onClose={() => setConfirmPaid(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('adminFinance.markPaid')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: axelionColors.textMuted, mb: 2 }}>
            {confirmPaid?.lawyer?.name || ''} · {fmtMoney(confirmPaid?.amount)} — {t('adminFinance.confirmPaid')}
          </Typography>
          <TextField fullWidth label={t('adminFinance.transactionId')} value={providerTransactionId} onChange={(e) => setProviderTransactionId(e.target.value)} sx={{ mb: 2 }} />
          <TextField fullWidth label={t('adminFinance.bankReference')} value={providerReference} onChange={(e) => setProviderReference(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPaid(null)}>{t('common.cancel')}</Button>
          <Button onClick={markPaid} disabled={acting === confirmPaid?.id}>{t('adminFinance.markPaid')}</Button>
        </DialogActions>
      </Dialog>

      {/* Отказ: причина обязательна — она уходит юристу в уведомлении */}
      <Dialog open={Boolean(rejectFor)} onClose={() => setRejectFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('adminFinance.reject')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: axelionColors.textMuted, mb: 2 }}>
            {t('adminFinance.confirmReject')}
          </Typography>
          <TextField
            autoFocus fullWidth multiline rows={3}
            label={t('adminFinance.note')}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectFor(null)}>{t('common.cancel')}</Button>
          <Button onClick={confirmReject} disabled={acting === rejectFor?.id} sx={{ color: axelionColors.error }}>
            {t('adminFinance.reject')}
          </Button>
        </DialogActions>
      </Dialog>
    </GlassShell>
  );
};

export default AdminFinancePage;
