/**
 * Documents Module - useDocuments Hook
 * Custom hook for documents data and actions
 */

import { useState, useEffect, useCallback } from 'react';
import documentsService from '../services/documentsService';

/**
 * Hook for managing documents list
 */
export const useDocuments = (initialFilters = {}) => {
  const [documents, setDocuments] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load documents with current filters
   */
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await documentsService.getDocuments(filters);
      setDocuments(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load documents:', err);
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
   * Upload document
   */
  const uploadDocument = useCallback(async (file, metadata) => {
    try {
      const result = await documentsService.uploadDocument(file, metadata);
      await loadDocuments();
      return result;
    } catch (err) {
      throw err;
    }
  }, [loadDocuments]);

  /**
   * Delete document
   */
  const deleteDocument = useCallback(async (documentId) => {
    try {
      await documentsService.deleteDocument(documentId);
      await loadDocuments();
      return true;
    } catch (err) {
      console.error('Failed to delete:', err);
      return false;
    }
  }, [loadDocuments]);

  /**
   * Analyze document
   */
  const analyzeDocument = useCallback(async (documentId) => {
    try {
      const result = await documentsService.analyzeDocument(documentId);
      await loadDocuments();
      return result;
    } catch (err) {
      console.error('Failed to analyze:', err);
      return null;
    }
  }, [loadDocuments]);

  /**
   * Download document
   */
  const downloadDocument = useCallback(async (documentId, filename) => {
    try {
      const blob = await documentsService.downloadDocument(documentId);
      if (blob) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Failed to download:', err);
    }
  }, []);

  // Load documents when filters change
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return {
    // Data
    documents,
    filters,

    // State
    loading,
    error,

    // Actions
    loadDocuments,
    updateFilters,
    uploadDocument,
    deleteDocument,
    analyzeDocument,
    downloadDocument,
  };
};

/**
 * Hook for templates
 */
export const useTemplates = (category = null) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await documentsService.getTemplates(category);
        setTemplates(data);
      } catch (err) {
        console.error('Failed to load templates:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [category]);

  /**
   * Download template
   */
  const downloadTemplate = useCallback(async (templateId, filename) => {
    try {
      const blob = await documentsService.downloadTemplate(templateId);
      if (blob) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Failed to download template:', err);
    }
  }, []);

  return { templates, loading, downloadTemplate };
};

export default useDocuments;
