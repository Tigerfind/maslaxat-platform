/**
 * Consultations Module - useConsultations Hook
 * Custom hook for consultations data and actions
 */

import { useState, useEffect, useCallback } from 'react';
import consultationsService from '../services/consultationsService';

/**
 * Hook for managing consultations list
 */
export const useConsultations = (initialFilters = {}) => {
  const [consultations, setConsultations] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load consultations with current filters
   */
  const loadConsultations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await consultationsService.getConsultations(filters);
      setConsultations(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load consultations:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  /**
   * Update filters
   */
  const updateFilters = useCallback((newFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  /**
   * Book new consultation
   */
  const bookConsultation = useCallback(async (bookingData) => {
    try {
      const result = await consultationsService.bookConsultation(bookingData);
      await loadConsultations(); // Refresh list
      return result;
    } catch (err) {
      throw err;
    }
  }, [loadConsultations]);

  /**
   * Cancel consultation
   */
  const cancelConsultation = useCallback(async (consultationId, reason) => {
    try {
      await consultationsService.cancelConsultation(consultationId, reason);
      await loadConsultations();
      return true;
    } catch (err) {
      console.error('Failed to cancel:', err);
      return false;
    }
  }, [loadConsultations]);

  /**
   * Reschedule consultation
   */
  const rescheduleConsultation = useCallback(async (consultationId, newDate, newTime) => {
    try {
      await consultationsService.rescheduleConsultation(consultationId, newDate, newTime);
      await loadConsultations();
      return true;
    } catch (err) {
      console.error('Failed to reschedule:', err);
      return false;
    }
  }, [loadConsultations]);

  /**
   * Get upcoming consultations
   */
  const upcomingConsultations = consultations.filter((c) => c.status === 'upcoming');

  /**
   * Get completed consultations
   */
  const completedConsultations = consultations.filter((c) => c.status === 'completed');

  // Load consultations when filters change
  useEffect(() => {
    loadConsultations();
  }, [loadConsultations]);

  return {
    // Data
    consultations,
    upcomingConsultations,
    completedConsultations,
    filters,

    // State
    loading,
    error,

    // Actions
    loadConsultations,
    updateFilters,
    bookConsultation,
    cancelConsultation,
    rescheduleConsultation,
  };
};

/**
 * Hook for managing single consultation
 */
export const useConsultation = (consultationId) => {
  const [consultation, setConsultation] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load consultation details
   */
  const loadConsultation = useCallback(async () => {
    if (!consultationId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await consultationsService.getConsultationById(consultationId);
      setConsultation(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load consultation:', err);
    } finally {
      setLoading(false);
    }
  }, [consultationId]);

  /**
   * Load chat history
   */
  const loadChatHistory = useCallback(async () => {
    if (!consultationId) return;

    try {
      const data = await consultationsService.getChatHistory(consultationId);
      setChatHistory(data.messages || []);
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  }, [consultationId]);

  /**
   * Submit review
   */
  const submitReview = useCallback(async (rating, review) => {
    try {
      await consultationsService.submitReview(consultationId, rating, review);
      await loadConsultation();
      return true;
    } catch (err) {
      console.error('Failed to submit review:', err);
      return false;
    }
  }, [consultationId, loadConsultation]);

  // Load data on mount
  useEffect(() => {
    loadConsultation();
  }, [loadConsultation]);

  return {
    // Data
    consultation,
    chatHistory,

    // State
    loading,
    error,

    // Actions
    loadConsultation,
    loadChatHistory,
    submitReview,
  };
};

/**
 * Hook for booking
 */
export const useBooking = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Check for conflicts
   */
  const checkConflicts = useCallback(async (lawyerId, date, time) => {
    try {
      const result = await consultationsService.checkConflicts(lawyerId, date, time);
      return result.hasConflict;
    } catch (err) {
      console.error('Failed to check conflicts:', err);
      return false;
    }
  }, []);

  /**
   * Book consultation
   */
  const book = useCallback(async (bookingData) => {
    setLoading(true);
    setError(null);

    try {
      // Check for conflicts first
      const hasConflict = await checkConflicts(
        bookingData.lawyerId,
        bookingData.date,
        bookingData.time
      );

      if (hasConflict) {
        throw new Error('Выбранное время уже занято');
      }

      const result = await consultationsService.bookConsultation(bookingData);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [checkConflicts]);

  return {
    loading,
    error,
    book,
    checkConflicts,
  };
};

export default useConsultations;
