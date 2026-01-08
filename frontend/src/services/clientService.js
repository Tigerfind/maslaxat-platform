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

// Mock lawyers data
const mockLawyers = [
  {
    id: 1,
    name: 'Акбаров Азиз',
    specialization: 'Гражданское право',
    rating: 4.9,
    reviewsCount: 127,
    experience: 12,
    price: 250000,
    location: 'Ташкент, Мирзо-Улугбекский район',
    avatar: null,
    isVerified: true,
    completedCases: 234,
    description: 'Специализируюсь на гражданских делах, защите прав потребителей и семейном праве',
  },
  {
    id: 2,
    name: 'Карим ова Дилора',
    specialization: 'Семейное право',
    rating: 4.8,
    reviewsCount: 98,
    experience: 8,
    price: 200000,
    location: 'Ташкент, Юнусабадский район',
    avatar: null,
    isVerified: true,
    completedCases: 156,
    description: 'Опытный юрист по семейным спорам, разводам и алиментам',
  },
  {
    id: 3,
    name: 'Рахимов Жасур',
    specialization: 'Уголовное право',
    rating: 4.7,
    reviewsCount: 145,
    experience: 15,
    price: 350000,
    location: 'Ташкент, Яшнабадский район',
    avatar: null,
    isVerified: true,
    completedCases: 312,
    description: 'Защита в уголовных делах, представительство в суде',
  },
  {
    id: 4,
    name: 'Мирзаева Нигора',
    specialization: 'Трудовое право',
    rating: 4.9,
    reviewsCount: 87,
    experience: 10,
    price: 180000,
    location: 'Ташкент, Чиланзарский район',
    avatar: null,
    isVerified: true,
    completedCases: 198,
    description: 'Консультации по трудовым спорам, защита прав работников',
  },
  {
    id: 5,
    name: 'Усманов Бахтиёр',
    specialization: 'Коммерческое право',
    rating: 4.6,
    reviewsCount: 112,
    experience: 14,
    price: 400000,
    location: 'Ташкент, Мирабадский район',
    avatar: null,
    isVerified: true,
    completedCases: 267,
    description: 'Юридическое сопровождение бизнеса, договорное право',
  },
  {
    id: 6,
    name: 'Хасанова Гульнара',
    specialization: 'Налоговое право',
    rating: 4.8,
    reviewsCount: 76,
    experience: 9,
    price: 300000,
    location: 'Ташкент, Сергелийский район',
    avatar: null,
    isVerified: true,
    completedCases: 145,
    description: 'Налоговые консультации, споры с налоговыми органами',
  },
  {
    id: 7,
    name: 'Салимов Тимур',
    specialization: 'Административное право',
    rating: 4.7,
    reviewsCount: 93,
    experience: 11,
    price: 220000,
    location: 'Ташкент, Алмазарский район',
    avatar: null,
    isVerified: true,
    completedCases: 187,
    description: 'Административные правонарушения, оспаривание штрафов',
  },
  {
    id: 8,
    name: 'Юнусова Зарина',
    specialization: 'Земельное право',
    rating: 4.9,
    reviewsCount: 68,
    experience: 7,
    price: 190000,
    location: 'Ташкент, Шайхантахурский район',
    avatar: null,
    isVerified: true,
    completedCases: 123,
    description: 'Сделки с недвижимостью, земельные споры',
  },
  {
    id: 9,
    name: 'Алимов Фаррух',
    specialization: 'Интеллектуальная собственность',
    rating: 4.8,
    reviewsCount: 54,
    experience: 13,
    price: 450000,
    location: 'Ташкент, Учтепинский район',
    avatar: null,
    isVerified: true,
    completedCases: 156,
    description: 'Защита авторских прав, патентование, товарные знаки',
  },
  {
    id: 10,
    name: 'Иванов Иван Иванович',
    specialization: 'Корпоративное право',
    rating: 4.9,
    reviewsCount: 142,
    experience: 16,
    price: 380000,
    location: 'Ташкент, Яккасарайский район',
    avatar: null,
    isVerified: true,
    completedCases: 289,
    description: 'Корпоративные споры, слияния и поглощения, юридическое сопровождение бизнеса',
  },
];

// Client Lawyer Search Service
export const clientLawyerService = {
  // Search lawyers
  searchLawyers: async (filters) => {
    try {
      const response = await api.get('/client/lawyers/search', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error searching lawyers:', error);
      // Return mock data with filtering
      let filtered = [...mockLawyers];

      if (filters?.specialization) {
        filtered = filtered.filter(l => l.specialization === filters.specialization);
      }

      if (filters?.minRating) {
        filtered = filtered.filter(l => l.rating >= filters.minRating);
      }

      if (filters?.search) {
        const search = filters.search.toLowerCase();
        filtered = filtered.filter(l =>
          l.name.toLowerCase().includes(search) ||
          l.specialization.toLowerCase().includes(search)
        );
      }

      if (filters?.sortBy === 'rating') {
        filtered.sort((a, b) => b.rating - a.rating);
      } else if (filters?.sortBy === 'price_low') {
        filtered.sort((a, b) => a.price - b.price);
      } else if (filters?.sortBy === 'price_high') {
        filtered.sort((a, b) => b.price - a.price);
      }

      return filtered;
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

  // Book consultation
  bookConsultation: async (lawyerId, consultationData) => {
    try {
      const response = await api.post(`/client/lawyers/${lawyerId}/book`, consultationData);
      return response.data;
    } catch (error) {
      console.error('Error booking consultation:', error);

      // Get current user from localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      console.log('📝 DEBUG: Booking - Current User:', user);

      // Find lawyer from mock data
      const lawyer = mockLawyers.find(l => l.id === lawyerId);
      console.log('📝 DEBUG: Booking - Selected Lawyer:', lawyer);

      // Create new consultation request
      const newRequest = {
        id: Date.now(),
        lawyerId: lawyerId,
        lawyerName: lawyer?.name || 'Юрист',
        client: {
          id: user.id || Date.now(),
          name: user.name || 'Клиент',
          avatar: null,
        },
        question: consultationData.question,
        description: consultationData.description,
        consultationType: consultationData.consultationType,
        preferredDate: consultationData.preferredDate,
        preferredTime: consultationData.preferredTime,
        status: 'pending',
        createdAt: new Date().toISOString(),
        price: lawyer?.price || 250000,
      };

      console.log('📝 DEBUG: Booking - New Request Created:', newRequest);

      // Get existing requests from localStorage
      const existingRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');
      console.log('📝 DEBUG: Booking - Existing Requests:', existingRequests);

      // Add new request
      existingRequests.push(newRequest);

      // Save to localStorage
      localStorage.setItem('consultationRequests', JSON.stringify(existingRequests));
      console.log('📝 DEBUG: Booking - Saved to localStorage. Total requests now:', existingRequests.length);

      // Verify save
      const verifyRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');
      console.log('📝 DEBUG: Booking - Verification read from localStorage:', verifyRequests);

      return {
        success: true,
        message: 'Запрос отправлен юристу',
        requestId: newRequest.id,
      };
    }
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
      return response.data;
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
  // Send message to AI
  sendMessage: async (message, conversationId = null) => {
    try {
      const response = await api.post('/client/ai-chat/message', {
        message,
        conversationId,
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

export default {
  dashboard: clientDashboardService,
  lawyers: clientLawyerService,
  consultations: clientConsultationService,
  documents: clientDocumentService,
  aiChat: clientAIChatService,
};
