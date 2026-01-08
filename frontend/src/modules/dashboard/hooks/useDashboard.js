/**
 * Dashboard Module - useDashboard Hook
 * Custom hook for dashboard data and actions
 */

import { useState, useEffect, useCallback } from 'react';
import dashboardService from '../services/dashboardService';

/**
 * Hook for managing dashboard data
 */
export const useDashboard = () => {
  const [stats, setStats] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load all dashboard data
   */
  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsData, consultationsData, notificationsData] = await Promise.all([
        dashboardService.getDashboardStats(),
        dashboardService.getRecentConsultations(),
        dashboardService.getNotifications(),
      ]);

      setStats(statsData);
      setConsultations(consultationsData);
      setNotifications(notificationsData);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Refresh dashboard data
   */
  const refresh = useCallback(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  /**
   * Mark notification as read
   */
  const markAsRead = useCallback(async (notificationId) => {
    try {
      await dashboardService.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error('Failed to mark notification:', err);
    }
  }, []);

  /**
   * Get unread notifications count
   */
  const unreadCount = notifications.filter((n) => !n.read).length;

  /**
   * Get upcoming consultations
   */
  const upcomingConsultations = consultations.filter((c) => c.status === 'upcoming');

  // Load data on mount
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return {
    // Data
    stats,
    consultations,
    notifications,
    upcomingConsultations,
    unreadCount,

    // State
    loading,
    error,

    // Actions
    refresh,
    markAsRead,
    loadDashboardData,
  };
};

export default useDashboard;
