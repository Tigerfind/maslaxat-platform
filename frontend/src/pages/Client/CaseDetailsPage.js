import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { Archive, AttachFile, CalendarMonth, Chat, Edit, EventNote, Gavel, Link } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import BookingModal from '../../components/BookingModal';
import { cabinetCardSx, formatDateTime, OfflineAlert, PageState, PrimaryButton } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import { CASE_EDITABLE_STATUSES } from './CasesPage';

const CaseDetailsPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const online = useOnlineStatus();
  const [state, setState] = useState({ loading: true, error: null, item: null });
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({});
  const [linkType, setLinkType] = useState(null);
  const [linkId, setLinkId] = useState('');
  const [linkOptions, setLinkOptions] = useState([]);
  const [booking, setBooking] = useState(null);

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await clientService.cabinet.getCase(caseId);
      const item = response.case || response;
      setState({ loading: false, error: null, item });
      setForm({ title: item.title || '', description: item.description || '', status: item.status || 'draft' });
    } catch (error) { setState((current) => ({ ...current, loading: false, error })); }
  };
  useEffect(() => { load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => { try { await clientService.cabinet.updateCase(caseId, form); setEditOpen(false); await load(); } catch { toast.error(t('common.error')); } };
  const archive = async () => { try { await clientService.cabinet.archiveCase(caseId, true); navigate('/cases'); } catch { toast.error(t('common.error')); } };
  const openLink = async (type) => {
    setLinkType(type); setLinkId(''); setLinkOptions([]);
    try {
      const data = type === 'consultation' ? await clientService.consultations.getConsultations({ bucket: 'all', limit: 100 }) : await clientService.documents.getDocuments({ limit: 100 });
      setLinkOptions(type === 'consultation' ? data.consultations || [] : data.documents || []);
    } catch { toast.error(t('common.error')); setLinkType(null); }
  };
  const link = async () => { if (!linkId) return; try { await clientService.cabinet.linkCaseItem(caseId, { type: linkType, id: linkId }); setLinkType(null); await load(); } catch { toast.error(t('common.error')); } };
  const unlink = async (type, id) => { try { await clientService.cabinet.unlinkCaseItem(caseId, type, id); await load(); } catch { toast.error(t('common.error')); } };

  const item = state.item;
  const primaryLawyer = item?.lawyer || item?.lawyers?.[0] || null;
  const otherLawyers = (item?.lawyers || []).filter((lawyer) => lawyer.id !== primaryLawyer?.id);
  const timeline = item?.timeline || item?.events || [];
  const conversations = item?.conversations || [];
  const messageCount = typeof item?.messages === 'number' ? item.messages : (item?.messages?.count ?? item?.messagesCount ?? 0);
  const rebook = async () => {
    if (!primaryLawyer?.id) return;
    try {
      const current = await clientService.lawyers.getBookableLawyerDetails(primaryLawyer.id);
      if (!current) throw new Error('not-bookable');
      const latest = (item.consultations || []).find((consultation) => consultation.lawyer?.id === primaryLawyer.id) || null;
      setBooking({ lawyer: current, initialConsultation: latest });
    } catch { toast.error(t('cabinet.bookingUnavailable')); }
  };

  const sections = item ? [
    { key: 'consultations', icon: CalendarMonth, items: item.consultations || [], open: (entry) => navigate(`/consultations/${entry.id}`), unlink: true },
    { key: 'messages', icon: Chat, items: conversations, open: (entry) => navigate(`/consultations/chat/${entry.consultationId}`) },
    { key: 'documents', icon: AttachFile, items: item.documents || [], open: () => navigate('/documents'), unlink: true },
    { key: 'deadlines', icon: EventNote, items: item.deadlines || [], open: () => navigate('/deadlines') },
  ] : [];

  return <GlassShell active="/cases" title={item?.title || t('cabinet.caseDetails')} subtitle={item ? t(`caseStatus.${item.status || 'draft'}`) : ''}>
    <Box sx={{ maxWidth: 1050, mx: 'auto' }}><OfflineAlert online={online} text={t('cabinet.offline')} /><PageState loading={state.loading} error={state.error} onRetry={load}>{item && <>
      <Box sx={{ ...cabinetCardSx, mb: 2 }}><Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}><Box><Typography variant="h5">{item.title}</Typography><Typography color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{item.description || t('cabinet.noDescription')}</Typography></Box><Box sx={{ display: 'flex', gap: 1 }}><Button startIcon={<Edit />} onClick={() => setEditOpen(true)}>{t('common.edit')}</Button><Button color="warning" startIcon={<Archive />} onClick={archive}>{t('cabinet.archive')}</Button></Box></Box></Box>
      {!!otherLawyers.length && <Box sx={{ ...cabinetCardSx, mb: 2 }}><Typography variant="overline">{t('cabinetDetail.caseLawyers')}</Typography>{otherLawyers.map((lawyer) => <Button key={lawyer.id} onClick={() => navigate(`/lawyers/${lawyer.id}`)}>{lawyer.name}</Button>)}</Box>}
      {primaryLawyer && <Box sx={{ ...cabinetCardSx, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}><Gavel color="primary" /><Box sx={{ flex: 1 }}><Typography variant="overline">{t('cabinet.assignedLawyer')}</Typography><Typography variant="h6">{primaryLawyer.name}</Typography></Box><Button onClick={() => navigate(`/lawyers/${primaryLawyer.id}`)}>{t('cabinet.profile')}</Button><PrimaryButton onClick={rebook}>{t('cabinet.bookAgain')}</PrimaryButton></Box>}
      <Box sx={{ ...cabinetCardSx, mb: 2 }}><Typography>{t('cabinet.messages')}: {messageCount} · {t('cabinetDetail.conversations')}: {item.conversationsCount ?? conversations.length}</Typography></Box>
      {!!timeline.length && <Box component="section" sx={{ ...cabinetCardSx, mb: 2 }}><Typography variant="h6">{t('cabinetDetail.timeline')}</Typography>{timeline.map((event) => <Box key={event.id} sx={{ borderLeft: '2px solid var(--accent)', pl: 2, py: 1 }}><Typography>{event.title || t(`caseEvents.${event.eventType || event.type}`)}</Typography><Typography variant="caption" color="text.secondary">{formatDateTime(event.createdAt, language)}</Typography></Box>)}</Box>}
      {sections.map(({ key, icon: Icon, items, open, unlink: canUnlink }) => <Box component="section" key={key} sx={{ ...cabinetCardSx, mb: 2 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><Icon color="primary" /><Typography variant="h6">{t(`cabinet.${key}`)}</Typography>{canUnlink && <Button startIcon={<Link />} sx={{ ml: 'auto' }} onClick={() => openLink(key.slice(0, -1))}>{t('cabinet.linkExisting')}</Button>}</Box>{!items.length ? <Typography color="text.secondary">{t('cabinet.sectionEmpty')}</Typography> : items.map((entry) => <Box key={entry.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderTop: '1px solid var(--border)', gap: 1 }}><Box><Typography>{entry.title || entry.name || entry.question || t(`cabinet.${key}`)}</Typography><Typography variant="caption" color="text.secondary">{formatDateTime(entry.dueAt || entry.scheduledStartAt || entry.createdAt, language)}</Typography></Box><Box><Button onClick={() => open(entry)}>{t('cabinet.open')}</Button>{canUnlink && <Button color="error" onClick={() => unlink(key.slice(0, -1), entry.id)}>{t('cabinetDetail.unlink')}</Button>}</Box></Box>)}</Box>)}
    </>}</PageState></Box>
    <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth><DialogTitle>{t('cabinet.editCase')}</DialogTitle><DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}><TextField required label={t('cabinet.caseTitle')} value={form.title || ''} onChange={(event) => setForm({ ...form, title: event.target.value })} /><TextField multiline minRows={4} label={t('cabinet.description')} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /><TextField select label={t('cabinet.status')} value={form.status || 'draft'} onChange={(event) => setForm({ ...form, status: event.target.value })}>{CASE_EDITABLE_STATUSES.map((status) => <MenuItem key={status} value={status}>{t(`caseStatus.${status}`)}</MenuItem>)}</TextField></DialogContent><DialogActions><Button onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button><PrimaryButton onClick={save}>{t('common.save')}</PrimaryButton></DialogActions></Dialog>
    <Dialog open={!!linkType} onClose={() => setLinkType(null)} fullWidth maxWidth="xs"><DialogTitle>{t('cabinet.linkExisting')}</DialogTitle><DialogContent><TextField select autoFocus fullWidth label={t('cabinet.linkExisting')} value={linkId} onChange={(event) => setLinkId(event.target.value)} sx={{ mt: 1 }}>{linkOptions.map((option) => <MenuItem key={option.id} value={option.id}>{option.title || option.name || option.question || formatDateTime(option.scheduledStartAt || option.createdAt, language)}</MenuItem>)}</TextField></DialogContent><DialogActions><Button onClick={() => setLinkType(null)}>{t('common.cancel')}</Button><PrimaryButton disabled={!linkId} onClick={link}>{t('cabinet.link')}</PrimaryButton></DialogActions></Dialog>
    <BookingModal open={!!booking} lawyer={booking?.lawyer || {}} initialConsultation={booking?.initialConsultation || null} onClose={() => setBooking(null)} />
  </GlassShell>;
};

export default CaseDetailsPage;
