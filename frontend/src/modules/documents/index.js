/**
 * Documents Module
 *
 * Модуль управления документами
 * Полностью изолированный модуль для работы с документами
 *
 * Зависимости: ai (для анализа)
 */

// Services
export { default as documentsService } from './services/documentsService';
export {
  getDocuments,
  getDocumentById,
  uploadDocument,
  deleteDocument,
  analyzeDocument,
  getTemplates,
  downloadDocument,
  downloadTemplate,
} from './services/documentsService';

// Hooks
export { useDocuments, useTemplates } from './hooks/useDocuments';

export default {
  service: documentsService,
};
