import React from 'react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import LawyerProfilePage from './LawyerProfilePage';

vi.mock('../../services/clientService', () => ({
  __esModule: true,
  resolvePublicAssetUrl: (value) => value || null,
  default: { lawyers: { getLawyerDetails: vi.fn() } },
}));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../components/BookingModal', () => ({ default: () => null }));

const details = (avatarFields = {}) => ({
  lawyer: {
    id: 'lawyer-1', name: 'Иван Иванов', ...avatarFields,
    profile: {
      specialization: 'Гражданское право', rating: 4.5, reviewsCount: 2,
      completedCases: 3, experience: 5, price: 200000, isAvailable: true,
    },
    receivedReviews: [],
  },
});

function renderProfile() {
  localStorage.setItem('language', 'ru');
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/lawyers/lawyer-1']}>
        <Routes><Route path="/lawyers/:lawyerId" element={<LawyerProfilePage />} /></Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test('показывает avatar/photo и безопасно возвращается к инициалам при ошибке', async () => {
  clientService.lawyers.getLawyerDetails.mockResolvedValue(details({ photo: '/uploads/photo.jpg' }));
  renderProfile();
  const image = await screen.findByRole('img', { name: 'Фото юриста Иван Иванов' });
  expect(image).toHaveAttribute('src', '/uploads/photo.jpg');
  fireEvent.error(image);
  expect(screen.queryByRole('img', { name: 'Фото юриста Иван Иванов' })).not.toBeInTheDocument();
  expect(screen.getByText('ИИ')).toBeVisible();
});

test('без фотографии показывает инициалы, точный рейтинг и честное действие AI', async () => {
  clientService.lawyers.getLawyerDetails.mockResolvedValue(details());
  renderProfile();
  expect(await screen.findByText('ИИ')).toBeVisible();
  expect(screen.getByLabelText('Рейтинг 4.5 из 5, отзывов: 2')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Спросить AI' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Написать' })).not.toBeInTheDocument();
});

test('вкладки поддерживают клавиатуру и всегда имеют связанный tabpanel', async () => {
  clientService.lawyers.getLawyerDetails.mockResolvedValue(details());
  renderProfile();
  const about = await screen.findByRole('tab', { name: 'О юристе' });
  about.focus();
  fireEvent.keyDown(about, { key: 'ArrowRight' });
  const reviews = screen.getByRole('tab', { name: 'Отзывы' });
  expect(reviews).toHaveFocus();
  expect(reviews).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'lawyer-panel-reviews');
});

test('realtime presence не меняет доступность бронирования', async () => {
  const payload = details();
  payload.lawyer.profile.isAvailable = false;
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  await screen.findByRole('heading', { name: 'Иван Иванов' });
  expect(screen.getByRole('button', { name: 'Недоступен для записи' })).toBeDisabled();
  fireEvent(window, new CustomEvent('maslaxat:presence', {
    detail: { userId: 'lawyer-1', role: 'lawyer', online: true },
  }));
  expect(screen.getByText('Онлайн', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Недоступен для записи' })).toBeDisabled();
});

test('старый HTTP snapshot не перезаписывает более новое realtime presence', async () => {
  let resolveDetails;
  clientService.lawyers.getLawyerDetails.mockReturnValue(new Promise((resolve) => { resolveDetails = resolve; }));
  renderProfile();
  fireEvent(window, new CustomEvent('maslaxat:presence', {
    detail: { userId: 'lawyer-1', role: 'lawyer', online: true, observedAt: '2026-08-18T12:00:00.000Z' },
  }));
  const payload = details();
  payload.lawyer.presence = { online: false, observedAt: '2026-08-18T11:59:00.000Z' };
  resolveDetails(payload);
  expect(await screen.findByText('Онлайн', { exact: true })).toBeVisible();
});
