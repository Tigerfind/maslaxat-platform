/**
 * Modules Index
 *
 * Главный файл экспорта всех модулей приложения
 * Каждый модуль полностью изолирован и независим
 *
 * Структура модуля:
 * - services/ - API сервисы
 * - hooks/ - React хуки
 * - components/ - UI компоненты
 * - pages/ - Страницы (опционально)
 * - types/ - TypeScript типы (при необходимости)
 * - utils/ - Утилиты модуля
 * - index.js - Экспорт модуля
 */

// Auth Module - Аутентификация и авторизация
export * from './auth';
export { default as AuthModule } from './auth';

// Dashboard Module - Панель управления клиента
export * from './dashboard';
export { default as DashboardModule } from './dashboard';

// Lawyers Module - Поиск и работа с юристами
export * from './lawyers';
export { default as LawyersModule } from './lawyers';

// Consultations Module - Управление консультациями
export * from './consultations';
export { default as ConsultationsModule } from './consultations';

// Documents Module - Работа с документами
export * from './documents';
export { default as DocumentsModule } from './documents';

// AI Module - AI функционал
export * from './ai';
export { default as AIModule } from './ai';

// Admin Module - Администрирование
export * from './admin';
export { default as AdminModule } from './admin';

// Lawyer Portal Module - Личный кабинет юриста
export * from './lawyer-portal';
export { default as LawyerPortalModule } from './lawyer-portal';

/**
 * Модульная архитектура:
 *
 * 1. Каждый модуль изолирован и имеет свой сервис, хуки и компоненты
 * 2. Модули могут импортировать только из shared/ и других модулей
 * 3. Изменения в одном модуле не влияют на другие
 * 4. Каждый модуль можно тестировать независимо
 *
 * Зависимости модулей:
 * - auth: нет зависимостей (базовый модуль)
 * - dashboard: auth, shared
 * - lawyers: shared
 * - consultations: lawyers, shared
 * - documents: ai, shared
 * - ai: нет зависимостей
 * - admin: auth, shared
 * - lawyer-portal: auth, consultations, shared
 * - shared: нет зависимостей
 */
