import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { LanguageProvider } from '../../i18n';
import ConsultationCard from './ConsultationCard';

const renderCard = (consultation, props = {}) => render(
  <LanguageProvider>
    <MemoryRouter>
      <ConsultationCard consultation={consultation} showTimeline={false} onAction={vi.fn()} {...props} />
    </MemoryRouter>
  </LanguageProvider>,
);

beforeEach(() => localStorage.setItem('language', 'ru'));

test('expired payment replaces pay with safe same-lawyer rebook', () => {
  const onAction = vi.fn();
  const consultation = {
    id: 'c1', status: 'payment_pending', paymentExpiresAt: '2020-01-01T00:00:00Z',
    lawyerId: 'l1', lawyer: { id: 'l1', name: 'Юрист' },
    policy: { status: 'payment_pending', statusKnown: true, availableActions: ['view_details', 'pay', 'cancel'] },
  };
  renderCard(consultation, { now: Date.now(), onAction });
  expect(screen.queryByRole('button', { name: 'Оплатить' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Записаться снова' }));
  expect(onAction).toHaveBeenCalledWith('rebook', consultation);
});

test('stale TOO_EARLY policy keeps join disabled after its old timestamp', () => {
  renderCard({
    id: 'c2', status: 'accepted', type: 'video', meetingProvider: 'webrtc', lawyer: { id: 'l1', name: 'Юрист' },
    policy: { status: 'accepted', statusKnown: true, availableActions: ['view_details'], canJoin: false, reason: 'TOO_EARLY', joinAvailableAt: '2020-01-01T00:00:00Z' },
  });
  expect(screen.getByRole('button', { name: 'Войти в видео' })).toBeDisabled();
  expect(screen.getByText(/Подключение откроется/)).toBeInTheDocument();
});

test('rebook is disabled when the consultation has no lawyer identity', () => {
  renderCard({
    id: 'c3', status: 'completed', lawyer: { name: 'Недоступный юрист' },
    policy: { status: 'completed', statusKnown: true, availableActions: ['rebook'] },
  });
  expect(screen.getByRole('button', { name: 'Записаться снова' })).toBeDisabled();
});

test('an active mutation disables every action for that consultation only', () => {
  renderCard({
    id: 'c4', status: 'pending', lawyerId: 'l1', lawyer: { id: 'l1', name: 'Юрист' },
    policy: { status: 'pending', statusKnown: true, availableActions: ['view_details', 'reschedule', 'cancel'] },
  }, { loadingAction: new Set(['c4:cancel']) });
  expect(screen.getByRole('button', { name: 'Подробнее' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Перенести' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Подождите…' })).toBeDisabled();
});

test('unknown backend status is localized without exposing the raw lifecycle value', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderCard({
    id: 'c5', status: 'internal_future_state', lawyer: { name: 'Юрист' },
    policy: { status: 'unknown', statusKnown: false, availableActions: [] },
  });
  expect(screen.getByText('Неизвестный статус')).toBeInTheDocument();
  expect(screen.queryByText(/internal_future_state/)).not.toBeInTheDocument();
});
