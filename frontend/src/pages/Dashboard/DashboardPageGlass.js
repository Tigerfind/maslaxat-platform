import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Box, Button, Chip, LinearProgress, Typography } from '@mui/material';
import { AutoAwesome, CalendarMonth, Description, FolderShared, Forum, Payment, PersonSearch, TaskAlt } from '@mui/icons-material';
import GlassShell from '../../components/GlassKit/GlassShell';
import { cabinetCardSx, formatDateTime, OfflineAlert, PageState, WidgetBoundary } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { launchConsultation } from '../../services/meetingLauncher';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';

const countDown = (value, language) => {
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60000);
  return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(minutes < 60 ? minutes : Math.ceil(minutes / 60), minutes < 60 ? 'minute' : 'hour');
};

const DashboardPageGlass = () => {
  const { t, language } = useTranslation();
  const user = useSelector((state) => state.auth.user);
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [state, setState] = useState({ loading: true, data: null, error: null, refreshing: false });
  const [, setClock] = useState(0);

  const load = async (background = false) => {
    setState((s) => ({ ...s, loading: !background, refreshing: background, error: null }));
    try { setState({ loading: false, refreshing: false, data: await clientService.dashboard.getDashboard(), error: null }); }
    catch (error) { setState((s) => ({ ...s, loading: false, refreshing: false, error })); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setInterval(() => setClock((value) => value + 1), 30000); return () => clearInterval(timer); }, []);

  const d = state.data || {};
  const next = d.nextConsultation;
  const metrics = [
    [t('cabinet.pendingPayments'), d.pendingPaymentsCount, '/payments', Payment],
    [t('cabinet.activeCases'), d.activeCasesCount, '/cases', FolderShared],
    [t('cabinet.unreadMessages'), d.unreadMessagesCount, '/messages', Forum],
    [t('cabinet.documentsAttention'), d.documentsAttentionCount, '/documents', Description],
  ];
  const firstName = user?.name?.trim().split(/\s+/)[0] || t('cabinet.client');

  return <GlassShell active="/dashboard" title={t('cabinet.overview')} subtitle={t('cabinet.greeting', { name: firstName })}>
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <OfflineAlert online={online} text={t('cabinet.offline')} />
      {state.refreshing && <LinearProgress aria-label={t('common.loading')} sx={{ mb: 1 }} />}
      <PageState loading={state.loading} error={state.error} onRetry={() => load()}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}><Button onClick={() => load(true)}>{t('common.refresh')}</Button></Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', lg: 'repeat(4,minmax(0,1fr))' }, gap: { xs: 1, sm: 2 }, mb: 2 }}>
          {metrics.map(([label, value, path, Icon]) => <WidgetBoundary key={path} fallback={t('cabinet.widgetError')}><Box component="button" onClick={() => navigate(path)} sx={{ ...cabinetCardSx, minHeight: 118, textAlign: 'left', color: 'var(--text)', cursor: 'pointer' }}><Icon sx={{ color: 'var(--accent)' }} /><Typography variant="h4">{value ?? 0}</Typography><Typography variant="body2" color="text.secondary">{label}</Typography></Box></WidgetBoundary>)}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 2 }}>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={cabinetCardSx}><Typography variant="overline">{t('cabinet.nextConsultation')}</Typography>{next ? <><Typography variant="h6" sx={{ mt: 1 }}>{next.lawyer?.name || next.lawyerName}</Typography><Typography color="text.secondary">{formatDateTime(next.scheduledStartAt || `${next.preferredDate}T${next.preferredTime}`, language)}</Typography>{countDown(next.scheduledStartAt, language) && <Chip label={countDown(next.scheduledStartAt, language)} sx={{ my: 1.5 }} />}<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Button variant="outlined" onClick={() => navigate(`/consultations/${next.id}`)}>{t('cabinet.details')}</Button>{next.access?.canJoin && <Button variant="contained" onClick={() => launchConsultation(next, navigate)}>{t('cabinet.join')}</Button>}</Box></> : <Typography color="text.secondary" sx={{ mt: 1 }}>{t('cabinet.noNextConsultation')}</Typography>}</Box></WidgetBoundary>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={cabinetCardSx}><Typography variant="overline">{t('cabinet.quickActions')}</Typography><Box sx={{ display: 'grid', gap: 1, mt: 1 }}><Button startIcon={<PersonSearch />} onClick={() => navigate('/lawyers')}>{t('cabinet.findLawyer')}</Button><Button startIcon={<AutoAwesome />} onClick={() => navigate('/ai-chat')}>{t('nav.aiChat')}</Button><Button startIcon={<Description />} onClick={() => navigate('/documents')}>{t('cabinet.uploadDocument')}</Button><Button startIcon={<FolderShared />} onClick={() => navigate('/cases')}>{t('cabinet.createCase')}</Button><Button startIcon={<CalendarMonth />} onClick={() => navigate('/consultations')}>{t('nav.consultations')}</Button></Box></Box></WidgetBoundary>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={cabinetCardSx}><Typography variant="overline">{t('cabinet.deadlines')}</Typography>{(d.upcomingDeadlines || []).slice(0, 4).map((x) => <Box key={x.id} sx={{ py: 1, borderBottom: '1px solid var(--border)' }}><Typography>{x.title}</Typography><Typography variant="caption" color="text.secondary">{formatDateTime(x.dueAt || x.date, language)}</Typography></Box>)}{!d.upcomingDeadlines?.length && <Typography color="text.secondary">{t('cabinet.noDeadlines')}</Typography>}<Button onClick={() => navigate('/deadlines')}>{t('cabinet.viewAll')}</Button></Box></WidgetBoundary>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={cabinetCardSx}><Typography variant="overline">{t('cabinet.onboarding')}</Typography>{Object.entries(d.onboarding || {}).map(([key, done]) => <Box key={key} sx={{ display: 'flex', gap: 1, py: .6 }}><TaskAlt color={done ? 'success' : 'disabled'} /><Typography>{t(`onboardingStatus.${key}`)}</Typography></Box>)}{!Object.keys(d.onboarding || {}).length && <Typography color="text.secondary">{t('cabinet.onboardingComplete')}</Typography>}</Box></WidgetBoundary>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={{ ...cabinetCardSx, gridColumn: { md: '1 / -1' } }}><Typography variant="overline">{t('cabinet.recentPayments')}</Typography>{(d.recentPayments || []).slice(0, 4).map((p) => <Box key={p.id} sx={{ py: 1, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}><Typography>{p.description || t('payments.consultation')}</Typography><Typography>{Number(p.amount || 0).toLocaleString(language)} UZS</Typography></Box>)}{!d.recentPayments?.length && <Typography color="text.secondary">{t('payments.empty')}</Typography>}<Button onClick={() => navigate('/payments')}>{t('cabinet.viewAll')}</Button></Box></WidgetBoundary>
          <WidgetBoundary fallback={t('cabinet.widgetError')}><Box sx={{ ...cabinetCardSx, gridColumn: { md: '1 / -1' } }}><Typography variant="overline">{t('nav.documents')}</Typography>{(d.recentDocuments || []).slice(0, 4).map((doc) => <Box key={doc.id} sx={{ py: 1, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}><Typography>{doc.name}</Typography><Typography variant="caption">{formatDateTime(doc.updatedAt || doc.createdAt, language, { dateOnly: true })}</Typography></Box>)}{!d.recentDocuments?.length && <Typography color="text.secondary">{t('documents.emptyTitle')}</Typography>}<Button onClick={() => navigate('/documents')}>{t('cabinet.viewAll')}</Button></Box></WidgetBoundary>
        </Box>
      </PageState>
    </Box>
  </GlassShell>;
};

export default DashboardPageGlass;
