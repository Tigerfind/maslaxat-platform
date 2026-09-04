import { vi } from 'vitest';
import api from './api';
import { clientConsultationService, clientLawyerService, LAWYER_MAX_PRICE, resolvePublicAssetUrl } from './clientService';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

const response = { data: { lawyers: [], total: 0, totalPages: 1, facets: null } };

describe('clientLawyerService.searchLawyers', () => {
  beforeEach(() => api.get.mockReset().mockResolvedValue(response));

  test('передаёт выбранные minPrice и maxPrice до UI-потолка', async () => {
    await clientLawyerService.searchLawyers({ priceRange: [100000, 3000000], sortBy: 'price_low' });

    expect(api.get).toHaveBeenCalledWith('/client/lawyers', {
      params: { minPrice: 100000, maxPrice: 3000000, sortBy: 'price_low' },
      signal: undefined,
    });
  });

  test('передаёт верхнюю границу полного UI-диапазона', async () => {
    await clientLawyerService.searchLawyers({ priceRange: [0, LAWYER_MAX_PRICE] });

    expect(api.get.mock.calls[0][1].params).toEqual({ maxPrice: LAWYER_MAX_PRICE });
  });

  test('сохраняет UI-потолок, если диапазон ограничен снизу', async () => {
    await clientLawyerService.searchLawyers({ priceRange: [100000, LAWYER_MAX_PRICE] });

    expect(api.get.mock.calls[0][1].params).toEqual({ minPrice: 100000, maxPrice: LAWYER_MAX_PRICE });
  });

  test('передаёт AbortSignal и не проглатывает ошибку', async () => {
    const error = new Error('network');
    const controller = new AbortController();
    api.get.mockRejectedValueOnce(error);

    await expect(clientLawyerService.searchLawyers({}, { signal: controller.signal })).rejects.toBe(error);
    expect(api.get.mock.calls[0][1].signal).toBe(controller.signal);
  });

  test('undefined isAvailable не превращает в онлайн', async () => {
    api.get.mockResolvedValueOnce({ data: { lawyers: [{ id: '1', name: 'Юрист', profile: {} }] } });

    const result = await clientLawyerService.searchLawyers({});
    expect(result.lawyers[0].isAvailable).toBe(false);
    expect(result.lawyers[0].online).toBeNull();
  });

  test('разделяет socket presence и доступность бронирования', async () => {
    api.get.mockResolvedValueOnce({
      data: { lawyers: [{ id: '1', name: 'Юрист', profile: { isAvailable: false }, presence: { online: true } }] },
    });
    const result = await clientLawyerService.searchLawyers({});
    expect(result.lawyers[0]).toMatchObject({ isAvailable: false, online: true });
  });
});

describe('resolvePublicAssetUrl', () => {
  test('оставляет абсолютный URL без изменений', () => {
    expect(resolvePublicAssetUrl('https://cdn.example/avatar.jpg')).toBe('https://cdn.example/avatar.jpg');
  });
});

describe('consultation pagination and payment recovery', () => {
  beforeEach(() => { api.get.mockReset(); api.post.mockReset(); vi.unstubAllEnvs(); });

  test('сохраняет серверные counts и pagination metadata', async () => {
    const envelope = { consultations: [{ id: 'c1' }], counts: { all: 25 }, total: 25, page: 2, totalPages: 3 };
    api.get.mockResolvedValueOnce({ data: envelope });
    const controller = new AbortController();
    await expect(clientConsultationService.getConsultations({ bucket: 'all', page: 2 }, { signal: controller.signal })).resolves.toEqual(envelope);
    expect(api.get).toHaveBeenCalledWith('/client/consultations', {
      params: { bucket: 'all', page: 2 }, signal: controller.signal,
    });
  });

  test('dev fallback после запрещённой simulation возвращает checkout URL', async () => {
    vi.stubEnv('MODE', 'development');
    api.post.mockRejectedValueOnce({ response: { status: 403 } });
    api.post.mockResolvedValueOnce({ data: { paymentId: 'p1', checkoutUrl: 'https://checkout.test/pay' } });
    const result = await clientLawyerService.payConsultation('c1');
    expect(result).toMatchObject({ completed: false, redirectUrl: 'https://checkout.test/pay', paymentId: 'p1' });
    expect(api.post).toHaveBeenNthCalledWith(1, '/payments/simulate', { consultationId: 'c1' });
    expect(api.post).toHaveBeenNthCalledWith(2, '/payments/create', { consultationId: 'c1' });
  });

  test('production payment never calls simulation', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', true);
    api.post.mockResolvedValueOnce({ data: { paymentId: 'p2', checkoutUrl: 'https://checkout.test/prod' } });
    const result = await clientLawyerService.payConsultation('c2');
    expect(result.redirectUrl).toBe('https://checkout.test/prod');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/payments/create', { consultationId: 'c2' });
  });

  test('rebook profile is normalized only when the lawyer remains available', async () => {
    api.get.mockResolvedValueOnce({ data: { lawyer: { id: 'l1', name: 'Юрист', profile: { isAvailable: true, price: 250000, specialization: 'civil', consultationFormats: ['chat'], consultationDurations: [30] } } } });
    await expect(clientLawyerService.getBookableLawyerDetails('l1')).resolves.toMatchObject({
      id: 'l1', priceFrom: 250000, specializations: ['civil'], consultationFormats: ['chat'], consultationDurations: [30], isAvailable: true,
    });
    expect(api.get).toHaveBeenCalledWith('/client/lawyers/l1');

    api.get.mockResolvedValueOnce({ data: { lawyer: { id: 'l2', profile: { isAvailable: false } } } });
    await expect(clientLawyerService.getBookableLawyerDetails('l2')).resolves.toBeNull();
  });

  test('archive uses the explicit archive endpoint', async () => {
    api.patch.mockResolvedValueOnce({ data: { consultation: { id: 'c1' } } });
    await clientConsultationService.archive('c1', true);
    expect(api.patch).toHaveBeenCalledWith('/client/consultations/c1/archive', { archived: true });
  });
});
