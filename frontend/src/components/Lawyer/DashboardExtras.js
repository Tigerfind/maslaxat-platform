import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, CircularProgress } from '@mui/material';
import {
  PaymentsOutlined, SavingsOutlined, TrendingUpOutlined, ShareOutlined,
  ContentCopyOutlined, ArrowForwardRounded,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';

const card = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)', padding: 22,
};
const head = { fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 };
const sub = { fontSize: 12, color: 'var(--text3)' };
const fmt = (n) => (Number(n) || 0).toLocaleString();

// Слаги чек-листа полноты (из бэкенда) → подписи для «Силы профиля».
const STRENGTH_ITEMS = [
  { key: 'photo', tk: 'dashExtra.sPhoto' },
  { key: 'description', tk: 'dashExtra.sDescription' },
  { key: 'specialization', tk: 'dashExtra.sSpecialization' },
  { key: 'price', tk: 'dashExtra.sPrice' },
  { key: 'schedule', tk: 'dashExtra.sSchedule' },
  { key: 'documents', tk: 'dashExtra.sDocuments' },
];

const DashboardExtras = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((s) => s.auth.user);

  const [balance, setBalance] = useState(null); // { balance, pendingBalance }
  const [checklist, setChecklist] = useState(null); // { complete, missing, verificationStatus }
  const [wdOpen, setWdOpen] = useState(false);
  const [wdAmount, setWdAmount] = useState('');
  const [wdOwner, setWdOwner] = useState('');
  const [wdLastFour, setWdLastFour] = useState('');
  const wdKeyRef = useRef(null);
  const [wding, setWding] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadBalance = () => lawyerService.payments.getBalance().then(setBalance).catch(() => {});
  useEffect(() => {
    loadBalance();
    lawyerService.verification.getChecklist().then(setChecklist).catch(() => {});
  }, []);

  // Сила профиля полностью определяется серверным чек-листом.
  const missing = new Set(checklist?.missing || []);
  const doneItems = STRENGTH_ITEMS.filter((it) => !missing.has(it.key));
  const strength = checklist ? Math.round((doneItems.length / STRENGTH_ITEMS.length) * 100) : 0;
  const todoItems = STRENGTH_ITEMS.filter((it) => missing.has(it.key));

  const profileUrl = `${window.location.origin}/lawyers/${user?.id || ''}`;
  const approved = (checklist?.verificationStatus || '') === 'approved';

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(profileUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard недоступен */ }
  };

  const withdraw = async () => {
    const amt = Number(wdAmount);
    if (!Number.isSafeInteger(amt) || amt < 10000) { toast.error(t('dashExtra.wdInvalid')); return; }
    if (balance && amt > Number(balance.balance)) { toast.error(t('dashExtra.wdTooMuch')); return; }
    if (!wdOwner.trim() || !/^\d{4}$/.test(wdLastFour)) { toast.error(t('dashExtra.wdDestinationInvalid')); return; }
    setWding(true);
    try {
      if (!wdKeyRef.current) wdKeyRef.current = window.crypto.randomUUID();
      const res = await lawyerService.payments.withdraw(amt, {
        ownerName: wdOwner.trim(), accountMask: wdLastFour, method: 'manual_bank',
      }, wdKeyRef.current);
      toast.success(res?.message || t('dashExtra.wdOk'));
      setWdOpen(false); setWdAmount(''); setWdOwner(''); setWdLastFour(''); wdKeyRef.current = null;
      await loadBalance();
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashExtra.wdError'));
    } finally { setWding(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 24 }}>
      {/* Финансы */}
      <div style={card}>
        <div style={head}><PaymentsOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} /> {t('dashExtra.financeTitle')}</div>
        <div style={sub}>{t('dashExtra.available')}</div>
        <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>
          {balance ? fmt(balance.balance) : '—'} <span style={{ fontSize: 14, color: 'var(--text3)', fontWeight: 400 }}>{t('lawyerPanel.sum')}</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', marginTop: 6 }}>
          <SavingsOutlined sx={{ fontSize: 16, color: 'var(--text3)' }} />
          {t('dashExtra.inEscrow')}: <b>{balance ? fmt(balance.pendingBalance) : '—'} {t('lawyerPanel.sum')}</b>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={() => { wdKeyRef.current = window.crypto.randomUUID(); setWdOpen(true); }} disabled={!balance || Number(balance.balance) <= 0}
            style={{ background: (!balance || Number(balance.balance) <= 0) ? 'var(--border-strong)' : 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 600, padding: '10px 18px', borderRadius: 10, cursor: (!balance || Number(balance.balance) <= 0) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {t('dashExtra.withdraw')}
          </button>
          <button onClick={() => navigate('/lawyer/analytics')} style={{ background: 'transparent', border: '1px solid var(--card-brd)', color: 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
            {t('dashExtra.history')}
          </button>
        </div>
      </div>

      {/* Сила профиля */}
      <div style={card}>
        <div style={head}><TrendingUpOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} /> {t('dashExtra.strengthTitle')}</div>
        <div style={sub}>{t('dashExtra.strengthSub')}</div>
        <div style={{ height: 8, borderRadius: 6, background: 'var(--border)', overflow: 'hidden', margin: '12px 0 6px' }}>
          <div style={{ height: '100%', width: `${strength}%`, borderRadius: 6, background: strength >= 100 ? 'linear-gradient(90deg,#77B487,#5AA06A)' : 'linear-gradient(90deg,var(--accent),var(--accent-dark))', transition: 'width .4s' }} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 600 }}>{strength}%{strength >= 100 ? ` · ${t('dashExtra.strengthFull')}` : ''}</div>
        {todoItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
            {todoItems.slice(0, 3).map((it) => (
              <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: 'var(--text)' }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', flexShrink: 0, border: '1.5px solid var(--border-strong)' }} />
                {t(it.tk)}
              </div>
            ))}
            <button onClick={() => navigate('/lawyer/profile/edit')} style={{ alignSelf: 'flex-start', marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: 'var(--accent-dark)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {t('dashExtra.improve')} <ArrowForwardRounded sx={{ fontSize: 15 }} />
            </button>
          </div>
        )}
      </div>

      {/* Поделиться профилем */}
      <div style={card}>
        <div style={head}><ShareOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} /> {t('dashExtra.shareTitle')}</div>
        <div style={sub}>{t('dashExtra.shareSub')}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--card-brd)', borderRadius: 10, padding: '10px 12px', marginTop: 12, wordBreak: 'break-all' }}>
          {profileUrl}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={copyLink} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 600, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
            <ContentCopyOutlined sx={{ fontSize: 16 }} /> {copied ? t('dashExtra.copied') : t('dashExtra.copy')}
          </button>
        </div>
        {!approved && (
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10 }}>{t('dashExtra.shareAfterApprove')}</div>
        )}
      </div>

      {/* Диалог вывода */}
      <Dialog open={wdOpen} onClose={() => setWdOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PaymentsOutlined sx={{ color: 'var(--accent)' }} /> {t('dashExtra.withdraw')}
        </DialogTitle>
        <DialogContent dividers>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            {t('dashExtra.available')}: <b>{balance ? fmt(balance.balance) : '—'} {t('lawyerPanel.sum')}</b>
          </div>
          <TextField fullWidth type="number" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)}
            placeholder={t('dashExtra.wdPlaceholder')} inputProps={{ min: 0 }} autoFocus />
          <TextField fullWidth value={wdOwner} onChange={(e) => setWdOwner(e.target.value)}
            label={t('dashExtra.wdOwner')} sx={{ mt: 2 }} inputProps={{ maxLength: 120 }} />
          <TextField fullWidth value={wdLastFour} onChange={(e) => setWdLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
            label={t('dashExtra.wdLastFour')} sx={{ mt: 2 }} inputProps={{ inputMode: 'numeric', maxLength: 4 }} />
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 10 }}>{t('dashExtra.wdNote')}</div>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setWdOpen(false)} sx={{ textTransform: 'none', color: 'var(--text2)' }}>{t('dashExtra.cancel')}</Button>
          <Button onClick={withdraw} disabled={wding} variant="contained"
            sx={{ textTransform: 'none', background: 'var(--accent)', '&:hover': { background: 'var(--accent-dark)' } }}>
            {wding ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : t('dashExtra.wdConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default DashboardExtras;
