import api from './api';

// Lawyer Schedule Management
export const lawyerScheduleService = {
  // Get lawyer's schedule for a specific month
  getSchedule: async (year, month) => {
    try {
      const response = await api.get(`/lawyer/schedule`, {
        params: { year, month },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching schedule:', error);
      // Return mock data if API fails
      return {
        events: {
          '2024-12-08': [
            { id: 1, time: '14:00', client: 'Иван Петров', topic: 'Договор купли-продажи', type: 'video', status: 'pending' },
            { id: 2, time: '16:30', client: 'Анна Сидорова', topic: 'Трудовой спор', type: 'chat', status: 'confirmed' },
          ],
          '2024-12-09': [
            { id: 3, time: '10:00', client: 'Михаил Козлов', topic: 'Регистрация бизнеса', type: 'video', status: 'confirmed' },
          ],
        },
      };
    }
  },

  // Confirm a consultation
  confirmConsultation: async (consultationId) => {
    try {
      const response = await api.post(`/lawyer/consultations/${consultationId}/confirm`);
      return response.data;
    } catch (error) {
      console.error('Error confirming consultation:', error);
      return { success: true, message: 'Консультация подтверждена' };
    }
  },

  // Reject a consultation
  rejectConsultation: async (consultationId, reason) => {
    try {
      const response = await api.post(`/lawyer/consultations/${consultationId}/reject`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error rejecting consultation:', error);
      return { success: true, message: 'Консультация отклонена' };
    }
  },

  // Set availability
  setAvailability: async (dates, timeSlots) => {
    try {
      const response = await api.post('/lawyer/availability', { dates, timeSlots });
      return response.data;
    } catch (error) {
      console.error('Error setting availability:', error);
      throw error;
    }
  },
};

// Lawyer Reviews Management
export const lawyerReviewsService = {
  // Get all reviews for the lawyer
  getReviews: async (filters = {}) => {
    try {
      const response = await api.get('/lawyer/reviews', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching reviews:', error);
      // Return mock data
      return {
        reviews: [
          {
            id: 1,
            clientName: 'Дмитрий Александров',
            rating: 5,
            comment: 'Отличная консультация! Юрист очень подробно разъяснил все нюансы договора купли-продажи.',
            date: '2024-12-05',
            helpful: 12,
            topic: 'Недвижимость',
          },
          {
            id: 2,
            clientName: 'Елена Васильева',
            rating: 5,
            comment: 'Профессионально и быстро! Помогли разобраться с трудовым спором.',
            date: '2024-12-03',
            helpful: 8,
            topic: 'Трудовое право',
          },
        ],
        stats: {
          average: 4.8,
          total: 156,
          distribution: { 5: 120, 4: 28, 3: 6, 2: 1, 1: 1 },
        },
      };
    }
  },

  // Reply to a review
  replyToReview: async (reviewId, reply) => {
    try {
      const response = await api.post(`/lawyer/reviews/${reviewId}/reply`, { reply });
      return response.data;
    } catch (error) {
      console.error('Error replying to review:', error);
      throw error;
    }
  },

  // Mark review as helpful
  markHelpful: async (reviewId) => {
    try {
      const response = await api.post(`/lawyer/reviews/${reviewId}/helpful`);
      return response.data;
    } catch (error) {
      console.error('Error marking helpful:', error);
      throw error;
    }
  },
};

// Lawyer Dashboard Stats
export const lawyerDashboardService = {
  // Get dashboard statistics
  getStats: async () => {
    try {
      const response = await api.get('/lawyer/dashboard/stats');
      return response.data;
    } catch (error) {
      console.error('Error fetching stats:', error);
      // Return mock data
      return {
        totalEarnings: 3250000,
        monthlyEarnings: 450000,
        activeClients: 24,
        completedConsultations: 156,
        rating: 4.8,
        responseRate: 95,
        availability: 'Online',
      };
    }
  },

  // Get pending consultations
  getPendingConsultations: async () => {
    try {
      const response = await api.get('/lawyer/consultations/pending');
      return response.data;
    } catch (error) {
      console.error('Error fetching consultations:', error);
      return [];
    }
  },

  // Get recent reviews
  getRecentReviews: async (limit = 3) => {
    try {
      const response = await api.get('/lawyer/reviews/recent', { params: { limit } });
      return response.data;
    } catch (error) {
      console.error('Error fetching recent reviews:', error);
      return [];
    }
  },

  // Update lawyer status
  updateStatus: async (status) => {
    try {
      const response = await api.put('/lawyer/status', { status });
      return response.data;
    } catch (error) {
      console.error('Error updating status:', error);
      throw error;
    }
  },
};

// Mock consultation requests
const mockConsultationRequests = [
  {
    id: 1,
    client: {
      id: 1,
      name: 'Каримова Малика',
      avatar: null,
    },
    question: 'Нужна консультация по трудовому договору',
    description: 'Работодатель не выплатил зарплату за последние 2 месяца. Что делать в такой ситуации?',
    consultationType: 'video',
    preferredDate: '2025-01-20',
    preferredTime: '14:00',
    status: 'pending',
    createdAt: '2025-01-15T10:30:00',
    price: 250000,
  },
  {
    id: 2,
    client: {
      id: 2,
      name: 'Рахимов Фаррух',
      avatar: null,
    },
    question: 'Вопрос по наследству',
    description: 'Умер родственник, оставил завещание. Нужна консультация по процедуре вступления в наследство.',
    consultationType: 'chat',
    preferredDate: '2025-01-22',
    preferredTime: '16:00',
    status: 'pending',
    createdAt: '2025-01-16T14:20:00',
    price: 250000,
  },
  {
    id: 3,
    client: {
      id: 3,
      name: 'Усманова Дилноза',
      avatar: null,
    },
    question: 'Консультация по договору купли-продажи',
    description: 'Хочу приобрести квартиру, нужна помощь в проверке документов и составлении договора.',
    consultationType: 'video',
    preferredDate: '2025-01-25',
    preferredTime: '11:00',
    status: 'pending',
    createdAt: '2025-01-17T09:15:00',
    price: 250000,
  },
];

// Lawyer Consultations
export const lawyerConsultationService = {
  // Get consultation requests
  getConsultationRequests: async (status = 'all') => {
    try {
      const response = await api.get('/lawyer/consultation-requests', { params: { status } });
      return response.data;
    } catch (error) {
      console.error('Error fetching consultation requests:', error);

      // Get current lawyer user from localStorage
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const currentLawyerId = currentUser.id;
      const currentLawyerName = currentUser.name;

      console.log('🔍 DEBUG: Current Lawyer:', { currentLawyerId, currentLawyerName, fullUser: currentUser });

      // Get requests from localStorage
      let allRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');

      console.log('🔍 DEBUG: All Requests from localStorage:', allRequests);
      console.log('🔍 DEBUG: Total requests count:', allRequests.length);

      // Add mock requests if localStorage is empty
      if (allRequests.length === 0) {
        allRequests.push(...mockConsultationRequests);
        localStorage.setItem('consultationRequests', JSON.stringify(allRequests));
        console.log('🔍 DEBUG: Added mock requests');
      }

      // Filter by lawyer ID or lawyer name - show only requests for this lawyer
      // Show if: no lawyerId (old mock data), OR lawyerId matches, OR lawyerName matches
      let lawyerRequests = allRequests.filter(req => {
        console.log('🔍 DEBUG: Checking request:', {
          requestId: req.id,
          requestLawyerId: req.lawyerId,
          requestLawyerName: req.lawyerName,
          currentLawyerId,
          currentLawyerName
        });

        // If no lawyerId and no lawyerName, show to all (mock data)
        if (!req.lawyerId && !req.lawyerName) {
          console.log('✅ Match: Mock data (no lawyer specified)');
          return true;
        }
        // Match by ID
        if (req.lawyerId && currentLawyerId && req.lawyerId === currentLawyerId) {
          console.log('✅ Match: Lawyer ID matches');
          return true;
        }
        // Match by name
        if (req.lawyerName && currentLawyerName && req.lawyerName === currentLawyerName) {
          console.log('✅ Match: Lawyer name matches');
          return true;
        }
        console.log('❌ No match');
        return false;
      });

      console.log('🔍 DEBUG: Filtered Lawyer Requests:', lawyerRequests);
      console.log('🔍 DEBUG: Filtered count:', lawyerRequests.length);

      // Filter by status
      if (status === 'all') {
        return lawyerRequests;
      }
      const statusFiltered = lawyerRequests.filter(req => req.status === status);
      console.log(`🔍 DEBUG: Status '${status}' filtered count:`, statusFiltered.length);
      return statusFiltered;
    }
  },

  // Accept consultation request
  acceptConsultationRequest: async (requestId, responseMessage = '') => {
    try {
      const response = await api.post(`/lawyer/consultation-requests/${requestId}/accept`, {
        responseMessage,
      });
      return response.data;
    } catch (error) {
      console.error('Error accepting consultation request:', error);

      // Update request status in localStorage
      const allRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');
      const requestIndex = allRequests.findIndex(req => req.id === requestId);

      if (requestIndex !== -1) {
        allRequests[requestIndex].status = 'accepted';
        allRequests[requestIndex].acceptedAt = new Date().toISOString();
        localStorage.setItem('consultationRequests', JSON.stringify(allRequests));
      }

      return { success: true, message: 'Запрос принят' };
    }
  },

  // Reject consultation request
  rejectConsultationRequest: async (requestId, reason = '') => {
    try {
      const response = await api.post(`/lawyer/consultation-requests/${requestId}/reject`, {
        reason,
      });
      return response.data;
    } catch (error) {
      console.error('Error rejecting consultation request:', error);

      // Update request status in localStorage
      const allRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');
      const requestIndex = allRequests.findIndex(req => req.id === requestId);

      if (requestIndex !== -1) {
        allRequests[requestIndex].status = 'rejected';
        allRequests[requestIndex].rejectedAt = new Date().toISOString();
        allRequests[requestIndex].rejectionReason = reason;
        localStorage.setItem('consultationRequests', JSON.stringify(allRequests));
      }

      return { success: true, message: 'Запрос отклонен' };
    }
  },

  // Start a consultation
  startConsultation: async (consultationId) => {
    try {
      const response = await api.post(`/lawyer/consultations/${consultationId}/start`);
      return response.data;
    } catch (error) {
      console.error('Error starting consultation:', error);
      throw error;
    }
  },

  // End a consultation
  endConsultation: async (consultationId, notes) => {
    try {
      const response = await api.post(`/lawyer/consultations/${consultationId}/end`, { notes });
      return response.data;
    } catch (error) {
      console.error('Error ending consultation:', error);
      throw error;
    }
  },

  // Get consultation details
  getConsultationDetails: async (consultationId) => {
    try {
      const response = await api.get(`/lawyer/consultations/${consultationId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching consultation details:', error);
      throw error;
    }
  },
};

// Lawyer Notifications
export const lawyerNotificationService = {
  // Get notifications
  getNotifications: async () => {
    try {
      const response = await api.get('/lawyer/notifications');
      return response.data;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }
  },

  // Mark notification as read
  markAsRead: async (notificationId) => {
    try {
      const response = await api.put(`/lawyer/notifications/${notificationId}/read`);
      return response.data;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  },

  // Mark all as read
  markAllAsRead: async () => {
    try {
      const response = await api.put('/lawyer/notifications/read-all');
      return response.data;
    } catch (error) {
      console.error('Error marking all as read:', error);
      throw error;
    }
  },
};

export default {
  schedule: lawyerScheduleService,
  reviews: lawyerReviewsService,
  dashboard: lawyerDashboardService,
  consultation: lawyerConsultationService,
  notification: lawyerNotificationService,
};
