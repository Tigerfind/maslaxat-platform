import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, CircularProgress } from '@mui/material';
import { ShieldOutlined, CheckCircle, ContentCopyOutlined, CloseOutlined } from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { useTranslation } from '../../i18n';

// Управление двухфакторной аутентификацией (TOTP) для юристов/админов.
// Самодостаточный блок: статус + мастер включения (QR → код → резервные коды) + отключение.

const card = {
  background: 'var(--surface)', border: '1px solid var(--card-brd, var(--border))',
  borderRadius: 'var(--radius, 14px)', padding: 22,
};
const goldBtn = {
  background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))', color: '#FFFFFF', border: 'none',
  fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', padding: '10px 20px', borderRadius: 10,
  cursor: 'pointer', fontFamily: 'inherit',
};
const outlineBtn = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
  fontSize: 13, fontWeight: 500, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
};

const TwoFactorSection = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ enabled: false, available: false, loading: true });
  const [dialog, setDialog] = useState(null); // 'setup' | 'backup' | 'disable' | null
  const [setupData, setSetupData] = useState(null); // { qrDataUrl, secret }
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    try {
      const { data } = await api.get('/2fa/status');
      setStatus({ enabled: !!data.enabled, available: !!data.available, loading: false });
    } catch (e) {
      setStatus({ enabled: false, available: false, loading: false });
    }
  };
  useEffect(() => { loadStatus(); }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/2fa/setup');
      setSetupData(data);
      setCode('');
      setDialog('setup');
    } catch (e) {
      toast.error(e.response?.data?.error || t('twofa.errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post('/2fa/enable', { token: code.trim() });
      setBackupCodes(data.backupCodes || []);
      setDialog('backup');
      setStatus((s) => ({ ...s, enabled: true }));
    } catch (e) {
      toast.error(e.response?.data?.error || t('twofa.errCode'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      await api.post('/2fa/disable', { token: code.trim() });
      setStatus((s) => ({ ...s, enabled: false }));
      setDialog(null);
      setCode('');
      toast.success(t('twofa.disabled'));
    } catch (e) {
      toast.error(e.response?.data?.error || t('twofa.errCode'));
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = () => { setDialog(null); setCode(''); setSetupData(null); };
  const copyBackup = () => {
    navigator.clipboard?.writeText(backupCodes.join('\n')).then(
      () => toast.success(t('twofa.copied')),
      () => {}
    );
  };

  if (status.loading || !status.available) return null;

  const inputStyle = {
    width: '100%', padding: '12px 14px', fontSize: 16, letterSpacing: '0.1em', textAlign: 'center',
    borderRadius: 10, border: '1px solid var(--border)', background: 'var(--canvas)', color: 'var(--text)',
    fontFamily: 'inherit', boxSizing: 'border-box',
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(184,149,110,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
          <ShieldOutlined sx={{ fontSize: 20 }} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{t('twofa.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{t('twofa.subtitle')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        {status.enabled ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--success, #5AA06A)', fontWeight: 500 }}>
            <CheckCircle sx={{ fontSize: 18 }} /> {t('twofa.on')}
          </span>
        ) : (
          <span style={{ fontSize: 14, color: 'var(--text3)' }}>{t('twofa.off')}</span>
        )}
        {status.enabled ? (
          <button style={outlineBtn} onClick={() => { setCode(''); setDialog('disable'); }}>{t('twofa.disable')}</button>
        ) : (
          <button style={goldBtn} onClick={startSetup} disabled={busy}>{t('twofa.enable')}</button>
        )}
      </div>

      {/* ── Диалог: настройка (QR + код) ── */}
      <Dialog open={dialog === 'setup'} onClose={closeDialog} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px', background: 'var(--surface)', backgroundImage: 'none' } }}>
        <DialogContent sx={{ p: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{t('twofa.setupTitle')}</div>
            <button onClick={closeDialog} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex' }}><CloseOutlined sx={{ fontSize: 20 }} /></button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t('twofa.setupStep1')}</div>
          {setupData?.qrDataUrl && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <img src={setupData.qrDataUrl} alt="QR" style={{ width: 190, height: 190, borderRadius: 12, border: '1px solid var(--border)' }} />
            </div>
          )}
          {setupData?.secret && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
              {t('twofa.manualKey')}: <code style={{ color: 'var(--text2)', fontSize: 13, letterSpacing: '0.06em' }}>{setupData.secret}</code>
            </div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>{t('twofa.setupStep2')}</div>
          <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} inputMode="numeric" autoFocus />
          <button style={{ ...goldBtn, width: '100%', padding: 12, marginTop: 16 }} onClick={confirmEnable} disabled={busy || !code.trim()}>
            {busy ? t('twofa.checking') : t('twofa.confirmEnable')}
          </button>
        </DialogContent>
      </Dialog>

      {/* ── Диалог: резервные коды ── */}
      <Dialog open={dialog === 'backup'} onClose={closeDialog} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px', background: 'var(--surface)', backgroundImage: 'none' } }}>
        <DialogContent sx={{ p: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--success, #5AA06A)' }}>
            <CheckCircle sx={{ fontSize: 22 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{t('twofa.enabledTitle')}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t('twofa.backupIntro')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {backupCodes.map((c) => (
              <div key={c} style={{ padding: '9px 6px', textAlign: 'center', fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.06em', background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text2)' }}>{c}</div>
            ))}
          </div>
          <button style={{ ...outlineBtn, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }} onClick={copyBackup}>
            <ContentCopyOutlined sx={{ fontSize: 16 }} /> {t('twofa.copyCodes')}
          </button>
          <button style={{ ...goldBtn, width: '100%', padding: 12 }} onClick={closeDialog}>{t('twofa.done')}</button>
        </DialogContent>
      </Dialog>

      {/* ── Диалог: отключение ── */}
      <Dialog open={dialog === 'disable'} onClose={closeDialog} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px', background: 'var(--surface)', backgroundImage: 'none' } }}>
        <DialogContent sx={{ p: 3 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('twofa.disableTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t('twofa.disableIntro')}</div>
          <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={9} autoFocus />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button style={{ ...outlineBtn, flex: 1 }} onClick={closeDialog}>{t('twofa.cancel')}</button>
            <button style={{ ...goldBtn, flex: 1, background: 'var(--error, #B07070)' }} onClick={confirmDisable} disabled={busy || !code.trim()}>
              {busy ? t('twofa.checking') : t('twofa.disable')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TwoFactorSection;
