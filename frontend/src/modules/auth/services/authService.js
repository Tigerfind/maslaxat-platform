/**
 * Auth Module - Authentication Service
 * Handles all authentication-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

// Mock users for development
const MOCK_USERS = {
  client: {
    id: 1,
    name: 'Клиент Тестовый',
    email: 'client@maslaxat.uz',
    role: 'client',
    avatar: null,
  },
  lawyer: {
    id: 10,
    name: 'Иванов Иван Иванович',
    email: 'ivanov@maslaxat.uz',
    role: 'lawyer',
    specialization: 'Семейное право',
    rating: 4.8,
    avatar: null,
  },
  admin: {
    id: 3,
    name: 'Администратор',
    email: 'admin@maslaxat.uz',
    role: 'admin',
    avatar: null,
  },
};

/**
 * Quick login for development - bypasses actual authentication
 */
export const quickLogin = async (role) => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const user = MOCK_USERS[role];
  if (!user) {
    throw new Error(`Unknown role: ${role}`);
  }

  const token = `mock-jwt-token-${role}-${Date.now()}`;

  return {
    user,
    token,
    role,
  };
};

/**
 * Login with email and password
 */
export const login = async (email, password) => {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }

    return response.json();
  } catch (error) {
    // Fallback to mock login for development
    console.warn('API unavailable, using mock login');

    // Determine role from email
    let role = 'client';
    if (email.includes('lawyer') || email.includes('advokat')) {
      role = 'lawyer';
    } else if (email.includes('admin')) {
      role = 'admin';
    }

    return quickLogin(role);
  }
};

/**
 * Register new user
 */
export const register = async (userData) => {
  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Registration failed');
    }

    return response.json();
  } catch (error) {
    console.warn('API unavailable, using mock registration');
    return quickLogin(userData.role || 'client');
  }
};

/**
 * Logout user
 */
export const logout = async () => {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });
  } catch (error) {
    console.warn('Logout API call failed:', error);
  }

  // Clear local storage regardless
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

/**
 * Get current user profile
 */
export const getCurrentUser = async () => {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user');
    }

    return response.json();
  } catch (error) {
    // Return cached user for development
    const cachedUser = localStorage.getItem('user');
    return cachedUser ? JSON.parse(cachedUser) : null;
  }
};

/**
 * Refresh authentication token
 */
export const refreshToken = async () => {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    localStorage.setItem('token', data.token);
    return data.token;
  } catch (error) {
    console.warn('Token refresh failed:', error);
    return token; // Return existing token for development
  }
};

export default {
  login,
  register,
  logout,
  quickLogin,
  getCurrentUser,
  refreshToken,
};
