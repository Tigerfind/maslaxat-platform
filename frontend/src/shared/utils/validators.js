/**
 * Shared Utilities - Validators
 * Common validation functions used across modules
 */

/**
 * Validate email format
 */
export const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Uzbekistan format)
 */
export const isValidPhone = (phone) => {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('998');
};

/**
 * Validate password strength
 */
export const validatePassword = (password) => {
  const errors = [];

  if (!password) {
    return { valid: false, errors: ['Пароль обязателен'] };
  }

  if (password.length < 6) {
    errors.push('Минимум 6 символов');
  }

  if (password.length > 50) {
    errors.push('Максимум 50 символов');
  }

  if (!/[A-Za-z]/.test(password)) {
    errors.push('Должен содержать буквы');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Должен содержать цифры');
  }

  return {
    valid: errors.length === 0,
    errors,
    strength: getPasswordStrength(password),
  };
};

/**
 * Get password strength score (0-4)
 */
const getPasswordStrength = (password) => {
  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return Math.min(4, score);
};

/**
 * Validate required field
 */
export const isRequired = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/**
 * Validate min length
 */
export const minLength = (value, min) => {
  if (!value) return false;
  return value.length >= min;
};

/**
 * Validate max length
 */
export const maxLength = (value, max) => {
  if (!value) return true;
  return value.length <= max;
};

/**
 * Validate number range
 */
export const inRange = (value, min, max) => {
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  return num >= min && num <= max;
};

/**
 * Validate date is in future
 */
export const isFutureDate = (date) => {
  if (!date) return false;
  return new Date(date) > new Date();
};

/**
 * Validate date is in past
 */
export const isPastDate = (date) => {
  if (!date) return false;
  return new Date(date) < new Date();
};

/**
 * Validate file type
 */
export const isValidFileType = (file, allowedTypes) => {
  if (!file) return false;

  const extension = file.name.split('.').pop().toLowerCase();
  return allowedTypes.includes(extension);
};

/**
 * Validate file size
 */
export const isValidFileSize = (file, maxSizeMB) => {
  if (!file) return false;
  return file.size <= maxSizeMB * 1024 * 1024;
};

/**
 * Create form validator
 */
export const createValidator = (rules) => {
  return (values) => {
    const errors = {};

    Object.keys(rules).forEach((field) => {
      const fieldRules = rules[field];
      const value = values[field];

      fieldRules.forEach((rule) => {
        if (errors[field]) return; // Stop on first error

        if (rule.required && !isRequired(value)) {
          errors[field] = rule.message || 'Обязательное поле';
        }

        if (rule.email && value && !isValidEmail(value)) {
          errors[field] = rule.message || 'Неверный формат email';
        }

        if (rule.phone && value && !isValidPhone(value)) {
          errors[field] = rule.message || 'Неверный формат телефона';
        }

        if (rule.minLength && value && !minLength(value, rule.minLength)) {
          errors[field] = rule.message || `Минимум ${rule.minLength} символов`;
        }

        if (rule.maxLength && value && !maxLength(value, rule.maxLength)) {
          errors[field] = rule.message || `Максимум ${rule.maxLength} символов`;
        }

        if (rule.pattern && value && !rule.pattern.test(value)) {
          errors[field] = rule.message || 'Неверный формат';
        }

        if (rule.custom && !rule.custom(value, values)) {
          errors[field] = rule.message || 'Ошибка валидации';
        }
      });
    });

    return errors;
  };
};

export default {
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
};
