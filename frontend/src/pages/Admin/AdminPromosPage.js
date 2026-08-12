import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  Box, Container, IconButton, Button, Switch, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip,
} from '@mui/material';
import { Add, DeleteOutline, EditOutlined } from '@mui/icons-material';
import adminService from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import ErrorState from '../../components/UI/ErrorState';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

const AdminPromosPage = () => {
  const { t, language } = useTranslation();
  // Даты по текущему языку интерфейса: раньше здесь была захардкожена 'ru-RU',
  // и в узбекской/английской версии даты оставались русскими.
  const dateLocale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';

  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ code: '', discountPercent: 10, minAmount: 0, usageLimit: '', expiresAt: '' });
  const [editId, setEditId] = useState(null); // null = создание, иначе id редактируемого промо
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminService.promos.getPromos();
      setPromos(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      // Сервис больше не глотает ошибку — показываем её, а не «промокодов нет».
      setError(e);
      setPromos([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ code: '', discountPercent: 10, minAmount: 0, usageLimit: '', expiresAt: '' });
    setDialogOpen(true);
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setForm({
      code: p.code || '',
      discountPercent: p.discountPercent ?? 10,
      minAmount: p.minAmount ?? 0,
      usageLimit: p.usageLimit ?? '',
      expiresAt: p.expiresAt ? String(p.expiresAt).split('T')[0] : '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editId && !form.code.trim()) { toast.error(t('adminPromo.needCode')); return; }
    // Дата в прошлом создала бы заведомо мёртвый код (бэкенд тоже это отклонит).
    if (form.expiresAt && new Date(form.expiresAt) < new Date(new Date().toDateString())) {
      toast.error(t('adminPromo.expiryPast'));
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        // Код не меняем (идентификатор промо); PATCH правит остальные поля.
        await adminService.promos.update(editId, {
          discountPercent: form.discountPercent,
          minAmount: form.minAmount,
          usageLimit: form.usageLimit,
          expiresAt: form.expiresAt || null,
        });
        toast.success(t('adminPromo.updated'));
      } else {
        await adminService.promos.create(form);
        toast.success(t('adminPromo.created'));
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally { setSaving(false); }
  };

  const toggleActive = async (p) => {
    // Оптимистично переключаем и откатываем при ошибке: раньше при неудачном
    // запросе тумблер оставался в неверном положении до перезагрузки страницы.
    const next = !p.isActive;
    setPromos((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: next } : x)));
    try {
      await adminService.promos.update(p.id, { isActive: next });
    } catch (e) {
      setPromos((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: !next } : x)));
      toast.error(e.response?.data?.error || t('common.error'));
    }
  };

  const remove = async () => {
    const p = confirmDelete;
    setSaving(true);
    try {
      await adminService.promos.remove(p.id);
      setPromos((prev) => prev.filter((x) => x.id !== p.id));
      toast.success(t('adminPromo.deleted'));
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassShell active="/admin/promos" title={t('adminPromo.title')} role="admin">
      <Container maxWidth="lg" disableGutters>
        {/* Кнопка создания жила в собственной шапке страницы — переносим в контент,
            шапку теперь рисует GlassShell. */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button startIcon={<Add />} onClick={openCreate} variant="contained"
            sx={{ bgcolor: axelionColors.gold, boxShadow: 'none', textTransform: 'none', '&:hover': { bgcolor: axelionColors.goldDark, boxShadow: 'none' } }}>
            {t('adminPromo.add')}
          </Button>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: axelionColors.gold }} /></Box>
        ) : error ? (
          <ErrorState error={error} onRetry={load} />
        ) : (
          <Paper sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', overflow: 'hidden', boxShadow: 'none' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: axelionColors.bgCream }}>
                  <TableCell>{t('adminPromo.code')}</TableCell>
                  <TableCell>{t('adminPromo.discount')}</TableCell>
                  <TableCell>{t('adminPromo.minAmount')}</TableCell>
                  <TableCell>{t('adminPromo.used')}</TableCell>
                  <TableCell>{t('adminPromo.expiresAt')}</TableCell>
                  <TableCell>{t('adminPromo.active')}</TableCell>
                  <TableCell align="right">{t('adminPromo.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {promos.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminPromo.empty')}</TableCell></TableRow>
                ) : promos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><Chip label={p.code} sx={{ fontWeight: 600, bgcolor: axelionColors.bgCream }} /></TableCell>
                    <TableCell>−{p.discountPercent}%</TableCell>
                    <TableCell>{(p.minAmount || 0).toLocaleString(dateLocale)}</TableCell>
                    <TableCell>{p.usedCount || 0}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</TableCell>
                    {/* Срок редактировался в форме, но в таблице его не было —
                        нельзя было увидеть, какие коды уже мертвы. */}
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                      {!p.expiresAt ? (
                        <span style={{ color: axelionColors.textMuted }}>{t('adminPromo.noExpiry')}</span>
                      ) : new Date(p.expiresAt) < new Date() ? (
                        <span style={{ color: axelionColors.error, fontWeight: 600 }}>
                          {t('adminPromo.expired')} · {new Date(p.expiresAt).toLocaleDateString(dateLocale)}
                        </span>
                      ) : (
                        <span style={{ color: axelionColors.textSecondary }}>{new Date(p.expiresAt).toLocaleDateString(dateLocale)}</span>
                      )}
                    </TableCell>
                    <TableCell><Switch checked={p.isActive} onChange={() => toggleActive(p)} sx={{ '& .Mui-checked': { color: axelionColors.gold } }} /></TableCell>
                    <TableCell align="right">
                      <IconButton onClick={() => openEdit(p)} size="small" sx={{ color: axelionColors.textMuted }}><EditOutlined /></IconButton>
                      <IconButton onClick={() => setConfirmDelete(p)} size="small" sx={{ color: axelionColors.error }}><DeleteOutline /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Container>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editId ? t('adminPromo.edit') : t('adminPromo.add')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label={t('adminPromo.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} fullWidth disabled={!!editId} helperText={editId ? t('adminPromo.codeLocked') : undefined} />
          <TextField label={t('adminPromo.discountPct')} type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} fullWidth />
          <TextField label={t('adminPromo.minAmount')} type="number" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} fullWidth />
          <TextField label={t('adminPromo.usageLimit')} type="number" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} fullWidth helperText={t('adminPromo.usageLimitHint')} />
          <TextField label={t('adminPromo.expiresAt')} type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} helperText={t('adminPromo.expiresAtHint')} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: axelionColors.textMuted, textTransform: 'none' }}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving} variant="contained" sx={{ bgcolor: axelionColors.gold, boxShadow: 'none', textTransform: 'none', '&:hover': { bgcolor: axelionColors.goldDark } }}>
            {saving ? t('adminPromo.saving') : (editId ? t('adminPromo.saveEdit') : t('adminPromo.save'))}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`${t('adminPromo.deleteConfirm')} ${confirmDelete?.code || ''}?`}
        message={confirmDelete?.usedCount ? `${t('adminPromo.used')}: ${confirmDelete.usedCount}` : ''}
        confirmLabel={t('common.delete')}
        danger
        busy={saving}
        onConfirm={remove}
        onClose={() => setConfirmDelete(null)}
      />
    </GlassShell>
  );
};

export default AdminPromosPage;
