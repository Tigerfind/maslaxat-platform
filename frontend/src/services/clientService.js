import api from './api';

// Client Dashboard Service
export const clientDashboardService = {
  // Get dashboard stats
  // Бросаем ошибку наружу — дашборд покажет состояние ошибки, а не тихие нули
  // (иначе сбой бэкенда выглядит как «0 консультаций»).
  getStats: async () => {
    const response = await api.get('/client/dashboard/stats');
    return response.data;
  },

  // Лента активности клиента (консультации/документы/отзывы)
  getActivity: async () => {
    try {
      const response = await api.get('/client/dashboard/activity');
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Error fetching activity:', error);
      return [];
    }
  },

  // Get upcoming consultations. Бэк отдаёт сырые консультации (lawyer.name,
  // preferredDate/Time, question) — нормализуем в поля, которые ждёт дашборд
  // (lawyerName / topic / date / time), иначе имя показывалось как «Юрист».
  getUpcomingConsultations: async () => {
    try {
      const response = await api.get('/client/consultations/upcoming');
      const list = Array.isArray(response.data) ? response.data : (response.data?.consultations || []);
      return list.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        lawyerName: c.lawyer?.name || null,
        avatar: c.lawyer?.avatar || null,
        topic: c.question || null,
        date: c.preferredDate || null,
        time: c.preferredTime || null,
      }));
    } catch (error) {
      console.error('Error fetching consultations:', error);
      return [];
    }
  },
};

