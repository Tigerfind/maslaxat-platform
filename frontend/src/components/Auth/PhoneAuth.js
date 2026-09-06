import React, { useState } from 'react';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * Вход/регистрация по номеру телефона + одноразовый код (SMS).
 * onSuccess(data) — data = { user, token, role }; вызывается после верификации.
 * В dev (без SMS-провайдера) сервер возвращает devCode — показываем его для теста.
 */
export default function PhoneAuth({ onSuccess }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [needName, setNeedName] = useState(false);
  const [needLegal, setNeedLegal] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/phone/request', { phone });
      setDevCode(res.data?.devCode || '');
      setStep('code');
    } catch (e) {
      setError(e.response?.data?.error || t('phoneAuth.requestErr'));
    } finally { setLoading(false); }
  };

  const verify = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/phone/verify', {
        phone, code, ...(name ? { name } : {}), acceptedTerms, legalVersion: '2026-08-13',
      });
      onSuccess(res.data);
    } catch (e) {
      if (e.response?.data?.needName) {
        setNeedName(true);
        setError(t('phoneAuth.needName'));
      } else if (e.response?.data?.needLegal) {
        setNeedLegal(true);
        setError(t('phoneAuth.needLegal'));
      } else {
        setError(e.response?.data?.error || t('phoneAuth.verifyErr'));
      }
    } finally { setLoading(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '13px 15px', borderRadius: 12, border: `1px solid ${axelionColors.borderLight}`, background: '#fff', color: axelionColors.textDark, fontFamily: 'inherit', fontSize: 15, outline: 'none', marginBottom: 12 };
  const btnStyle = { width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: axelionColors.gold, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 };
  const linkStyle = { background: 'none', border: 'none', color: axelionColors.textMuted, fontSize: 13, marginTop: 10, cursor: 'pointer', fontFamily: 'inherit', width: '100%' };

  if (step === 'phone') {
    return (
      <div>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phoneAuth.phonePlaceholder')} style={inputStyle} />
        {error && <div style={{ color: '#C0492F', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <button onClick={requestCode} disabled={loading || !phone.trim()} style={btnStyle}>{loading ? t('phoneAuth.sending') : t('phoneAuth.getCode')}</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: axelionColors.textMuted, marginBottom: 10 }}>{t('phoneAuth.sentTo')} {phone}</div>
      {devCode && <div style={{ fontSize: 13, color: axelionColors.gold, marginBottom: 10 }}>{t('phoneAuth.devCode')}: <b>{devCode}</b></div>}
      <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={t('phoneAuth.codePlaceholder')} maxLength={6} style={inputStyle} />
      {needName && <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('phoneAuth.namePlaceholder')} style={inputStyle} />}
      {(needName || needLegal) && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: axelionColors.textMuted, marginBottom: 12 }}>
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
          <span>{t('phoneAuth.acceptLegal')} <a href="/terms" target="_blank" rel="noopener noreferrer">{t('phoneAuth.terms')}</a> / <a href="/privacy" target="_blank" rel="noopener noreferrer">{t('phoneAuth.privacy')}</a></span>
        </label>
      )}
      {error && <div style={{ color: needName ? axelionColors.textMuted : '#C0492F', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button onClick={verify} disabled={loading || code.length < 6 || (needName && name.trim().length < 2) || ((needName || needLegal) && !acceptedTerms)} style={btnStyle}>{loading ? t('phoneAuth.checking') : t('phoneAuth.verify')}</button>
      <button onClick={() => { setStep('phone'); setCode(''); setNeedName(false); setNeedLegal(false); setAcceptedTerms(false); setError(''); }} style={linkStyle}>{t('phoneAuth.changeNumber')}</button>
    </div>
  );
}
