import api from './api';

// Client Dashboard Service
export const clientDashboardService = {
  // Get dashboard stats
  getStats: async () => {
    try {
      const response = await api.get('/client/dashboard/stats');
      return response.data;
    } catch (error) {
      console.error('Error fetching stats:', error);
      return {
        activeConsultations: 3,
        documents: 12,
        completedConsultations: 8,
        rating: 4.8,
      };
    }
  },

  // Get upcoming consultations
  getUpcomingConsultations: async () => {
    try {
      const response = await api.get('/client/consultations/upcoming');
      return response.data;
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
      const response = await api.get('/client/lawyers', { params: filters });
      const data = response.data;
      const rawLawyers = data.lawyers || data || [];
      const lawyers = rawLawyers.map((l) => ({
        id: l.id,
        name: l.name,
        avatar: l.avatar,
        isVerified: l.isVerified,
        rating: l.profile?.rating || 0,
        reviewsCount: l.profile?.reviewsCount || 0,
        completedConsultations: l.profile?.completedCases || 0,
        specializations: l.profile?.specialization ? [l.profile.specialization] : [],
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
      };
    } catch (error) {
      console.error('Error searching lawyers:', error);
      return { lawyers: [], totalPages: 1, total: 0 };
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
};

const clientService = {
  dashboard: clientDashboardService,
  lawyers: clientLawyerService,
  consultations: clientConsultationService,
  documents: clientDocumentService,
  aiChat: clientAIChatService,
  favorites: clientFavoritesService,
  subscription: clientSubscriptionService,
};

export default clientService;
