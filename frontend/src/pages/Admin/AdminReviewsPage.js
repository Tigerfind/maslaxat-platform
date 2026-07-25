import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Box, Container, Typography, IconButton, CircularProgress, Rating,
  Table, TableBody, TableCell, TableHead, TableRow, Paper, Switch, Chip,
} from '@mui/material';
import { ArrowBack, Star } from '@mui/icons-material';
import adminService from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const AdminReviewsPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setReviews(await adminService.reviews.getReviews());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleHidden = async (review) => {
    const next = !review.isHidden;
    try {
      await adminService.reviews.setHidden(review.id, next);
      setReviews((prev) => prev.map((x) => (x.id === review.id ? { ...x, isHidden: next } : x)));
      toast.success(next ? t('adminReviews.hidden') : t('adminReviews.shown'));
    } catch (e) { toast.error(t('common.error')); }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, pb: 6 }}>
      <Box sx={{ bgcolor: axelionColors.bgLight, borderBottom: `1px solid ${axelionColors.borderLight}`, py: { xs: 2, md: 3 } }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigate('/admin/dashboard')} sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px' }}>
              <ArrowBack sx={{ color: axelionColors.textDark }} />
            </IconButton>
            <Typography sx={{ fontWeight: 300, fontSize: { xs: '1.25rem', md: '1.6rem' }, letterSpacing: '0.08em', textTransform: 'uppercase', color: axelionColors.textDark }}>
              {t('adminReviews.title')}
            </Typography>
          </Box>
          <Typography sx={{ mt: 1, ml: 7, fontSize: 13, color: axelionColors.textMuted }}>
            {t('adminReviews.subtitle')}
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: axelionColors.gold }} /></Box>
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
                        <Switch checked={!review.isHidden} onChange={() => toggleHidden(review)} size="small" sx={{ '& .Mui-checked': { color: axelionColors.gold }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: axelionColors.gold } }} />
                        {review.isHidden && <Chip label={t('adminReviews.hiddenTag')} size="small" sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(196,163,90,0.16)', color: axelionColors.warning }} />}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Container>
    </Box>
  );
};

export default AdminReviewsPage;
