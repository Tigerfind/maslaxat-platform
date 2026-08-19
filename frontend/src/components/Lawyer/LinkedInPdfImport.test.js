/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n';
import LinkedInPdfImport from './LinkedInPdfImport';

global.IS_REACT_ACT_ENVIRONMENT = true;

function renderImport(service, props = {}) {
  localStorage.setItem('language', 'ru');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<LanguageProvider><LinkedInPdfImport service={service} onManual={jest.fn()} {...props} /></LanguageProvider>));
  return { host, cleanup: () => act(() => { root.unmount(); host.remove(); }) };
}

function selectFile(host, file) {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

const flushFileRead = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function waitForCalls(mock, count) {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length < count; attempt += 1) {
    await flushFileRead();
  }
}

test('rejects non-PDF selection before upload and keeps the manual alternative visible', async () => {
  const service = { current: jest.fn().mockResolvedValue({ import: null }), upload: jest.fn() };
  const view = renderImport(service);
  await act(async () => {});
  const input = view.host.querySelector('input[type="file"]');
  const file = new File(['text'], 'profile.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

  expect(service.upload).not.toHaveBeenCalled();
  expect([...view.host.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes('PDF-файл'))).toBe(true);
  expect(view.host.textContent).toContain('Заполнить вручную');
  view.cleanup();
});

test('reload recovery resumes polling and exposes a recovered draft without previewing the PDF', async () => {
  const draft = { id: 'import-1', status: 'draft', version: 2, parsedData: { headline: 'Counsel' }, warnings: [] };
  const service = {
    current: jest.fn().mockResolvedValue({ import: { id: 'import-1', status: 'uploaded' } }),
    poll: jest.fn().mockImplementation(async (_id, { onUpdate }) => { onUpdate(draft); return { import: draft }; }),
  };
  const onReady = jest.fn();
  const view = renderImport(service, { onImportReady: onReady });
  await act(async () => {});

  expect(service.poll).toHaveBeenCalledWith('import-1', expect.objectContaining({ signal: expect.any(Object), onUpdate: expect.any(Function) }));
  expect(onReady).toHaveBeenCalledWith(draft);
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(view.host.querySelector('iframe, embed, object')).toBeNull();
  view.cleanup();
});

test('uncertain upload keeps its key for the same PDF and rotates it for a different fingerprint', async () => {
  const unknown = Object.assign(new Error('network'), { code: 'PROFILE_IMPORT_FAILED' });
  const service = {
    current: jest.fn().mockResolvedValue({ import: null }),
    upload: jest.fn().mockRejectedValue(unknown),
  };
  const view = renderImport(service);
  await act(async () => {});
  const first = new File(['first-pdf'], 'linkedin.pdf', { type: 'application/pdf', lastModified: 1 });
  const second = new File(['second-pdf'], 'linkedin.pdf', { type: 'application/pdf', lastModified: 1 });

  selectFile(view.host, first);
  await waitForCalls(service.upload, 1);
  const firstKey = service.upload.mock.calls[0][1].idempotencyKey;
  selectFile(view.host, first);
  await waitForCalls(service.upload, 2);
  expect(service.upload.mock.calls[1][1].idempotencyKey).toBe(firstKey);
  selectFile(view.host, second);
  await waitForCalls(service.upload, 3);
  expect(service.upload.mock.calls[2][1].idempotencyKey).not.toBe(firstKey);
  expect(service.current).toHaveBeenCalledTimes(4);
  view.cleanup();
});

test('canceling an active upload reconciles a committed server import before polling', async () => {
  const committed = { id: 'committed-1', status: 'uploaded', version: 1 };
  const draftRecord = { ...committed, status: 'draft', version: 3, parsedData: { headline: 'Recovered' }, warnings: [] };
  const service = {
    current: jest.fn()
      .mockResolvedValueOnce({ import: null })
      .mockResolvedValueOnce({ import: committed }),
    upload: jest.fn().mockImplementation((_file, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })), { once: true });
    })),
    poll: jest.fn().mockImplementation(async (_id, { onUpdate }) => { onUpdate(draftRecord); return { import: draftRecord }; }),
  };
  const onReady = jest.fn();
  const view = renderImport(service, { onImportReady: onReady });
  await act(async () => {});
  selectFile(view.host, new File(['pdf'], 'linkedin.pdf', { type: 'application/pdf' }));
  await waitForCalls(service.upload, 1);
  const cancel = [...view.host.querySelectorAll('button')].find((button) => button.textContent.includes('Отменить загрузку'));
  await act(async () => cancel.click());
  await act(async () => {});

  expect(service.current).toHaveBeenCalledTimes(2);
  expect(service.current.mock.calls[1][0].idempotencyKey).toBe(service.upload.mock.calls[0][1].idempotencyKey);
  expect(service.poll).toHaveBeenCalledWith('committed-1', expect.any(Object));
  expect(onReady).toHaveBeenCalledTimes(1);
  view.cleanup();
});

