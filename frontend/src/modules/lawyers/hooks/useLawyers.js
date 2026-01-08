/**
 * Lawyers Module - useLawyers Hook
 * Custom hook for lawyers data and actions
 */

import { useState, useEffect, useCallback } from 'react';
import lawyersService from '../services/lawyersService';

/**
 * Hook for managing lawyers list
 */
export const useLawyers = (initialFilters = {}) => {
  const [lawyers, setLawyers] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load lawyers with current filters
   */
  const loadLawyers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await lawyersService.getLawyers(filters);
      setLawyers(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load lawyers:', err);
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
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  /**
   * Save lawyer to favorites
   */
  const saveLawyer = useCallback(async (lawyerId) => {
    try {
      await lawyersService.saveLawyer(lawyerId);
      return true;
    } catch (err) {
      console.error('Failed to save lawyer:', err);
      return false;
    }
  }, []);

  /**
   * Remove lawyer from favorites
   */
  const unsaveLawyer = useCallback(async (lawyerId) => {
    try {
      await lawyersService.unsaveLawyer(lawyerId);
      return true;
    } catch (err) {
      console.error('Failed to unsave lawyer:', err);
      return false;
    }
  }, []);

  // Load lawyers when filters change
  useEffect(() => {
    loadLawyers();
  }, [loadLawyers]);

  return {
    // Data
    lawyers,
    filters,

    // State
    loading,
    error,

    // Actions
    loadLawyers,
    updateFilters,
    clearFilters,
    saveLawyer,
    unsaveLawyer,
  };
};

/**
 * Hook for managing single lawyer profile
 */
export const useLawyerProfile = (lawyerId) => {
  const [lawyer, setLawyer] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load lawyer profile
   */
  const loadLawyer = useCallback(async () => {
    if (!lawyerId) return;

    setLoading(true);
    setError(null);

    try {
      const [lawyerData, reviewsData] = await Promise.all([
        lawyersService.getLawyerById(lawyerId),
        lawyersService.getLawyerReviews(lawyerId),
      ]);

      setLawyer(lawyerData);
      setReviews(reviewsData.reviews || []);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load lawyer:', err);
    } finally {
      setLoading(false);
    }
  }, [lawyerId]);

  /**
   * Load schedule for date
   */
  const loadSchedule = useCallback(
    async (date) => {
      if (!lawyerId) return;

      try {
        const data = await lawyersService.getLawyerSchedule(lawyerId, date);
        setSchedule(data);
        return data;
      } catch (err) {
        console.error('Failed to load schedule:', err);
        return null;
      }
    },
    [lawyerId]
  );

  // Load lawyer on mount
  useEffect(() => {
    loadLawyer();
  }, [loadLawyer]);

  return {
    // Data
    lawyer,
    reviews,
    schedule,

    // State
    loading,
    error,

    // Actions
    loadLawyer,
    loadSchedule,
  };
};

/**
 * Hook for specializations
 */
export const useSpecializations = () => {
  const [specializations, setSpecializations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await lawyersService.getSpecializations();
        setSpecializations(data);
      } catch (err) {
        console.error('Failed to load specializations:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return { specializations, loading };
};

export default useLawyers;
