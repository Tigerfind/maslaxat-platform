/**
 * Dashboard Module
 *
 * Модуль панели управления клиента
 * Изолированный модуль для дашборда
 *
 * Зависимости: auth (для пользователя), shared (UI компоненты)
 */

// Services
export { default as dashboardService } from './services/dashboardService';
export {
  getDashboardStats,
  getRecentConsultations,
  getNotifications,
  markNotificationRead,
  getActivityFeed,
} from './services/dashboardService';

// Components
export { default as StatCard } from './components/StatCard';
export { default as QuickActionCard } from './components/QuickActionCard';

// Hooks
export { useDashboard } from './hooks/useDashboard';

export default {
  service: dashboardService,
};
