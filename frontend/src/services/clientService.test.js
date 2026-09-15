import { vi } from 'vitest';
import api from './api';
import { clientCabinetService, clientConsultationService, clientDashboardService, clientDocumentService, clientLawyerService, clientPaymentService, LAWYER_MAX_PRICE, resolvePublicAssetUrl } from './clientService';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
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

describe('client cabinet contracts', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: {} }); api.post.mockResolvedValue({ data: {} }); api.patch.mockResolvedValue({ data: {} }); api.put.mockResolvedValue({ data: {} }); api.delete.mockResolvedValue({ data: {} }); });

  test('dashboard uses the single aggregate endpoint and propagates errors', async () => {
    const dashboard = { activeCasesCount: 2 };
    api.get.mockResolvedValueOnce({ data: dashboard });
    await expect(clientDashboardService.getDashboard()).resolves.toEqual(dashboard);
    expect(api.get).toHaveBeenCalledWith('/client/dashboard', { signal: undefined });
    const failure = new Error('offline'); api.get.mockRejectedValueOnce(failure);
    await expect(clientDashboardService.getDashboard()).rejects.toBe(failure);
  });

  test('normalizes lawyer history, messages, cases and deadlines envelopes', async () => {
    api.get
      .mockResolvedValueOnce({ data: [{ id: 'l1' }] })
      .mockResolvedValueOnce({ data: { conversations: [{ id: 'm1' }], totalUnread: 3 } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'c1' }], totalPages: 2 } })
      .mockResolvedValueOnce({ data: { deadlines: [{ id: 'd1' }] } });
    await expect(clientCabinetService.getLawyerHistory()).resolves.toMatchObject({ lawyers: [{ id: 'l1' }] });
    await expect(clientCabinetService.getMessages()).resolves.toMatchObject({ conversations: [{ id: 'm1' }], totalUnread: 3 });
    await expect(clientCabinetService.getCases()).resolves.toMatchObject({ cases: [{ id: 'c1' }], totalPages: 2 });
    await expect(clientCabinetService.getDeadlines()).resolves.toMatchObject({ deadlines: [{ id: 'd1' }] });
  });

  test('case and deadline mutations use scoped endpoints', async () => {
    await clientCabinetService.archiveCase('c1', true);
    const deadline = { title: 'Appeal', reminders: [{ intervalMinutes: 1440, channel: 'in_app' }] };
    await clientCabinetService.createDeadline('c1', deadline);
    await clientCabinetService.completeDeadline('c1', 'd1');
    expect(api.patch).toHaveBeenNthCalledWith(1, '/client/cases/c1/archive', { archived: true });
    expect(api.post).toHaveBeenCalledWith('/client/cases/c1/deadlines', deadline);
    expect(api.patch).toHaveBeenNthCalledWith(2, '/client/cases/c1/deadlines/d1/complete');
  });

  test('links and unlinks case items with resource-specific PUT/DELETE routes', async () => {
    await clientCabinetService.linkCaseItem('c1', { type: 'consultation', id: 'x1' });
    await clientCabinetService.unlinkCaseItem('c1', 'document', 'd1');
    expect(api.put).toHaveBeenCalledWith('/client/cases/c1/consultations/x1');
    expect(api.delete).toHaveBeenCalledWith('/client/cases/c1/documents/d1');
  });

  test('payments keep envelope state and verify status independently', async () => {
    api.get.mockResolvedValueOnce({ data: { payments: [{ id: 'p1', status: 'pending' }], page: 2, totalPages: 3 } });
    await expect(clientPaymentService.getMy({ status: 'pending', page: 2 })).resolves.toMatchObject({ page: 2, totalPages: 3 });
    expect(api.get).toHaveBeenCalledWith('/payments/my', { params: { status: 'pending', page: 2 }, signal: undefined });
    api.get.mockResolvedValueOnce({ data: { status: 'paid' } });
    await expect(clientPaymentService.getStatus('p1')).resolves.toEqual({ status: 'paid' });
    expect(api.get).toHaveBeenLastCalledWith('/payments/p1/status');
    api.get.mockResolvedValueOnce({ data: 'receipt text' });
    await expect(clientPaymentService.getReceipt('p1')).resolves.toBe('receipt text');
    expect(api.get).toHaveBeenLastCalledWith('/payments/p1/receipt', { responseType: 'blob' });
  });

  test('documents preserve pagination and throw request failures', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [{ id: 'd1' }], totalPages: 4 } });
    await expect(clientDocumentService.getDocuments({ search: 'claim' })).resolves.toMatchObject({ documents: [{ id: 'd1' }], totalPages: 4 });
    const failure = new Error('network'); api.get.mockRejectedValueOnce(failure);
    await expect(clientDocumentService.getDocuments()).rejects.toBe(failure);
  });

  test('document relinking uses the atomic owner-scoped endpoint', async () => {
    api.patch.mockResolvedValueOnce({ data: { linked: true } });
    await clientDocumentService.linkCase('d1', 'new-case', 'old-case');
    expect(api.patch).toHaveBeenCalledWith('/client/documents/d1/case', { caseId: 'new-case', currentCaseId: 'old-case' });
  });
});

describe('resolvePublicAssetUrl', () => {
  test('оставляет абсолютный URL без изменений', () => {
    expect(resolvePublicAssetUrl('https://cdn.example/avatar.jpg')).toBe('https://cdn.example/avatar.jpg');
  });
});

describe('clientLawyerService profile requests', () => {
  beforeEach(() => api.get.mockReset());

  test('передаёт AbortSignal профилю, слотам и отзывам', async () => {
    const controller = new AbortController();
    api.get
      .mockResolvedValueOnce({ data: { lawyer: { id: 'l1' } } })
      .mockResolvedValueOnce({ data: { dates: [] } })
      .mockResolvedValueOnce({ data: { reviews: [], page: 1, totalPages: 1 } });
    await clientLawyerService.getLawyerDetails('l1', { signal: controller.signal });
    await clientLawyerService.getAvailableSlots('l1', { duration: 60 }, { signal: controller.signal });
    await clientLawyerService.getReviews('l1', { page: 1, sort: 'newest' }, { signal: controller.signal });
    expect(api.get).toHaveBeenNthCalledWith(1, '/client/lawyers/l1', { signal: controller.signal });
    expect(api.get).toHaveBeenNthCalledWith(2, '/lawyers/l1/available-slots', { params: { duration: 60 }, signal: controller.signal });
    expect(api.get).toHaveBeenNthCalledWith(3, '/client/lawyers/l1/reviews', { params: { page: 1, sort: 'newest' }, signal: controller.signal });
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
    expect(api.get).toHaveBeenCalledWith('/client/lawyers/l1', { signal: undefined });

    api.get.mockResolvedValueOnce({ data: { lawyer: { id: 'l2', profile: { isAvailable: false } } } });
    await expect(clientLawyerService.getBookableLawyerDetails('l2')).resolves.toBeNull();
  });

  test('archive uses the explicit archive endpoint', async () => {
    api.patch.mockResolvedValueOnce({ data: { consultation: { id: 'c1' } } });
    await clientConsultationService.archive('c1', true);
    expect(api.patch).toHaveBeenCalledWith('/client/consultations/c1/archive', { archived: true });
  });
});
