import api from './api';

const IMPORT_ERROR_CODES = new Set([
  'INVALID_PDF_UPLOAD', 'PDF_IMPORT_UNAVAILABLE', 'PROFILE_IMPORT_RATE_LIMITED',
  'PROFILE_IMPORT_BUSY', 'PROFILE_IMPORT_CONCURRENCY_LIMITED', 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE', 'IMPORT_NOT_FOUND',
  'IMPORT_STATE_CONFLICT', 'IMPORT_VERSION_CONFLICT', 'PROFILE_REVISION_CONFLICT',
  'IMPORT_ALREADY_CONFIRMED', 'IMPORT_EXPIRED', 'INVALID_IMPORT_DRAFT',
  'INVALID_ACCEPTED_PATHS', 'INVALID_SPECIALIZATION', 'ERR_CANCELED',
]);

const normalizeImportError = (error) => {
  if (error?.code === 'ERR_CANCELED' || error?.name === 'AbortError') {
    return Object.assign(new Error('Import request canceled'), { code: 'ERR_CANCELED', status: 0, retryAfter: null });
  }
  const status = Number(error?.response?.status) || 0;
  const rawCode = error?.response?.data?.code;
  const code = IMPORT_ERROR_CODES.has(rawCode) ? rawCode : 'PROFILE_IMPORT_FAILED';
  const retryHeader = Number(error?.response?.headers?.['retry-after']);
  const retryBody = Number(error?.response?.data?.retryAfter);
  const retryAfterValue = Number.isFinite(retryHeader) ? retryHeader : retryBody;
  const retryAfter = Number.isFinite(retryAfterValue)
    ? Math.max(0, Math.min(3600, Math.floor(retryAfterValue)))
    : null;
  return Object.assign(new Error(code), { code, status, retryAfter });
};

const importRequest = async (operation) => {
  try {
    const response = await operation();
    return response.data;
  } catch (error) {
    throw normalizeImportError(error);
  }
};

export const lawyerImportService = {
  upload: (file, { signal, onProgress, idempotencyKey } = {}) => {
    const body = new FormData();
    body.append('file', file);
    return importRequest(() => api.post('/lawyer/imports', body, {
      signal,
      headers: {
        'Content-Type': 'multipart/form-data',
        'Idempotency-Key': idempotencyKey,
      },
      onUploadProgress: ({ loaded, total }) => {
        if (onProgress && total > 0) onProgress(Math.min(100, Math.round((loaded / total) * 100)));
      },
    }));
  },
  current: ({ signal, idempotencyKey } = {}) => importRequest(() => api.get('/lawyer/imports/current', {
    signal,
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  })),
  get: (id, { signal } = {}) => importRequest(() => api.get(`/lawyer/imports/${id}`, { signal })),
  poll: async (id, { signal, onUpdate, intervalMs = 1500 } = {}) => {
    while (!signal?.aborted) {
      const result = await lawyerImportService.get(id, { signal });
      onUpdate?.(result.import);
      if (!['uploaded', 'parsing'].includes(result.import?.status)) return result;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(normalizeImportError({ code: 'ERR_CANCELED' }));
        }, { once: true });
      });
    }
    throw normalizeImportError({ code: 'ERR_CANCELED' });
  },
  updateDraft: (id, version, draft, { signal } = {}) => importRequest(() => api.patch(
    `/lawyer/imports/${id}/draft`, { version, draft }, { signal }
  )),
  confirm: (id, version, acceptedPaths, profileRevision, { signal } = {}) => importRequest(() => api.post(
    `/lawyer/imports/${id}/confirm`, { version, acceptedPaths, profileRevision }, { signal }
  )),
  discard: (id, { signal } = {}) => importRequest(() => api.delete(`/lawyer/imports/${id}`, { signal })),
  attachment: (id, { signal } = {}) => importRequest(() => api.get(`/lawyer/imports/${id}/download`, {
    signal,
    responseType: 'blob',
  })),
};

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
  // Приватная заметка юриста по делу
  saveNote: async (consultationId, note) => {
    const response = await api.put(`/lawyer/consultations/${consultationId}/note`, { note });
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

// Lawyer Payments — баланс и заявки на вывод (эндпоинты под /api/payments)
export const lawyerPaymentService = {
  getBalance: async () => {
    const response = await api.get('/payments/balance');
    return response.data;
  },
  withdraw: async (amount) => {
    const response = await api.post('/payments/withdraw', { amount });
    return response.data;
  },
  getWithdrawals: async () => {
    const response = await api.get('/payments/withdrawals');
    return response.data;
  },
};

// Lawyer verification — документы для проверки (диплом/лицензия/удостоверение)
export const lawyerVerificationService = {
  getDocuments: async () => {
    const response = await api.get('/lawyer/verification-documents');
    return response.data;
  },
  uploadDocument: async (file, type) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    const response = await api.post('/lawyer/verification-documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  deleteDocument: async (id) => {
    const response = await api.delete(`/lawyer/verification-documents/${id}`);
    return response.data;
  },
  // Blob документа для предпросмотра/скачивания (свой документ)
  getDocumentBlob: async (id) => {
    const response = await api.get(`/lawyer/verification-documents/${id}/download`, { responseType: 'blob' });
    return response.data;
  },
  submitForReview: async () => {
    const response = await api.post('/lawyer/verification/submit');
    return response.data;
  },
  getChecklist: async () => {
    const response = await api.get('/lawyer/verification/checklist');
    return response.data;
  },
};

export default {
  schedule: lawyerScheduleService,
  reviews: lawyerReviewsService,
  dashboard: lawyerDashboardService,
  consultation: lawyerConsultationService,
  notification: lawyerNotificationService,
  payments: lawyerPaymentService,
  verification: lawyerVerificationService,
  imports: lawyerImportService,
};
