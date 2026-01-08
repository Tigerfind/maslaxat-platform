/**
 * Lawyers Module
 *
 * Модуль поиска и работы с юристами
 * Полностью изолированный модуль для списка юристов и профилей
 *
 * Зависимости: shared (UI компоненты)
 */

// Services
export { default as lawyersService } from './services/lawyersService';
export {
  getLawyers,
  getLawyerById,
  getLawyerReviews,
  getLawyerSchedule,
  getSpecializations,
  saveLawyer,
  unsaveLawyer,
} from './services/lawyersService';

// Components
export { default as LawyerCard } from './components/LawyerCard';
export { default as LawyerFilters } from './components/LawyerFilters';

// Hooks
export { useLawyers, useLawyerProfile, useSpecializations } from './hooks/useLawyers';

export default {
  service: lawyersService,
};
