/**
 * Admin Module - Admin Service
 * Handles all admin-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock admin stats
 */
const MOCK_STATS = {
  totalUsers: 1250,
  totalLawyers: 85,
  totalConsultations: 3420,
  totalRevenue: 256000000,
  pendingVerifications: 12,
  activeConsultations: 45,
  newUsersToday: 18,
  newLawyersThisMonth: 5,
};

const MOCK_USERS = [
  {
    id: 1,
    name: 'Клиент Тестовый',
    email: 'client@maslaxat.uz',
    role: 'client',
    status: 'active',
    createdAt: '2024-01-01T10:00:00Z',
    consultationsCount: 5,
  },
  {
    id: 2,
    name: 'Иванов Иван',
    email: 'ivanov@maslaxat.uz',
    role: 'lawyer',
    status: 'active',
    createdAt: '2023-06-15T10:00:00Z',
    consultationsCount: 156,
    verified: true,
  },
];

/**
 * Get admin dashboard stats
 */
export const getDashboardStats = async () => {
  try {
    const response = await fetch(`${API_URL}/admin/stats`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch stats');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock admin stats');
    return MOCK_STATS;
  }
};

/**
 * Get all users
 */
export const getUsers = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams(filters).toString();
    const response = await fetch(`${API_URL}/admin/users?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch users');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock users');
    return MOCK_USERS;
  }
};

/**
 * Get pending lawyer verifications
 */
export const getPendingVerifications = async () => {
  try {
    const response = await fetch(`${API_URL}/admin/verifications/pending`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch verifications');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock verifications');
    return [
      {
        id: 1,
        lawyerId: 10,
        lawyerName: 'Новый Юрист',
        documents: ['diploma.pdf', 'license.pdf'],
        submittedAt: '2024-01-18T10:00:00Z',
        status: 'pending',
      },
    ];
  }
};

/**
 * Verify lawyer
 */
export const verifyLawyer = async (lawyerId, approved, notes = '') => {
  try {
    const response = await fetch(`${API_URL}/admin/verifications/${lawyerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ approved, notes }),
    });

    if (!response.ok) {
      throw new Error('Failed to verify lawyer');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: lawyer verification processed');
    return { success: true, approved };
  }
};

/**
 * Block/unblock user
 */
export const toggleUserStatus = async (userId, blocked) => {
  try {
    const response = await fetch(`${API_URL}/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ blocked }),
    });

    if (!response.ok) {
      throw new Error('Failed to update user status');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: user status updated');
    return { success: true, blocked };
  }
};

/**
 * Get specializations
 */
export const getSpecializations = async () => {
  try {
    const response = await fetch(`${API_URL}/admin/specializations`, {
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
    return [
      { id: 1, name: 'Семейное право', lawyersCount: 45, active: true },
      { id: 2, name: 'Трудовое право', lawyersCount: 32, active: true },
      { id: 3, name: 'Недвижимость', lawyersCount: 28, active: true },
      { id: 4, name: 'Уголовное право', lawyersCount: 21, active: true },
    ];
  }
};

/**
 * Create specialization
 */
export const createSpecialization = async (name) => {
  try {
    const response = await fetch(`${API_URL}/admin/specializations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error('Failed to create specialization');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: specialization created');
    return { id: Date.now(), name, lawyersCount: 0, active: true };
  }
};

/**
 * Delete specialization
 */
export const deleteSpecialization = async (specializationId) => {
  try {
    const response = await fetch(`${API_URL}/admin/specializations/${specializationId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete specialization');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: specialization deleted');
    return { success: true };
  }
};

/**
 * Get analytics data
 */
export const getAnalytics = async (period = '30d') => {
  try {
    const response = await fetch(`${API_URL}/admin/analytics?period=${period}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch analytics');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock analytics');
    return {
      consultations: [
        { date: '2024-01-01', count: 25 },
        { date: '2024-01-02', count: 32 },
        { date: '2024-01-03', count: 28 },
      ],
      revenue: [
        { date: '2024-01-01', amount: 5000000 },
        { date: '2024-01-02', amount: 7500000 },
        { date: '2024-01-03', amount: 6200000 },
      ],
      users: [
        { date: '2024-01-01', new: 12, active: 450 },
        { date: '2024-01-02', new: 18, active: 468 },
        { date: '2024-01-03', new: 15, active: 475 },
      ],
    };
  }
};

export default {
  getDashboardStats,
  getUsers,
  getPendingVerifications,
  verifyLawyer,
  toggleUserStatus,
  getSpecializations,
  createSpecialization,
  deleteSpecialization,
  getAnalytics,
};
