import { vi } from 'vitest';
import api from './api';
import { clientLawyerService, LAWYER_MAX_PRICE, resolvePublicAssetUrl } from './clientService';

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
