import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Box, Button, Chip, IconButton, Typography } from '@mui/material';
import { Favorite, Gavel, History, Star } from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import BookingModal from '../../components/BookingModal';
import { cabinetCardSx, formatDateTime, OfflineAlert, PagePagination, PageState } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';

const lawyerOf = (entry) => entry.lawyer || entry.Lawyer || entry;

const LawyerCard = ({ entry, favorite, onRemove, onProfile, onBook, t, language }) => {
  const lawyer = lawyerOf(entry);
  const profile = lawyer.profile || {};
  return <Box sx={{ ...cabinetCardSx, display: 'flex', flexDirection: 'column', gap: 1.5, position: 'relative' }}>
    {favorite && <IconButton aria-label={t('cabinet.removeFavorite')} onClick={() => onRemove(lawyer.id)} sx={{ position: 'absolute', right: 10, top: 10 }}><Favorite color="error" /></IconButton>}
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', pr: favorite ? 5 : 0 }}><Avatar src={lawyer.avatar} sx={{ width: 56, height: 56 }}>{lawyer.name?.[0]}</Avatar><Box sx={{ minWidth: 0 }}><Typography variant="h6" noWrap>{lawyer.name}</Typography><Typography variant="body2" color="text.secondary" noWrap>{profile.professionalTitle || lawyer.professionalTitle || profile.specialization || lawyer.specialization || entry.specialization}</Typography></Box></Box>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Chip size="small" icon={<Star />} label={`${profile.rating ?? lawyer.rating ?? 0} · ${profile.reviewsCount ?? lawyer.reviewsCount ?? 0}`} />{Number(profile.experience ?? lawyer.experience) > 0 && <Chip size="small" label={`${profile.experience ?? lawyer.experience} ${t('lawyerProfile.years')}`} />}{(profile.price || lawyer.price || lawyer.priceFrom) > 0 && <Chip size="small" label={`${Number(profile.price || lawyer.price || lawyer.priceFrom).toLocaleString(language)} UZS`} />}</Box>
    {(profile.languages || lawyer.languages)?.length > 0 && <Typography variant="caption" color="text.secondary">{(profile.languages || lawyer.languages).join(', ')}</Typography>}
    {(entry.latestConsultation || entry.lastConsultationAt) && <Typography variant="caption" color="text.secondary">{t('cabinet.latestConsultation')}: {formatDateTime(entry.latestConsultation?.scheduledStartAt || entry.latestConsultation?.createdAt || entry.lastConsultationAt, language)}</Typography>}
    <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}><Button variant="outlined" onClick={() => onProfile(lawyer.id)}>{t('cabinet.profile')}</Button><Button variant="contained" disabled={profile.isAvailable === false || lawyer.isAvailable === false} onClick={() => onBook(lawyer.id, entry.latestConsultation)}>{t('cabinet.bookAgain')}</Button></Box>
  </Box>;
};

const MyLawyersPage = () => {
  const { t, language } = useTranslation(); const navigate = useNavigate(); const online = useOnlineStatus();
  const [page, setPage] = useState(1); const [data, setData] = useState({ favorites: [], lawyers: [], totalPages: 1 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [booking, setBooking] = useState(null); const [bookingBusy, setBookingBusy] = useState(false);
  const load = async () => { setLoading(true); setError(null); try { const [favoritesRaw, history] = await Promise.all([clientService.favorites.getFavorites(), clientService.cabinet.getLawyerHistory({ page, limit: 12 })]); setData({ favorites: Array.isArray(favoritesRaw) ? favoritesRaw : favoritesRaw.favorites || [], lawyers: history.lawyers, totalPages: history.totalPages || 1 }); } catch (e) { setError(e); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (id) => { const old = data.favorites; setData((s) => ({ ...s, favorites: s.favorites.filter((x) => lawyerOf(x).id !== id) })); try { await clientService.favorites.removeFavorite(id); } catch { setData((s) => ({ ...s, favorites: old })); toast.error(t('favorites.removeError')); } };
  const book = async (id, initialConsultation = null) => { setBookingBusy(true); try { const current = await clientService.lawyers.getBookableLawyerDetails(id); if (!current) throw new Error('not-bookable'); setBooking({ lawyer: current, initialConsultation }); } catch { toast.error(t('cabinet.bookingUnavailable')); } finally { setBookingBusy(false); } };
  const renderGrid = (items, favorite) => <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 2 }}>{items.map((x) => <LawyerCard key={lawyerOf(x).id} entry={x} favorite={favorite} onRemove={remove} onProfile={(id) => navigate(`/lawyers/${id}`)} onBook={book} t={t} language={language} />)}</Box>;
  return <GlassShell active="/my-lawyers" title={t('cabinet.myLawyers')} subtitle={t('cabinet.myLawyersSubtitle')}><Box sx={{ maxWidth: 1180, mx: 'auto' }}><OfflineAlert online={online} text={t('cabinet.offline')} /><PageState loading={loading} error={error} onRetry={load} empty={!data.favorites.length && !data.lawyers.length} emptyIcon={<Gavel />} emptyTitle={t('cabinet.noLawyers')} emptySubtitle={t('cabinet.noLawyersHint')}>
    {!!data.favorites.length && <Box component="section" sx={{ mb: 4 }}><Typography variant="h5" sx={{ mb: 2 }}><Favorite sx={{ verticalAlign: 'middle', mr: 1 }} />{t('cabinet.favorites')}</Typography>{renderGrid(data.favorites, true)}</Box>}
    {!!data.lawyers.length && <Box component="section"><Typography variant="h5" sx={{ mb: 2 }}><History sx={{ verticalAlign: 'middle', mr: 1 }} />{t('cabinet.consultedLawyers')}</Typography>{renderGrid(data.lawyers, false)}<PagePagination page={page} totalPages={data.totalPages} onChange={setPage} label={t('cabinet.pagination')} /></Box>}
  </PageState></Box><BookingModal open={!!booking} lawyer={booking?.lawyer || {}} initialConsultation={booking?.initialConsultation || null} onClose={() => setBooking(null)} />{bookingBusy && <Box role="status" sx={{ position: 'fixed', inset: 0, zIndex: 1500, bgcolor: 'rgba(0,0,0,.15)' }} />}</GlassShell>;
};
export default MyLawyersPage;
