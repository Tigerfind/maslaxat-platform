import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Box, Container, Typography, IconButton, Button, Switch, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip,
} from '@mui/material';
import { ArrowBack, Add, DeleteOutline, EditOutlined } from '@mui/icons-material';
import adminService from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const AdminPromosPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ code: '', discountPercent: 10, minAmount: 0, usageLimit: '', expiresAt: '' });
  const [editId, setEditId] = useState(null); // null = создание, иначе id редактируемого промо
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setPromos(await adminService.promos.getPromos());
    setLoading(false);
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
    try {
      await adminService.promos.update(p.id, { isActive: !p.isActive });
      setPromos((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: !x.isActive } : x)));
    } catch (e) { toast.error(t('common.error')); }
  };

  const remove = async (p) => {
    if (!window.confirm(`${t('adminPromo.deleteConfirm')} ${p.code}?`)) return;
    try {
      await adminService.promos.remove(p.id);
      setPromos((prev) => prev.filter((x) => x.id !== p.id));
      toast.success(t('adminPromo.deleted'));
    } catch (e) { toast.error(t('common.error')); }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, pb: 6 }}>
      <Box sx={{ bgcolor: axelionColors.bgLight, borderBottom: `1px solid ${axelionColors.borderLight}`, py: { xs: 2, md: 3 } }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton onClick={() => navigate('/admin/dashboard')} sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px' }}>
                <ArrowBack sx={{ color: axelionColors.textDark }} />
              </IconButton>
              <Typography sx={{ fontWeight: 300, fontSize: { xs: '1.25rem', md: '1.6rem' }, letterSpacing: '0.08em', textTransform: 'uppercase', color: axelionColors.textDark }}>
                {t('adminPromo.title')}
              </Typography>
            </Box>
            <Button startIcon={<Add />} onClick={openCreate} variant="contained"
              sx={{ bgcolor: axelionColors.gold, boxShadow: 'none', textTransform: 'none', '&:hover': { bgcolor: axelionColors.goldDark, boxShadow: 'none' } }}>
              {t('adminPromo.add')}
            </Button>
          </Box>
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
                  <TableCell>{t('adminPromo.code')}</TableCell>
                  <TableCell>{t('adminPromo.discount')}</TableCell>
                  <TableCell>{t('adminPromo.minAmount')}</TableCell>
                  <TableCell>{t('adminPromo.used')}</TableCell>
                  <TableCell>{t('adminPromo.active')}</TableCell>
                  <TableCell align="right">{t('adminPromo.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {promos.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminPromo.empty')}</TableCell></TableRow>
                ) : promos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><Chip label={p.code} sx={{ fontWeight: 600, bgcolor: axelionColors.bgCream }} /></TableCell>
                    <TableCell>−{p.discountPercent}%</TableCell>
                    <TableCell>{(p.minAmount || 0).toLocaleString('ru-RU')}</TableCell>
                    <TableCell>{p.usedCount || 0}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</TableCell>
                    <TableCell><Switch checked={p.isActive} onChange={() => toggleActive(p)} sx={{ '& .Mui-checked': { color: axelionColors.gold } }} /></TableCell>
                    <TableCell align="right">
                      <IconButton onClick={() => openEdit(p)} size="small" sx={{ color: axelionColors.textMuted }}><EditOutlined /></IconButton>
                      <IconButton onClick={() => remove(p)} size="small" sx={{ color: axelionColors.error }}><DeleteOutline /></IconButton>
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
    </Box>
  );
};

export default AdminPromosPage;
