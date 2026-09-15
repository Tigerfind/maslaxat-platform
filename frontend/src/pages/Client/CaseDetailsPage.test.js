import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import CaseDetailsPage from './CaseDetailsPage';

vi.mock('../../services/clientService', () => ({ default: {
  cabinet: { getCase: vi.fn(), updateCase: vi.fn(), archiveCase: vi.fn(), linkCaseItem: vi.fn(), unlinkCaseItem: vi.fn() },
  consultations: { getConsultations: vi.fn() }, documents: { getDocuments: vi.fn() }, lawyers: { getBookableLawyerDetails: vi.fn() },
} }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children, subtitle }) => <main><span>{subtitle}</span>{children}</main> }));
vi.mock('../../components/BookingModal', () => ({ default: () => null }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

test('consumes events, lawyers, counts and unlinks through the typed endpoint', async () => {
  clientService.cabinet.getCase.mockResolvedValue({
    id: 'case-1', title: 'Case', status: 'lawyer_review', messages: { count: 4, unreadCount: 2 }, conversationsCount: 1,
    lawyers: [{ id: 'lawyer-1', name: 'Lawyer One' }], events: [{ id: 'event-1', eventType: 'case_created', createdAt: '2030-01-01T10:00:00Z' }],
    consultations: [{ id: 'consult-1', question: 'Question' }], documents: [], deadlines: [], conversations: [],
  });
  clientService.cabinet.unlinkCaseItem.mockResolvedValue({});
  render(<LanguageProvider><MemoryRouter initialEntries={['/cases/case-1']}><Routes><Route path="/cases/:caseId" element={<CaseDetailsPage />} /></Routes></MemoryRouter></LanguageProvider>);
  expect(await screen.findByText('Проверка юристом')).toBeVisible();
  expect(screen.getByText('Lawyer One')).toBeVisible();
  expect(screen.getByText(/Сообщения: 4/)).toBeVisible();
  expect(screen.getByText('Дело создано')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Отвязать' }));
  await waitFor(() => expect(clientService.cabinet.unlinkCaseItem).toHaveBeenCalledWith('case-1', 'consultation', 'consult-1'));
});
