import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Pagination, Select, Tab, Tabs, TextField,
} from '@mui/material';
import {
  AddRounded, CampaignOutlined, EditOutlined, GavelOutlined, RefreshRounded,
  ToggleOffOutlined, ToggleOnOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';
import promotionService from '../../services/promotionService';
import { canonicalCatalogKey, createCatalogRequestCoordinator } from '../../utils/catalogRequestCoordinator';
import { runLatestRequest } from '../../utils/latestRequest';
import {
  createAdminPromotionReloadTracker, parseSponsoredPositions, runMutationThenRefresh,
  snapshotCampaignFilters,
} from '../../utils/promotionAdminState';

const card = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)',
};

const emptyPackage = {
  code: '', nameRu: '', nameUz: '', nameEn: '', durationDays: 7, priceUzs: '',
  maxActiveSlots: 2, sponsoredPositions: '0,3', displayOrder: 0,
};

const statuses = [
  'pending_payment', 'queued', 'scheduled', 'active', 'paused', 'expired',
  'cancelled', 'refund_pending', 'refunded',
];

const emptyFilters = { status: '', lawyerId: '', packageId: '', specialization: '', location: '' };

export const isAuditReasonValid = (reason) => {
  const length = String(reason || '').trim().length;
  return length >= 3 && length <= 120;
};

export const campaignAction = (status) => {
  if (status === 'pending_payment') return 'cancel';
  if (['queued', 'scheduled', 'active', 'paused'].includes(status)) return 'refund';
  return null;
};

