import React from 'react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../../i18n';
import clientService from '../../services/clientService';
import LawyerProfilePage from './LawyerProfilePage';

vi.mock('../../services/clientService', () => ({
  __esModule: true,
  resolvePublicAssetUrl: (value) => value || null,
  default: {
    lawyers: { getLawyerDetails: vi.fn(), getAvailableSlots: vi.fn(), getReviews: vi.fn() },
    favorites: { getFavorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() },
  },
}));
vi.mock('../../components/GlassKit/GlassShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../components/BookingModal', () => ({
  default: ({ open, lawyer }) => open ? <div role="dialog" data-testid="booking-lawyer">{lawyer?.id}</div> : null,
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fullDetails = (overrides = {}) => ({
  lawyer: {
    id: 'lawyer-1', name: 'Иван Иванов', avatar: '/uploads/photo.jpg',
    profile: {
      isVerifiedLawyer: true,
      professionalTitle: 'Адвокат по гражданским делам',
      specialization: 'Гражданское право', specializations: ['Гражданское право', 'Семейное право'],
      description: 'Помогаю клиентам разобраться в сложных правовых вопросах.\nРаботаю внимательно и последовательно.',
      rating: 4.5, reviewsCount: 2, completedCases: 18, experience: 8,
      price: 200000, isAvailable: true, location: 'Ташкент', region: 'Ташкент', languages: ['ru', 'uz'],
      consultationFormats: ['chat', 'webrtc'], consultationDurations: [30, 60, 90], zoomAvailable: false,
      verifiedDocumentTypes: ['license'], medianResponseMinutes: 45,
      licenseNumber: 'UZ-123', licenseIssuer: 'Палата адвокатов', licenseIssuedAt: '2020-01-01', licenseExpiresAt: '2030-01-01',
    },
    presence: { online: true, observedAt: '2026-09-10T10:00:00.000Z' },
    lawyerExperiences: [{ id: 'x1', position: 'Адвокат', organization: 'Коллегия адвокатов', startDate: '2020-01-01', isCurrent: true, description: 'Судебное представительство' }],
    lawyerEducations: [{ id: 'e1', university: 'ТГЮУ', specialty: 'Юриспруденция', degree: 'Магистр', startYear: 2014, endYear: 2020, city: 'Ташкент', country: 'Узбекистан' }],
    lawyerCertificates: [{ id: 'c1', title: 'Медиация', organization: 'Центр медиации', issuedAt: '2024-04-01', credentialUrl: 'https://example.uz/certificate' }],
    ...overrides,
  },
});

const reviewsEnvelope = {
  reviews: [{ id: 'r1', rating: 4.5, text: 'Очень полезная консультация', createdAt: '2026-08-10T10:00:00.000Z', helpfulCount: 3, verifiedConsultation: true, client: { name: 'Алина К.' } }],
  page: 1, totalPages: 1, total: 1,
  summary: { rating: 4.5, reviewsCount: 2, distribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 } },
};

function renderProfile(initialEntry = '/lawyers/lawyer-1') {
  localStorage.setItem('language', 'ru');
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes><Route path="/lawyers/:lawyerId" element={<LawyerProfilePage />} /><Route path="/lawyers" element={<div>Каталог</div>} /><Route path="/ai-chat" element={<div>AI</div>} /></Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clientService.lawyers.getLawyerDetails.mockResolvedValue(fullDetails());
  clientService.lawyers.getAvailableSlots.mockReturnValue(new Promise(() => {}));
  clientService.lawyers.getReviews.mockReturnValue(new Promise(() => {}));
  clientService.favorites.getFavorites.mockReturnValue(new Promise(() => {}));
  clientService.favorites.addFavorite.mockResolvedValue({});
  clientService.favorites.removeFavorite.mockResolvedValue({});
});

test('показывает крупную фотографию и безопасно возвращается к инициалам при ошибке', async () => {
  renderProfile();
  const image = await screen.findByRole('img', { name: 'Фото юриста Иван Иванов' });
  expect(image).toHaveAttribute('src', '/uploads/photo.jpg');
  fireEvent.error(image);
  expect(screen.queryByRole('img', { name: 'Фото юриста Иван Иванов' })).not.toBeInTheDocument();
  expect(screen.getByText('ИИ')).toBeVisible();
});

test('без фотографии показывает инициалы, точный половинчатый рейтинг и реальные метрики', async () => {
  const payload = fullDetails();
  payload.lawyer.avatar = null;
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  expect(await screen.findByText('ИИ')).toBeVisible();
  expect(screen.getByLabelText('Рейтинг 4.5 из 5, отзывов: 2')).toBeVisible();
  expect(screen.getByText(/18/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Спросить AI' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Написать' })).not.toBeInTheDocument();
});

