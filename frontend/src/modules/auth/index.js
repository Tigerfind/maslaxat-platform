/**
 * Auth Module
 *
 * Модуль аутентификации и авторизации
 * Полностью изолированный модуль для работы с авторизацией
 *
 * Зависимости: нет (базовый модуль)
 */

// Services
export { default as authService } from './services/authService';
export {
  login,
  register,
  logout,
  quickLogin,
  getCurrentUser,
  refreshToken,
} from './services/authService';

// Components
export { default as RoleCard } from './components/RoleCard';
export { default as LoginForm } from './components/LoginForm';

// Hooks
export { useAuth } from './hooks/useAuth';

// Constants
export const AUTH_ROLES = {
  CLIENT: 'client',
  LAWYER: 'lawyer',
  ADMIN: 'admin',
};

export const DASHBOARD_PATHS = {
  client: '/dashboard',
  lawyer: '/lawyer/dashboard',
  admin: '/admin/dashboard',
};

export default {
  service: authService,
};
