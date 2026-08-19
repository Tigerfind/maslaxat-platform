import api from './api';

const data = (response) => response.data;

const promotionService = {
  getPackages: async (options = {}) => data(await api.get('/promotion-packages', options)),

  lawyer: {
    getProfile: async (options = {}) => data(await api.get('/lawyer/profile', options)),
    getCampaigns: async (params = {}, options = {}) => data(await api.get('/lawyer/promotions', { params, ...options })),
    getCampaign: async (id) => data(await api.get(`/lawyer/promotions/${id}`)),
    checkout: async (terms, idempotencyKey) => data(await api.post(
      '/lawyer/promotions/checkout',
      terms,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )),
  },

  admin: {
    getPackages: async (params = {}, options = {}) => data(await api.get('/admin/promotion-packages', { params, ...options })),
    createPackage: async (payload) => data(await api.post('/admin/promotion-packages', payload)),
    updatePackage: async (id, payload) => data(await api.put(`/admin/promotion-packages/${id}`, payload)),
    setPackageActivation: async (id, isActive, reason) => data(await api.patch(
      `/admin/promotion-packages/${id}/activation`, { isActive, reason },
    )),
    getCampaigns: async (params = {}, options = {}) => data(await api.get('/admin/promotions', { params, ...options })),
    cancelCampaign: async (id, reason) => data(await api.post(`/admin/promotions/${id}/cancel`, { reason })),
    refundCampaign: async (id, reason) => data(await api.post(`/admin/promotions/${id}/refund`, { reason })),
    getLawyers: async (params = {}, options = {}) => data(await api.get('/admin/lawyers', { params, ...options })),
    setPilot: async (lawyerId, enabled, reason) => data(await api.patch(
      `/admin/lawyers/${lawyerId}/promotion-pilot`, { enabled, reason },
    )),
  },
};

export default promotionService;
