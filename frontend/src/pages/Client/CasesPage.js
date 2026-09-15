import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { Add, Archive, FolderShared, Search } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { cabinetCardSx, formatDateTime, OfflineAlert, PagePagination, PageState, PrimaryButton } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';

export const CASE_STATUSES = ['draft', 'collecting_documents', 'lawyer_review', 'consultation_scheduled', 'in_progress', 'waiting_for_client', 'waiting_for_lawyer', 'resolved', 'closed', 'archived'];
export const CASE_EDITABLE_STATUSES = CASE_STATUSES.filter((status) => status !== 'archived');
const EMPTY = { title: '', description: '', status: 'draft' };

const CasesPage = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState({ loading: true, error: null, cases: [], totalPages: 1 });

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await clientService.cabinet.getCases({ page, limit: 12, search: query || undefined, archived: archived ? 'true' : undefined });
      setState({ loading: false, error: null, cases: data.cases, totalPages: data.totalPages || 1 });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error }));
    }
  };
  useEffect(() => { const timer = setTimeout(load, 300); return () => clearTimeout(timer); }, [page, query, archived]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await clientService.cabinet.createCase(form);
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || t('common.error'));
    } finally { setSaving(false); }
  };
  const archive = async (event, item) => {
    event.stopPropagation();
    try {
      await clientService.cabinet.archiveCase(item.id, !archived);
      setState((current) => ({ ...current, cases: current.cases.filter((entry) => entry.id !== item.id) }));
    } catch { toast.error(t('common.error')); }
  };

  return <GlassShell active="/cases" title={t('cabinet.cases')} subtitle={t('cabinet.casesSubtitle')}>
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <OfflineAlert online={online} text={t('cabinet.offline')} />
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField label={t('common.search')} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} InputProps={{ startAdornment: <Search sx={{ mr: 1 }} /> }} sx={{ flex: 1, minWidth: 220 }} />
        <PrimaryButton startIcon={<Add />} onClick={() => { setForm(EMPTY); setDialogOpen(true); }}>{t('cabinet.newCase')}</PrimaryButton>
        <Button variant={archived ? 'contained' : 'outlined'} onClick={() => { setArchived((value) => !value); setPage(1); }}>{t('caseStatus.archived')}</Button>
      </Box>
      <PageState loading={state.loading} error={state.error} onRetry={load} empty={!state.cases.length} emptyIcon={<FolderShared />} emptyTitle={t('cabinet.noCases')} emptySubtitle={t('cabinet.noCasesHint')}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 2 }}>
          {state.cases.map((item) => <Box component="article" key={item.id} onClick={() => navigate(`/cases/${item.id}`)} sx={{ ...cabinetCardSx, cursor: 'pointer' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}><Typography variant="h6">{item.title}</Typography><Chip size="small" label={t(`caseStatus.${item.status || 'draft'}`)} /></Box>
            <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{item.description || t('cabinet.noDescription')}</Typography>
            <Typography variant="caption" color="text.secondary">{formatDateTime(item.updatedAt, language)}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}><Button onClick={() => navigate(`/cases/${item.id}`)}>{t('cabinet.open')}</Button><Button color="warning" startIcon={<Archive />} onClick={(event) => archive(event, item)}>{archived ? t('consultations.unarchive') : t('cabinet.archive')}</Button></Box>
          </Box>)}
        </Box>
        <PagePagination page={page} totalPages={state.totalPages} onChange={setPage} label={t('cabinet.pagination')} />
      </PageState>
    </Box>
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>{t('cabinet.newCase')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}><TextField autoFocus required label={t('cabinet.caseTitle')} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /><TextField multiline minRows={4} label={t('cabinet.description')} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><TextField select label={t('cabinet.status')} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{CASE_EDITABLE_STATUSES.map((status) => <MenuItem key={status} value={status}>{t(`caseStatus.${status}`)}</MenuItem>)}</TextField></DialogContent>
      <DialogActions><Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button><PrimaryButton disabled={saving || !form.title.trim()} onClick={save}>{t('common.save')}</PrimaryButton></DialogActions>
    </Dialog>
  </GlassShell>;
};

export default CasesPage;
