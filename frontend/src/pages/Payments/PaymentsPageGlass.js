import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Chip, Tab, Tabs, Typography } from '@mui/material';
import { Download, Gavel, ReceiptLong, Refresh } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { cabinetCardSx, formatDateTime, OfflineAlert, PagePagination, PageState } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';

const TABS = ['all', 'pending', 'paid', 'refunds', 'failed'];
const STATUS_COLOR = { paid: 'success', pending: 'warning', failed: 'error', refunded: 'info', refund_pending: 'warning', refund_failed: 'error' };
export const displayStatus = (payment) => {
  if (payment.refundStatus === 'requested') return 'refund_pending';
  if (payment.refundStatus === 'completed') return 'refunded';
  if (payment.refundStatus === 'failed') return 'refund_failed';
  return payment.status || 'pending';
};

const PaymentsPageGlass = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [state, setState] = useState({ loading: true, error: null, payments: [], totalPages: 1 });
  const [busy, setBusy] = useState(null);
  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await clientService.payments.getMy({ status: tab === 'all' ? undefined : tab, page, limit: 15 });
      setState({ loading: false, error: null, payments: data.payments, totalPages: data.totalPages || 1 });
    } catch (error) { setState((current) => ({ ...current, loading: false, error })); }
  };
  useEffect(() => { load(); }, [tab, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (nextTab, nextPage = 1) => setParams({ tab: nextTab, ...(nextPage > 1 ? { page: String(nextPage) } : {}) });
  const refreshStatus = async (id) => { setBusy(id); try { await clientService.payments.getStatus(id); await load(); } catch { toast.error(t('payments.loadError')); } finally { setBusy(null); } };
  const pay = async (payment) => {
    setBusy(payment.id);
    try {
      const result = await clientService.lawyers.payConsultation(payment.consultationId || payment.consultation?.id);
      if (result.redirectUrl) window.location.assign(result.redirectUrl); else await refreshStatus(payment.id);
    } catch (error) { toast.error(error.response?.data?.error || t('common.error')); setBusy(null); }
  };
  const receipt = async (payment) => {
    setBusy(payment.id);
    try {
      const text = await clientService.payments.getReceipt(payment.id);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `receipt-${payment.id}.txt`; anchor.click(); URL.revokeObjectURL(url);
    } catch { toast.error(t('payments.loadError')); } finally { setBusy(null); }
  };

  return <GlassShell active="/payments" title={t('payments.title')} subtitle={t('payments.subtitle')}>
    <Box sx={{ maxWidth: 980, mx: 'auto' }}><OfflineAlert online={online} text={t('cabinet.offline')} />
      <Tabs value={tab} onChange={(_, value) => change(value)} variant="scrollable" scrollButtons="auto" aria-label={t('payments.title')} sx={{ mb: 2 }}>{TABS.map((item) => <Tab value={item} key={item} label={t(`payments.tab_${item}`)} />)}</Tabs>
      <PageState loading={state.loading} error={state.error} onRetry={load} empty={!state.payments.length} emptyIcon={<ReceiptLong />} emptyTitle={t('payments.empty')} emptySubtitle={t('payments.emptySub')}>
        <Box sx={{ display: 'grid', gap: 1.5 }}>{state.payments.map((payment) => {
          const consultation = payment.consultation || payment.Consultation;
          const currentStatus = displayStatus(payment);
          return <Box key={payment.id} sx={{ ...cabinetCardSx, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
            <Gavel sx={{ color: 'var(--accent)' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={600} noWrap>{consultation?.lawyer?.name || payment.description || t('payments.consultation')}</Typography><Typography variant="body2" color="text.secondary">{formatDateTime(payment.createdAt, language)}</Typography><Chip size="small" color={STATUS_COLOR[currentStatus] || 'default'} label={t(`payments.status_${currentStatus}`)} sx={{ mt: .7 }} /></Box>
            <Typography fontWeight={700}>{Number(payment.amount || 0).toLocaleString(language)} {payment.currency || 'UZS'}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>{['pending', 'failed'].includes(payment.status) && (!payment.refundStatus || payment.refundStatus === 'none') && consultation?.status === 'payment_pending' && <Button disabled={busy === payment.id} onClick={() => pay(payment)}>{payment.status === 'failed' ? t('payments.retryPayment') : t('payments.continuePayment')}</Button>}<Button startIcon={<Refresh />} disabled={busy === payment.id} onClick={() => refreshStatus(payment.id)}>{t('payments.checkStatus')}</Button>{payment.status === 'paid' && <Button startIcon={<Download />} disabled={busy === payment.id} onClick={() => receipt(payment)}>{t('payments.receipt')}</Button>}{consultation?.id && <Button onClick={() => navigate(`/consultations/${consultation.id}`)}>{t('cabinet.details')}</Button>}</Box>
          </Box>;
        })}</Box>
        <PagePagination page={page} totalPages={state.totalPages} onChange={(value) => change(tab, value)} label={t('cabinet.pagination')} />
      </PageState>
    </Box>
  </GlassShell>;
};

export default PaymentsPageGlass;
