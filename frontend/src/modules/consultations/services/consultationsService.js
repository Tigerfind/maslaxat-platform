/**
 * Consultations Module - Consultations Service
 * Handles all consultation-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock consultations data
 */
const MOCK_CONSULTATIONS = [
  {
    id: 1,
    lawyerId: 1,
    lawyerName: 'Иванов Иван',
    lawyerSpecialization: 'Семейное право',
    clientId: 1,
    clientName: 'Клиент Тестовый',
    date: '2024-01-20',
    time: '10:00',
    duration: 60,
    status: 'upcoming',
    type: 'video',
    price: 150000,
    topic: 'Раздел имущества при разводе',
    notes: '',
    meetingLink: 'https://meet.maslaxat.uz/room/abc123',
  },
  {
    id: 2,
    lawyerId: 2,
    lawyerName: 'Петрова Анна',
    lawyerSpecialization: 'Трудовое право',
    clientId: 1,
    clientName: 'Клиент Тестовый',
    date: '2024-01-15',
    time: '14:00',
    duration: 45,
    status: 'completed',
    type: 'video',
    price: 200000,
    topic: 'Незаконное увольнение',
    notes: 'Рекомендовано подать жалобу в трудовую инспекцию',
    rating: 5,
    review: 'Отличная консультация!',
  },
  {
    id: 3,
    lawyerId: 3,
    lawyerName: 'Сидоров Петр',
    lawyerSpecialization: 'Недвижимость',
    clientId: 1,
    clientName: 'Клиент Тестовый',
    date: '2024-01-10',
    time: '11:00',
    duration: 30,
    status: 'completed',
    type: 'chat',
    price: 80000,
    topic: 'Договор аренды',
    notes: 'Документ проверен',
    rating: 4,
    review: 'Хороший специалист',
  },
];

/**
 * Get all consultations for current user
 */
export const getConsultations = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams(filters).toString();
    const response = await fetch(`${API_URL}/consultations?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch consultations');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock consultations data');

    let filtered = [...MOCK_CONSULTATIONS];

    if (filters.status) {
      filtered = filtered.filter((c) => c.status === filters.status);
    }

    if (filters.type) {
      filtered = filtered.filter((c) => c.type === filters.type);
    }

    return filtered;
  }
};

/**
 * Get consultation by ID
 */
export const getConsultationById = async (consultationId) => {
  try {
    const response = await fetch(`${API_URL}/consultations/${consultationId}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch consultation');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock consultation data');
    return MOCK_CONSULTATIONS.find((c) => c.id === parseInt(consultationId)) || null;
  }
};

/**
 * Book a new consultation
 */
export const bookConsultation = async (bookingData) => {
  try {
    const response = await fetch(`${API_URL}/consultations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify(bookingData),
    });

    if (!response.ok) {
      throw new Error('Failed to book consultation');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: consultation booked');
    return {
      id: Date.now(),
      ...bookingData,
      status: 'upcoming',
      createdAt: new Date().toISOString(),
    };
  }
};

/**
 * Cancel consultation
 */
export const cancelConsultation = async (consultationId, reason) => {
  try {
    const response = await fetch(`${API_URL}/consultations/${consultationId}/cancel`, {
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
 * Reschedule consultation
 */
export const rescheduleConsultation = async (consultationId, newDate, newTime) => {
  try {
    const response = await fetch(`${API_URL}/consultations/${consultationId}/reschedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ date: newDate, time: newTime }),
    });

    if (!response.ok) {
      throw new Error('Failed to reschedule consultation');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: consultation rescheduled');
    return { success: true, date: newDate, time: newTime };
  }
};

/**
 * Submit review for consultation
 */
export const submitReview = async (consultationId, rating, review) => {
  try {
    const response = await fetch(`${API_URL}/consultations/${consultationId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ rating, review }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit review');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: review submitted');
    return { success: true, rating, review };
  }
};

/**
 * Get consultation chat history
 */
export const getChatHistory = async (consultationId) => {
  try {
    const response = await fetch(`${API_URL}/consultations/${consultationId}/chat`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch chat history');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock chat history');
    return {
      messages: [
        {
          id: 1,
          sender: 'client',
          text: 'Здравствуйте! У меня вопрос по договору.',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 2,
          sender: 'lawyer',
          text: 'Добрый день! Да, я готов помочь. Опишите ситуацию.',
          timestamp: new Date(Date.now() - 3500000).toISOString(),
        },
      ],
    };
  }
};

/**
 * Check for booking conflicts
 */
export const checkConflicts = async (lawyerId, date, time) => {
  try {
    const response = await fetch(
      `${API_URL}/consultations/check-conflicts?lawyerId=${lawyerId}&date=${date}&time=${time}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to check conflicts');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: no conflicts');
    return { hasConflict: false };
  }
};

export default {
  getConsultations,
  getConsultationById,
  bookConsultation,
  cancelConsultation,
  rescheduleConsultation,
  submitReview,
  getChatHistory,
  checkConflicts,
};
