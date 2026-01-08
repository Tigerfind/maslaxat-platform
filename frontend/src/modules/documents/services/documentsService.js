/**
 * Documents Module - Documents Service
 * Handles all document-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock documents data
 */
const MOCK_DOCUMENTS = [
  {
    id: 1,
    name: 'Договор аренды квартиры',
    type: 'contract',
    category: 'Недвижимость',
    status: 'verified',
    uploadedAt: '2024-01-15T10:00:00Z',
    size: 256000,
    format: 'pdf',
    aiScore: 95,
    aiNotes: 'Документ соответствует законодательству',
  },
  {
    id: 2,
    name: 'Трудовой договор',
    type: 'contract',
    category: 'Трудовое право',
    status: 'pending',
    uploadedAt: '2024-01-18T14:30:00Z',
    size: 128000,
    format: 'docx',
    aiScore: null,
    aiNotes: null,
  },
  {
    id: 3,
    name: 'Исковое заявление',
    type: 'claim',
    category: 'Судебные документы',
    status: 'issues',
    uploadedAt: '2024-01-10T09:15:00Z',
    size: 64000,
    format: 'pdf',
    aiScore: 68,
    aiNotes: 'Обнаружены проблемы с формулировками',
  },
];

const MOCK_TEMPLATES = [
  {
    id: 1,
    name: 'Договор купли-продажи',
    category: 'Недвижимость',
    downloads: 1250,
    rating: 4.8,
  },
  {
    id: 2,
    name: 'Трудовой договор',
    category: 'Трудовое право',
    downloads: 890,
    rating: 4.9,
  },
  {
    id: 3,
    name: 'Доверенность',
    category: 'Общие',
    downloads: 2100,
    rating: 4.7,
  },
  {
    id: 4,
    name: 'Договор аренды',
    category: 'Недвижимость',
    downloads: 1560,
    rating: 4.8,
  },
];

/**
 * Get all documents for current user
 */
export const getDocuments = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams(filters).toString();
    const response = await fetch(`${API_URL}/documents?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch documents');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock documents data');

    let filtered = [...MOCK_DOCUMENTS];

    if (filters.status) {
      filtered = filtered.filter((d) => d.status === filters.status);
    }

    if (filters.category) {
      filtered = filtered.filter((d) => d.category === filters.category);
    }

    return filtered;
  }
};

/**
 * Get document by ID
 */
export const getDocumentById = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/documents/${documentId}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch document');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock document data');
    return MOCK_DOCUMENTS.find((d) => d.id === parseInt(documentId)) || null;
  }
};

/**
 * Upload document
 */
export const uploadDocument = async (file, metadata) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    Object.keys(metadata).forEach((key) => {
      formData.append(key, metadata[key]);
    });

    const response = await fetch(`${API_URL}/documents/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload document');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: document uploaded');
    return {
      id: Date.now(),
      name: file.name,
      ...metadata,
      status: 'pending',
      uploadedAt: new Date().toISOString(),
      size: file.size,
      format: file.name.split('.').pop(),
    };
  }
};

/**
 * Delete document
 */
export const deleteDocument = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/documents/${documentId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete document');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: document deleted');
    return { success: true };
  }
};

/**
 * Analyze document with AI
 */
export const analyzeDocument = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/documents/${documentId}/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to analyze document');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: document analyzed');
    return {
      score: Math.floor(Math.random() * 30) + 70,
      issues: [
        { type: 'warning', message: 'Рекомендуется уточнить сроки' },
        { type: 'info', message: 'Формат соответствует стандарту' },
      ],
      recommendations: [
        'Добавить пункт о форс-мажорных обстоятельствах',
        'Уточнить порядок расторжения договора',
      ],
    };
  }
};

/**
 * Get document templates
 */
export const getTemplates = async (category = null) => {
  try {
    const url = category
      ? `${API_URL}/documents/templates?category=${category}`
      : `${API_URL}/documents/templates`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch templates');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock templates');
    return category
      ? MOCK_TEMPLATES.filter((t) => t.category === category)
      : MOCK_TEMPLATES;
  }
};

/**
 * Download document
 */
export const downloadDocument = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/documents/${documentId}/download`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download document');
    }

    const blob = await response.blob();
    return blob;
  } catch (error) {
    console.warn('Mock: document download initiated');
    return null;
  }
};

/**
 * Download template
 */
export const downloadTemplate = async (templateId) => {
  try {
    const response = await fetch(`${API_URL}/documents/templates/${templateId}/download`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download template');
    }

    const blob = await response.blob();
    return blob;
  } catch (error) {
    console.warn('Mock: template download initiated');
    return null;
  }
};

export default {
  getDocuments,
  getDocumentById,
  uploadDocument,
  deleteDocument,
  analyzeDocument,
  getTemplates,
  downloadDocument,
  downloadTemplate,
};
