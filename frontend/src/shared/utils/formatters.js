/**
 * Shared Utilities - Formatters
 * Common formatting functions used across modules
 */

/**
 * Format price in UZS
 */
export const formatPrice = (price, currency = 'сум') => {
  if (price === null || price === undefined) return '-';
  return `${price.toLocaleString('ru-RU')} ${currency}`;
};

/**
 * Format date to Russian locale
 */
export const formatDate = (date, options = {}) => {
  if (!date) return '-';

  const defaultOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  };

  return new Date(date).toLocaleDateString('ru-RU', defaultOptions);
};

/**
 * Format date to short format
 */
export const formatDateShort = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/**
 * Format time
 */
export const formatTime = (time) => {
  if (!time) return '-';

  // If already in HH:MM format
  if (typeof time === 'string' && time.includes(':')) {
    return time.substring(0, 5);
  }

  // If Date object
  return new Date(time).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format relative time (e.g., "2 часа назад")
 */
export const formatRelativeTime = (date) => {
  if (!date) return '-';

  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'только что';
  if (diffMins < 60) return `${diffMins} мин. назад`;
  if (diffHours < 24) return `${diffHours} ч. назад`;
  if (diffDays < 7) return `${diffDays} дн. назад`;

  return formatDateShort(date);
};

/**
 * Format file size
 */
export const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

/**
 * Format phone number
 */
export const formatPhone = (phone) => {
  if (!phone) return '-';

  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Format as +998 XX XXX XX XX
  if (digits.length === 12 && digits.startsWith('998')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  }

  return phone;
};

/**
 * Format duration in minutes to readable string
 */
export const formatDuration = (minutes) => {
  if (!minutes) return '-';

  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
};

/**
 * Format rating
 */
export const formatRating = (rating, precision = 1) => {
  if (rating === null || rating === undefined) return '-';
  return rating.toFixed(precision);
};

/**
 * Format experience years
 */
export const formatExperience = (years) => {
  if (!years) return '-';

  const lastDigit = years % 10;
  const lastTwoDigits = years % 100;

  let word = 'лет';
  if (lastDigit === 1 && lastTwoDigits !== 11) {
    word = 'год';
  } else if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) {
    word = 'года';
  }

  return `${years} ${word}`;
};

/**
 * Truncate text with ellipsis
 */
export const truncateText = (text, maxLength = 100) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
};

/**
 * Get initials from name
 */
export const getInitials = (name) => {
  if (!name) return '?';

  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
};

export default {
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
};
