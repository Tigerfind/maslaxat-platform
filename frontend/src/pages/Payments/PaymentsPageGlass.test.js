import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import PaymentsPageGlass, { displayStatus } from './PaymentsPageGlass';

vi.mock('../../services/clientService', () => ({ default: { payments: { getMy: vi.fn(), getStatus: vi.fn(), getReceipt: vi.fn() }, lawyers: { payConsultation: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

test('checks authoritative payment status from the status endpoint', async () => {
  clientService.payments.getMy.mockResolvedValue({ payments: [{ id: 'p1', amount: 100000, status: 'pending', consultationId: 'c1' }], totalPages: 1 });
  clientService.payments.getStatus.mockResolvedValue({ status: 'paid' });
  render(<LanguageProvider><MemoryRouter><PaymentsPageGlass /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Проверить статус' }));
  await waitFor(() => expect(clientService.payments.getStatus).toHaveBeenCalledWith('p1'));
});

test.each([
  [{ status: 'paid', refundStatus: 'none' }, 'paid'],
  [{ status: 'paid', refundStatus: 'requested' }, 'refund_pending'],
  [{ status: 'paid', refundStatus: 'completed' }, 'refunded'],
  [{ status: 'paid', refundStatus: 'failed' }, 'refund_failed'],
])('maps refund state %#', (payment, expected) => {
  expect(displayStatus(payment)).toBe(expected);
});

test('sends the refunds filter exactly as supported by the backend', async () => {
  clientService.payments.getMy.mockResolvedValue({ payments: [], totalPages: 1 });
  render(<LanguageProvider><MemoryRouter><PaymentsPageGlass /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Возвраты' }));
  await waitFor(() => expect(clientService.payments.getMy).toHaveBeenLastCalledWith(
    { status: 'refunds', page: 1, limit: 15 },
  ));
});
