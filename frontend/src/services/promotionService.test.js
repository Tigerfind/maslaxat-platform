import api from './api';
import promotionService from './promotionService';

jest.mock('./api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

test('sends lawyer checkout terms with the stable idempotency header', async () => {
  api.post.mockResolvedValue({ data: { outcome: 'reserved', checkoutUrl: 'https://checkout.test/1' } });

  const result = await promotionService.lawyer.checkout({
    packageId: 'package-1',
    specialization: 'Civil law',
    location: 'Tashkent',
  }, 'promotion-attempt-1');

  expect(api.post).toHaveBeenCalledWith('/lawyer/promotions/checkout', {
    packageId: 'package-1', specialization: 'Civil law', location: 'Tashkent',
  }, { headers: { 'Idempotency-Key': 'promotion-attempt-1' } });
  expect(result.checkoutUrl).toBe('https://checkout.test/1');
});

test('uses bounded pagination and strict campaign filters for admin reads', async () => {
  api.get.mockResolvedValue({ data: { campaigns: [], totalPages: 0 } });

  await promotionService.admin.getCampaigns({ status: 'queued', page: 2, limit: 10 });

  expect(api.get).toHaveBeenCalledWith('/admin/promotions', {
    params: { status: 'queued', page: 2, limit: 10 },
  });
});

test('forwards AbortController signals through lawyer and admin list loaders', async () => {
  const signal = new AbortController().signal;
  api.get.mockResolvedValue({ data: {} });

  await promotionService.getPackages({ signal });
  await promotionService.lawyer.getProfile({ signal });
  await promotionService.lawyer.getCampaigns({ page: 2 }, { signal });
  await promotionService.admin.getPackages({ page: 3 }, { signal });
  await promotionService.admin.getCampaigns({ status: 'active' }, { signal });
  await promotionService.admin.getLawyers({}, { signal });

  expect(api.get.mock.calls.map(([url]) => url)).toEqual([
    '/promotion-packages', '/lawyer/profile', '/lawyer/promotions',
    '/admin/promotion-packages', '/admin/promotions', '/admin/lawyers',
  ]);
  api.get.mock.calls.forEach(([, config]) => expect(config?.signal).toBe(signal));
  expect(api.get.mock.calls[2][1].params).toEqual({ page: 2 });
  expect(api.get.mock.calls[3][1].params).toEqual({ page: 3 });
  expect(api.get.mock.calls[4][1].params).toEqual({ status: 'active' });
});

test('sends audit reasons for explicit activation, cancellation, refund, and pilot changes', async () => {
  api.patch.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: {} });

  await promotionService.admin.setPackageActivation('package-1', true, 'pilot launch');
  await promotionService.admin.cancelCampaign('campaign-1', 'duplicate checkout');
  await promotionService.admin.refundCampaign('campaign-2', 'service recovery');
  await promotionService.admin.setPilot('lawyer-1', false, 'pilot review');

  expect(api.patch).toHaveBeenNthCalledWith(1, '/admin/promotion-packages/package-1/activation', {
    isActive: true, reason: 'pilot launch',
  });
  expect(api.post).toHaveBeenNthCalledWith(1, '/admin/promotions/campaign-1/cancel', { reason: 'duplicate checkout' });
  expect(api.post).toHaveBeenNthCalledWith(2, '/admin/promotions/campaign-2/refund', { reason: 'service recovery' });
  expect(api.patch).toHaveBeenNthCalledWith(2, '/admin/lawyers/lawyer-1/promotion-pilot', {
    enabled: false, reason: 'pilot review',
  });
});