test('response-lost reconciliation recovers only the import matching the current attempt key', async () => {
  const prior = { id: 'prior-confirmed', status: 'confirmed', version: 4, confirmedFromVersion: 3 };
  const committed = { id: 'matching-upload', status: 'uploaded', version: 1 };
  const draftRecord = { ...committed, status: 'draft', version: 2, parsedData: { headline: 'Matching' }, warnings: [] };
  let uploadedKey;
  const service = {
    current: jest.fn().mockImplementation(({ idempotencyKey } = {}) => Promise.resolve({
      import: idempotencyKey && idempotencyKey === uploadedKey ? committed : prior,
    })),
    upload: jest.fn().mockImplementation((_file, options) => {
      uploadedKey = options.idempotencyKey;
      return Promise.reject(Object.assign(new Error('lost response'), { code: 'PROFILE_IMPORT_FAILED' }));
    }),
    poll: jest.fn().mockImplementation(async (_id, { onUpdate }) => { onUpdate(draftRecord); return { import: draftRecord }; }),
  };
  const onReady = jest.fn();
  const onConfirmedRecovery = jest.fn();
  const view = renderImport(service, { onImportReady: onReady, onConfirmedRecovery });
  await act(async () => {});
  expect(onConfirmedRecovery).toHaveBeenCalledWith(prior);

  selectFile(view.host, new File(['matching'], 'linkedin.pdf', { type: 'application/pdf' }));
  await waitForCalls(service.current, 2);
  await act(async () => {});

  expect(service.current.mock.calls[1][0].idempotencyKey).toBe(uploadedKey);
  expect(service.poll).toHaveBeenCalledWith('matching-upload', expect.any(Object));
  expect(onReady).toHaveBeenCalledWith(draftRecord);
  view.cleanup();
});

test('older confirmed import cannot swallow a new parser failure with no matching attempt', async () => {
  const prior = { id: 'prior-confirmed', status: 'confirmed', version: 4, confirmedFromVersion: 3 };
  const parserFailure = Object.assign(new Error('parser unavailable'), { code: 'PDF_IMPORT_UNAVAILABLE', status: 503 });
  const service = {
    current: jest.fn().mockImplementation(({ idempotencyKey } = {}) => Promise.resolve({ import: idempotencyKey ? null : prior })),
    upload: jest.fn().mockRejectedValue(parserFailure),
    poll: jest.fn(),
  };
  const onConfirmedRecovery = jest.fn();
  const view = renderImport(service, { onConfirmedRecovery });
  await act(async () => {});
  expect(onConfirmedRecovery).toHaveBeenCalledTimes(1);

  selectFile(view.host, new File(['new-failed'], 'linkedin.pdf', { type: 'application/pdf' }));
  await waitForCalls(service.current, 2);
  await act(async () => {});

  expect(service.current.mock.calls[1][0].idempotencyKey).toBe(service.upload.mock.calls[0][1].idempotencyKey);
  expect(view.host.textContent).toContain('обработчик PDF сейчас недоступен');
  expect(onConfirmedRecovery).toHaveBeenCalledTimes(1);
  expect(service.poll).not.toHaveBeenCalled();
  view.cleanup();
});

test('unmount aborts an active upload without reconciliation, polling, callbacks or late UI work', async () => {
  const service = {
    current: jest.fn().mockResolvedValue({ import: null }),
    upload: jest.fn().mockImplementation((_file, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('unmounted'), { code: 'ERR_CANCELED' })), { once: true });
    })),
    poll: jest.fn(),
  };
  const onReady = jest.fn();
  const onConfirmedRecovery = jest.fn();
  const view = renderImport(service, { onImportReady: onReady, onConfirmedRecovery });
  await act(async () => {});
  selectFile(view.host, new File(['unmount-pdf'], 'linkedin.pdf', { type: 'application/pdf' }));
  await waitForCalls(service.upload, 1);
  expect(service.upload).toHaveBeenCalledTimes(1);

  view.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(service.current).toHaveBeenCalledTimes(1);
  expect(service.poll).not.toHaveBeenCalled();
  expect(onReady).not.toHaveBeenCalled();
  expect(onConfirmedRecovery).not.toHaveBeenCalled();
});

