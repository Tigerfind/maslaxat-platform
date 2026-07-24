import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
const AUTH_ENDPOINT = /\/auth\/(login|register|forgot-password|reset-password|verify-email)/;
const AUTH_PAGE = /\/(login|register|forgot-password|reset-password|verify-email)/;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    // Истёкшая/битая сессия: чистим ВСЕ ключи авторизации и уводим на вход.
    // Но НЕ на самих auth-запросах (неверный пароль ≠ разлогин) и не зациклим редирект.
    if (status === 401 && !AUTH_ENDPOINT.test(url)) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('user');
      if (!AUTH_PAGE.test(window.location.pathname)) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
