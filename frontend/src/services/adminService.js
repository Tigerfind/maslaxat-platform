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
    try {
      const response = await api.get('/admin/activity/recent', { params: { limit } });
      return response.data;
    } catch (error) {
      console.error('Error fetching activity:', error);
      return [];
    }
  },

  // Реальные отчёты: выручка, консультации по статусам, рост юзеров, топ юристов
  getReports: async () => {
    try {
      const response = await api.get('/admin/dashboard/reports');
      return response.data;
    } catch (error) {
      console.error('Error fetching reports:', error);
      return null;
    }
  },
};

// Admin Users Management
export const adminUserService = {
  // Get all users
  getUsers: async (filters = {}) => {
    try {
      const response = await api.get('/admin/users', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
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

  // Update user
  updateUser: async (userId, userData) => {
    try {
      const response = await api.put(`/admin/users/${userId}`, userData);
      return response.data;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  },

  // Delete user
  deleteUser: async (userId) => {
    try {
      const response = await api.delete(`/admin/users/${userId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting user:', error);
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
    try {
      const response = await api.get('/admin/lawyers', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching lawyers:', error);
      return [];
    }
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

  // Verify lawyer credentials
  verifyCredentials: async (lawyerId, credentials) => {
    try {
      const response = await api.post(`/admin/lawyers/${lawyerId}/verify`, credentials);
      return response.data;
    } catch (error) {
      console.error('Error verifying credentials:', error);
      throw error;
    }
  },

  // Верификационные документы юриста (для проверки перед одобрением)
  getVerificationDocuments: async (lawyerId) => {
    const response = await api.get(`/admin/lawyers/${lawyerId}/verification-documents`);
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
    try {
      const response = await api.get('/admin/specializations');
      return response.data;
    } catch (error) {
      console.error('Error fetching specializations:', error);
      return [];
    }
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
    try {
      const response = await api.get('/admin/consultations', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching consultations:', error);
      return [];
    }
  },

  // Get consultation details
  getConsultationDetails: async (consultationId) => {
    try {
      const response = await api.get(`/admin/consultations/${consultationId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching consultation details:', error);
      throw error;
    }
  },

  // Cancel consultation (admin override)
  cancelConsultation: async (consultationId, reason) => {
    try {
      const response = await api.post(`/admin/consultations/${consultationId}/cancel`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error canceling consultation:', error);
      throw error;
    }
  },
};

// Admin Reports Service
export const adminReportService = {
  // Get revenue report
  getRevenueReport: async (startDate, endDate) => {
    try {
      const response = await api.get('/admin/reports/revenue', {
        params: { startDate, endDate },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching revenue report:', error);
      return {};
    }
  },

  // Get consultations report
  getConsultationsReport: async (startDate, endDate) => {
    try {
      const response = await api.get('/admin/reports/consultations', {
        params: { startDate, endDate },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching consultations report:', error);
      return {};
    }
  },

  // Export report
  exportReport: async (reportType, format = 'pdf') => {
    try {
      const response = await api.get(`/admin/reports/export/${reportType}`, {
        params: { format },
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      console.error('Error exporting report:', error);
      throw error;
    }
  },
};

// Admin Support Tickets
export const adminSupportService = {
  getTickets: async () => {
    try {
      const response = await api.get('/admin/support');
      return response.data;
    } catch (error) {
      console.error('Error fetching tickets:', error);
      return [];
    }
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
    try {
      const response = await api.get('/admin/promos');
      return response.data;
    } catch (error) {
      console.error('Error fetching promos:', error);
      return [];
    }
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

// Модерация отзывов
export const adminReviewService = {
  getReviews: async () => {
    try {
      const response = await api.get('/admin/reviews');
      return response.data;
    } catch (error) {
      console.error('Error fetching reviews:', error);
      return [];
    }
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
  reports: adminReportService,
  support: adminSupportService,
  promos: adminPromoService,
  reviews: adminReviewService,
};