test('показывает проверку только по явному серверному флагу', async () => {
  const first = renderProfile();
  expect(await screen.findByText('Проверенный юрист')).toBeVisible();
  first.unmount();

  const payload = fullDetails();
  payload.lawyer.profile.isVerifiedLawyer = false;
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile('/lawyers/lawyer-2');
  await screen.findByRole('heading', { name: 'Иван Иванов' });
  expect(screen.queryByText('Проверенный юрист')).not.toBeInTheDocument();
});

test('Онлайн виден только когда presence и доступность бронирования истинны', async () => {
  const payload = fullDetails();
  payload.lawyer.profile.isAvailable = false;
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  await screen.findByRole('heading', { name: 'Иван Иванов' });
  expect(screen.queryByText('Онлайн', { exact: true })).not.toBeInTheDocument();
  screen.getAllByRole('button', { name: 'Недоступен для записи' }).forEach((button) => expect(button).toBeDisabled());
});

test('полное резюме открывается через динамические вкладки, пустые вкладки скрываются', async () => {
  const first = renderProfile();
  expect(await screen.findByRole('tab', { name: 'Опыт работы' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Опыт работы' }));
  expect(screen.getByText('Коллегия адвокатов')).toBeVisible();
  expect(screen.getByText('Работает сейчас')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Образование' }));
  expect(screen.getByText('ТГЮУ')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Лицензии и сертификаты' }));
  expect(screen.getByText(/UZ-123/)).toBeVisible();
  expect(screen.getByRole('link', { name: /Открыть подтверждение/ })).toHaveAttribute('href', 'https://example.uz/certificate');
  first.unmount();

  const partial = fullDetails();
  partial.lawyer.lawyerExperiences = [];
  partial.lawyer.lawyerEducations = [];
  partial.lawyer.lawyerCertificates = [];
  partial.lawyer.profile.licenseNumber = '';
  clientService.lawyers.getLawyerDetails.mockResolvedValue(partial);
  renderProfile('/lawyers/lawyer-2');
  await screen.findByRole('heading', { name: 'Иван Иванов' });
  expect(screen.queryByRole('tab', { name: 'Опыт работы' })).not.toBeInTheDocument();
});

test('отзывы имеют распределение, дату, подтверждённую консультацию и сортировку', async () => {
  clientService.lawyers.getReviews.mockResolvedValue(reviewsEnvelope);
  renderProfile();
  fireEvent.click(await screen.findByRole('tab', { name: 'Отзывы' }));
  expect(await screen.findByText('Очень полезная консультация')).toBeVisible();
  expect(screen.getByText('Подтверждённая консультация')).toBeVisible();
  expect(screen.getByLabelText('Оценка 4.5 из 5')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Полезные' })); });
  await waitFor(() => expect(clientService.lawyers.getReviews).toHaveBeenLastCalledWith('lawyer-1', expect.objectContaining({ sort: 'helpful' }), expect.any(Object)));
});

test('ошибка отзывов не ломает профиль и повторяет только запрос отзывов', async () => {
  let resolveRetry;
  clientService.lawyers.getReviews
    .mockRejectedValueOnce(new Error('network'))
    .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
  renderProfile();
  fireEvent.click(await screen.findByRole('tab', { name: 'Отзывы' }));
  expect(await screen.findByText(/Не удалось загрузить отзывы/)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Загрузка отзывов' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Иван Иванов' })).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); });
  await waitFor(() => expect(clientService.lawyers.getReviews).toHaveBeenCalledTimes(2));
  await act(async () => { resolveRetry(reviewsEnvelope); });
  expect(await screen.findByText('Очень полезная консультация')).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Загрузка отзывов' })).not.toBeInTheDocument());
  expect(clientService.lawyers.getLawyerDetails).toHaveBeenCalledTimes(1);
});

test('избранное обновляется и BookingModal получает правильный lawyerId', async () => {
  clientService.favorites.getFavorites.mockResolvedValue([]);
  renderProfile();
  const favorite = await screen.findByRole('button', { name: /Добавить Иван Иванов в избранное/ });
  await waitFor(() => expect(favorite).toBeEnabled());
  fireEvent.click(favorite);
  await waitFor(() => expect(clientService.favorites.addFavorite).toHaveBeenCalledWith('lawyer-1'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Записаться на консультацию' })[0]);
  expect(screen.getByRole('dialog')).toHaveTextContent('lawyer-1');
});

test('показывает ближайший реальный слот из API', async () => {
  clientService.lawyers.getAvailableSlots.mockResolvedValue({ dates: [{ date: '2026-09-15', slots: [{ time: '10:00', clientDate: '2026-09-15', clientTime: '10:00' }] }] });
  renderProfile();
  expect(await screen.findByText(/15 сентября, 10:00/)).toBeVisible();
});

test('просроченная лицензия явно помечена и не выдаётся за актуальный trust-документ', async () => {
  const payload = fullDetails();
  payload.lawyer.profile.licenseExpiresAt = '2020-01-01';
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  fireEvent.click(await screen.findByRole('tab', { name: 'Лицензии и сертификаты' }));
  expect(screen.getByText('Срок истёк')).toBeVisible();
  expect(screen.queryByText(/Проверены: лицензия/)).not.toBeInTheDocument();
});

test('длинное описание раскрывается и сворачивается', async () => {
  const payload = fullDetails();
  payload.lawyer.profile.description = 'Подробный профессиональный подход. '.repeat(20);
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  const expand = await screen.findByRole('button', { name: 'Показать полностью' });
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true');
});

test('вкладки поддерживают клавиатуру', async () => {
  renderProfile();
  const about = await screen.findByRole('tab', { name: 'О юристе' });
  about.focus();
  fireEvent.keyDown(about, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Опыт работы' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'lawyer-panel-experience');
});

test('realtime presence не меняет доступность бронирования', async () => {
  const payload = fullDetails();
  payload.lawyer.profile.isAvailable = false;
  payload.lawyer.presence.online = false;
  clientService.lawyers.getLawyerDetails.mockResolvedValue(payload);
  renderProfile();
  await screen.findByRole('heading', { name: 'Иван Иванов' });
  fireEvent(window, new CustomEvent('maslaxat:presence', { detail: { userId: 'lawyer-1', role: 'lawyer', online: true } }));
  expect(screen.queryByText('Онлайн', { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Недоступен для записи' })[0]).toBeDisabled();
});

test('различает 404 и сетевую ошибку с повтором', async () => {
  clientService.lawyers.getLawyerDetails.mockRejectedValueOnce({ response: { status: 404 } });
  const notFound = renderProfile();
  expect(await screen.findByRole('heading', { name: 'Юрист не найден' })).toBeVisible();
  notFound.unmount();

  clientService.lawyers.getLawyerDetails.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(fullDetails());
  renderProfile();
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
  expect(await screen.findByRole('heading', { name: 'Иван Иванов' })).toBeVisible();
});
