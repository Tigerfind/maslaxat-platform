import api from './api';

// Admin Dashboard Service
export const adminDashboardService = {
  // Get admin stats
  // Бросаем ошибку наружу — дашборд покажет состояние ошибки, а не тихие нули
  getStats: async () => {
    const response = await api.get('/admin/dashboard/stats');
    return response.data;
  },

  // Get recent activity
  getRecentActivity: async (limit = 10) => {
    const response = await api.get('/admin/activity/recent', { params: { limit } });
    return response.data;
  },

  // Реальные отчёты: выручка, консультации по статусам, рост юзеров, топ юристов
  getReports: async () => {
    const response = await api.get('/admin/dashboard/reports');
    return response.data;
  },
};

// Admin Users Management
export const adminUserService = {
  // Get all users
  getUsers: async (filters = {}) => {
    const response = await api.get('/admin/users', { params: filters });
    return response.data;
  },

  // Get user details
  getUserDetails: async (userId) => {
    try {
      const response = await api.get(`/admin/users/${userId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching user details:', error);
      throw error;
    }
  },

  // Suspend/Activate user
  toggleUserStatus: async (userId, status) => {
    try {
      const response = await api.put(`/admin/users/${userId}/status`, { status });
      return response.data;
    } catch (error) {
      console.error('Error toggling user status:', error);
      throw error;
    }
  },
};

// Admin Lawyers Management
export const adminLawyerService = {
  // Get all lawyers
  getLawyers: async (filters = {}) => {
    const response = await api.get('/admin/lawyers', { params: filters });
    return response.data;
  },

  // Approve lawyer
  approveLawyer: async (lawyerId) => {
    try {
      const response = await api.post(`/admin/lawyers/${lawyerId}/approve`);
      return response.data;
    } catch (error) {
      console.error('Error approving lawyer:', error);
      throw error;
    }
  },

  // Reject lawyer
  rejectLawyer: async (lawyerId, reason) => {
    try {
      const response = await api.post(`/admin/lawyers/${lawyerId}/reject`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error rejecting lawyer:', error);
      throw error;
    }
  },

  // Верификационные документы юриста (для проверки перед одобрением)
  getVerificationDocuments: async (lawyerId) => {
    const response = await api.get(`/admin/lawyers/${lawyerId}/verification-documents`);
    return response.data;
  },

  // Blob документа для предпросмотра (без скачивания на диск)
  getVerificationDocumentBlob: async (lawyerId, docId) => {
    const response = await api.get(
      `/admin/lawyers/${lawyerId}/verification-documents/${docId}/download`,
      { responseType: 'blob' },
    );
    return response.data;
  },

  // Скачать файл документа (через blob — нужен auth-заголовок, поэтому не прямая ссылка)
  downloadVerificationDocument: async (lawyerId, docId, name) => {
    const response = await api.get(
      `/admin/lawyers/${lawyerId}/verification-documents/${docId}/download`,
      { responseType: 'blob' },
    );
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

// Admin Specializations Management
export const adminSpecializationService = {
  // Get all specializations
  getSpecializations: async () => {
    const response = await api.get('/admin/specializations');
    return response.data;
  },

  // Create specialization
  createSpecialization: async (specializationData) => {
    try {
      const response = await api.post('/admin/specializations', specializationData);
      return response.data;
    } catch (error) {
      console.error('Error creating specialization:', error);
      throw error;
    }
  },

  // Update specialization
  updateSpecialization: async (specializationId, specializationData) => {
    try {
      const response = await api.put(`/admin/specializations/${specializationId}`, specializationData);
      return response.data;
    } catch (error) {
      console.error('Error updating specialization:', error);
      throw error;
    }
  },

  // Delete specialization
  deleteSpecialization: async (specializationId) => {
    try {
      const response = await api.delete(`/admin/specializations/${specializationId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting specialization:', error);
      throw error;
    }
  },
};

// Admin Consultations Monitoring
export const adminConsultationService = {
  // Get all consultations
  getConsultations: async (filters = {}) => {
    const response = await api.get('/admin/consultations', { params: filters });
    return response.data;
  },

};

// Admin Support Tickets
export const adminSupportService = {
  getTickets: async (params = {}) => {
    const response = await api.get('/admin/support', { params });
    return response.data;
  },
  updateStatus: async (id, status) => {
    const response = await api.patch(`/admin/support/${id}`, { status });
    return response.data;
  },
  reply: async (id, responseText) => {
    const response = await api.patch(`/admin/support/${id}`, { response: responseText });
    return response.data;
  },
};

// Admin Promo Codes
export const adminPromoService = {
  getPromos: async () => {
    const response = await api.get('/admin/promos');
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/admin/promos', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.patch(`/admin/promos/${id}`, data);
    return response.data;
  },
  remove: async (id) => {
    const response = await api.delete(`/admin/promos/${id}`);
    return response.data;
  },
};

// Финансы: заявки на вывод и журнал платежей
export const adminFinanceService = {
  getWithdrawals: async (params = {}) => {
    const response = await api.get('/admin/withdrawals', { params });
    return response.data;
  },
  // status: 'paid' | 'cancelled' | 'failed'. Отказ возвращает сумму юристу.
  processWithdrawal: async (id, status, note) => {
    const response = await api.patch(`/admin/withdrawals/${id}`, { status, note });
    return response.data;
  },
  getPayments: async (params = {}) => {
    const response = await api.get('/admin/payments', { params });
    return response.data;
  },
};

// Модерация отзывов
export const adminReviewService = {
  getReviews: async (params = {}) => {
    const response = await api.get('/admin/reviews', { params });
    return response.data;
  },
  setHidden: async (id, isHidden) => {
    const response = await api.patch(`/admin/reviews/${id}`, { isHidden });
    return response.data;
  },
};

export default {
  dashboard: adminDashboardService,
  users: adminUserService,
  lawyers: adminLawyerService,
  specializations: adminSpecializationService,
  consultations: adminConsultationService,
  support: adminSupportService,
  promos: adminPromoService,
  reviews: adminReviewService,
  finance: adminFinanceService,
};
