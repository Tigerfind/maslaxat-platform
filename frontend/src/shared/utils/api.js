/**
 * Shared Utilities - API Helper
 * Common API request functions
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Get authorization header
 */
const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Handle API response
 */
const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: 'Ошибка сервера',
    }));
    throw new Error(error.message || `HTTP Error: ${response.status}`);
  }

  // Handle empty responses
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

/**
 * API GET request
 */
export const apiGet = async (endpoint, params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const url = queryString ? `${API_URL}${endpoint}?${queryString}` : `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
  });

  return handleResponse(response);
};

/**
 * API POST request
 */
export const apiPost = async (endpoint, data = {}) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(data),
  });

  return handleResponse(response);
};

/**
 * API PUT request
 */
export const apiPut = async (endpoint, data = {}) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(data),
  });

  return handleResponse(response);
};

/**
 * API DELETE request
 */
export const apiDelete = async (endpoint) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: {
      ...getAuthHeader(),
    },
  });

  return handleResponse(response);
};

/**
 * API POST with FormData (for file uploads)
 */
export const apiUpload = async (endpoint, formData) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      ...getAuthHeader(),
    },
    body: formData,
  });

  return handleResponse(response);
};

/**
 * Download file from API
 */
export const apiDownload = async (endpoint, filename) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  if (!response.ok) {
    throw new Error('Download failed');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

/**
 * Create API service with base endpoint
 */
export const createApiService = (baseEndpoint) => ({
  get: (endpoint = '', params = {}) => apiGet(`${baseEndpoint}${endpoint}`, params),
  post: (endpoint = '', data = {}) => apiPost(`${baseEndpoint}${endpoint}`, data),
  put: (endpoint = '', data = {}) => apiPut(`${baseEndpoint}${endpoint}`, data),
  delete: (endpoint = '') => apiDelete(`${baseEndpoint}${endpoint}`),
  upload: (endpoint = '', formData) => apiUpload(`${baseEndpoint}${endpoint}`, formData),
  download: (endpoint = '', filename) => apiDownload(`${baseEndpoint}${endpoint}`, filename),
});

export default {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  delete: apiDelete,
  upload: apiUpload,
  download: apiDownload,
  createService: createApiService,
};
