import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';

const FIELD_ORDER = ['headline', 'summary', 'positions', 'education', 'languages', 'certificates', 'specializations'];
const PROTECTED_PATHS = new Set(['positions', 'education', 'certificates', 'specializations']);
const OBJECT_FIELDS = {
  positions: ['title', 'company', 'location', 'startDate', 'endDate', 'description'],
  education: ['institution', 'degree', 'endDate'],
  certificates: ['name', 'issuer', 'issuedAt'],
};

const profileValue = (profile, path) => ({
  headline: profile?.headline || '',
  summary: profile?.description || '',
  positions: profile?.workExperience || [],
  education: profile?.education || [],
  languages: profile?.languages || [],
  certificates: profile?.certificates || [],
  specializations: profile?.specializations || [],
}[path]);

const displayValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : Object.values(item || {}).filter(Boolean).join(' · '))).join('\n');
  }
  return String(value || '');
};

const inputStyle = {
  width: '100%', minHeight: 44, boxSizing: 'border-box', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--canvas)', color: 'var(--text)',
  padding: '10px 12px', fontFamily: 'inherit', resize: 'vertical',
};

const DraftEditor = ({ path, value, onChange, label, t }) => {
  if (path === 'headline' || path === 'summary') {
    return path === 'summary'
      ? <textarea aria-label={label} value={value || ''} onChange={(event) => onChange(event.target.value)} style={inputStyle} rows={4} maxLength={2000} />
      : <input aria-label={label} value={value || ''} onChange={(event) => onChange(event.target.value)} style={inputStyle} maxLength={300} />;
  }
  if (OBJECT_FIELDS[path]) {
    return <div style={{ display: 'grid', gap: 10 }}>{(value || []).map((item, index) => (
      <fieldset key={`${path}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
        <legend>{label} {index + 1}</legend>
        <div style={{ display: 'grid', gap: 8 }}>
          {OBJECT_FIELDS[path].map((field) => {
            const id = `import-${path}-${index}-${field}`;
            return <div key={field}>
              <label htmlFor={id} style={{ display: 'block', marginBottom: 5, color: 'var(--text2)', fontSize: 12 }}>{t(`profileImport.draft_${field}`)}</label>
              <input id={id} value={item?.[field] || ''} maxLength={500} style={inputStyle} onChange={(event) => {
                const next = value.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: event.target.value } : row);
                onChange(next);
              }} />
            </div>;
          })}
        </div>
      </fieldset>
    ))}</div>;
  }
  return <textarea aria-label={label} value={(value || []).join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} style={inputStyle} rows={3} />;
};

const ProfileImportReview = ({
  importRecord,
  profile,
  service = lawyerService.imports,
  onConfirmed,
  onDiscarded,
  onConflict,
}) => {
  const { t } = useTranslation();
  const [record, setRecord] = useState(importRecord);
  const [currentProfile, setCurrentProfile] = useState(profile || {});
  const [draft, setDraft] = useState(importRecord.parsedData);
  const [selected, setSelected] = useState(() => new Set(FIELD_ORDER.filter((path) => {
    const value = importRecord.parsedData?.[path];
    return Array.isArray(value) ? value.length : Boolean(value);
  })));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const firstControl = useRef(null);
  const confirmedNotification = useRef('');
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(record.parsedData), [draft, record]);

  useEffect(() => {
    setRecord(importRecord);
    setDraft(importRecord.parsedData);
  }, [importRecord]);

  useEffect(() => {
    const warn = (event) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const toggle = (path) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const notifyConfirmed = async (confirmedRecord, confirmedProfile) => {
    const signature = `${confirmedRecord?.id || record.id}:${confirmedRecord?.confirmedFromVersion || confirmedRecord?.version || record.version}`;
    if (confirmedNotification.current === signature) return;
    confirmedNotification.current = signature;
    try {
      await onConfirmed?.(confirmedProfile, confirmedRecord);
    } catch (callbackError) {
      setError(callbackError.code || 'PROFILE_IMPORT_FAILED');
    }
  };

  const confirm = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true); setError(''); setConflict(false);
    let savedRecord;
    try {
      const saved = await service.updateDraft(record.id, record.version, draft, {});
      savedRecord = saved.import;
      setRecord(savedRecord);
      const confirmed = await service.confirm(record.id, savedRecord.version, [...selected], currentProfile.revision, {});
      setRecord(confirmed.import || savedRecord);
      await notifyConfirmed(confirmed.import || savedRecord, confirmed.profile);
    } catch (requestError) {
      if (['PROFILE_REVISION_CONFLICT', 'IMPORT_VERSION_CONFLICT'].includes(requestError.code)) {
        setConflict(true);
        try {
          const refreshed = await onConflict?.();
          if (refreshed?.import) { setRecord(refreshed.import); setDraft(refreshed.import.parsedData); }
          if (refreshed?.profile) setCurrentProfile(refreshed.profile);
        } catch (refreshError) {
          setError(refreshError.code || 'PROFILE_IMPORT_FAILED');
        }
      } else if (savedRecord && requestError.code === 'PROFILE_IMPORT_FAILED') {
        try {
          const latest = await service.get(record.id);
          if (latest.import?.status === 'confirmed'
            && latest.import.confirmedFromVersion === savedRecord.version) {
            setRecord(latest.import);
            await notifyConfirmed(latest.import);
          } else {
            if (latest.import?.status === 'draft') {
              setRecord(latest.import);
              setDraft(latest.import.parsedData);
            }
            setError(requestError.code);
          }
        } catch (reconcileError) {
          setError(reconcileError.code || requestError.code || 'PROFILE_IMPORT_FAILED');
        }
      } else setError(requestError.code || 'PROFILE_IMPORT_FAILED');
    } finally { setBusy(false); }
  };

  const discard = async () => {
    setBusy(true);
    try { await service.discard(record.id); onDiscarded?.(); }
    catch (requestError) { setError(requestError.code || 'PROFILE_IMPORT_FAILED'); }
    finally { setBusy(false); setDiscardOpen(false); }
  };

  return <section className="profile-import-review" aria-labelledby="profile-import-review-title" style={{ display: 'grid', gap: 16 }}>
    <h2 id="profile-import-review-title" style={{ margin: 0 }}>{t('profileImport.reviewTitle')}</h2>
    <Alert severity="info">{t('profileImport.selfReportedNotice')}</Alert>
    {record.warnings?.map((warning) => <Alert severity="warning" key={warning.code}>{t(`profileImport.warning_${warning.code}`)}</Alert>)}
    {conflict && <Alert role="alert" severity="warning">{t('profileImport.staleConflict')}</Alert>}
    {error && <Alert role="alert" severity="error">{t(`profileImport.error_${error}`)}</Alert>}
    {[...selected].some((path) => PROTECTED_PATHS.has(path)) && <Alert severity="warning">{t('profileImport.moderationWarning')}</Alert>}
    <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>{busy ? t('profileImport.saving') : ''}</div>
    {FIELD_ORDER.map((path, index) => <fieldset key={path} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <legend style={{ fontWeight: 600 }}>
        <label><Checkbox inputRef={index === 0 ? firstControl : undefined} value={path} checked={selected.has(path)} onChange={() => toggle(path)} />{t(`profileImport.field_${path}`)}</label>
      </legend>
      <div className="profile-import-compare" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        <div><strong>{t('profileImport.current')}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{displayValue(profileValue(currentProfile, path)) || t('profileImport.empty')}</pre></div>
        <div><strong>{t('profileImport.proposed')}</strong><DraftEditor path={path} value={draft[path]} label={t(`profileImport.field_${path}`)} t={t} onChange={(value) => { setDraft((old) => ({ ...old, [path]: value })); setConflict(false); }} /></div>
      </div>
    </fieldset>)}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      <Button data-action="confirm-import" variant="contained" disabled={busy || selected.size === 0} onClick={confirm} sx={{ minHeight: 44 }}>{t('profileImport.confirm')}</Button>
      <Button variant="outlined" disabled={busy} onClick={() => setDiscardOpen(true)} sx={{ minHeight: 44 }}>{t('profileImport.discard')}</Button>
    </div>
    <Dialog className="profile-import-dialog" open={discardOpen} onClose={() => setDiscardOpen(false)} aria-labelledby="discard-import-title">
      <DialogTitle id="discard-import-title">{t('profileImport.discardTitle')}</DialogTitle>
      <DialogContent>{t('profileImport.discardText')}</DialogContent>
      <DialogActions><Button onClick={() => setDiscardOpen(false)}>{t('common.cancel')}</Button><Button color="error" onClick={discard}>{t('profileImport.discard')}</Button></DialogActions>
    </Dialog>
    <style>{`@media (max-width: 700px){.profile-import-compare{grid-template-columns:1fr!important}}@media (prefers-reduced-motion:reduce){.profile-import-compare *{scroll-behavior:auto!important;transition:none!important}}`}</style>
  </section>;
};

export default ProfileImportReview;
