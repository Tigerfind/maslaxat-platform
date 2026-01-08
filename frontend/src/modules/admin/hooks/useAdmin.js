/**
 * Admin Module - useAdmin Hook
 * Custom hook for admin functionality
 */

import { useState, useEffect, useCallback } from 'react';
import adminService from '../services/adminService';

/**
 * Hook for admin dashboard
 */
export const useAdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminService.getDashboardStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load admin stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return {
    stats,
    loading,
    error,
    refresh: loadStats,
  };
};

/**
 * Hook for user management
 */
export const useUserManagement = (initialFilters = {}) => {
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getUsers(filters);
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const updateFilters = useCallback((newFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const toggleUserStatus = useCallback(async (userId, blocked) => {
    try {
      await adminService.toggleUserStatus(userId, blocked);
      await loadUsers();
      return true;
    } catch (err) {
      console.error('Failed to toggle user status:', err);
      return false;
    }
  }, [loadUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  return {
    users,
    filters,
    loading,
    loadUsers,
    updateFilters,
    toggleUserStatus,
  };
};

/**
 * Hook for lawyer verifications
 */
export const useVerifications = () => {
  const [verifications, setVerifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadVerifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getPendingVerifications();
      setVerifications(data);
    } catch (err) {
      console.error('Failed to load verifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyLawyer = useCallback(async (lawyerId, approved, notes) => {
    try {
      await adminService.verifyLawyer(lawyerId, approved, notes);
      await loadVerifications();
      return true;
    } catch (err) {
      console.error('Failed to verify lawyer:', err);
      return false;
    }
  }, [loadVerifications]);

  useEffect(() => {
    loadVerifications();
  }, [loadVerifications]);

  return {
    verifications,
    loading,
    loadVerifications,
    verifyLawyer,
  };
};

/**
 * Hook for specializations management
 */
export const useSpecializationsAdmin = () => {
  const [specializations, setSpecializations] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSpecializations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getSpecializations();
      setSpecializations(data);
    } catch (err) {
      console.error('Failed to load specializations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSpecialization = useCallback(async (name) => {
    try {
      await adminService.createSpecialization(name);
      await loadSpecializations();
      return true;
    } catch (err) {
      console.error('Failed to create specialization:', err);
      return false;
    }
  }, [loadSpecializations]);

  const deleteSpecialization = useCallback(async (specializationId) => {
    try {
      await adminService.deleteSpecialization(specializationId);
      await loadSpecializations();
      return true;
    } catch (err) {
      console.error('Failed to delete specialization:', err);
      return false;
    }
  }, [loadSpecializations]);

  useEffect(() => {
    loadSpecializations();
  }, [loadSpecializations]);

  return {
    specializations,
    loading,
    loadSpecializations,
    createSpecialization,
    deleteSpecialization,
  };
};

/**
 * Hook for analytics
 */
export const useAnalytics = (period = '30d') => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async (p) => {
    setLoading(true);
    try {
      const data = await adminService.getAnalytics(p || period);
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  return {
    analytics,
    loading,
    loadAnalytics,
  };
};

export default useAdminDashboard;
