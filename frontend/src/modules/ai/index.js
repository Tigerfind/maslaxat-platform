/**
 * AI Module
 *
 * Модуль AI функционала (чат, анализ документов)
 * Полностью изолированный модуль для AI функций
 *
 * Зависимости: нет (независимый модуль)
 */

// Services
export { default as aiService } from './services/aiService';
export {
  sendMessage,
  getChatHistory,
  getChatSessions,
  createSession,
  deleteSession,
  getDocumentSuggestions,
  transcribeVoice,
} from './services/aiService';

// Hooks
export { useAIChat, useChatSessions } from './hooks/useAIChat';

export default {
  service: aiService,
};
