/**
 * AI Module - AI Service
 * Handles all AI-related API calls
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

/**
 * Mock AI responses
 */
const MOCK_RESPONSES = [
  'Здравствуйте! Я AI-помощник МаслаХат. Готов ответить на ваши юридические вопросы.',
  'На основе вашего вопроса, могу сказать следующее: в соответствии с законодательством Узбекистана...',
  'Для более точного ответа рекомендую проконсультироваться с юристом, специализирующимся на данной области права.',
  'Это сложный вопрос, который требует детального анализа. Давайте рассмотрим ключевые аспекты...',
];

/**
 * Send message to AI and get response
 */
export const sendMessage = async (message, sessionId = null) => {
  try {
    const response = await fetch(`${API_URL}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ message, sessionId }),
    });

    if (!response.ok) {
      throw new Error('Failed to get AI response');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock AI response');

    // Simulate AI response
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const randomResponse = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];

    return {
      message: randomResponse,
      sessionId: sessionId || `session-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }
};

/**
 * Get chat history
 */
export const getChatHistory = async (sessionId) => {
  try {
    const response = await fetch(`${API_URL}/ai/chat/${sessionId}/history`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch chat history');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock chat history');
    return {
      messages: [],
      sessionId,
    };
  }
};

/**
 * Get all chat sessions
 */
export const getChatSessions = async () => {
  try {
    const response = await fetch(`${API_URL}/ai/chat/sessions`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch sessions');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock sessions');
    return [
      {
        id: 'session-1',
        title: 'Вопрос о трудовом договоре',
        lastMessage: 'Спасибо за консультацию!',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        messagesCount: 5,
      },
      {
        id: 'session-2',
        title: 'Раздел имущества',
        lastMessage: 'Понял, буду действовать по плану',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        messagesCount: 8,
      },
    ];
  }
};

/**
 * Create new chat session
 */
export const createSession = async (title = 'Новый чат') => {
  try {
    const response = await fetch(`${API_URL}/ai/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: session created');
    return {
      id: `session-${Date.now()}`,
      title,
      createdAt: new Date().toISOString(),
      messages: [],
    };
  }
};

/**
 * Delete chat session
 */
export const deleteSession = async (sessionId) => {
  try {
    const response = await fetch(`${API_URL}/ai/chat/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete session');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: session deleted');
    return { success: true };
  }
};

/**
 * Get AI suggestions for document
 */
export const getDocumentSuggestions = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/ai/documents/${documentId}/suggestions`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get suggestions');
    }

    return response.json();
  } catch (error) {
    console.warn('Using mock suggestions');
    return {
      suggestions: [
        'Рекомендуется добавить пункт о форс-мажорных обстоятельствах',
        'Следует уточнить порядок расторжения договора',
        'Необходимо указать срок действия соглашения',
      ],
      score: 78,
    };
  }
};

/**
 * Transcribe voice message
 */
export const transcribeVoice = async (audioBlob) => {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const response = await fetch(`${API_URL}/ai/transcribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to transcribe');
    }

    return response.json();
  } catch (error) {
    console.warn('Mock: transcription');
    return {
      text: 'Это тестовая транскрипция голосового сообщения.',
    };
  }
};

export default {
  sendMessage,
  getChatHistory,
  getChatSessions,
  createSession,
  deleteSession,
  getDocumentSuggestions,
  transcribeVoice,
};
