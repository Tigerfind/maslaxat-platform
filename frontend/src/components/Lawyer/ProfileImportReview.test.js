/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n';
import ProfileImportReview from './ProfileImportReview';

global.IS_REACT_ACT_ENVIRONMENT = true;

const draft = {
  headline: '<img src=x onerror=alert(1)>Senior counsel',
  summary: 'Civil practice',
  positions: [],
  education: [],
  skills: [],
  languages: [],
  certificates: [],
  specializations: [],
};

function renderReview(overrides = {}) {
  localStorage.setItem('language', 'ru');
  const service = {
    updateDraft: jest.fn().mockResolvedValue({ import: { version: 4, parsedData: draft } }),
    confirm: jest.fn().mockResolvedValue({ profile: { revision: 3 } }),
    get: jest.fn(),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = {
    importRecord: { id: 'import-1', version: 3, status: 'draft', parsedData: draft, warnings: [] },
    profile: { revision: 2, headline: 'Current headline', description: 'Current summary' },
    service,
    onConfirmed: jest.fn(),
    onDiscarded: jest.fn(),
    ...overrides,
  };
  act(() => root.render(<LanguageProvider><ProfileImportReview {...props} /></LanguageProvider>));
  return { host, service, cleanup: () => act(() => { root.unmount(); host.remove(); }) };
}

test('review renders extracted content as plain text and submits only checked fields', async () => {
  const view = renderReview();
  expect(view.host.querySelector('img')).toBeNull();
  expect(view.host.querySelector('input[aria-label="Заголовок"]').value).toBe('<img src=x onerror=alert(1)>Senior counsel');

  const headline = view.host.querySelector('input[type="checkbox"][value="headline"]');
  act(() => headline.click());
  const confirm = [...view.host.querySelectorAll('button')].find((button) => button.dataset.action === 'confirm-import');
  await act(async () => confirm.click());

  expect(view.service.confirm).toHaveBeenCalledWith('import-1', 4, expect.not.arrayContaining(['headline']), 2, expect.any(Object));
  view.cleanup();
});

test('nested draft inputs use localized visible labels associated with controls', () => {
  const withPosition = {
    ...draft,
    positions: [{ title: 'Counsel', company: 'Firm', location: 'Tashkent', startDate: '2020', endDate: '2024', description: 'Cases' }],
  };
  const view = renderReview({ importRecord: { id: 'import-1', version: 3, status: 'draft', parsedData: withPosition, warnings: [] } });
  const titleInput = view.host.querySelector('input[value="Counsel"]');
  const titleLabel = view.host.querySelector(`label[for="${titleInput.id}"]`);
  expect(titleLabel.textContent).toBe('Должность');
  expect(view.host.textContent).toContain('Компания');
  expect(view.host.textContent).not.toContain('startDate');
  view.cleanup();
});

test('stale profile confirmation shows conflict and requires refreshed reconfirmation', async () => {
  const conflict = Object.assign(new Error('conflict'), { code: 'PROFILE_REVISION_CONFLICT' });
  const onConflict = jest.fn().mockResolvedValue({
    import: { id: 'import-1', version: 4, status: 'draft', parsedData: draft, warnings: [] },
    profile: { revision: 5, headline: 'Changed elsewhere' },
  });
  const view = renderReview({ onConflict });
  view.service.updateDraft
    .mockResolvedValueOnce({ import: { id: 'import-1', version: 4, status: 'draft', parsedData: draft, warnings: [] } })
    .mockResolvedValueOnce({ import: { id: 'import-1', version: 5, status: 'draft', parsedData: draft, warnings: [] } });
  view.service.confirm.mockRejectedValueOnce(conflict);

  const confirm = [...view.host.querySelectorAll('button')].find((button) => button.dataset.action === 'confirm-import');
  await act(async () => confirm.click());

  expect([...view.host.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes('изменён'))).toBe(true);
  expect(onConflict).toHaveBeenCalled();
  expect(view.service.confirm).toHaveBeenCalledTimes(1);
  await act(async () => confirm.click());
  expect(view.service.confirm).toHaveBeenLastCalledWith('import-1', 5, expect.any(Array), 5, expect.any(Object));
  view.cleanup();
});

test('lost confirm response reconciles a matching confirmed version exactly once', async () => {
  const unknown = Object.assign(new Error('network'), { code: 'PROFILE_IMPORT_FAILED' });
  const onConfirmed = jest.fn();
  const view = renderReview({ onConfirmed });
  view.service.confirm.mockRejectedValueOnce(unknown);
  view.service.get.mockResolvedValueOnce({
    import: { id: 'import-1', status: 'confirmed', version: 5, confirmedFromVersion: 4 },
  });

  const confirm = [...view.host.querySelectorAll('button')].find((button) => button.dataset.action === 'confirm-import');
  await act(async () => confirm.click());

  expect(view.service.get).toHaveBeenCalledWith('import-1');
  expect(onConfirmed).toHaveBeenCalledTimes(1);
  expect([...view.host.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes('Не удалось выполнить импорт'))).toBe(false);
  view.cleanup();
});

test('unknown confirm outcome keeps draft selections when reconciliation remains draft', async () => {
  const unknown = Object.assign(new Error('network'), { code: 'PROFILE_IMPORT_FAILED' });
  const view = renderReview();
  view.service.updateDraft
    .mockResolvedValueOnce({ import: { id: 'import-1', version: 4, status: 'draft', parsedData: draft, warnings: [] } })
    .mockResolvedValueOnce({ import: { id: 'import-1', version: 5, status: 'draft', parsedData: draft, warnings: [] } });
  view.service.confirm.mockRejectedValueOnce(unknown);
  view.service.get.mockResolvedValueOnce({
    import: { id: 'import-1', status: 'draft', version: 4, parsedData: draft, warnings: [] },
  });
  const confirm = [...view.host.querySelectorAll('button')].find((button) => button.dataset.action === 'confirm-import');

  await act(async () => confirm.click());
  const firstPaths = view.service.confirm.mock.calls[0][2];
  expect([...view.host.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes('Не удалось выполнить импорт'))).toBe(true);
  await act(async () => confirm.click());
  expect(view.service.confirm.mock.calls[1][2]).toEqual(firstPaths);
  view.cleanup();
});

test('stale refresh failure is caught and rendered instead of escaping the click handler', async () => {
  const conflict = Object.assign(new Error('conflict'), { code: 'IMPORT_VERSION_CONFLICT' });
  const refreshFailure = Object.assign(new Error('offline'), { code: 'PROFILE_IMPORT_FAILED' });
  const view = renderReview({ onConflict: jest.fn().mockRejectedValue(refreshFailure) });
  view.service.confirm.mockRejectedValueOnce(conflict);
  const confirm = [...view.host.querySelectorAll('button')].find((button) => button.dataset.action === 'confirm-import');

  await act(async () => confirm.click());
  expect([...view.host.querySelectorAll('[role="alert"]')].some((node) => node.textContent.includes('Не удалось выполнить импорт'))).toBe(true);
  view.cleanup();
});
