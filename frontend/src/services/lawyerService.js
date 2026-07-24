import api from './api';

// Lawyer Schedule Management
export const lawyerScheduleService = {
  getSchedule: async (year, month) => {
    const response = await api.get('/lawyer/schedule', { params: { year, month } });
    return response.data;
  },

  confirmConsultation: async (consultationId) => {
    const response = await api.post(`/lawyer/consultations/${consultationId}/confirm`);
    return response.data;
  },

  rejectConsultation: async (consultationId, reason) => {
    const response = await api.post(`/lawyer/consultations/${consultationId}/reject`, { reason });
    return response.data;
  },

  // Недельные слоты доступности (schedule JSONB)
  getAvailability: async () => {
    const response = await api.get('/lawyer/availability');
    return response.data;
  },
  saveAvailability: async (schedule) => {
    const response = await api.put('/lawyer/availability', { schedule });
    return response.data;
  },
};

// Lawyer Reviews Management
export const lawyerReviewsService = {
  getReviews: async (filters = {}) => {
    const response = await api.get('/lawyer/reviews', { params: filters });
    return response.data;
  },

  replyToReview: async (reviewId, reply) => {
    const response = await api.post(`/lawyer/reviews/${reviewId}/reply`, { reply });
    return response.data;
  },

  markHelpful: async (reviewId) => {
    const response = await api.post(`/lawyer/reviews/${reviewId}/helpful`);
    return response.data;
  },
};

// Lawyer Dashboard Stats
export const lawyerDashboardService = {
  getStats: async () => {
    const response = await api.get('/lawyer/dashboard/stats');
    return response.data;
  },

  getAnalytics: async () => {
    const response = await api.get('/lawyer/dashboard/analytics');
    return response.data;
  },

  getPendingConsultations: async () => {
    const response = await api.get('/lawyer/consultations/pending');
    return response.data;
  },

  getRecentReviews: async (limit = 3) => {
    const response = await api.get('/lawyer/reviews/recent', { params: { limit } });
    return response.data;
  },

  updateStatus: async (status) => {
    const response = await api.put('/lawyer/status', { status });
    return response.data;
  },
};

// Lawyer Consultations — all through real API, no localStorage
export const lawyerConsultationService = {
  getConsultationRequests: async (status = 'all') => {
    const response = await api.get('/lawyer/consultation-requests', { params: { status } });
    return response.data;
  },

  acceptConsultationRequest: async (requestId, responseMessage = '') => {
    const response = await api.post(`/lawyer/consultation-requests/${requestId}/accept`, {
      responseMessage,
    });
    return response.data;
  },

  rejectConsultationRequest: async (requestId, reason = '') => {
    const response = await api.post(`/lawyer/consultation-requests/${requestId}/reject`, {
      reason,
    });
    return response.data;
  },

  startConsultation: async (consultationId) => {
    const response = await api.post(`/lawyer/consultations/${consultationId}/start`);
    return response.data;
  },

  endConsultation: async (consultationId, notes) => {
    const response = await api.post(`/lawyer/consultations/${consultationId}/end`, { notes });
    return response.data;
  },

  getConsultationDetails: async (consultationId) => {
    const response = await api.get(`/lawyer/consultations/${consultationId}`);
    return response.data;
  },
};

// Lawyer Notifications
export const lawyerNotificationService = {
  getNotifications: async () => {
    try {
      const response = await api.get('/lawyer/notifications');
      return response.data;
    } catch {
      return [];
    }
  },

  markAsRead: async (notificationId) => {
    const response = await api.put(`/lawyer/notifications/${notificationId}/read`);
    return response.data;
  },

  markAllAsRead: async () => {
    const response = await api.put('/lawyer/notifications/read-all');
    return response.data;
  },
};

export default {
  schedule: lawyerScheduleService,
  reviews: lawyerReviewsService,
  dashboard: lawyerDashboardService,
  consultation: lawyerConsultationService,
  notification: lawyerNotificationService,
};
