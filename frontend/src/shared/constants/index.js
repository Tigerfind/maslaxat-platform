/**
 * Shared Constants
 * Application-wide constants
 */

// User roles
export const ROLES = {
  CLIENT: 'client',
  LAWYER: 'lawyer',
  ADMIN: 'admin',
};

// Consultation statuses
export const CONSULTATION_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  UPCOMING: 'upcoming',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// Consultation types
export const CONSULTATION_TYPE = {
  VIDEO: 'video',
  CHAT: 'chat',
  PHONE: 'phone',
};

// Document statuses
export const DOCUMENT_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  ISSUES: 'issues',
  REJECTED: 'rejected',
};

// Document types
export const DOCUMENT_TYPE = {
  CONTRACT: 'contract',
  CLAIM: 'claim',
  STATEMENT: 'statement',
  POWER_OF_ATTORNEY: 'power_of_attorney',
  OTHER: 'other',
};

// Allowed file types for upload
export const ALLOWED_FILE_TYPES = {
  DOCUMENTS: ['pdf', 'doc', 'docx', 'odt', 'rtf'],
  IMAGES: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  ALL: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'jpg', 'jpeg', 'png'],
};

// Max file sizes (in MB)
export const MAX_FILE_SIZE = {
  DOCUMENT: 10,
  IMAGE: 5,
  AVATAR: 2,
};

// Dashboard routes by role
export const DASHBOARD_ROUTES = {
  [ROLES.CLIENT]: '/dashboard',
  [ROLES.LAWYER]: '/lawyer/dashboard',
  [ROLES.ADMIN]: '/admin/dashboard',
};

// API endpoints
export const API_ENDPOINTS = {
  AUTH: '/auth',
  USERS: '/users',
  LAWYERS: '/lawyers',
  CONSULTATIONS: '/consultations',
  DOCUMENTS: '/documents',
  AI: '/ai',
  ADMIN: '/admin',
};

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
};

// Theme colors
export const COLORS = {
  PRIMARY: '#3d5a52',
  SECONDARY: '#a67c52',
  SUCCESS: '#22c55e',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  INFO: '#3b82f6',
};

// Languages
export const LANGUAGES = {
  RU: 'ru',
  UZ: 'uz',
  EN: 'en',
};

// Time slots for booking
export const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00',
];

// Duration options (in minutes)
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

// Rating options
export const RATING_OPTIONS = [1, 2, 3, 4, 5];

export default {
  ROLES,
  CONSULTATION_STATUS,
  CONSULTATION_TYPE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  DASHBOARD_ROUTES,
  API_ENDPOINTS,
  PAGINATION,
  COLORS,
  LANGUAGES,
  TIME_SLOTS,
  DURATION_OPTIONS,
  RATING_OPTIONS,
};