const compact = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value != null));
const number = (value) => (Number(value) || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
const money = (tiyin) => number(Math.round((Number(tiyin) || 0) / 100));
const requireSuccessfulLoad = async (loadPromise) => {
  const result = await loadPromise;
  if (result?.error) throw result.error;
  return result;
};

const AdminPromotionsPage = () => {
  const { t, language } = useTranslation();
  const [tab, setTab] = useState('packages');
  const [packages, setPackages] = useState([]);
  const [packageMeta, setPackageMeta] = useState({ page: 1, totalPages: 1 });
  const [campaigns, setCampaigns] = useState([]);
  const [campaignMeta, setCampaignMeta] = useState({ page: 1, totalPages: 1 });
  const [lawyers, setLawyers] = useState([]);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedCampaignFilters, setAppliedCampaignFilters] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [packageDialog, setPackageDialog] = useState(null);
  const [packageForm, setPackageForm] = useState(emptyPackage);
  const [packageError, setPackageError] = useState('');
  const [reasonDialog, setReasonDialog] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(null);
  const packageCoordinatorRef = useRef(createCatalogRequestCoordinator());
  const campaignCoordinatorRef = useRef(createCatalogRequestCoordinator());
  const lawyerCoordinatorRef = useRef(createCatalogRequestCoordinator());
  const viewCoordinatorRef = useRef(createCatalogRequestCoordinator());
  const reloadTrackerRef = useRef(createAdminPromotionReloadTracker());

  const loadPackages = useCallback(async (page = 1) => {
    reloadTrackerRef.current.recordPackages(page);
    return runLatestRequest(packageCoordinatorRef.current, `packages:${page}`, (signal) => (
      promotionService.admin.getPackages({ page, limit: 8 }, { signal })
    ), {
      onSuccess: (result) => {
        setPackages(result.packages || []);
        setPackageMeta({ page: result.page || page, totalPages: result.totalPages || 1 });
      },
    });
  }, []);

  const loadCampaigns = useCallback(async (page = 1, nextFilters = {}) => {
    reloadTrackerRef.current.recordCampaigns(page, nextFilters);
    const query = { ...compact(nextFilters), page, limit: 8 };
    return runLatestRequest(campaignCoordinatorRef.current, canonicalCatalogKey(query), (signal) => (
      promotionService.admin.getCampaigns(query, { signal })
    ), {
      onSuccess: (result) => {
        setCampaigns(result.campaigns || []);
        setCampaignMeta({ page: result.page || page, totalPages: result.totalPages || 1 });
      },
    });
  }, []);

  const loadLawyers = useCallback(async () => {
    return runLatestRequest(lawyerCoordinatorRef.current, 'lawyers', (signal) => (
      promotionService.admin.getLawyers({}, { signal })
    ), {
      onSuccess: (result) => setLawyers(
        Array.isArray(result?.lawyers) ? result.lawyers : Array.isArray(result) ? result : [],
      ),
    });
  }, []);

  const loadView = useCallback((key, operation) => runLatestRequest(
    viewCoordinatorRef.current,
    key,
    async () => {
      const results = await operation();
      const list = Array.isArray(results) ? results : [results];
      const failed = list.find((result) => result?.error);
      if (failed) throw failed.error;
      return results;
    },
    {
      onStart: () => { setLoading(true); setError(''); },
      onError: (requestError) => setError(requestError.response?.data?.error || t('adminPromotions.loadError')),
      onFinally: () => setLoading(false),
    },
  ), [t]);

  const loadAll = useCallback(async () => {
    return loadView('all', () => Promise.all([loadPackages(1), loadCampaigns(1, {}), loadLawyers()]));
  }, [loadCampaigns, loadLawyers, loadPackages, loadView]);

  const retryCurrentLists = useCallback(() => {
    const current = reloadTrackerRef.current.current();
    return loadView(`retry:${canonicalCatalogKey(current)}`, () => Promise.all([
      loadPackages(current.packagePage),
      loadCampaigns(current.campaignPage, current.appliedCampaignFilters),
      loadLawyers(),
    ]));
  }, [loadCampaigns, loadLawyers, loadPackages, loadView]);

  useEffect(() => {
    const coordinators = [packageCoordinatorRef.current, campaignCoordinatorRef.current,
      lawyerCoordinatorRef.current, viewCoordinatorRef.current];
    loadAll();
    return () => coordinators.forEach((coordinator) => coordinator.cancel());
  }, [loadAll]);

  const packageName = (promotionPackage) => promotionPackage.name?.[language]
    || promotionPackage.name?.ru || promotionPackage.code;
  const pilotEnabled = (lawyer) => Boolean(lawyer.profile?.promotionPilotEnabled);

  const openCreate = () => {
    setPackageForm(emptyPackage);
    setPackageError('');
    setPackageDialog({ mode: 'create' });
  };

  const openEdit = (promotionPackage) => {
    setPackageForm({
      code: promotionPackage.code,
      nameRu: promotionPackage.name?.ru || '', nameUz: promotionPackage.name?.uz || '', nameEn: promotionPackage.name?.en || '',
      durationDays: promotionPackage.durationDays, priceUzs: Math.round(promotionPackage.priceAmountTiyin / 100),
      maxActiveSlots: promotionPackage.maxActiveSlots,
      sponsoredPositions: (promotionPackage.sponsoredPositions || []).join(','), displayOrder: promotionPackage.displayOrder,
    });
    setPackageError('');
    setPackageDialog({ mode: 'edit', target: promotionPackage });
  };

  const packagePayload = (sponsoredPositions) => ({
    code: packageForm.code.trim().toUpperCase(),
    name: { ru: packageForm.nameRu.trim(), uz: packageForm.nameUz.trim(), en: packageForm.nameEn.trim() },
    placement: 'catalog_top', durationDays: Number(packageForm.durationDays),
    priceAmountTiyin: Math.round(Number(packageForm.priceUzs) * 100), currency: 'UZS',
    maxActiveSlots: Number(packageForm.maxActiveSlots),
    sponsoredPositions,
    displayOrder: Number(packageForm.displayOrder),
  });

  const savePackage = async () => {
    const parsedPositions = parseSponsoredPositions(packageForm.sponsoredPositions);
    if (!parsedPositions.ok) {
      setPackageError(t('adminPromotions.positionsInvalid'));
      return;
    }
    const payload = packagePayload(parsedPositions.value);
    if (!payload.code || Object.values(payload.name).some((value) => !value) || !Number.isSafeInteger(payload.priceAmountTiyin)
      || payload.priceAmountTiyin <= 0 || !payload.sponsoredPositions.length) {
      setPackageError(t('adminPromotions.formError'));
      return;
    }
    setSaving(true);
    setPackageError('');
    try {
      const mode = packageDialog.mode;
      const result = await runMutationThenRefresh({
        mutate: () => mode === 'create'
          ? promotionService.admin.createPackage(payload)
          : promotionService.admin.updatePackage(packageDialog.target.id, payload),
        onSaved: () => {
          toast.success(t(mode === 'create' ? 'adminPromotions.created' : 'adminPromotions.updated'));
          setPackageDialog(null);
        },
        refresh: () => {
          const current = reloadTrackerRef.current.current();
          return requireSuccessfulLoad(loadPackages(current.packagePage));
        },
      });
      if (!result.refreshed) setRefreshWarning('packages');
    } catch (requestError) {
      setPackageError(requestError.response?.data?.error || t('adminPromotions.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const requestReason = (action) => {
    setReason('');
    setReasonError('');
    setReasonDialog(action);
  };

  const submitReasonAction = async () => {
    if (!isAuditReasonValid(reason)) {
      setReasonError(t('adminPromotions.reasonError'));
      return;
    }
    setSaving(true);
    setReasonError('');
    try {
      const action = reasonDialog;
      const mutation = {
        activation: () => promotionService.admin.setPackageActivation(action.target.id, action.enabled, reason.trim()),
        cancel: () => promotionService.admin.cancelCampaign(action.target.id, reason.trim()),
        refund: () => promotionService.admin.refundCampaign(action.target.id, reason.trim()),
        pilot: () => promotionService.admin.setPilot(action.target.id, action.enabled, reason.trim()),
      }[action.kind];
      const refreshKind = action.kind === 'activation' ? 'packages'
        : action.kind === 'pilot' ? 'lawyers' : 'campaigns';
      const current = reloadTrackerRef.current.current();
      const refresh = {
        packages: () => requireSuccessfulLoad(loadPackages(current.packagePage)),
        campaigns: () => requireSuccessfulLoad(loadCampaigns(
          current.campaignPage, current.appliedCampaignFilters,
        )),
        lawyers: () => requireSuccessfulLoad(loadLawyers()),
      }[refreshKind];
      const result = await runMutationThenRefresh({
        mutate: mutation,
        onSaved: () => {
          toast.success(t('adminPromotions.actionSaved'));
          setReasonDialog(null);
          setReason('');
        },
        refresh,
      });
      if (!result.refreshed) setRefreshWarning(refreshKind);
    } catch (requestError) {
      setReasonError(requestError.response?.data?.error || t('adminPromotions.actionError'));
    } finally {
      setSaving(false);
    }
  };

  const applyFilters = async () => {
    const applied = snapshotCampaignFilters(draftFilters);
    setAppliedCampaignFilters(applied);
    await loadView(`campaigns:${canonicalCatalogKey({ page: 1, ...applied })}`, () => loadCampaigns(1, applied));
  };

  const recoverRefresh = async () => {
    const current = reloadTrackerRef.current.current();
    const loaders = {
      packages: () => loadPackages(current.packagePage),
      campaigns: () => loadCampaigns(current.campaignPage, current.appliedCampaignFilters),
      lawyers: () => loadLawyers(),
    };
    const result = await loadView(`recovery:${refreshWarning}`, loaders[refreshWarning]);
    if (!result?.error && !result?.stale) setRefreshWarning(null);
  };

  const renderPackages = () => (
    <section aria-labelledby="admin-packages-title">
      <div className="admin-promotion-heading">
        <div><span>{t('adminPromotions.configuration')}</span><h2 id="admin-packages-title">{t('adminPromotions.packages')}</h2></div>
        <Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>{t('adminPromotions.create')}</Button>
      </div>
      <Alert severity="info" sx={{ mb: 2 }}>{t('adminPromotions.activationNotice')}</Alert>
      {packages.length ? <div className="admin-package-grid">{packages.map((promotionPackage) => (
        <article className="admin-promotion-card" key={promotionPackage.id}>
          <div className="admin-card-head"><div><span className="code">{promotionPackage.code}</span><h3>{packageName(promotionPackage)}</h3></div><span className={promotionPackage.isActive ? 'enabled' : 'disabled'}>{t(`adminPromotions.${promotionPackage.isActive ? 'active' : 'inactive'}`)}</span></div>
          <div className="admin-package-price">{money(promotionPackage.priceAmountTiyin)} {t('adminPromotions.uzs')} <small>· {promotionPackage.durationDays} {t('adminPromotions.days')}</small></div>
          <dl><div><dt>{t('adminPromotions.slots')}</dt><dd>{promotionPackage.maxActiveSlots}</dd></div><div><dt>{t('adminPromotions.positions')}</dt><dd>{promotionPackage.sponsoredPositions.join(', ')}</dd></div><div><dt>{t('adminPromotions.order')}</dt><dd>{promotionPackage.displayOrder}</dd></div></dl>
          <div className="admin-card-actions">
            <Button startIcon={<EditOutlined />} onClick={() => openEdit(promotionPackage)}>{t('adminPromotions.edit')}</Button>
            <Button color={promotionPackage.isActive ? 'warning' : 'success'} startIcon={promotionPackage.isActive ? <ToggleOffOutlined /> : <ToggleOnOutlined />} onClick={() => requestReason({ kind: 'activation', target: promotionPackage, enabled: !promotionPackage.isActive })}>
              {t(`adminPromotions.${promotionPackage.isActive ? 'deactivate' : 'activate'}`)}
            </Button>
          </div>
        </article>
      ))}</div> : <div className="admin-empty">{t('adminPromotions.noPackages')}</div>}
      {packageMeta.totalPages > 1 && <Pagination count={packageMeta.totalPages} page={packageMeta.page} onChange={(event, page) => loadView(`packages:${page}`, () => loadPackages(page))} />}
    </section>
  );

  const renderCampaigns = () => (
    <section aria-labelledby="admin-campaigns-title">
      <div className="admin-promotion-heading"><div><span>{t('adminPromotions.operations')}</span><h2 id="admin-campaigns-title">{t('adminPromotions.campaigns')}</h2></div></div>
      <div className="campaign-filters">
        <FormControl size="small"><InputLabel id="campaign-status-label">{t('adminPromotions.status')}</InputLabel><Select labelId="campaign-status-label" label={t('adminPromotions.status')} value={draftFilters.status} onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value })}><MenuItem value="">{t('adminPromotions.all')}</MenuItem>{statuses.map((status) => <MenuItem key={status} value={status}>{t(`promotions.status.${status}`)}</MenuItem>)}</Select></FormControl>
        <FormControl size="small"><InputLabel id="campaign-lawyer-label">{t('adminPromotions.lawyer')}</InputLabel><Select labelId="campaign-lawyer-label" label={t('adminPromotions.lawyer')} value={draftFilters.lawyerId} onChange={(event) => setDraftFilters({ ...draftFilters, lawyerId: event.target.value })}><MenuItem value="">{t('adminPromotions.all')}</MenuItem>{lawyers.map((lawyer) => <MenuItem key={lawyer.id} value={lawyer.id}>{lawyer.name}</MenuItem>)}</Select></FormControl>
        <TextField size="small" label={t('adminPromotions.specialization')} value={draftFilters.specialization} onChange={(event) => setDraftFilters({ ...draftFilters, specialization: event.target.value })} />
        <TextField size="small" label={t('adminPromotions.location')} value={draftFilters.location} onChange={(event) => setDraftFilters({ ...draftFilters, location: event.target.value })} />
        <Button variant="outlined" onClick={applyFilters}>{t('adminPromotions.apply')}</Button>
      </div>
      {campaigns.length ? campaigns.map((campaign) => {
        const action = campaignAction(campaign.status);
        return <article className="admin-promotion-card campaign" key={campaign.id}>
          <div className="admin-card-head"><div><h3>{campaign.lawyer?.name || t('adminPromotions.unknownLawyer')}</h3><span>{campaign.specialization}{campaign.location ? ` · ${campaign.location}` : ''}</span></div><span className="campaign-status">{t(`promotions.status.${campaign.status}`)}</span></div>
          <div className="campaign-summary"><span>{campaign.package ? packageName(campaign.package) : campaign.packageId}</span><span>{money(campaign.priceAmountTiyin)} {t('adminPromotions.uzs')}</span><span>{t('adminPromotions.payment')}: {t(`promotions.paymentStatus.${campaign.payment?.status || 'pending'}`)}</span></div>
          <div className="campaign-summary metrics"><span>{t('promotions.impressions')}: {number(campaign.impressions)}</span><span>{t('promotions.profileViews')}: {number(campaign.profileViews)}</span><span>{t('promotions.bookings')}: {number(campaign.bookings)}</span></div>
          {action && <div className="admin-card-actions"><Button color="warning" onClick={() => requestReason({ kind: action, target: campaign })}>{t(`adminPromotions.${action}`)}</Button></div>}
        </article>;
      }) : <div className="admin-empty">{t('adminPromotions.noCampaigns')}</div>}
      {campaignMeta.totalPages > 1 && <Pagination count={campaignMeta.totalPages} page={campaignMeta.page} onChange={(event, page) => loadView(`campaigns:${canonicalCatalogKey({ page, ...appliedCampaignFilters })}`, () => loadCampaigns(page, appliedCampaignFilters))} />}
    </section>
  );

  const renderPilot = () => (
    <section aria-labelledby="admin-pilot-title">
      <div className="admin-promotion-heading"><div><span>{t('adminPromotions.access')}</span><h2 id="admin-pilot-title">{t('adminPromotions.pilot')}</h2></div></div>
      <Alert severity="warning" sx={{ mb: 2 }}>{t('adminPromotions.pilotNotice')}</Alert>
      {lawyers.length ? <div className="pilot-list">{lawyers.map((lawyer) => (
        <article className="admin-promotion-card pilot" key={lawyer.id}>
          <div><h3>{lawyer.name}</h3><span>{lawyer.profile?.specialization || t('adminPromotions.noSpecialization')}</span></div>
          <Button color={pilotEnabled(lawyer) ? 'warning' : 'success'} startIcon={<GavelOutlined />} onClick={() => requestReason({ kind: 'pilot', target: lawyer, enabled: !pilotEnabled(lawyer) })}>
            {t(`adminPromotions.${pilotEnabled(lawyer) ? 'disablePilot' : 'enablePilot'}`)}
          </Button>
        </article>
      ))}</div> : <div className="admin-empty">{t('adminPromotions.noLawyers')}</div>}
    </section>
  );

  return (
    <GlassShell active="/admin/promotions" title={t('adminPromotions.title')} subtitle={t('adminPromotions.subtitle')} role="admin">
      <div className="admin-promotions-page">
        <Tabs value={tab} onChange={(event, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile aria-label={t('adminPromotions.sections')}>
          <Tab value="packages" label={t('adminPromotions.packages')} icon={<CampaignOutlined />} iconPosition="start" />
          <Tab value="campaigns" label={t('adminPromotions.campaigns')} icon={<RefreshRounded />} iconPosition="start" />
          <Tab value="pilot" label={t('adminPromotions.pilot')} icon={<GavelOutlined />} iconPosition="start" />
        </Tabs>
        {refreshWarning && (
          <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={recoverRefresh}>{t('adminPromotions.refreshSavedData')}</Button>}>
            {t('adminPromotions.savedRefreshFailed')}
          </Alert>
        )}
        {loading ? <div className="admin-state" role="status"><CircularProgress size={28} />{t('common.loading')}</div>
          : error ? <div className="admin-state" role="alert"><strong>{t('adminPromotions.loadErrorTitle')}</strong><span>{error}</span><Button startIcon={<RefreshRounded />} onClick={retryCurrentLists}>{t('adminPromotions.retry')}</Button></div>
            : tab === 'packages' ? renderPackages() : tab === 'campaigns' ? renderCampaigns() : renderPilot()}
      </div>

      <Dialog open={Boolean(packageDialog)} onClose={() => !saving && setPackageDialog(null)} fullWidth maxWidth="md" aria-labelledby="package-dialog-title">
        <DialogTitle id="package-dialog-title">{t(packageDialog?.mode === 'edit' ? 'adminPromotions.editPackage' : 'adminPromotions.createPackage')}</DialogTitle>
        <DialogContent><div className="package-form">
          <TextField label={t('adminPromotions.code')} value={packageForm.code} onChange={(event) => setPackageForm({ ...packageForm, code: event.target.value })} />
          <TextField label={t('adminPromotions.nameRu')} value={packageForm.nameRu} onChange={(event) => setPackageForm({ ...packageForm, nameRu: event.target.value })} />
          <TextField label={t('adminPromotions.nameUz')} value={packageForm.nameUz} onChange={(event) => setPackageForm({ ...packageForm, nameUz: event.target.value })} />
          <TextField label={t('adminPromotions.nameEn')} value={packageForm.nameEn} onChange={(event) => setPackageForm({ ...packageForm, nameEn: event.target.value })} />
          <FormControl><InputLabel id="package-duration-label">{t('adminPromotions.duration')}</InputLabel><Select labelId="package-duration-label" label={t('adminPromotions.duration')} value={packageForm.durationDays} onChange={(event) => setPackageForm({ ...packageForm, durationDays: event.target.value })}><MenuItem value={7}>7</MenuItem><MenuItem value={30}>30</MenuItem></Select></FormControl>
          <TextField type="number" label={t('adminPromotions.priceUzs')} value={packageForm.priceUzs} onChange={(event) => setPackageForm({ ...packageForm, priceUzs: event.target.value })} />
          <TextField type="number" label={t('adminPromotions.slots')} value={packageForm.maxActiveSlots} onChange={(event) => setPackageForm({ ...packageForm, maxActiveSlots: event.target.value })} />
          <TextField label={t('adminPromotions.positions')} value={packageForm.sponsoredPositions} helperText={t('adminPromotions.positionsHint')} onChange={(event) => setPackageForm({ ...packageForm, sponsoredPositions: event.target.value })} />
          <TextField type="number" label={t('adminPromotions.order')} value={packageForm.displayOrder} onChange={(event) => setPackageForm({ ...packageForm, displayOrder: event.target.value })} />
        </div>{packageError && <Alert severity="error" role="alert" sx={{ mt: 2 }}>{packageError}</Alert>}{packageDialog?.mode === 'create' && <Alert severity="info" sx={{ mt: 2 }}>{t('adminPromotions.createdInactive')}</Alert>}</DialogContent>
        <DialogActions><Button onClick={() => setPackageDialog(null)} disabled={saving}>{t('adminPromotions.close')}</Button><Button variant="contained" onClick={savePackage} disabled={saving}>{t('adminPromotions.save')}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(reasonDialog)} onClose={() => !saving && setReasonDialog(null)} fullWidth maxWidth="xs" aria-labelledby="reason-dialog-title">
        <DialogTitle id="reason-dialog-title">{reasonDialog && t(`adminPromotions.confirm.${reasonDialog.kind}`)}</DialogTitle>
        <DialogContent>
          <Alert severity={reasonDialog?.kind === 'refund' ? 'warning' : 'info'} sx={{ mb: 2 }}>{reasonDialog && t(`adminPromotions.confirmText.${reasonDialog.kind}`)}</Alert>
          <TextField autoFocus fullWidth multiline minRows={3} inputProps={{ maxLength: 120 }} label={t('adminPromotions.reason')} value={reason} error={Boolean(reasonError)} helperText={reasonError || t('adminPromotions.reasonHint')} onChange={(event) => setReason(event.target.value)} />
        </DialogContent>
        <DialogActions><Button onClick={() => setReasonDialog(null)} disabled={saving}>{t('adminPromotions.close')}</Button><Button variant="contained" color="warning" onClick={submitReasonAction} disabled={saving || !isAuditReasonValid(reason)}>{t('adminPromotions.confirmAction')}</Button></DialogActions>
      </Dialog>

      <style>{`
        .admin-promotions-page{max-width:1120px;margin:0 auto}.admin-promotions-page>.MuiTabs-root{margin-bottom:26px;border-bottom:1px solid var(--border)}.admin-promotion-heading{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:16px}.admin-promotion-heading span{font-size:10px;color:var(--accent-dark);font-weight:700;letter-spacing:.1em;text-transform:uppercase}.admin-promotion-heading h2{margin:4px 0 0;color:var(--text);font-size:22px}.admin-package-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:15px}.admin-promotion-card,.admin-state,.admin-empty{${Object.entries(card).map(([key,value]) => `${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}:${value}`).join(';')}}.admin-promotion-card{padding:20px;margin-bottom:14px}.admin-card-head{display:flex;justify-content:space-between;align-items:start;gap:12px}.admin-card-head h3,.pilot h3{margin:4px 0;color:var(--text);font-size:16px}.admin-card-head .code,.admin-card-head div>span,.pilot div>span{font-size:11px;color:var(--text3)}.enabled,.disabled,.campaign-status{font-size:10px!important;font-weight:700;padding:5px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}.enabled{color:#397b47!important;background:rgba(90,160,106,.14)}.disabled{color:var(--text3)!important;background:var(--surface)}.admin-package-price{margin:16px 0;font-size:22px;font-weight:650;color:var(--text)}.admin-package-price small{font-size:12px;color:var(--text3)}.admin-promotion-card dl{display:flex;gap:10px;margin:0}.admin-promotion-card dl div{flex:1;background:var(--surface);padding:9px;border-radius:10px}.admin-promotion-card dt{font-size:10px;color:var(--text3)}.admin-promotion-card dd{margin:3px 0 0;color:var(--text);font-weight:600}.admin-card-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)}.campaign-filters{display:grid;grid-template-columns:1fr 1.4fr 1fr 1fr auto;gap:10px;margin-bottom:18px}.campaign-summary{display:flex;flex-wrap:wrap;gap:10px 24px;padding:13px 0;color:var(--text2);font-size:12px}.campaign-summary.metrics{border-top:1px solid var(--border);color:var(--text3)}.pilot-list{display:grid;gap:10px}.admin-promotion-card.pilot{display:flex;justify-content:space-between;align-items:center;gap:16px}.admin-state,.admin-empty{padding:40px;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--text3);text-align:center}.admin-state strong{color:var(--text)}.package-form{display:grid;grid-template-columns:1fr 1fr;gap:15px;padding-top:8px}.admin-promotions-page button,.admin-promotions-page .MuiButton-root,.admin-promotions-page .MuiTab-root,.MuiDialog-root .MuiButton-root{min-height:44px}@media(max-width:850px){.campaign-filters{grid-template-columns:1fr 1fr}.campaign-filters button{grid-column:1/-1}.package-form{grid-template-columns:1fr}}@media(max-width:600px){.admin-promotion-heading{align-items:stretch;flex-direction:column}.admin-package-grid,.campaign-filters{grid-template-columns:1fr}.admin-promotion-card.pilot,.admin-card-head{align-items:stretch;flex-direction:column}.admin-card-actions{flex-direction:column}.admin-card-actions button{width:100%}}@media(prefers-reduced-motion:reduce){.admin-promotions-page *{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
      `}</style>
    </GlassShell>
  );
};

export default AdminPromotionsPage;
