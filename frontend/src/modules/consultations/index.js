/**
 * Consultations Module
 *
 * Модуль управления консультациями
 * Полностью изолированный модуль для работы с консультациями
 *
 * Зависимости: lawyers (для юристов)
 */

// Services
export { default as consultationsService } from './services/consultationsService';
export {
  getConsultations,
  getConsultationById,
  bookConsultation,
  cancelConsultation,
  rescheduleConsultation,
  submitReview,
  getChatHistory,
  checkConflicts,
} from './services/consultationsService';

// Components
export { default as ConsultationCard } from './components/ConsultationCard';

// Hooks
export { useConsultations, useConsultation, useBooking } from './hooks/useConsultations';

export default {
  service: consultationsService,
};
