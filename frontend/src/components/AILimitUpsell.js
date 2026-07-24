import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AutoAwesomeRounded,
  CheckRounded,
  CloseRounded,
  WorkspacePremiumOutlined,
  BoltRounded,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import clientService from '../services/clientService';
import { useTranslation } from '../i18n';

/**
 * Красивый апселл при исчерпании дневного лимита бесплатных AI-запросов (3/день).
 * Показывается поверх AI-чата на 429. В dev — тест-оплата подписки, в проде — Payme (Фаза 6).
 */
const AILimitUpsell = ({ open, onClose, onUpgraded }) => {
  const { t } = useTranslation();
  const [loadingPlan, setLoadingPlan] = useState(null);

  if (!open) return null;

  const PLANS = [
    {
      key: 'basic',
      price: 99000,
      accent: false,
      perks: [t('aiLimit.perkUnlimited'), t('aiLimit.perkBasicConsult'), t('aiLimit.perkDocs')],
    },
    {
      key: 'pro',
      price: 299000,
      accent: true,
      perks: [t('aiLimit.perkUnlimited'), t('aiLimit.perkProConsult'), t('aiLimit.perkPriority'), t('aiLimit.perkDocs')],
    },
  ];

  const handleUpgrade = async (plan) => {
    setLoadingPlan(plan);
    try {
      const res = await clientService.subscription.upgrade(plan);
      toast.success(res.message || t('aiLimit.success'));
      onUpgraded && onUpgraded(plan);
      onClose && onClose();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 501) {
        toast.info(t('aiLimit.paymeSoon'));
      } else {
        toast.error(err?.response?.data?.error || t('aiLimit.error'));
      }
    } finally {
      setLoadingPlan(null);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(28, 22, 16, 0.55)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: 'upsellFade .25s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 560,
          background: 'var(--card-glass, rgba(255,252,247,0.92))',
          backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border: '1px solid var(--card-brd, rgba(184,149,110,0.28))',
          borderRadius: 24, boxShadow: '0 24px 70px rgba(60,40,20,0.28)',
          padding: '34px 28px 26px', animation: 'upsellRise .3s cubic-bezier(.22,1,.36,1)',
          maxHeight: '92vh', overflowY: 'auto',
        }}
      >
        <button onClick={onClose} aria-label="close" style={{
          position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: '50%',
          border: 'none', background: 'rgba(120,90,60,0.10)', color: 'var(--text3, #8a7a66)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CloseRounded sx={{ fontSize: 19 }} />
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 66, height: 66, margin: '0 auto 16px', borderRadius: 20,
            background: 'linear-gradient(135deg, #C9A15E 0%, #A6844F 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 10px 26px rgba(166,132,79,0.42)',
          }}>
            <BoltRounded sx={{ fontSize: 34, color: '#fff' }} />
          </div>
          <div style={{ fontSize: 21, fontWeight: 600, color: 'var(--text, #3a2f22)', marginBottom: 8, letterSpacing: '-0.01em' }}>
            {t('aiLimit.title')}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text3, #8a7a66)', maxWidth: 400, margin: '0 auto' }}>
            {t('aiLimit.subtitle')}
          </div>
        </div>

        {/* Plans */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 14 }}>
          {PLANS.map((p) => (
            <div key={p.key} style={{
              position: 'relative', borderRadius: 18, padding: '20px 18px',
              background: p.accent ? 'linear-gradient(160deg, rgba(201,161,94,0.14), rgba(201,161,94,0.05))' : 'rgba(120,90,60,0.05)',
              border: p.accent ? '1.5px solid var(--accent, #C9A15E)' : '1px solid rgba(120,90,60,0.14)',
            }}>
              {p.accent && (
                <div style={{
                  position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                  background: 'linear-gradient(135deg, #C9A15E, #A6844F)', color: '#fff',
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '4px 12px', borderRadius: 20, whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(166,132,79,0.4)',
                }}>
                  {t('aiLimit.popular')}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {p.accent
                  ? <WorkspacePremiumOutlined sx={{ fontSize: 20, color: 'var(--accent, #C9A15E)' }} />
                  : <AutoAwesomeRounded sx={{ fontSize: 19, color: 'var(--text3, #8a7a66)' }} />}
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #3a2f22)' }}>
                  {t('aiLimit.plan_' + p.key)}
                </span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text, #3a2f22)' }}>
                  {p.price.toLocaleString('ru-RU')}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text3, #8a7a66)' }}> {t('aiLimit.perMonth')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
                {p.perks.map((perk, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text2, #5c4f3d)', lineHeight: 1.4 }}>
                    <CheckRounded sx={{ fontSize: 16, color: 'var(--accent, #C9A15E)', flexShrink: 0, mt: '1px' }} />
                    <span>{perk}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => handleUpgrade(p.key)}
                disabled={loadingPlan !== null}
                style={{
                  width: '100%', padding: '11px', borderRadius: 12, border: 'none', cursor: loadingPlan ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  color: p.accent ? '#fff' : 'var(--accent-dark, #8B7355)',
                  background: p.accent ? 'linear-gradient(135deg, #C9A15E, #A6844F)' : 'rgba(184,149,110,0.14)',
                  opacity: loadingPlan && loadingPlan !== p.key ? 0.5 : 1,
                  transition: 'transform .12s ease, box-shadow .12s ease',
                  boxShadow: p.accent ? '0 8px 20px rgba(166,132,79,0.34)' : 'none',
                }}
              >
                {loadingPlan === p.key ? t('aiLimit.processing') : t('aiLimit.choose')}
              </button>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{
          display: 'block', margin: '18px auto 0', background: 'none', border: 'none',
          color: 'var(--text3, #8a7a66)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline',
        }}>
          {t('aiLimit.later')}
        </button>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--text3, #a89a86)' }}>
          {t('aiLimit.resetHint')}
        </div>
      </div>

      <style>{`
        @keyframes upsellFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes upsellRise { from { opacity: 0; transform: translateY(16px) scale(.97) } to { opacity: 1; transform: none } }
      `}</style>
    </div>,
    document.body
  );
};

export default AILimitUpsell;
