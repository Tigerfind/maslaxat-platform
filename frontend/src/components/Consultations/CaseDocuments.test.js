import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LanguageProvider } from '../../i18n';
import api from '../../services/api';
import CaseDocuments from './CaseDocuments';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const renderDocuments = (props = {}) => render(
  <LanguageProvider>
    <CaseDocuments consultationId="consultation-1" open onClose={vi.fn()} currentUserId="user-1" {...props} />
  </LanguageProvider>,
);

describe('CaseDocuments states', () => {
  beforeEach(() => {
    localStorage.setItem('language', 'ru');
    vi.clearAllMocks();
  });

  test('shows a persistent load error and retries independently from empty state', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { documents: [], writable: true } });
    renderDocuments();
    expect(await screen.findByText('Не удалось загрузить документы')).toBeInTheDocument();
    expect(screen.queryByText('Пока нет документов по делу')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Пока нет документов по делу')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('shows upload only when both server policy and prop allow writes', async () => {
    api.get.mockResolvedValue({ data: { documents: [], writable: true } });
    const view = renderDocuments({ readOnly: true });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Загрузить документ' })).not.toBeInTheDocument();
    view.unmount();

    renderDocuments();
    expect(await screen.findByRole('button', { name: 'Загрузить документ' })).toBeInTheDocument();
  });
});
