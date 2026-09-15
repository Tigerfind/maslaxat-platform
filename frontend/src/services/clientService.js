import api from './api';

export const LAWYER_MAX_PRICE = 10000000;

export const resolvePublicAssetUrl = (value) => {
  if (!value || !String(value).startsWith('/uploads/')) return value || null;
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) return value;
  try {
    return `${new URL(apiUrl, window.location.origin).origin}${value}`;
  } catch {
    return value;
  }
};

// Client Dashboard Service
export const clientDashboardService = {
  getDashboard: async (options = {}) => {
    const response = await api.get('/client/dashboard', { signal: options.signal });
    return response.data;
  },
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
        meetingProvider: c.meetingProvider,
        scheduledStartAt: c.scheduledStartAt,
        scheduledEndAt: c.scheduledEndAt,
        scheduleTimezone: c.scheduleTimezone,
        access: c.access,
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
  searchLawyers: async (filters, options = {}) => {
    // priceRange ([min,max]) → плоские minPrice/maxPrice для бэка. Полный UI-диапазон
    // означает отсутствие ограничения; любое выбранное пользователем сужение отправляем.
    const { priceRange, ...rest } = filters || {};
    const params = { ...rest };
    if (Array.isArray(priceRange)) {
      const [min, max] = priceRange;
      if (Number(min) > 0) params.minPrice = Number(min);
      if (Number(max) >= 0) params.maxPrice = Number(max);
    }
    const response = await api.get('/client/lawyers', { params, signal: options.signal });
    const data = response.data;
    const rawLawyers = data.lawyers || data || [];
    const lawyers = rawLawyers.map((l) => ({
        id: l.id,
        name: l.name,
        avatar: resolvePublicAssetUrl(l.avatar || l.photo),
        // Публичный endpoint возвращает только одобренных юристов и намеренно
        // не раскрывает внутренний статус модерации.
        verificationStatus: 'approved',
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
        professionalTitle: l.profile?.professionalTitle || '',
        primaryEducation: Array.isArray(l.profile?.education) ? l.profile.education[0] || null : null,
        languages: l.profile?.languages || [],
        consultationFormats: l.profile?.consultationFormats || [],
        zoomAvailable: l.profile?.zoomAvailable === true,
        consultationDurations: l.profile?.consultationDurations || [],
        verifiedDocumentTypes: Array.isArray(l.profile?.verifiedDocumentTypes) ? l.profile.verifiedDocumentTypes : [],
        medianResponseMinutes: l.profile?.medianResponseMinutes != null && Number.isFinite(Number(l.profile.medianResponseMinutes))
          ? Number(l.profile.medianResponseMinutes) : null,
        schedule: l.profile?.schedule || {},
        isAvailable: l.profile?.isAvailable === true,
        online: l.presence?.online == null ? null : l.presence.online === true,
        lastSeenAt: l.presence?.lastSeenAt || null,
        presenceObservedAt: l.presence?.observedAt || null,
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
  getLawyerDetails: async (lawyerId, options = {}) => {
    try {
      const response = await api.get(`/client/lawyers/${lawyerId}`, { signal: options.signal });
      return response.data;
    } catch (error) {
      console.error('Error fetching lawyer details:', error);
      throw error;
    }
  },

  getAvailableSlots: async (lawyerId, params = {}, options = {}) => {
    const response = await api.get(`/lawyers/${lawyerId}/available-slots`, { params, signal: options.signal });
    return response.data;
  },

  getBookableLawyerDetails: async (lawyerId) => {
    const data = await clientLawyerService.getLawyerDetails(lawyerId);
    const lawyer = data?.lawyer || data;
    const profile = lawyer?.profile;
    if (!lawyer?.id || !profile || profile.isAvailable !== true) return null;
    return {
      ...lawyer,
      avatar: resolvePublicAssetUrl(lawyer.avatar || lawyer.photo),
      rating: profile.rating || 0,
      specializations: Array.isArray(profile.specializations) && profile.specializations.length
        ? profile.specializations : (profile.specialization ? [profile.specialization] : []),
      priceFrom: profile.price || 0,
      consultationFormats: profile.consultationFormats || [],
      consultationDurations: profile.consultationDurations || [],
      zoomAvailable: profile.zoomAvailable === true,
      isAvailable: true,
    };
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
  // Production never touches the test-only simulation endpoint.
  payConsultation: async (consultationId) => {
    if (import.meta.env.PROD || import.meta.env.MODE === 'production') {
      const result = await clientLawyerService.createPayment(consultationId);
      return { completed: false, redirectUrl: result.checkoutUrl, ...result };
    }
    try {
      const result = await clientLawyerService.simulatePayment(consultationId);
      return { completed: true, ...result };
    } catch (error) {
      if (error.response?.status !== 403) throw error;
      const result = await clientLawyerService.createPayment(consultationId);
      return { completed: false, redirectUrl: result.checkoutUrl, ...result };
    }
  },

  // Get lawyer reviews
  getReviews: async (lawyerId, params = {}, options = {}) => {
    const response = await api.get(`/client/lawyers/${lawyerId}/reviews`, { params, signal: options.signal });
    return Array.isArray(response.data)
      ? { reviews: response.data, page: 1, totalPages: 1, total: response.data.length, summary: null }
      : response.data;
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
  getConsultations: async (params = {}, options = {}) => {
    const normalized = typeof params === 'string' ? { bucket: params } : params;
    const response = await api.get('/client/consultations', { params: normalized, signal: options.signal });
    const data = response.data;
    return Array.isArray(data)
      ? { consultations: data, total: data.length, page: 1, limit: data.length, totalPages: 1, counts: {} }
      : data;
  },
  getConsultationDetails: async (consultationId, options = {}) => {
    const response = await api.get(`/client/consultations/${consultationId}`, { signal: options.signal });
    return response.data;
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
  archive: async (consultationId, archived) => {
    const response = await api.patch(`/client/consultations/${consultationId}/archive`, { archived });
    return response.data;
  },
};

// Client Documents Service
export const clientDocumentService = {
  // Get all documents
  getDocuments: async (params = {}, options = {}) => {
    const response = await api.get('/client/documents', { params, signal: options.signal });
    const data = response.data;
    return Array.isArray(data)
      ? { documents: data, page: 1, totalPages: 1, total: data.length }
      : { ...data, documents: data.documents || data.items || [] };
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
  archive: async (documentId, archived = true) => {
    const response = await api.patch(`/client/documents/${documentId}/archive`, { archived });
    return response.data;
  },
  linkCase: async (documentId, caseId, currentCaseId = null) => {
    const response = await api.patch(`/client/documents/${documentId}/case`, { caseId, currentCaseId });
    return response.data;
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
  getFavorites: async (options = {}) => {
    const response = await api.get('/client/favorites', { signal: options.signal });
    return response.data;
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
  getMy: async (params = {}, options = {}) => {
    const response = await api.get('/payments/my', { params, signal: options.signal });
    const data = response.data;
    return Array.isArray(data)
      ? { payments: data, page: 1, totalPages: 1, total: data.length }
      : { ...data, payments: data.payments || data.items || [] };
  },
  getStatus: async (paymentId) => (await api.get(`/payments/${paymentId}/status`)).data,
  getReceipt: async (paymentId) => (await api.get(`/payments/${paymentId}/receipt`, { responseType: 'blob' })).data,
};

const normalizePage = (data, key) => {
  if (Array.isArray(data)) return { [key]: data, page: 1, totalPages: 1, total: data.length };
  return { ...data, [key]: data?.[key] || data?.items || [] };
};

export const clientCabinetService = {
  getLawyerHistory: async (params = {}, options = {}) => normalizePage(
    (await api.get('/client/lawyers/history', { params, signal: options.signal })).data,
    'lawyers',
  ),
  getMessages: async (params = {}, options = {}) => normalizePage(
    (await api.get('/client/messages', { params, signal: options.signal })).data,
    'conversations',
  ),
  getCases: async (params = {}, options = {}) => normalizePage(
    (await api.get('/client/cases', { params, signal: options.signal })).data,
    'cases',
  ),
  getCase: async (caseId, options = {}) => (await api.get(`/client/cases/${caseId}`, { signal: options.signal })).data,
  createCase: async (payload) => (await api.post('/client/cases', payload)).data,
  updateCase: async (caseId, payload) => (await api.patch(`/client/cases/${caseId}`, payload)).data,
  archiveCase: async (caseId, archived = true) => (await api.patch(`/client/cases/${caseId}/archive`, { archived })).data,
  linkCaseItem: async (caseId, payload) => {
    const segment = payload.type === 'consultation' ? 'consultations' : 'documents';
    return (await api.put(`/client/cases/${caseId}/${segment}/${payload.id}`)).data;
  },
  unlinkCaseItem: async (caseId, type, itemId) => {
    const segment = type === 'consultation' ? 'consultations' : 'documents';
    return (await api.delete(`/client/cases/${caseId}/${segment}/${itemId}`)).data;
  },
  getDeadlines: async (params = {}, options = {}) => normalizePage(
    (await api.get('/client/deadlines', { params, signal: options.signal })).data,
    'deadlines',
  ),
  createDeadline: async (caseId, payload) => (await api.post(`/client/cases/${caseId}/deadlines`, payload)).data,
  updateDeadline: async (caseId, deadlineId, payload) => (await api.patch(`/client/cases/${caseId}/deadlines/${deadlineId}`, payload)).data,
  completeDeadline: async (caseId, deadlineId) => (await api.patch(`/client/cases/${caseId}/deadlines/${deadlineId}/complete`)).data,
  deleteDeadline: async (caseId, deadlineId) => (await api.delete(`/client/cases/${caseId}/deadlines/${deadlineId}`)).data,
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
  cabinet: clientCabinetService,
  promo: clientPromoService,
};

export default clientService;
