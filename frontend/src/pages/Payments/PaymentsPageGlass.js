import React, { useState, useEffect } from 'react';
import {
  GavelOutlined,
  WorkspacePremiumOutlined,
  ReceiptLongOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const STATUS = {
  paid: { key: 'statusPaid', color: '#7A9A6B', bg: 'rgba(122,154,107,0.14)' },
  pending: { key: 'statusPending', color: '#C4A35A', bg: 'rgba(196,163,90,0.14)' },
  failed: { key: 'statusFailed', color: '#B07070', bg: 'rgba(176,112,112,0.14)' },
  refunded: { key: 'statusRefunded', color: '#6A8A9A', bg: 'rgba(106,138,154,0.14)' },
};

const PaymentsPageGlass = () => {
  const { t } = useTranslation();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await clientService.payments.getMy();
        setPayments(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.toLocaleDateString('ru-RU')} · ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const renderCard = (p) => {
    const st = STATUS[p.status] || STATUS.pending;
    const isSub = p.providerResponse && p.providerResponse.subscription;
    const consultation = p.Consultation;
    const lawyerName = consultation?.lawyer?.name;
    const title = isSub
      ? `${t('payments.subscription')} · ${p.providerResponse.subscription.toUpperCase()}`
      : `${t('payments.consultation')}${lawyerName ? ' · ' + lawyerName : ''}`;
    const Icon = isSub ? WorkspacePremiumOutlined : GavelOutlined;

    return (
      <div key={p.id} style={{ ...glassCard, padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 46, height: 46, flexShrink: 0, borderRadius: 12,
          background: 'rgba(184,149,110,0.14)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon sx={{ fontSize: 22 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>{fmtDate(p.createdAt)}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            {(p.amount || 0).toLocaleString('ru-RU')} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text3)' }}>{t('payments.sum')}</span>
          </div>
          <span style={{
            display: 'inline-block', marginTop: 5, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: st.color, background: st.bg, padding: '3px 9px', borderRadius: 12,
          }}>
            {t('payments.' + st.key)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <GlassShell active="/payments" title={t('payments.title')} subtitle={t('payments.subtitle')}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {loading ? (
          <div style={{ ...glassCard, padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            {t('common.loading')}
          </div>
        ) : error ? (
          <div style={{ ...glassCard, padding: 40, textAlign: 'center', color: '#B07070', fontSize: 14 }}>
            {t('payments.loadError')}
          </div>
        ) : payments.length === 0 ? (
          <div style={{ ...glassCard, padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: '50%', background: 'rgba(184,149,110,0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ReceiptLongOutlined sx={{ fontSize: 30 }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>{t('payments.empty')}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('payments.emptySub')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {payments.map(renderCard)}
          </div>
        )}
      </div>
    </GlassShell>
  );
};

export default PaymentsPageGlass;
