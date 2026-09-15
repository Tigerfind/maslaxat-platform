import React from 'react';
import { vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import DashboardPageGlass from './DashboardPageGlass';

vi.mock('../../services/clientService', () => ({ default: { dashboard: { getDashboard: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/meetingLauncher', () => ({ launchConsultation: vi.fn() }));

test('loads the dashboard from one aggregate endpoint and renders independent metrics', async () => {
  clientService.dashboard.getDashboard.mockResolvedValue({ pendingPaymentsCount: 2, activeCasesCount: 3, unreadMessagesCount: 4, documentsAttentionCount: 1, upcomingDeadlines: [], recentPayments: [], onboarding: {} });
  const store = configureStore({ reducer: { auth: () => ({ user: { name: 'Aziza Karimova' } }) } });
  render(<Provider store={store}><LanguageProvider><MemoryRouter><DashboardPageGlass /></MemoryRouter></LanguageProvider></Provider>);
  expect(await screen.findByText('Ожидают оплаты')).toBeVisible();
  expect(screen.getByText('Активные дела')).toBeVisible();
  expect(clientService.dashboard.getDashboard).toHaveBeenCalledTimes(1);
});
