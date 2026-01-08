/**
 * Dashboard Module - Dashboard Service
 * Handles all dashboard-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock data for dashboard statistics
 */
const MOCK_STATS = {
  totalConsultations: 12,
  upcomingConsultations: 3,
  completedConsultations: 8,
  pendingDocuments: 5,
  aiChatSessions: 24,
  savedLawyers: 4,
};

const MOCK_RECENT_CONSULTATIONS = [
  {
    id: 1,
    lawyerName: 'Иванов Иван',
    specialization: 'Семейное право',
    date: '2024-01-15',
    time: '10:00',
    status: 'completed',
    rating: 5,
  },
  {
    id: 2,
    lawyerName: 'Петрова Анна',
    specialization: 'Трудовое право',
    date: '2024-01-18',
    time: '14:00',
    status: 'upcoming',
    rating: null,
  },
  {
    id: 3,
    lawyerName: 'Сидоров Петр',
    specialization: 'Недвижимость',
    date: '2024-01-20',
    time: '11:30',
    status: 'upcoming',
    rating: null,
  },
];

const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    type: 'consultation',
    title: 'Напоминание о консультации',
    message: 'Консультация с Петровой Анной через 2 часа',
    timestamp: new Date().toISOString(),
    read: false,
  },
  {
    id: 2,
    type: 'document',
    title: 'Документ готов',
    message: 'Ваш договор аренды готов к скачиванию',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    read: false,
  },
  {
    id: 3,
    type: 'ai',
    title: 'AI консультация',
    message: 'Новый ответ от AI помощника',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    read: true,
  },
];

/**
 * Get dashboard statistics
 */
export const getDashboardStats = async () => {
  try {
    const response = await fetch(`${API_URL}/dashboard/stats`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch stats');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock dashboard stats');
    return MOCK_STATS;
  }
};

/**
 * Get recent consultations
 */
export const getRecentConsultations = async (limit = 5) => {
  try {
    const response = await fetch(`${API_URL}/dashboard/consultations/recent?limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch consultations');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock consultations');
    return MOCK_RECENT_CONSULTATIONS;
  }
};

/**
 * Get notifications
 */
export const getNotifications = async () => {
  try {
    const response = await fetch(`${API_URL}/dashboard/notifications`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch notifications');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock notifications');
    return MOCK_NOTIFICATIONS;
  }
};

/**
 * Mark notification as read
 */
export const markNotificationRead = async (notificationId) => {
  try {
    const response = await fetch(`${API_URL}/dashboard/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to mark notification');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: notification marked as read');
    return { success: true };
  }
};

/**
 * Get activity feed
 */
export const getActivityFeed = async (page = 1, limit = 10) => {
  try {
    const response = await fetch(`${API_URL}/dashboard/activity?page=${page}&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch activity');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock activity feed');
    return {
      items: [],
      total: 0,
      page,
      limit,
    };
  }
};

export default {
  getDashboardStats,
  getRecentConsultations,
  getNotifications,
  markNotificationRead,
  getActivityFeed,
};
