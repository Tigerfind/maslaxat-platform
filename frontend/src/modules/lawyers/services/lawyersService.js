/**
 * Lawyers Module - Lawyers Service
 * Handles all lawyer-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock lawyers data
 */
const MOCK_LAWYERS = [
  {
    id: 1,
    name: 'Иванов Иван Иванович',
    email: 'ivanov@maslaxat.uz',
    phone: '+998 90 123 45 67',
    specializations: ['Семейное право', 'Наследство'],
    rating: 4.9,
    reviewsCount: 156,
    experience: 15,
    education: 'Ташкентский государственный юридический университет',
    price: 150000,
    avatar: null,
    verified: true,
    available: true,
    bio: 'Опытный юрист с 15-летним стажем работы в семейном праве.',
    languages: ['Русский', 'Узбекский', 'Английский'],
    consultationsCount: 450,
  },
  {
    id: 2,
    name: 'Петрова Анна Сергеевна',
    email: 'petrova@maslaxat.uz',
    phone: '+998 90 234 56 78',
    specializations: ['Трудовое право', 'Корпоративное право'],
    rating: 4.8,
    reviewsCount: 98,
    experience: 10,
    education: 'МГУ им. Ломоносова',
    price: 200000,
    avatar: null,
    verified: true,
    available: true,
    bio: 'Специализируюсь на трудовых спорах и корпоративном праве.',
    languages: ['Русский', 'Английский'],
    consultationsCount: 320,
  },
  {
    id: 3,
    name: 'Сидоров Петр Александрович',
    email: 'sidorov@maslaxat.uz',
    phone: '+998 90 345 67 89',
    specializations: ['Недвижимость', 'Договорное право'],
    rating: 4.7,
    reviewsCount: 75,
    experience: 8,
    education: 'Ташкентский государственный юридический университет',
    price: 120000,
    avatar: null,
    verified: true,
    available: false,
    bio: 'Эксперт по сделкам с недвижимостью и договорному праву.',
    languages: ['Русский', 'Узбекский'],
    consultationsCount: 210,
  },
  {
    id: 4,
    name: 'Каримова Дильноза',
    email: 'karimova@maslaxat.uz',
    phone: '+998 90 456 78 90',
    specializations: ['Уголовное право', 'Административное право'],
    rating: 4.6,
    reviewsCount: 64,
    experience: 12,
    education: 'Академия МВД Узбекистана',
    price: 180000,
    avatar: null,
    verified: true,
    available: true,
    bio: 'Защита прав в уголовных и административных делах.',
    languages: ['Узбекский', 'Русский'],
    consultationsCount: 380,
  },
];

const MOCK_SPECIALIZATIONS = [
  { id: 1, name: 'Семейное право', count: 45 },
  { id: 2, name: 'Трудовое право', count: 32 },
  { id: 3, name: 'Недвижимость', count: 28 },
  { id: 4, name: 'Уголовное право', count: 21 },
  { id: 5, name: 'Корпоративное право', count: 18 },
  { id: 6, name: 'Налоговое право', count: 15 },
  { id: 7, name: 'Миграционное право', count: 12 },
  { id: 8, name: 'Договорное право', count: 25 },
];

/**
 * Get all lawyers with optional filters
 */
export const getLawyers = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams(filters).toString();
    const response = await fetch(`${API_URL}/lawyers?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch lawyers');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock lawyers data');

    // Apply filters to mock data
    let filtered = [...MOCK_LAWYERS];

    if (filters.specialization) {
      filtered = filtered.filter((l) =>
        l.specializations.some((s) =>
          s.toLowerCase().includes(filters.specialization.toLowerCase())
        )
      );
    }

    if (filters.available) {
      filtered = filtered.filter((l) => l.available);
    }

    if (filters.minRating) {
      filtered = filtered.filter((l) => l.rating >= parseFloat(filters.minRating));
    }

    if (filters.maxPrice) {
      filtered = filtered.filter((l) => l.price <= parseInt(filters.maxPrice));
    }

    return filtered;
  }
};

/**
 * Get lawyer by ID
 */
export const getLawyerById = async (lawyerId) => {
  try {
    const response = await fetch(`${API_URL}/lawyers/${lawyerId}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch lawyer');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock lawyer data');
    return MOCK_LAWYERS.find((l) => l.id === parseInt(lawyerId)) || null;
  }
};

/**
 * Get lawyer reviews
 */
export const getLawyerReviews = async (lawyerId, page = 1, limit = 10) => {
  try {
    const response = await fetch(
      `${API_URL}/lawyers/${lawyerId}/reviews?page=${page}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      }
    );

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
          clientName: 'Алексей К.',
          rating: 5,
          text: 'Отличный специалист! Помог решить сложный вопрос.',
          date: '2024-01-10',
        },
        {
          id: 2,
          clientName: 'Мария С.',
          rating: 4,
          text: 'Профессиональный подход к делу.',
          date: '2024-01-05',
        },
      ],
      total: 2,
      page,
      limit,
    };
  }
};

/**
 * Get available time slots for lawyer
 */
export const getLawyerSchedule = async (lawyerId, date) => {
  try {
    const response = await fetch(`${API_URL}/lawyers/${lawyerId}/schedule?date=${date}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch schedule');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock schedule');
    return {
      date,
      slots: [
        { time: '09:00', available: true },
        { time: '10:00', available: true },
        { time: '11:00', available: false },
        { time: '14:00', available: true },
        { time: '15:00', available: true },
        { time: '16:00', available: true },
      ],
    };
  }
};

/**
 * Get all specializations
 */
export const getSpecializations = async () => {
  try {
    const response = await fetch(`${API_URL}/lawyers/specializations`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch specializations');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock specializations');
    return MOCK_SPECIALIZATIONS;
  }
};

/**
 * Save lawyer to favorites
 */
export const saveLawyer = async (lawyerId) => {
  try {
    const response = await fetch(`${API_URL}/lawyers/${lawyerId}/save`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to save lawyer');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: lawyer saved');
    return { success: true };
  }
};

/**
 * Remove lawyer from favorites
 */
export const unsaveLawyer = async (lawyerId) => {
  try {
    const response = await fetch(`${API_URL}/lawyers/${lawyerId}/unsave`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to unsave lawyer');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: lawyer unsaved');
    return { success: true };
  }
};

export default {
  getLawyers,
  getLawyerById,
  getLawyerReviews,
  getLawyerSchedule,
  getSpecializations,
  saveLawyer,
  unsaveLawyer,
};