test('replacement upload invalidates the stale aborted operation before it can reconcile or poll', async () => {
  const stale = { id: 'stale-import', status: 'uploaded', version: 1 };
  const current = { id: 'new-import', status: 'uploaded', version: 1 };
  const currentDraft = { ...current, status: 'draft', version: 2, parsedData: { headline: 'New' }, warnings: [] };
  let uploadCall = 0;
  const service = {
    current: jest.fn()
      .mockResolvedValueOnce({ import: null })
      .mockResolvedValue({ import: stale }),
    upload: jest.fn().mockImplementation((_file, { signal }) => {
      uploadCall += 1;
      if (uploadCall === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('replaced'), { code: 'ERR_CANCELED' })), { once: true });
        });
      }
      return Promise.resolve({ import: current });
    }),
    poll: jest.fn().mockImplementation(async (id, { onUpdate }) => {
      const result = id === current.id ? currentDraft : { ...stale, status: 'draft', parsedData: { headline: 'Stale' }, warnings: [] };
      onUpdate(result);
      return { import: result };
    }),
  };
  const onReady = jest.fn();
  const view = renderImport(service, { onImportReady: onReady });
  await act(async () => {});
  selectFile(view.host, new File(['old-pdf'], 'linkedin.pdf', { type: 'application/pdf' }));
  await flushFileRead();
  selectFile(view.host, new File(['new-pdf'], 'linkedin.pdf', { type: 'application/pdf' }));
  await flushFileRead();
  await waitForCalls(service.poll, 1);

  expect(service.current).toHaveBeenCalledTimes(1);
  expect(service.poll).toHaveBeenCalledTimes(1);
  expect(service.poll).toHaveBeenCalledWith('new-import', expect.any(Object));
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenCalledWith(currentDraft);
  view.cleanup();
});

test('replacement aborts an in-flight reconciliation controller before starting the new upload', async () => {
  const unknown = Object.assign(new Error('network'), { code: 'PROFILE_IMPORT_FAILED' });
  const next = { id: 'replacement-import', status: 'draft', version: 2, parsedData: { headline: 'Replacement' }, warnings: [] };
  let reconciliationSignal;
  const service = {
    current: jest.fn()
      .mockResolvedValueOnce({ import: null })
      .mockImplementationOnce((options = {}) => {
        reconciliationSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('reconciliation replaced'), { code: 'ERR_CANCELED' })), { once: true });
        });
      }),
    upload: jest.fn()
      .mockRejectedValueOnce(unknown)
      .mockResolvedValueOnce({ import: { ...next, status: 'uploaded', version: 1 } }),
    poll: jest.fn().mockImplementation(async (_id, { onUpdate }) => { onUpdate(next); return { import: next }; }),
  };
  const onReady = jest.fn();
  const view = renderImport(service, { onImportReady: onReady });
  await act(async () => {});
  selectFile(view.host, new File(['first'], 'linkedin.pdf', { type: 'application/pdf' }));
  await waitForCalls(service.current, 2);
  expect(service.current).toHaveBeenCalledTimes(2);
  selectFile(view.host, new File(['replacement'], 'linkedin.pdf', { type: 'application/pdf' }));
  await flushFileRead();
  await act(async () => {});

  expect(reconciliationSignal).toBeInstanceOf(AbortSignal);
  expect(reconciliationSignal.aborted).toBe(true);
  expect(service.poll).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenCalledWith(next);
  view.cleanup();
});

test('parser-unavailable response has a clear fail-closed message and no fallback parser', async () => {
  const unavailable = Object.assign(new Error('unavailable'), { code: 'PDF_IMPORT_UNAVAILABLE', status: 503 });
  const service = { current: jest.fn().mockRejectedValue(unavailable) };
  const view = renderImport(service);
  await act(async () => {});

  expect(view.host.textContent).toContain('обработчик PDF сейчас недоступен');
  expect(view.host.textContent).toContain('Заполнить вручную');
  view.cleanup();
});

test('reload recovery reports an already confirmed import once for profile refetch', async () => {
  const confirmed = { id: 'import-confirmed', status: 'confirmed', version: 5, confirmedFromVersion: 4 };
  const service = { current: jest.fn().mockResolvedValue({ import: confirmed }) };
  const onConfirmedRecovery = jest.fn();
  const view = renderImport(service, { onConfirmedRecovery });
  await act(async () => {});
  expect(onConfirmedRecovery).toHaveBeenCalledTimes(1);
  expect(onConfirmedRecovery).toHaveBeenCalledWith(confirmed);
  view.cleanup();
});
