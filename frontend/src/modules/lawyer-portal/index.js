/**
 * Lawyer Portal Module
 *
 * Модуль личного кабинета юриста
 * Полностью изолированный модуль для юристов
 *
 * Зависимости: auth (для проверки роли), consultations (для записей)
 */

// Services
export { default as lawyerPortalService } from './services/lawyerPortalService';
export {
  getDashboardStats,
  getSchedule,
  updateAvailability,
  confirmConsultation,
  cancelConsultation,
  getReviews,
  replyToReview,
  getEarningsReport,
  updateProfile,
} from './services/lawyerPortalService';

// Hooks
export {
  useLawyerDashboard,
  useLawyerSchedule,
  useLawyerReviews,
  useLawyerEarnings,
} from './hooks/useLawyerPortal';

export default {
  service: lawyerPortalService,
};
