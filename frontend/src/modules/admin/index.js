/**
 * Admin Module
 *
 * Модуль администрирования платформы
 * Полностью изолированный модуль для админ-панели
 *
 * Зависимости: auth (для проверки роли)
 */

// Services
export { default as adminService } from './services/adminService';
export {
  getDashboardStats,
  getUsers,
  getPendingVerifications,
  verifyLawyer,
  toggleUserStatus,
  getSpecializations,
  createSpecialization,
  deleteSpecialization,
  getAnalytics,
} from './services/adminService';

// Hooks
export {
  useAdminDashboard,
  useUserManagement,
  useVerifications,
  useSpecializationsAdmin,
  useAnalytics,
} from './hooks/useAdmin';

export default {
  service: adminService,
};
