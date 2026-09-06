import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  Box, Container, CircularProgress, Rating,
  Table, TableBody, TableCell, TableHead, TableRow, Paper, Switch, Chip, Pagination,
} from '@mui/material';
import { Star } from '@mui/icons-material';
import adminService from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import ErrorState from '../../components/UI/ErrorState';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

const PAGE_SIZE = 25;

const AdminReviewsPage = () => {
  const { t, language } = useTranslation();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [acting, setActing] = useState(null);

  const load = async (pageNum = 1) => {
    setLoading(true);
    try {
      const data = await adminService.reviews.getReviews({ page: pageNum, limit: PAGE_SIZE });
      // Бэкенд теперь отдаёт объект с пагинацией; массив — старый формат.
      setReviews(Array.isArray(data?.reviews) ? data.reviews : (Array.isArray(data) ? data : []));
      setTotalPages(data?.totalPages || 1);
      setError(null);
    } catch (e) {
      setError(e);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(1); }, []);

  // Скрытие тянет пересчёт рейтинга юриста на бэкенде — случайный клик по
  // переключателю менял публичный рейтинг без спроса. Теперь через подтверждение.
  const toggleHidden = async () => {
    const review = confirmToggle;
    const next = !review.isHidden;
    setActing(review.id);
    try {
      await adminService.reviews.setHidden(review.id, next);
      setReviews((prev) => prev.map((x) => (x.id === review.id ? { ...x, isHidden: next } : x)));
      toast.success(next ? t('adminReviews.hidden') : t('adminReviews.shown'));
      setConfirmToggle(null);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally {
      setActing(null);
    }
  };

  // Даты по текущему языку интерфейса: раньше здесь была захардкожена 'ru-RU',
  // и в узбекской/английской версии даты оставались русскими.
  const dateLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <GlassShell active="/admin/reviews" title={t('adminReviews.title')} subtitle={t('adminReviews.subtitle')} role="admin">
      <Container maxWidth="lg" disableGutters>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: axelionColors.gold }} /></Box>
        ) : error ? (
          <ErrorState error={error} onRetry={() => load(page)} />
        ) : (
          <Paper sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', overflow: 'hidden', boxShadow: 'none' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: axelionColors.bgCream }}>
                  <TableCell>{t('adminReviews.lawyer')}</TableCell>
                  <TableCell>{t('adminReviews.client')}</TableCell>
                  <TableCell>{t('adminReviews.rating')}</TableCell>
                  <TableCell>{t('adminReviews.text')}</TableCell>
                  <TableCell>{t('adminReviews.date')}</TableCell>
                  <TableCell align="center">{t('adminReviews.visible')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reviews.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminReviews.empty')}</TableCell></TableRow>
                ) : reviews.map((review) => (
                  <TableRow key={review.id} sx={review.isHidden ? { opacity: 0.55, bgcolor: 'rgba(0,0,0,0.02)' } : {}}>
                    <TableCell sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{review.lawyer?.name || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 13, color: axelionColors.textSecondary }}>{review.client?.name || '—'}</TableCell>
                    <TableCell>
                      <Rating value={review.rating} readOnly size="small" emptyIcon={<Star fontSize="inherit" sx={{ opacity: 0.25 }} />} sx={{ color: axelionColors.gold }} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 340, fontSize: 13, color: axelionColors.textSecondary }}>{review.text || <em style={{ color: axelionColors.textMuted }}>{t('adminReviews.noText')}</em>}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textMuted }}>{fmtDate(review.createdAt)}</TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <Switch checked={!review.isHidden} onChange={() => setConfirmToggle(review)} size="small" sx={{ '& .Mui-checked': { color: axelionColors.gold }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: axelionColors.gold } }} />
                        {review.isHidden && <Chip label={t('adminReviews.hiddenTag')} size="small" sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(196,163,90,0.16)', color: axelionColors.warning }} />}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}

        {!loading && !error && totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination count={totalPages} page={page} onChange={(e, p) => { setPage(p); load(p); }} shape="rounded" />
          </Box>
        )}
      </Container>

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={confirmToggle?.isHidden ? t('adminReviews.confirmShowTitle') : t('adminReviews.confirmHideTitle')}
        message={confirmToggle?.isHidden ? t('adminReviews.confirmShowMsg') : t('adminReviews.confirmHideMsg')}
        confirmLabel={confirmToggle?.isHidden ? t('adminReviews.show') : t('adminReviews.hide')}
        danger={!confirmToggle?.isHidden}
        busy={acting === confirmToggle?.id}
        onConfirm={toggleHidden}
        onClose={() => setConfirmToggle(null)}
      />
    </GlassShell>
  );
};

export default AdminReviewsPage;
