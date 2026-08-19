import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, LinearProgress } from '@mui/material';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export const validateLinkedinPdf = (file) => Boolean(file
  && file.type === 'application/pdf'
  && file.name.toLowerCase().endsWith('.pdf')
  && file.size > 0
  && file.size <= MAX_PDF_BYTES);

const makeIdempotencyKey = () => {
  if (window.crypto?.randomUUID) return `linkedin-${window.crypto.randomUUID()}`;
  return `linkedin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const readFileBytes = (file) => {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_FAILED'));
    reader.readAsArrayBuffer(file);
  });
};

export const fingerprintPdf = async (file) => {
  const bytes = new Uint8Array(await readFileBytes(file));
  let first = 2166136261;
  let second = 2246822519;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 16777619) >>> 0;
    second = Math.imul(second ^ byte, 3266489917) >>> 0;
  }
  return `${bytes.length}:${first.toString(16)}:${second.toString(16)}`;
};

const LinkedInPdfImport = ({
  service = lawyerService.imports,
  onImportReady,
  onConfirmedRecovery,
  onManual,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState('recovering');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const pollController = useRef(null);
  const uploadController = useRef(null);
  const reconciliationController = useRef(null);
  const mounted = useRef(false);
  const uploadGeneration = useRef(0);
  const attempt = useRef({ fingerprint: null, key: makeIdempotencyKey() });
  const activeRecord = useRef(null);
  const terminalRecord = useRef(null);
  const lastCallback = useRef('');

  const rotateAttempt = () => {
    attempt.current = { fingerprint: null, key: makeIdempotencyKey() };
  };

  const isCurrentOperation = (generation) => (
    mounted.current && uploadGeneration.current === generation
  );

  const stopPolling = () => {
    if (!mounted.current) return;
    uploadGeneration.current += 1;
    pollController.current?.abort();
    pollController.current = null;
    setStatus('idle');
  };

  const handleTerminal = (record, generation = uploadGeneration.current) => {
    if (!isCurrentOperation(generation)) return;
    if (!record) { setStatus('idle'); return; }
    activeRecord.current = record;
    if (record.expiresAt && new Date(record.expiresAt) <= new Date() && record.status !== 'confirmed') {
      terminalRecord.current = record;
      rotateAttempt();
      setStatus('expired'); return;
    }
    if (record.status === 'draft') {
      setStatus(record.status);
      const signature = `${record.id}:${record.status}:${record.version}`;
      if (lastCallback.current !== signature) {
        lastCallback.current = signature;
        onImportReady?.(record);
      }
      return;
    }
    if (record.status === 'confirmed') {
      const signature = `${record.id}:${record.status}:${record.version}`;
      if (lastCallback.current !== signature) {
        lastCallback.current = signature;
        onConfirmedRecovery?.(record);
      }
      setStatus('idle'); return;
    }
    if (record.status === 'failed') {
      terminalRecord.current = record;
      rotateAttempt();
      setStatus('failed'); return;
    }
    setStatus(record.status);
  };

  const reconcileCurrent = async ({ canceled = false, generation } = {}) => {
    if (!isCurrentOperation(generation)) return false;
    reconciliationController.current?.abort();
    const controller = new AbortController();
    reconciliationController.current = controller;
    try {
      const result = await service.current({
        signal: controller.signal,
        idempotencyKey: attempt.current.key,
      });
      if (!isCurrentOperation(generation) || controller.signal.aborted) return false;
      const record = result.import;
      if (record && record.id !== activeRecord.current?.id) activeRecord.current = record;
      if (['uploaded', 'parsing'].includes(record?.status)) await poll(record, generation);
      else handleTerminal(record, generation);
      if (!isCurrentOperation(generation)) return false;
      if (!record && canceled) setStatus('idle');
      return Boolean(record);
    } catch (reconcileError) {
      if (isCurrentOperation(generation) && reconcileError.code !== 'ERR_CANCELED') {
        setError(reconcileError.code || 'PROFILE_IMPORT_FAILED');
        setStatus('error');
      }
      return false;
    } finally {
      if (reconciliationController.current === controller) reconciliationController.current = null;
    }
  };

  const poll = async (record, generation = uploadGeneration.current) => {
    if (!isCurrentOperation(generation)) return;
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    setStatus(record.status);
    try {
      const result = await service.poll(record.id, {
        signal: controller.signal,
        onUpdate: (nextRecord) => handleTerminal(nextRecord, generation),
      });
      if (!isCurrentOperation(generation) || controller.signal.aborted) return;
      handleTerminal(result.import, generation);
    } catch (requestError) {
      if (isCurrentOperation(generation) && requestError.code !== 'ERR_CANCELED') {
        setError(requestError.code || 'PROFILE_IMPORT_FAILED');
        setStatus('error');
      }
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }
  };

  useEffect(() => {
    mounted.current = true;
    const generation = uploadGeneration.current;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await service.current({ signal: controller.signal });
        if (!isCurrentOperation(generation) || controller.signal.aborted) return;
        const record = result.import;
        if (['uploaded', 'parsing'].includes(record?.status)) await poll(record, generation);
        else handleTerminal(record, generation);
      } catch (requestError) {
        if (isCurrentOperation(generation) && requestError.code !== 'ERR_CANCELED') {
          setError(requestError.code || 'PROFILE_IMPORT_FAILED');
          setStatus(requestError.code === 'PDF_IMPORT_UNAVAILABLE' ? 'unavailable' : 'error');
        }
      }
    })();
    return () => {
      mounted.current = false;
      uploadGeneration.current += 1;
      controller.abort();
      pollController.current?.abort();
      uploadController.current?.abort();
      reconciliationController.current?.abort();
    };
  // The injected service and callback are stable integration boundaries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (file) => {
    if (!validateLinkedinPdf(file)) {
      if (!mounted.current) return;
      setError('INVALID_FILE_SELECTION');
      setStatus('error');
      return;
    }
    const generation = uploadGeneration.current + 1;
    uploadGeneration.current = generation;
    reconciliationController.current?.abort();
    pollController.current?.abort();
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    if (!isCurrentOperation(generation)) return;
    setError(''); setProgress(0); setStatus('uploading');
    try {
      const fingerprint = await fingerprintPdf(file);
      if (!isCurrentOperation(generation)) return;
      if (controller.signal.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
      if (attempt.current.fingerprint && attempt.current.fingerprint !== fingerprint) rotateAttempt();
      attempt.current.fingerprint = fingerprint;
      const result = await service.upload(file, {
        signal: controller.signal,
        idempotencyKey: attempt.current.key,
        onProgress: (value) => {
          if (isCurrentOperation(generation)) setProgress(value);
        },
      });
      if (!isCurrentOperation(generation)) return;
      if (controller.signal.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
      activeRecord.current = result.import;
      await poll(result.import, generation);
    } catch (requestError) {
      if (!isCurrentOperation(generation)) return;
      const reconciled = await reconcileCurrent({
        canceled: requestError.code === 'ERR_CANCELED',
        generation,
      });
      if (!isCurrentOperation(generation)) return;
      if (!reconciled && requestError.code !== 'ERR_CANCELED') {
        setError(requestError.code || 'PROFILE_IMPORT_FAILED');
        setStatus(requestError.code === 'PDF_IMPORT_UNAVAILABLE' ? 'unavailable' : 'error');
      }
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
    }
  };

  const cancelUpload = () => uploadController.current?.abort();

  const discardTerminal = async () => {
    const record = terminalRecord.current;
    if (!record?.id) { rotateAttempt(); setStatus('idle'); return; }
    try {
      await service.discard(record.id);
      terminalRecord.current = null;
      activeRecord.current = null;
      rotateAttempt();
      setError('');
      setStatus('idle');
    } catch (requestError) {
      setError(requestError.code || 'PROFILE_IMPORT_FAILED');
      setStatus('error');
    }
  };

  const message = {
    recovering: t('profileImport.recover'),
    uploaded: t('profileImport.parsing'),
    parsing: t('profileImport.parsing'),
    failed: t('profileImport.failed'),
    expired: t('profileImport.expired'),
    unavailable: t('profileImport.unavailable'),
  }[status];

  return <section className="linkedin-import-root" aria-labelledby="linkedin-import-title" style={{ padding: 20, border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', background: 'var(--card-glass)' }}>
    <h2 id="linkedin-import-title" style={{ margin: '0 0 8px', fontSize: 20 }}>{t('profileImport.title')}</h2>
    <p style={{ color: 'var(--text2)', lineHeight: 1.6 }}>{t('profileImport.intro')}</p>
    <div aria-live="polite">
      {status === 'uploading' && <><div>{t('profileImport.uploading', { n: progress })}</div><LinearProgress className="linkedin-import-progress" variant="determinate" value={progress} aria-label={t('profileImport.uploading', { n: progress })} sx={{ my: 1 }} /></>}
      {message && <Alert severity={['failed', 'expired', 'unavailable'].includes(status) ? 'warning' : 'info'}>{message}</Alert>}
      {error === 'INVALID_FILE_SELECTION' && <Alert role="alert" severity="error">{t('profileImport.pdfOnly')}</Alert>}
      {error && error !== 'INVALID_FILE_SELECTION' && status === 'error' && <Alert role="alert" severity="error">{t(`profileImport.error_${error}`)}</Alert>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
      <Button component="label" variant="contained" disabled={['uploading', 'uploaded', 'parsing', 'recovering', 'draft', 'failed', 'expired'].includes(status)} sx={{ minHeight: 44 }}>
        {t('profileImport.choosePdf')}
        <input hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
      </Button>
      <Button variant="outlined" onClick={onManual} sx={{ minHeight: 44 }}>{t('profileImport.manual')}</Button>
      {status === 'uploading' && <Button onClick={cancelUpload} sx={{ minHeight: 44 }}>{t('profileImport.cancelUpload')}</Button>}
      {['uploaded', 'parsing'].includes(status) && <Button onClick={stopPolling} sx={{ minHeight: 44 }}>{t('profileImport.cancelPolling')}</Button>}
      {['failed', 'expired'].includes(status) && <Button onClick={discardTerminal} sx={{ minHeight: 44 }}>{t('profileImport.discardUploadAgain')}</Button>}
    </div>
  </section>;
};

export default LinkedInPdfImport;
