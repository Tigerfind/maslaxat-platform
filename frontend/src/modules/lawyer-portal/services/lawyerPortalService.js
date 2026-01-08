/**
 * Lawyer Portal Module - Lawyer Portal Service
 * Handles all lawyer-specific API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock lawyer stats
 */
const MOCK_STATS = {
  totalConsultations: 156,
  upcomingConsultations: 5,
  completedThisMonth: 28,
  rating: 4.9,
  reviewsCount: 89,
  earnings: 15600000,
  earningsThisMonth: 4200000,
  clientsCount: 145,
};

const MOCK_SCHEDULE = [
  {
    id: 1,
    clientName: 'Клиент Тестовый',
    date: '2024-01-20',
    time: '10:00',
    duration: 60,
    type: 'video',
    topic: 'Раздел имущества',
    status: 'confirmed',
  },
  {
    id: 2,
    clientName: 'Мария С.',
    date: '2024-01-20',
    time: '14:00',
    duration: 45,
    type: 'video',
    topic: 'Составление договора',
    status: 'pending',
  },
  {
    id: 3,
    clientName: 'Алексей К.',
    date: '2024-01-21',
    time: '11:00',
    duration: 30,
    type: 'chat',
    topic: 'Консультация по наследству',
    status: 'confirmed',
  },
];

/**
 * Get lawyer dashboard stats
 */
export const getDashboardStats = async () => {
  try {
    const response = await fetch(`${API_URL}/lawyer/stats`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch stats');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock lawyer stats');
    return MOCK_STATS;
  }
};

/**
 * Get lawyer schedule
 */
export const getSchedule = async (startDate, endDate) => {
  try {
    const response = await fetch(
      `${API_URL}/lawyer/schedule?start=${startDate}&end=${endDate}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch schedule');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock schedule');
    return MOCK_SCHEDULE;
  }
};

/**
 * Update availability
 */
export const updateAvailability = async (slots) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/availability`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ slots }),
    });

    if (!response.ok) {
      throw new Error('Failed to update availability');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: availability updated');
    return { success: true };
  }
};

/**
 * Confirm consultation
 */
export const confirmConsultation = async (consultationId) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/consultations/${consultationId}/confirm`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to confirm consultation');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: consultation confirmed');
    return { success: true, status: 'confirmed' };
  }
};

/**
 * Cancel consultation
 */
export const cancelConsultation = async (consultationId, reason) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/consultations/${consultationId}/cancel`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      throw new Error('Failed to cancel consultation');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: consultation cancelled');
    return { success: true, status: 'cancelled' };
  }
};

/**
 * Get lawyer reviews
 */
export const getReviews = async (page = 1, limit = 10) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/reviews?page=${page}&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch reviews');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock reviews');
    return {
      reviews: [
        {
          id: 1,
          clientName: 'Клиент Тестовый',
          rating: 5,
          text: 'Отличный специалист!',
          date: '2024-01-15',
          reply: null,
        },
        {
          id: 2,
          clientName: 'Мария С.',
          rating: 4,
          text: 'Профессиональный подход',
          date: '2024-01-10',
          reply: 'Спасибо за отзыв!',
        },
      ],
      total: 89,
      page,
      limit,
    };
  }
};

/**
 * Reply to review
 */
export const replyToReview = async (reviewId, reply) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/reviews/${reviewId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ reply }),
    });

    if (!response.ok) {
      throw new Error('Failed to reply to review');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: reply added');
    return { success: true, reply };
  }
};

/**
 * Get earnings report
 */
export const getEarningsReport = async (period = 'month') => {
  try {
    const response = await fetch(`${API_URL}/lawyer/earnings?period=${period}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch earnings');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock earnings');
    return {
      total: 4200000,
      consultations: [
        { date: '2024-01-01', amount: 150000, count: 1 },
        { date: '2024-01-02', amount: 350000, count: 2 },
        { date: '2024-01-03', amount: 200000, count: 1 },
      ],
      byType: {
        video: 3500000,
        chat: 700000,
      },
    };
  }
};

/**
 * Update lawyer profile
 */
export const updateProfile = async (profileData) => {
  try {
    const response = await fetch(`${API_URL}/lawyer/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify(profileData),
    });

    if (!response.ok) {
      throw new Error('Failed to update profile');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: profile updated');
    return { success: true, ...profileData };
  }
};

export default {
  getDashboardStats,
  getSchedule,
  updateAvailability,
  confirmConsultation,
  cancelConsultation,
  getReviews,
  replyToReview,
  getEarningsReport,
  updateProfile,
};
