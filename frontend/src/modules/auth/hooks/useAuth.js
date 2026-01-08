/**
 * Auth Module - useAuth Hook
 * Custom hook for authentication state and actions
 */

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  loginStart,
  loginSuccess,
  loginFailure,
  logout as logoutAction,
} from '../../../store/slices/authSlice';
import authService from '../services/authService';

/**
 * Hook for managing authentication
 */
export const useAuth = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, token, isAuthenticated, loading, error } = useSelector(
    (state) => state.auth
  );

  /**
   * Login with credentials
   */
  const login = useCallback(
    async (email, password) => {
      dispatch(loginStart());
      try {
        const result = await authService.login(email, password);
        dispatch(loginSuccess(result));

        // Navigate based on role
        const dashboardPath = getDashboardPath(result.role);
        navigate(dashboardPath);

        return result;
      } catch (error) {
        dispatch(loginFailure(error.message));
        throw error;
      }
    },
    [dispatch, navigate]
  );

  /**
   * Quick login for development
   */
  const quickLogin = useCallback(
    async (role) => {
      dispatch(loginStart());
      try {
        const result = await authService.quickLogin(role);
        dispatch(loginSuccess(result));

        const dashboardPath = getDashboardPath(role);
        navigate(dashboardPath);

        return result;
      } catch (error) {
        dispatch(loginFailure(error.message));
        throw error;
      }
    },
    [dispatch, navigate]
  );

  /**
   * Logout user
   */
  const logout = useCallback(async () => {
    await authService.logout();
    dispatch(logoutAction());
    navigate('/login');
  }, [dispatch, navigate]);

  /**
   * Register new user
   */
  const register = useCallback(
    async (userData) => {
      dispatch(loginStart());
      try {
        const result = await authService.register(userData);
        dispatch(loginSuccess(result));

        const dashboardPath = getDashboardPath(result.role);
        navigate(dashboardPath);

        return result;
      } catch (error) {
        dispatch(loginFailure(error.message));
        throw error;
      }
    },
    [dispatch, navigate]
  );

  /**
   * Check if user has specific role
   */
  const hasRole = useCallback(
    (roles) => {
      if (!user) return false;
      const roleArray = Array.isArray(roles) ? roles : [roles];
      return roleArray.includes(user.role);
    },
    [user]
  );

  /**
   * Check if user is authenticated
   */
  const checkAuth = useCallback(() => {
    return isAuthenticated && !!token;
  }, [isAuthenticated, token]);

  return {
    // State
    user,
    token,
    isAuthenticated,
    loading,
    error,

    // Actions
    login,
    quickLogin,
    logout,
    register,

    // Helpers
    hasRole,
    checkAuth,
  };
};

/**
 * Get dashboard path based on user role
 */
const getDashboardPath = (role) => {
  switch (role) {
    case 'admin':
      return '/admin/dashboard';
    case 'lawyer':
      return '/lawyer/dashboard';
    case 'client':
    default:
      return '/dashboard';
  }
};

export default useAuth;
