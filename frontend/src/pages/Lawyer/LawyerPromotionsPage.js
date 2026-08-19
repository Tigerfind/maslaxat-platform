import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Pagination, Select, TextField,
} from '@mui/material';
import {
  AdsClickOutlined, ArrowOutwardRounded, CalendarMonthOutlined, PaymentsOutlined,
  PersonSearchOutlined, RefreshRounded, VisibilityOutlined,
} from '@mui/icons-material';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';
import promotionService from '../../services/promotionService';
import { createPromotionCheckoutAttemptStore } from '../../utils/promotionCheckoutAttempt';
import { navigateToPromotionCheckout, promotionCheckoutUrl } from '../../utils/promotionCheckoutRedirect';
import { createCatalogRequestCoordinator } from '../../utils/catalogRequestCoordinator';
import { runLatestRequest } from '../../utils/latestRequest';
import {
  capturePromotionCheckoutScope, promotionCheckoutResponseState,
} from '../../utils/promotionCheckoutState';

const card = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)',
};

const localeOf = (language) => ({ ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }[language] || 'ru-RU');
const number = (value) => (Number(value) || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
const money = (tiyin) => number(Math.round((Number(tiyin) || 0) / 100));

export const CheckoutTerms = ({ outcome }) => {
  const { t } = useTranslation();
  const queued = outcome === 'queued_after_payment';
  return (
    <Alert severity={queued ? 'warning' : 'success'} role="status" sx={{ mt: 2 }}>
      <strong>{t(queued ? 'promotions.queuedTitle' : 'promotions.immediateTitle')}</strong>
      <div>{t(queued ? 'promotions.queuedTerms' : 'promotions.immediateTerms')}</div>
    </Alert>
  );
};

export const CampaignMetrics = ({ campaign }) => {
  const { t } = useTranslation();
  const metrics = [
    [<VisibilityOutlined key="impressions" />, t('promotions.impressions'), campaign.impressions],
    [<PersonSearchOutlined key="views" />, t('promotions.profileViews'), campaign.profileViews],
    [<AdsClickOutlined key="starts" />, t('promotions.bookingStarts'), campaign.bookingStarts],
    [<CalendarMonthOutlined key="bookings" />, t('promotions.bookings'), campaign.bookings],
  ];
  return (
    <div className="promotion-metrics">
      {metrics.map(([icon, label, value]) => (
        <div key={label} className="promotion-metric">
          <span aria-hidden="true">{icon}</span>
          <span><strong>{number(value)}</strong><small>{label}</small></span>
        </div>
      ))}
    </div>
  );
};

const LawyerPromotionsPage = () => {
  const { t, language } = useTranslation();
  const [packages, setPackages] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [profile, setProfile] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [specialization, setSpecialization] = useState('');
  const [location, setLocation] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [checking, setChecking] = useState(false);
  const attemptStoreRef = useRef(null);
  const loadCoordinatorRef = useRef(createCatalogRequestCoordinator());
  const mountedRef = useRef(true);
  const checkoutRequestRef = useRef(null);
  const currentScopeRef = useRef(null);
  if (!attemptStoreRef.current) attemptStoreRef.current = createPromotionCheckoutAttemptStore();
  currentScopeRef.current = capturePromotionCheckoutScope({
    packageId: selectedPackage?.id,
    specialization,
    location,
  });

  const load = useCallback(async (page = 1) => {
    return runLatestRequest(loadCoordinatorRef.current, `lawyer-promotions:${page}`, (signal) => Promise.all([
      promotionService.getPackages({ signal }),
      promotionService.lawyer.getCampaigns({ page, limit: 6 }, { signal }),
      promotionService.lawyer.getProfile({ signal }),
    ]), {
      onStart: () => { setLoading(true); setError(''); },
      onSuccess: ([packageData, campaignData, profileData]) => {
        const lawyerProfile = profileData.profile || {};
        setPackages(packageData.packages || []);
        setCampaigns(campaignData.promotions || []);
        setPagination({ page: campaignData.page || page, totalPages: campaignData.totalPages || 1 });
        setProfile(lawyerProfile);
        const specs = Array.isArray(lawyerProfile.specializations) && lawyerProfile.specializations.length
          ? lawyerProfile.specializations : lawyerProfile.specialization ? [lawyerProfile.specialization] : [];
        setSpecialization((current) => current || specs[0] || '');
        setLocation((current) => current || lawyerProfile.location || '');
      },
      onError: (requestError) => setError(requestError.response?.data?.error || t('promotions.loadError')),
      onFinally: () => setLoading(false),
    });
  }, [t]);

  useEffect(() => {
    const coordinator = loadCoordinatorRef.current;
    mountedRef.current = true;
    load(1);
    return () => {
      mountedRef.current = false;
      coordinator.cancel();
    };
  }, [load]);

  const checkoutScope = (promotionPackage = selectedPackage) => ({
    packageId: promotionPackage?.id || '',
    specialization: specialization.trim(),
    location: location.trim(),
  });

  const openCheckout = (promotionPackage) => {
    if (checking) return;
    setSelectedPackage(promotionPackage);
    setCheckout(null);
    setCheckoutError('');
    if (specialization.trim()) attemptStoreRef.current.getOrCreate(checkoutScope(promotionPackage));
  };

  const closeCheckout = () => {
    if (checking) return;
    setSelectedPackage(null);
    setCheckout(null);
    setCheckoutError('');
    attemptStoreRef.current.clearActive();
  };

  const prepareCheckout = async () => {
    if (checkoutRequestRef.current) return;
    if (!specialization.trim()) {
      setCheckoutError(t('promotions.scopeRequired'));
      return;
    }
    const requestedScope = capturePromotionCheckoutScope(checkoutScope());
    const attempt = attemptStoreRef.current.getOrCreate(requestedScope);
    const requestToken = Symbol('promotion-checkout');
    checkoutRequestRef.current = requestToken;
    setChecking(true);
    setCheckoutError('');
    try {
      const result = await promotionService.lawyer.checkout({
        packageId: requestedScope.packageId,
        specialization: requestedScope.specialization,
        location: requestedScope.location || null,
      }, attempt.retryKey());
      const responseState = promotionCheckoutResponseState({
        mounted: mountedRef.current,
        requestedScope,
        currentScope: currentScopeRef.current,
      });
      if (responseState === 'unmounted') return;
      if (responseState === 'scope_changed') {
        setCheckout(null);
        setCheckoutError(t('promotions.scopeChangedRecovery'));
        return;
      }
      if (!promotionCheckoutUrl(result?.checkoutUrl)) {
        setCheckoutError(t('promotions.invalidCheckoutUrl'));
        return;
      }
      setCheckout({ ...result, requestedScope });
    } catch (requestError) {
      if (!mountedRef.current) return;
      const responseState = promotionCheckoutResponseState({
        mounted: true,
        requestedScope,
        currentScope: currentScopeRef.current,
      });
      setCheckoutError(responseState === 'scope_changed'
        ? t('promotions.scopeChangedRecovery')
        : requestError.response?.data?.error || t('promotions.checkoutError'));
    } finally {
      if (checkoutRequestRef.current === requestToken) checkoutRequestRef.current = null;
      if (mountedRef.current) setChecking(false);
    }
  };

  const goToPayme = () => {
    const responseState = promotionCheckoutResponseState({
      mounted: mountedRef.current,
      requestedScope: checkout?.requestedScope,
      currentScope: currentScopeRef.current,
    });
    if (responseState !== 'current') {
      setCheckout(null);
      setCheckoutError(t('promotions.scopeChangedRecovery'));
      return;
    }
    const navigated = navigateToPromotionCheckout(checkout?.checkoutUrl, (safeUrl) => {
      window.location.assign(safeUrl);
      attemptStoreRef.current.clear(checkout.requestedScope);
    });
    if (!navigated) setCheckoutError(t('promotions.invalidCheckoutUrl'));
  };

  const specs = Array.isArray(profile?.specializations) && profile.specializations.length
    ? profile.specializations : profile?.specialization ? [profile.specialization] : [];
  const packageName = (promotionPackage) => promotionPackage.name?.[language]
    || promotionPackage.name?.ru || promotionPackage.code;
  const statusLabel = (status) => t(`promotions.status.${status}`);
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'medium' }).format(new Date(value)) : t('promotions.notStarted');

  return (
    <GlassShell active="/lawyer/promotions" title={t('promotions.title')} subtitle={t('promotions.subtitle')} role="lawyer">
      <div className="promotions-page">
        {loading ? (
          <div className="promotion-state" role="status"><CircularProgress size={28} /><span>{t('common.loading')}</span></div>
        ) : error ? (
          <div className="promotion-state" role="alert">
            <strong>{t('promotions.loadErrorTitle')}</strong><span>{error}</span>
            <Button startIcon={<RefreshRounded />} onClick={() => load(pagination.page)}>{t('promotions.retry')}</Button>
          </div>
        ) : (
          <>
            <section aria-labelledby="promotion-packages-title">
              <div className="section-heading">
                <div><span className="eyebrow">{t('promotions.catalogPlacement')}</span><h2 id="promotion-packages-title">{t('promotions.packages')}</h2></div>
                <p>{t('promotions.packagesHint')}</p>
              </div>
              {packages.length ? (
                <div className="package-grid">
                  {packages.map((promotionPackage) => (
                    <article key={promotionPackage.id} className="package-card">
                      <span className="package-code">{promotionPackage.code}</span>
                      <h3>{packageName(promotionPackage)}</h3>
                      <div className="package-price">{money(promotionPackage.priceAmountTiyin)} <small>{t('promotions.uzs')}</small></div>
                      <div className="package-duration">{t('promotions.duration', { days: promotionPackage.durationDays })}</div>
                      <ul>
                        <li>{t('promotions.termSponsored')}</li>
                        <li>{t('promotions.termQueue')}</li>
                        <li>{t('promotions.termRating')}</li>
                      </ul>
                      <Button fullWidth variant="contained" disabled={checking} onClick={() => openCheckout(promotionPackage)}>{t('promotions.choose')}</Button>
                    </article>
                  ))}
                </div>
              ) : <div className="promotion-empty">{t('promotions.noPackages')}</div>}
            </section>

            <section aria-labelledby="promotion-history-title">
              <div className="section-heading"><div><span className="eyebrow">{t('promotions.performance')}</span><h2 id="promotion-history-title">{t('promotions.history')}</h2></div></div>
              {campaigns.length ? campaigns.map((campaign) => (
                <article key={campaign.id} className="campaign-card">
                  <div className="campaign-head">
                    <div><h3>{campaign.package ? packageName(campaign.package) : campaign.specialization}</h3><span>{campaign.specialization}{campaign.location ? ` · ${campaign.location}` : ''}</span></div>
                    <span className={`status status-${campaign.status}`}>{statusLabel(campaign.status)}</span>
                  </div>
                  <div className="campaign-dates">
                    <span>{t('promotions.start')}: <strong>{formatDate(campaign.startsAt)}</strong></span>
                    <span>{t('promotions.end')}: <strong>{formatDate(campaign.endsAt)}</strong></span>
                    <span>{t('promotions.payment')}: <strong>{t(`promotions.paymentStatus.${campaign.payment?.status || 'pending'}`)}</strong></span>
                  </div>
                  <CampaignMetrics campaign={campaign} />
                </article>
              )) : <div className="promotion-empty"><strong>{t('promotions.emptyTitle')}</strong><span>{t('promotions.emptyText')}</span></div>}
              {pagination.totalPages > 1 && <Pagination count={pagination.totalPages} page={pagination.page} onChange={(event, page) => load(page)} />}
            </section>
          </>
        )}
      </div>

      <Dialog open={Boolean(selectedPackage)} onClose={closeCheckout} fullWidth maxWidth="sm" aria-labelledby="promotion-checkout-title">
        <DialogTitle id="promotion-checkout-title">{t('promotions.checkoutTitle')}</DialogTitle>
        <DialogContent>
          <p className="dialog-copy">{selectedPackage && packageName(selectedPackage)} · {selectedPackage && money(selectedPackage.priceAmountTiyin)} {t('promotions.uzs')}</p>
          <FormControl fullWidth margin="normal" disabled={checking}>
            <InputLabel id="promotion-specialization-label">{t('promotions.specialization')}</InputLabel>
            <Select labelId="promotion-specialization-label" label={t('promotions.specialization')} value={specialization} onChange={(event) => { if (checking) return; attemptStoreRef.current.clearActive(); setSpecialization(event.target.value); setCheckout(null); }}>
              {specs.map((spec) => <MenuItem key={spec} value={spec}>{spec}</MenuItem>)}
              {!specs.length && <MenuItem value="" disabled>{t('promotions.noSpecializations')}</MenuItem>}
            </Select>
          </FormControl>
          <TextField fullWidth margin="normal" disabled={checking} label={t('promotions.location')} value={location} onChange={(event) => { if (checking) return; attemptStoreRef.current.clearActive(); setLocation(event.target.value); setCheckout(null); }} />
          {!checkout && <Alert severity="info">{t('promotions.preflightTerms')}</Alert>}
          {checkout && <CheckoutTerms outcome={checkout.outcome} />}
          {checkoutError && <Alert severity="error" role="alert" sx={{ mt: 2 }}>{checkoutError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCheckout} disabled={checking}>{t('promotions.close')}</Button>
          {!checkout ? (
            <Button variant="contained" onClick={prepareCheckout} disabled={checking || !specialization} startIcon={checking ? <CircularProgress size={18} /> : <PaymentsOutlined />}>
              {checkoutError ? t('promotions.retrySameAttempt') : t('promotions.checkTerms')}
            </Button>
          ) : (
            <Button variant="contained" onClick={goToPayme} endIcon={<ArrowOutwardRounded />}>{t('promotions.payWithPayme')}</Button>
          )}
        </DialogActions>
      </Dialog>

      <style>{`
        .promotions-page{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:34px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:16px}.section-heading h2{margin:3px 0 0;color:var(--text);font-size:22px;font-weight:500}.section-heading p,.dialog-copy{color:var(--text3);font-size:13px}.eyebrow{color:var(--accent-dark);font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.package-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.package-card,.campaign-card,.promotion-state,.promotion-empty{${Object.entries(card).map(([key,value]) => `${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}:${value}`).join(';')}}.package-card{padding:24px;position:relative;overflow:hidden}.package-card:before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--accent),var(--accent-dark))}.package-card h3{font-size:19px;color:var(--text);margin:16px 0 10px}.package-code{font-size:10px;letter-spacing:.1em;color:var(--text3)}.package-price{font-size:28px;font-weight:650;color:var(--text)}.package-price small{font-size:12px;color:var(--text3)}.package-duration{font-size:13px;color:var(--accent-dark);margin-top:3px}.package-card ul{padding-left:18px;min-height:88px;color:var(--text2);font-size:13px;line-height:1.65}.campaign-card{padding:22px;margin-bottom:14px}.campaign-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.campaign-head h3{margin:0 0 4px;color:var(--text);font-size:16px}.campaign-head div>span,.campaign-dates{font-size:12px;color:var(--text3)}.status{padding:5px 10px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:var(--surface);color:var(--text2)}.status-active{background:rgba(90,160,106,.14);color:#397b47}.status-queued,.status-scheduled{background:rgba(196,163,90,.15);color:#8a6b20}.status-refund_pending,.status-paused{background:rgba(194,130,75,.15);color:#995d2d}.campaign-dates{display:flex;flex-wrap:wrap;gap:10px 24px;padding:14px 0;border-bottom:1px solid var(--border)}.promotion-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding-top:16px}.promotion-metric{display:flex;align-items:center;gap:8px;color:var(--accent-dark)}.promotion-metric svg{font-size:20px}.promotion-metric strong,.promotion-metric small{display:block}.promotion-metric strong{font-size:17px;color:var(--text)}.promotion-metric small{font-size:10.5px;color:var(--text3)}.promotion-state,.promotion-empty{padding:36px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--text3)}.promotion-state strong,.promotion-empty strong{color:var(--text)}.promotions-page button,.promotions-page .MuiButton-root,.MuiDialog-root .MuiButton-root{min-height:44px}@media(max-width:700px){.section-heading{align-items:start;flex-direction:column}.promotion-metrics{grid-template-columns:repeat(2,1fr)}.campaign-head{flex-direction:column}.package-card{padding:20px}}@media(prefers-reduced-motion:reduce){.package-card,.campaign-card,.promotions-page *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
      `}</style>
    </GlassShell>
  );
};

export default LawyerPromotionsPage;
