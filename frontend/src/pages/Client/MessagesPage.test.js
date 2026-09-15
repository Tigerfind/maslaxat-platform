import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import MessagesPage from './MessagesPage';

vi.mock('../../services/clientService', () => ({ default: { cabinet: { getMessages: vi.fn() } } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));

test('opens the existing consultation chat and never an AI conversation', async () => {
  clientService.cabinet.getMessages.mockResolvedValue({ conversations: [{ id: 'row-1', consultationId: 'consult-9', partner: { name: 'Lawyer Nine' }, lastMessage: { excerpt: 'Hello' }, consultationStatus: 'accepted', unreadCount: 2 }], totalPages: 1, totalUnread: 2 });
  render(<LanguageProvider><MemoryRouter initialEntries={['/messages']}><Routes><Route path="/messages" element={<MessagesPage />} /><Route path="/consultations/chat/:id" element={<div>consultation-chat</div>} /></Routes></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /Lawyer Nine/i }));
  expect(await screen.findByText('consultation-chat')).toBeVisible();
});
