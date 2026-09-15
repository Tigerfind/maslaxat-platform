import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import DeadlinesPage, { buildDeadlinePayload } from './DeadlinesPage';

vi.mock('../../services/clientService', () => ({ default: { cabinet: { getDeadlines: vi.fn(), getCases: vi.fn(), updateDeadline: vi.fn(), createDeadline: vi.fn(), completeDeadline: vi.fn(), deleteDeadline: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

test('completes a deadline through its nested case endpoint service', async () => {
  clientService.cabinet.getDeadlines.mockResolvedValue({ deadlines: [{ id: 'd1', clientCaseId: 'c1', clientCase: { title: 'Case' }, title: 'Appeal', dueAt: '2030-01-01T10:00:00Z' }], totalPages: 1 });
  clientService.cabinet.getCases.mockResolvedValue({ cases: [] });
  clientService.cabinet.completeDeadline.mockResolvedValue({});
  render(<LanguageProvider><MemoryRouter><DeadlinesPage /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Завершить' }));
  await waitFor(() => expect(clientService.cabinet.completeDeadline).toHaveBeenCalledWith('c1', 'd1'));
});

test('builds the backend reminder array instead of a top-level reminder value', () => {
  const payload = buildDeadlinePayload({ title: 'Appeal', source: 'manual', dueAt: '2030-01-01T10:00', reminderMinutes: 60 }, 'Asia/Tashkent');
  expect(payload).toMatchObject({ reminders: [{ intervalMinutes: 60, channel: 'in_app' }], timezone: 'Asia/Tashkent' });
  expect(payload).not.toHaveProperty('reminderMinutes');
});
