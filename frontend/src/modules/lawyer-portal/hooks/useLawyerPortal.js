/**
 * Lawyer Portal Module - useLawyerPortal Hook
 * Custom hook for lawyer portal functionality
 */

import { useState, useEffect, useCallback } from 'react';
import lawyerPortalService from '../services/lawyerPortalService';

/**
 * Hook for lawyer dashboard
 */
export const useLawyerDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await lawyerPortalService.getDashboardStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load lawyer stats:', err);
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
 * Hook for lawyer schedule
 */
export const useLawyerSchedule = () => {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSchedule = useCallback(async (startDate, endDate) => {
    setLoading(true);
    try {
      const data = await lawyerPortalService.getSchedule(startDate, endDate);
      setSchedule(data);
    } catch (err) {
      console.error('Failed to load schedule:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const confirmConsultation = useCallback(async (consultationId) => {
    try {
      await lawyerPortalService.confirmConsultation(consultationId);
      // Refresh schedule
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await loadSchedule(today, nextWeek);
      return true;
    } catch (err) {
      console.error('Failed to confirm:', err);
      return false;
    }
  }, [loadSchedule]);

  const cancelConsultation = useCallback(async (consultationId, reason) => {
    try {
      await lawyerPortalService.cancelConsultation(consultationId, reason);
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await loadSchedule(today, nextWeek);
      return true;
    } catch (err) {
      console.error('Failed to cancel:', err);
      return false;
    }
  }, [loadSchedule]);

  const updateAvailability = useCallback(async (slots) => {
    try {
      await lawyerPortalService.updateAvailability(slots);
      return true;
    } catch (err) {
      console.error('Failed to update availability:', err);
      return false;
    }
  }, []);

  // Load initial schedule
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    loadSchedule(today, nextWeek);
  }, [loadSchedule]);

  // Get upcoming consultations
  const upcomingConsultations = schedule.filter((c) =>
    c.status === 'confirmed' || c.status === 'pending'
  );

  // Get pending confirmations
  const pendingConfirmations = schedule.filter((c) => c.status === 'pending');

  return {
    schedule,
    upcomingConsultations,
    pendingConfirmations,
    loading,
    loadSchedule,
    confirmConsultation,
    cancelConsultation,
    updateAvailability,
  };
};

/**
 * Hook for lawyer reviews
 */
export const useLawyerReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const data = await lawyerPortalService.getReviews(pageNum);
      setReviews(data.reviews);
      setTotal(data.total);
      setPage(pageNum);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const replyToReview = useCallback(async (reviewId, reply) => {
    try {
      await lawyerPortalService.replyToReview(reviewId, reply);
      await loadReviews(page);
      return true;
    } catch (err) {
      console.error('Failed to reply:', err);
      return false;
    }
  }, [loadReviews, page]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  return {
    reviews,
    total,
    page,
    loading,
    loadReviews,
    replyToReview,
  };
};

/**
 * Hook for earnings
 */
export const useLawyerEarnings = (period = 'month') => {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadEarnings = useCallback(async (p) => {
    setLoading(true);
    try {
      const data = await lawyerPortalService.getEarningsReport(p || period);
      setEarnings(data);
    } catch (err) {
      console.error('Failed to load earnings:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  return {
    earnings,
    loading,
    loadEarnings,
  };
};

export default useLawyerDashboard;
