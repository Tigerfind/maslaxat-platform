/**
 * Shared Module
 *
 * Общие компоненты, хуки и утилиты для всех модулей
 * Не имеет зависимостей от других модулей
 */

// Utils
export { default as formatters } from './utils/formatters';
export {
  formatPrice,
  formatDate,
  formatDateShort,
  formatTime,
  formatRelativeTime,
  formatFileSize,
  formatPhone,
  formatDuration,
  formatRating,
  formatExperience,
  truncateText,
  getInitials,
} from './utils/formatters';

export { default as validators } from './utils/validators';
export {
  isValidEmail,
  isValidPhone,
  validatePassword,
  isRequired,
  minLength,
  maxLength,
  inRange,
  isFutureDate,
  isPastDate,
  isValidFileType,
  isValidFileSize,
  createValidator,
} from './utils/validators';

export { default as api } from './utils/api';
export {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  apiUpload,
  apiDownload,
  createApiService,
} from './utils/api';

// Constants
export { default as constants } from './constants';
export {
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
} from './constants';

// Hooks
export { useLocalStorage } from './hooks/useLocalStorage';
export { useDebounce, useDebouncedCallback } from './hooks/useDebounce';

export default {
  formatters,
  validators,
  api,
  constants,
};