// Client Lawyer Search Service
export const clientLawyerService = {
  // Search lawyers
  searchLawyers: async (filters) => {
    try {
      // priceRange ([min,max]) → плоские minPrice/maxPrice для бэка. Границы 0 / +∞
      // не шлём, чтобы не сужать выборку без нужды (0 и максимум = «любая цена»).
      const { priceRange, ...rest } = filters || {};
      const params = { ...rest };
      if (Array.isArray(priceRange)) {
        const [min, max] = priceRange;
        if (Number(min) > 0) params.minPrice = min;
        if (Number(max) > 0 && Number(max) < 2000000) params.maxPrice = max;
      }
      const response = await api.get('/client/lawyers', { params });
      const data = response.data;
      const rawLawyers = data.lawyers || data || [];
      const lawyers = rawLawyers.map((l) => ({
        id: l.id,
        name: l.name,
        avatar: l.avatar,
        isVerified: l.isVerified,
        // Статус модерации админом (галочка «Проверенный»). В каталог попадают
        // только approved, но держим явно — на будущее и для единообразия.
        verificationStatus: l.profile?.verificationStatus || 'pending',
        rating: l.profile?.rating || 0,
        // Ступень юриста (топ/эксперт/практик) считает сервер — тем же правилом,
        // что и фильтр подбора, чтобы бейдж и выборка не расходились.
        status: l.profile?.status || null,
        reviewsCount: l.profile?.reviewsCount || 0,
        completedConsultations: l.profile?.completedCases || 0,
        specializations: Array.isArray(l.profile?.specializations) && l.profile.specializations.length
          ? l.profile.specializations
          : (l.profile?.specialization ? [l.profile.specialization] : []),
        experience: l.profile?.experience || 0,
        priceFrom: l.profile?.price || 0,
        region: l.profile?.location || '',
        description: l.profile?.description || '',
        languages: l.profile?.languages || [],
        schedule: l.profile?.schedule || {},
        isAvailable: l.profile?.isAvailable ?? true,
      }));
      return {
        lawyers,
        totalPages: data.totalPages || 1,
        total: data.total || lawyers.length,
        // Фасеты обязаны дойти до страницы: на них держатся числа на чипах,
        // порог «Недорого» и весь блок подбора по карману/статусу. Пока этот
        // ключ здесь терялся, чипы стояли без счётчиков, «Недорого» было
        // погашено навсегда, а блок подбора просто не отрисовывался.
        facets: data.facets || null,
      };
    } catch (error) {
      console.error('Error searching lawyers:', error);
      return { lawyers: [], totalPages: 1, total: 0, facets: null };
    }
  },

  // Списки городов и языков для фильтров
  getFilterOptions: async () => {
    try {
      const response = await api.get('/client/lawyers/filter-options');
      return response.data;
    } catch (error) {
      return { locations: [], languages: [] };
    }
  },

  // Get lawyer details
  getLawyerDetails: async (lawyerId) => {
    try {
      const response = await api.get(`/client/lawyers/${lawyerId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching lawyer details:', error);
      throw error;
    }
  },

  // Book consultation — directly through API, no localStorage fallback
  bookConsultation: async (lawyerId, consultationData) => {
    const response = await api.post(`/client/lawyers/${lawyerId}/book`, consultationData);
    return response.data;
  },

  // Test-mode payment: marks the consultation paid without a real Payme gateway
  simulatePayment: async (consultationId) => {
    const response = await api.post('/payments/simulate', { consultationId });
    return response.data;
  },

  // Реальная оплата: создаёт платёж и возвращает Payme checkout URL (для редиректа в проде)
  createPayment: async (consultationId) => {
    const response = await api.post('/payments/create', { consultationId });
    return response.data;
  },

  // Get lawyer reviews
  getReviews: async (lawyerId) => {
    const response = await api.get(`/client/lawyers/${lawyerId}/reviews`);
    return response.data.reviews || response.data || [];
  },

  // Leave review
  leaveReview: async (lawyerId, reviewData) => {
    try {
      const response = await api.post(`/client/lawyers/${lawyerId}/review`, reviewData);
      return response.data;
    } catch (error) {
      console.error('Error leaving review:', error);
      throw error;
    }
  },
};

// Client Consultations Service
export const clientConsultationService = {
  // Get all consultations
  getConsultations: async (status = 'all') => {
    try {
      const response = await api.get('/client/consultations', { params: { status } });
      const data = response.data;
      return Array.isArray(data) ? data : (data.consultations || []);
    } catch (error) {
      console.error('Error fetching consultations:', error);
      return [];
    }
  },

  // Перенос времени консультации
  reschedule: async (consultationId, preferredDate, preferredTime) => {
    const response = await api.patch(`/client/consultations/${consultationId}/reschedule`, { preferredDate, preferredTime });
    return response.data;
  },

  // Cancel consultation
  cancelConsultation: async (consultationId, reason) => {
    try {
      const response = await api.post(`/client/consultations/${consultationId}/cancel`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error canceling consultation:', error);
      throw error;
    }
  },

  // Join consultation
  joinConsultation: async (consultationId) => {
    try {
      const response = await api.post(`/client/consultations/${consultationId}/join`);
      return response.data;
    } catch (error) {
      console.error('Error joining consultation:', error);
      throw error;
    }
  },
  completeConsultation: async (consultationId) => {
    try {
      const response = await api.post(`/client/consultations/${consultationId}/complete`);
      return response.data;
    } catch (error) {
      console.error('Error completing consultation:', error);
      throw error;
    }
  },
};

// Client Documents Service
export const clientDocumentService = {
  // Get all documents
  getDocuments: async () => {
    try {
      const response = await api.get('/client/documents');
      return response.data;
    } catch (error) {
      console.error('Error fetching documents:', error);
      return [];
    }
  },

  // Upload document
  uploadDocument: async (file, metadata) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('metadata', JSON.stringify(metadata));

      const response = await api.post('/client/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  },

  // Delete document
  deleteDocument: async (documentId) => {
    try {
      const response = await api.delete(`/client/documents/${documentId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  },

  // Download original file (returns a Blob)
  downloadDocument: async (documentId) => {
    const response = await api.get(`/client/documents/${documentId}/download`, { responseType: 'blob' });
    return response.data;
  },

  // AI document check
  checkDocument: async (documentId) => {
    try {
      const response = await api.post(`/client/documents/${documentId}/ai-check`);
      return response.data;
    } catch (error) {
      console.error('Error checking document:', error);
      throw error;
    }
  },
};

// Client AI Chat Service
export const clientAIChatService = {
  // Send message to AI (supports file attachments)
  sendMessage: async (message, conversationId = null, files = []) => {
    try {
      const formData = new FormData();
      formData.append('message', message);
      if (conversationId) {
        formData.append('conversationId', conversationId);
      }
      for (const file of files) {
        formData.append('files', file);
      }
      const response = await api.post('/client/ai-chat/message', formData, {
        timeout: 60000,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  },

  // Get chat history
  getChatHistory: async (conversationId) => {
    try {
      const response = await api.get(`/client/ai-chat/history/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching chat history:', error);
      return [];
    }
  },

  // Get all conversations
  getConversations: async () => {
    try {
      const response = await api.get('/client/ai-chat/conversations');
      return response.data;
    } catch (error) {
      console.error('Error fetching conversations:', error);
      return [];
    }
  },
};

// Client Favorites Service
export const clientFavoritesService = {
  // Get all favorite lawyers
  getFavorites: async () => {
    try {
      const response = await api.get('/client/favorites');
      return response.data;
    } catch (error) {
      console.error('Error fetching favorites:', error);
      return [];
    }
  },

  // Add lawyer to favorites
  addFavorite: async (lawyerId) => {
    try {
      const response = await api.post(`/client/favorites/${lawyerId}`);
      return response.data;
    } catch (error) {
      console.error('Error adding to favorites:', error);
      throw error;
    }
  },

  // Remove lawyer from favorites
  removeFavorite: async (lawyerId) => {
    try {
      const response = await api.delete(`/client/favorites/${lawyerId}`);
      return response.data;
    } catch (error) {
      console.error('Error removing from favorites:', error);
      throw error;
    }
  },

  // Check if lawyer is favorited
  checkFavorite: async (lawyerId) => {
    try {
      const response = await api.get(`/client/favorites/check/${lawyerId}`);
      return response.data.isFavorite;
    } catch (error) {
      console.error('Error checking favorite:', error);
      return false;
    }
  },
};

// Client Subscription Service (free / basic / pro + daily AI usage)
export const clientSubscriptionService = {
  getMy: async () => {
    try {
      const response = await api.get('/subscriptions/my');
      return response.data;
    } catch (error) {
      console.error('Error fetching subscription:', error);
      return null;
    }
  },
  // Оформление платной подписки (в dev — тест-оплата, в проде — Payme, Фаза 6)
  upgrade: async (plan) => {
    const response = await api.post('/subscriptions/upgrade', { plan });
    return response.data;
  },
};

export const clientPromoService = {
  // Проверить промокод для суммы → { valid, discountPercent, discountAmount, message, minAmount }
  validate: async (code, amount) => {
    try {
      const response = await api.post('/promo/validate', { code, amount });
      return response.data;
    } catch (error) {
      return { valid: false, reason: 'error' };
    }
  },
};

export const clientPaymentService = {
  // Бросает ошибку наружу, чтобы страница показала состояние ошибки (а не пустоту как «нет платежей»)
  getMy: async () => {
    const response = await api.get('/payments/my');
    return Array.isArray(response.data) ? response.data : (response.data.payments || []);
  },
};

const clientService = {
  dashboard: clientDashboardService,
  lawyers: clientLawyerService,
  consultations: clientConsultationService,
  documents: clientDocumentService,
  aiChat: clientAIChatService,
  favorites: clientFavoritesService,
  subscription: clientSubscriptionService,
  payments: clientPaymentService,
  promo: clientPromoService,
};

export default clientService;
