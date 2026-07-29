import React, { useState, useEffect } from 'react';
import {
  PaymentsOutlined,
  StarOutlineRounded,
  AccountBalanceWalletOutlined,
  TrendingUpOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
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

const MONTHS_SHORT = {
  ru: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  uz: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const fmtMoney = (n) => (Number(n) || 0).toLocaleString('ru-RU');

const LawyerAnalyticsPage = () => {
  const { t, language } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await lawyerService.dashboard.getAnalytics();
      setData(res);
    } catch (e) {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openWithdraw = () => {
    setWithdrawAmount(String(Math.floor(Number(data?.balance) || 0)));
    setWithdrawOpen(true);
  };

  const submitWithdraw = async () => {
    const amt = Number(withdrawAmount);
    const bal = Number(data?.balance) || 0;
    if (!Number.isFinite(amt) || amt <= 0 || amt > bal) {
      toast.error(t('analytics.withdrawInvalid'));
      return;
    }
    setWithdrawing(true);
    try {
      const res = await lawyerService.payments.withdraw(amt);
      toast.success(res?.message || t('analytics.withdrawOk'));
      setWithdrawOpen(false);
      await load(); // обновить баланс
    } catch (e) {
      toast.error(e.response?.data?.error || t('analytics.withdrawErr'));
    } finally {
      setWithdrawing(false);
    }
  };

  const monthLabel = (key) => {
    const m = parseInt(String(key).split('-')[1], 10) - 1;
    return (MONTHS_SHORT[language] || MONTHS_SHORT.ru)[m] || key;
  };

  const kpi = (icon, label, value, sub, color) => (
    <div style={{ ...glassCard, padding: 20, flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: color.bg, color: color.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--text3)', letterSpacing: '0.02em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 23, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  const income = data?.monthlyIncome || [];
  const maxIncome = Math.max(1, ...income.map((m) => m.income));
  const funnel = data?.funnel || {};
  const rb = data?.ratingBreakdown || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  const maxRb = Math.max(1, ...Object.values(rb));

  return (
    <GlassShell active="/lawyer/analytics" title={t('analytics.title')} subtitle={t('analytics.subtitle')} role="lawyer">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {loading ? (
          <div style={{ ...glassCard, padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>{t('common.loading')}</div>
        ) : !data ? (
          <div style={{ ...glassCard, padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>{t('analytics.noData')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* KPI row */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {kpi(<PaymentsOutlined sx={{ fontSize: 20 }} />, t('analytics.totalIncome'), `${fmtMoney(data.totalIncome)}`, t('analytics.sum6mo'), { bg: 'rgba(122,154,107,0.14)', fg: '#7A9A6B' })}
              {kpi(<StarOutlineRounded sx={{ fontSize: 21 }} />, t('analytics.avgRating'), data.avgRating || '—', `${data.totalReviews} ${t('analytics.reviews')}`, { bg: 'rgba(196,163,90,0.16)', fg: '#C4A35A' })}
              {kpi(<AccountBalanceWalletOutlined sx={{ fontSize: 20 }} />, t('analytics.balance'), `${fmtMoney(data.balance)}`, `${t('analytics.pending')}: ${fmtMoney(data.pendingBalance)}`, { bg: 'rgba(184,149,110,0.16)', fg: 'var(--accent)' })}
            </div>

            {/* Вывод средств */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>
                {t('analytics.withdrawHint')}
              </span>
              <button
                onClick={openWithdraw}
                disabled={(Number(data.balance) || 0) <= 0}
                style={{
                  background: (Number(data.balance) || 0) > 0 ? 'var(--accent)' : 'var(--canvas)',
                  color: (Number(data.balance) || 0) > 0 ? '#fff' : 'var(--text3)',
                  border: `1px solid ${(Number(data.balance) || 0) > 0 ? 'var(--accent)' : 'var(--border)'}`,
                  fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
                  padding: '11px 22px', borderRadius: 'var(--radius)', fontFamily: 'inherit',
                  cursor: (Number(data.balance) || 0) > 0 ? 'pointer' : 'default',
                }}
              >
                {t('analytics.withdraw')}
              </button>
            </div>

            {/* Monthly income chart */}
            <div style={{ ...glassCard, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <TrendingUpOutlined sx={{ fontSize: 19, color: 'var(--accent)' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{t('analytics.monthlyIncome')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, height: 190 }}>
                {income.map((m) => {
                  const h = Math.round((m.income / maxIncome) * 150);
                  return (
                    <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {m.income > 0 ? fmtMoney(m.income) : ''}
                      </div>
                      <div title={`${fmtMoney(m.income)} · ${m.count}`} style={{
                        width: '100%', maxWidth: 54, height: Math.max(h, 4), borderRadius: '8px 8px 4px 4px',
                        background: m.income > 0 ? 'linear-gradient(180deg, var(--accent), var(--accent-dark))' : 'var(--border)',
                        transition: 'height .4s cubic-bezier(.22,1,.36,1)',
                      }} />
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{monthLabel(m.month)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
              {/* Conversion funnel */}
              <div style={{ ...glassCard, padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>{t('analytics.funnel')}</div>
                {[
                  { label: t('analytics.requests'), value: funnel.requests || 0, color: 'var(--accent)' },
                  { label: t('analytics.accepted'), value: funnel.accepted || 0, color: '#C4A35A', rate: funnel.acceptRate },
                  { label: t('analytics.completed'), value: funnel.completed || 0, color: '#7A9A6B', rate: funnel.completeRate },
                ].map((step, i) => {
                  const base = Math.max(1, funnel.requests || 0);
                  const w = Math.round((step.value / base) * 100);
                  return (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                        <span>{step.label}{step.rate != null ? ` · ${step.rate}%` : ''}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{step.value}</span>
                      </div>
                      <div style={{ height: 10, borderRadius: 6, background: 'var(--surface)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(w, 3)}%`, height: '100%', borderRadius: 6, background: step.color, transition: 'width .5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rating breakdown */}
              <div style={{ ...glassCard, padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>{t('analytics.ratings')}</div>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = rb[star] || 0;
                  const w = Math.round((count / maxRb) * 100);
                  return (
                    <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text2)', width: 34, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {star} <StarOutlineRounded sx={{ fontSize: 13, color: '#C4A35A' }} />
                      </span>
                      <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--surface)', overflow: 'hidden' }}>
                        <div style={{ width: `${w}%`, height: '100%', borderRadius: 6, background: 'linear-gradient(90deg, #C4A35A, #B8956E)', transition: 'width .5s ease' }} />
                      </div>
                      <span style={{ fontSize: 12.5, color: 'var(--text3)', width: 22, textAlign: 'right' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Модалка вывода средств */}
      {withdrawOpen && (
        <div
          onClick={() => !withdrawing && setWithdrawOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...glassCard, background: 'var(--canvas)', padding: 26, width: 'min(420px, 92vw)' }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{t('analytics.withdrawTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 18 }}>
              {t('analytics.withdrawAvailable')}: {fmtMoney(data?.balance)} {t('analytics.sumShort')}
            </div>
            <input
              type="number"
              min={1}
              max={Math.floor(Number(data?.balance) || 0)}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 15 }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setWithdrawOpen(false)} disabled={withdrawing} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {t('analytics.cancel')}
              </button>
              <button onClick={submitWithdraw} disabled={withdrawing} style={{ background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--radius)', cursor: withdrawing ? 'default' : 'pointer', fontFamily: 'inherit', opacity: withdrawing ? 0.7 : 1 }}>
                {withdrawing ? t('analytics.withdrawing') : t('analytics.withdrawSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </GlassShell>
  );
};

export default LawyerAnalyticsPage;
