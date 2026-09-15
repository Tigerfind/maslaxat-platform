import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import CasesPage, { CASE_EDITABLE_STATUSES, CASE_STATUSES } from './CasesPage';

vi.mock('../../services/clientService', () => ({ default: { cabinet: { getCases: vi.fn(), createCase: vi.fn(), archiveCase: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

test('creates a case and refreshes the list', async () => {
  clientService.cabinet.getCases.mockResolvedValue({ cases: [], totalPages: 1 });
  clientService.cabinet.createCase.mockResolvedValue({ id: 'case-1' });
  render(<LanguageProvider><MemoryRouter><CasesPage /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Новое дело' }));
  fireEvent.change(screen.getByLabelText(/Название дела/), { target: { value: 'Наследство' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(clientService.cabinet.createCase).toHaveBeenCalledWith(expect.objectContaining({ title: 'Наследство', status: 'draft' })));
});

test('only exposes backend-supported case statuses', () => {
  expect(CASE_STATUSES).toEqual(['draft', 'collecting_documents', 'lawyer_review', 'consultation_scheduled', 'in_progress', 'waiting_for_client', 'waiting_for_lawyer', 'resolved', 'closed', 'archived']);
  expect(CASE_STATUSES).not.toContain('active');
  expect(CASE_STATUSES).not.toContain('on_hold');
  expect(CASE_EDITABLE_STATUSES).not.toContain('archived');
});
