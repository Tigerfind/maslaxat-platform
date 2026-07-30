import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Box, Container, Typography, IconButton, CircularProgress, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Paper, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip,
} from '@mui/material';
import { ArrowBack, ReplyOutlined } from '@mui/icons-material';
import adminService from '../../services/adminService';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const STATUS_COLOR = {
  open: { c: axelionColors.warning, bg: 'rgba(196,163,90,0.16)' },
  in_progress: { c: axelionColors.gold, bg: 'rgba(184,149,110,0.16)' },
  closed: { c: axelionColors.success, bg: 'rgba(122,154,107,0.16)' },
};

const AdminSupportPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyTicket, setReplyTicket] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    setTickets(await adminService.support.getTickets());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const changeStatus = async (ticket, status) => {
    try {
      await adminService.support.updateStatus(ticket.id, status);
      setTickets((prev) => prev.map((x) => (x.id === ticket.id ? { ...x, status } : x)));
      toast.success(t('adminSupport.statusChanged'));
    } catch (e) { toast.error(t('common.error')); }
  };

  const openReply = (ticket) => {
    setReplyTicket(ticket);
    setReplyText(ticket.response || '');
  };

  const sendReply = async () => {
    if (!replyText.trim()) { toast.error(t('adminSupport.needReply')); return; }
    setSending(true);
    try {
      const res = await adminService.support.reply(replyTicket.id, replyText.trim());
      const updated = res?.ticket || { ...replyTicket, response: replyText.trim(), status: 'closed' };
      setTickets((prev) => prev.map((x) => (x.id === replyTicket.id ? { ...x, response: updated.response, respondedAt: updated.respondedAt, status: updated.status } : x)));
      toast.success(t('adminSupport.replySent'));
      setReplyTicket(null);
    } catch (e) {
      toast.error(e.response?.data?.error || t('common.error'));
    } finally { setSending(false); }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, pb: 6 }}>
      <Box sx={{ bgcolor: axelionColors.bgLight, borderBottom: `1px solid ${axelionColors.borderLight}`, py: { xs: 2, md: 3 } }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigate('/admin/dashboard')} sx={{ border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px' }}>
              <ArrowBack sx={{ color: axelionColors.textDark }} />
            </IconButton>
            <Typography sx={{ fontWeight: 300, fontSize: { xs: '1.25rem', md: '1.6rem' }, letterSpacing: '0.08em', textTransform: 'uppercase', color: axelionColors.textDark }}>
              {t('adminSupport.title')}
            </Typography>
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
                  <TableCell>{t('adminSupport.user')}</TableCell>
                  <TableCell>{t('adminSupport.subject')}</TableCell>
                  <TableCell>{t('adminSupport.message')}</TableCell>
                  <TableCell>{t('adminSupport.date')}</TableCell>
                  <TableCell>{t('adminSupport.status')}</TableCell>
                  <TableCell>{t('adminSupport.response')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ color: axelionColors.textMuted, py: 4 }}>{t('adminSupport.empty')}</TableCell></TableRow>
                ) : tickets.map((ticket) => {
                  const sc = STATUS_COLOR[ticket.status] || STATUS_COLOR.open;
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, color: axelionColors.textDark }}>{ticket.user?.name || '—'}</Typography>
                        <Typography sx={{ fontSize: 12, color: axelionColors.textMuted }}>{ticket.user?.email}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 180 }}>{ticket.subject}</TableCell>
                      <TableCell sx={{ maxWidth: 320, fontSize: 13, color: axelionColors.textSecondary }}>{ticket.message}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13, color: axelionColors.textMuted }}>{fmtDate(ticket.createdAt)}</TableCell>
                      <TableCell>
                        <Select
                          size="small"
                          value={ticket.status}
                          onChange={(e) => changeStatus(ticket, e.target.value)}
                          sx={{ fontSize: 13, color: sc.c, bgcolor: sc.bg, borderRadius: 2, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}
                        >
                          <MenuItem value="open">{t('adminSupport.stOpen')}</MenuItem>
                          <MenuItem value="in_progress">{t('adminSupport.stProgress')}</MenuItem>
                          <MenuItem value="closed">{t('adminSupport.stClosed')}</MenuItem>
                        </Select>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {ticket.response ? (
                            <Typography sx={{ fontSize: 12.5, color: axelionColors.textSecondary, flex: 1, whiteSpace: 'pre-wrap' }}>{ticket.response}</Typography>
                          ) : (
                            <Typography sx={{ fontSize: 12.5, color: axelionColors.textMuted, flex: 1 }}>{t('adminSupport.noReply')}</Typography>
                          )}
                          <Tooltip title={ticket.response ? t('adminSupport.editReply') : t('adminSupport.reply')}>
                            <IconButton size="small" onClick={() => openReply(ticket)} sx={{ color: axelionColors.gold }}>
                              <ReplyOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Container>

      {/* Диалог ответа автору обращения */}
      <Dialog open={!!replyTicket} onClose={() => !sending && setReplyTicket(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('adminSupport.replyTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {replyTicket && (
            <Box sx={{ bgcolor: axelionColors.bgCream, borderRadius: 2, p: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: axelionColors.textMuted, mb: 0.5 }}>
                {replyTicket.user?.name} · {replyTicket.subject}
              </Typography>
              <Typography sx={{ fontSize: 13.5, color: axelionColors.textDark, whiteSpace: 'pre-wrap' }}>{replyTicket.message}</Typography>
            </Box>
          )}
          <TextField
            label={t('adminSupport.replyLabel')}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            placeholder={t('adminSupport.replyPlaceholder')}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReplyTicket(null)} disabled={sending} sx={{ color: axelionColors.textMuted, textTransform: 'none' }}>{t('common.cancel')}</Button>
          <Button onClick={sendReply} disabled={sending} variant="contained" sx={{ bgcolor: axelionColors.gold, boxShadow: 'none', textTransform: 'none', '&:hover': { bgcolor: axelionColors.goldDark } }}>
            {sending ? t('adminSupport.sending') : t('adminSupport.sendReply')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminSupportPage;
