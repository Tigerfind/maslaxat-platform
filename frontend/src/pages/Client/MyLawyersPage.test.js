import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import MyLawyersPage from './MyLawyersPage';

vi.mock('../../services/clientService', () => ({ default: { favorites: { getFavorites: vi.fn(), removeFavorite: vi.fn() }, cabinet: { getLawyerHistory: vi.fn() }, lawyers: { getBookableLawyerDetails: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../components/BookingModal', () => ({ default: ({ open, lawyer }) => open ? <div data-testid="booking-lawyer">{lawyer.id}</div> : null }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  clientService.favorites.getFavorites.mockResolvedValue([{ id: 'lawyer-7', name: 'Current Lawyer', profile: { isAvailable: true } }]);
  clientService.cabinet.getLawyerHistory.mockResolvedValue({ lawyers: [], totalPages: 1 });
});

test('rebooks by current lawyer ID without carrying an old question', async () => {
  clientService.lawyers.getBookableLawyerDetails.mockResolvedValue({ id: 'lawyer-7', name: 'Current Lawyer', isAvailable: true });
  render(<LanguageProvider><MemoryRouter><MyLawyersPage /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Записаться снова' }));
  expect(clientService.lawyers.getBookableLawyerDetails).toHaveBeenCalledWith('lawyer-7');
  expect(await screen.findByTestId('booking-lawyer')).toHaveTextContent('lawyer-7');
});

test('rolls back optimistic favorite removal when the request fails', async () => {
  clientService.favorites.removeFavorite.mockRejectedValue(new Error('network'));
  render(<LanguageProvider><MemoryRouter><MyLawyersPage /></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить из избранного' }));
  await waitFor(() => expect(screen.getByText('Current Lawyer')).toBeVisible());
});
