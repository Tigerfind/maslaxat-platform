import React from 'react';
import { vi } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import api from '../../services/api';
import { toast } from 'react-toastify';
import LawyersPageGlass from './LawyersPageGlass';

vi.mock('../../services/clientService', () => ({
  __esModule: true,
  LAWYER_MAX_PRICE: 10000000,
  default: {
    lawyers: { searchLawyers: vi.fn(), getFilterOptions: vi.fn() },
    favorites: { getFavorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() },
  },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../components/BookingModal', () => ({ default: () => null }));
vi.mock('../../components/UI/Skeleton', () => ({ SkeletonCard: () => <div>loading-card</div> }));

const lawyer = (id, name, extra = {}) => ({
  id, name, avatar: null, rating: 4.5, reviewsCount: 2, completedConsultations: 3,
  specializations: ['Гражданское право'], experience: 5, priceFrom: 200000,
  isAvailable: false, online: false, verificationStatus: 'approved', ...extra,
});

const result = (lawyers) => ({ lawyers, total: lawyers.length, totalPages: 1, facets: null });

function renderPage() {
  const store = configureStore({
    reducer: {
      specializations: () => ({ specializations: [] }),
      auth: () => ({ user: { id: 'client-1' } }),
    },
  });
  return render(
    <Provider store={store}>
      <LanguageProvider><MemoryRouter><LawyersPageGlass /></MemoryRouter></LanguageProvider>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('language', 'ru');
  api.get.mockResolvedValue({ data: { freeNow: false } });
  clientService.lawyers.searchLawyers.mockResolvedValue(result([lawyer('1', 'Иван Иванов')]));
  clientService.lawyers.getFilterOptions.mockResolvedValue({ locations: [], languages: [] });
  clientService.favorites.getFavorites.mockResolvedValue([]);
  clientService.favorites.addFavorite.mockResolvedValue({});
  clientService.favorites.removeFavorite.mockResolvedValue({});
});

afterEach(() => vi.useRealTimers());

test('показывает бесплатную консультацию только при freeNow=true', async () => {
  api.get.mockResolvedValueOnce({ data: { freeNow: true } });
  const { unmount } = renderPage();
  expect(await screen.findByText('Первая консультация — бесплатно')).toBeVisible();
  expect(screen.getByLabelText('Рейтинг 4.5 из 5')).toBeVisible();
  unmount();

  api.get.mockResolvedValueOnce({ data: { freeNow: false } });
  renderPage();
  await screen.findByText('Иван Иванов');
  expect(screen.queryByText('Первая консультация — бесплатно')).not.toBeInTheDocument();
});

test('различает пустой результат и ошибку с повтором', async () => {
  clientService.lawyers.searchLawyers.mockResolvedValueOnce(result([]));
  const { unmount } = renderPage();
  expect(await screen.findByText('Юристы не найдены')).toBeVisible();
  unmount();

  clientService.lawyers.searchLawyers.mockRejectedValueOnce(new Error('network'));
  renderPage();
  expect(await screen.findByText('Не удалось загрузить юристов')).toBeVisible();
  expect(screen.queryByText('Юристы не найдены')).not.toBeInTheDocument();
  clientService.lawyers.searchLawyers.mockResolvedValueOnce(result([lawyer('2', 'Анна Юрист')]));
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Анна Юрист')).toBeVisible();
});

test('debounce отправляет только финальный поиск и старый ответ не перезаписывает новый', async () => {
  vi.useFakeTimers();
  let resolveOld;
  let resolveNew;
  const oldRequest = new Promise((resolve) => { resolveOld = resolve; });
  const newRequest = new Promise((resolve) => { resolveNew = resolve; });
  clientService.lawyers.searchLawyers
    .mockResolvedValueOnce(result([lawyer('0', 'Начальный Юрист')]))
    .mockReturnValueOnce(oldRequest)
    .mockReturnValueOnce(newRequest);
  renderPage();
  await screen.findByText('Начальный Юрист');
  const input = screen.getByPlaceholderText('Поиск по имени или специализации...');

  fireEvent.change(input, { target: { value: 'ста' } });
  await act(async () => { vi.advanceTimersByTime(350); });
  fireEvent.change(input, { target: { value: 'стаж' } });
  await act(async () => { vi.advanceTimersByTime(350); });
  expect(clientService.lawyers.searchLawyers).toHaveBeenCalledTimes(3);
  expect(clientService.favorites.getFavorites).toHaveBeenCalledTimes(1);

  await act(async () => { resolveNew(result([lawyer('2', 'Новый Ответ')])); });
  expect(await screen.findByText('Новый Ответ')).toBeVisible();
  await act(async () => { resolveOld(result([lawyer('1', 'Старый Ответ')])); });
  expect(screen.queryByText('Старый Ответ')).not.toBeInTheDocument();
  expect(screen.getByText('Новый Ответ')).toBeVisible();
});

test('избранное обновляется локально и откатывается при ошибке', async () => {
  clientService.favorites.addFavorite.mockRejectedValueOnce(new Error('failed'));
  renderPage();
  const add = await screen.findByRole('button', { name: 'Добавить Иван Иванов в избранное' });
  fireEvent.click(add);
  expect(screen.getByRole('button', { name: 'Удалить Иван Иванов из избранного' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Добавить Иван Иванов в избранное' })).toBeEnabled());
  expect(toast.error).toHaveBeenCalledWith('Ошибка при изменении избранного');
});

test('Онлайн показывается только при явном isAvailable=true, отсутствие рейтинга не подменяется нулём', async () => {
  clientService.lawyers.searchLawyers.mockResolvedValueOnce(result([
    lawyer('1', 'Нет Статуса', { rating: 0, isAvailable: false }),
    lawyer('2', 'Доступный Юрист', { isAvailable: true, online: true }),
  ]));
  renderPage();
  await screen.findByText('Нет Статуса');
  expect(screen.getAllByText('Онлайн', { exact: true })).toHaveLength(1);
  expect(screen.getByText('Нет оценок')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Недоступен для записи' })).toBeDisabled();
});

test('presence event обновляет онлайн независимо от booking availability', async () => {
  clientService.lawyers.searchLawyers.mockResolvedValueOnce(result([
    lawyer('1', 'Socket Юрист', { isAvailable: false, online: false }),
  ]));
  renderPage();
  await screen.findByText('Socket Юрист');
  expect(screen.queryByText('Онлайн', { exact: true })).not.toBeInTheDocument();
  act(() => {
    window.dispatchEvent(new CustomEvent('maslaxat:presence', {
      detail: { userId: '1', role: 'lawyer', online: true },
    }));
  });
  expect(screen.getByText('Онлайн', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Недоступен для записи' })).toBeDisabled();
});

test('избранное недоступно до загрузки достоверного snapshot', async () => {
  let resolveFavorites;
  clientService.favorites.getFavorites.mockReturnValueOnce(new Promise((resolve) => { resolveFavorites = resolve; }));
  renderPage();
  await screen.findByText('Иван Иванов');
  expect(screen.getByRole('button', { name: 'Избранное временно недоступно' })).toBeDisabled();
  await act(async () => { resolveFavorites([]); });
  expect(screen.getByRole('button', { name: 'Добавить Иван Иванов в избранное' })).toBeEnabled();
});

test('ошибка загрузки избранного имеет retry и восстанавливает управление', async () => {
  clientService.favorites.getFavorites
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce([]);
  renderPage();
  expect(await screen.findByText('Не удалось загрузить избранное')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Добавить Иван Иванов в избранное' })).toBeEnabled());
  expect(clientService.favorites.getFavorites).toHaveBeenCalledTimes(2);
});

test('сломанная фотография карточки возвращается к инициалам', async () => {
  clientService.lawyers.searchLawyers.mockResolvedValueOnce(result([lawyer('1', 'Иван Иванов', { avatar: '/broken.jpg' })]));
  renderPage();
  const profileButton = await screen.findByRole('button', { name: 'Открыть профиль юриста Иван Иванов' });
  const image = screen.getByTestId('lawyer-avatar-1');
  expect(image).toBeInTheDocument();
  fireEvent.error(image);
  expect(screen.queryByTestId('lawyer-avatar-1')).not.toBeInTheDocument();
  expect(profileButton).toHaveTextContent('ИИ');
});
