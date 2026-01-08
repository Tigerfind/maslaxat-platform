/**
 * AI Module - useAIChat Hook
 * Custom hook for AI chat functionality
 */

import { useState, useCallback, useEffect } from 'react';
import aiService from '../services/aiService';

/**
 * Hook for managing AI chat
 */
export const useAIChat = (initialSessionId = null) => {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Send message to AI
   */
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    // Add user message
    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setError(null);

    try {
      const response = await aiService.sendMessage(text, sessionId);

      // Update session ID if new
      if (!sessionId && response.sessionId) {
        setSessionId(response.sessionId);
      }

      // Add AI response
      const aiMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        timestamp: response.timestamp,
      };

      setMessages((prev) => [...prev, aiMessage]);

      return response;
    } catch (err) {
      setError(err.message);

      // Add error message
      const errorMessage = {
        id: Date.now() + 1,
        role: 'system',
        content: 'Извините, произошла ошибка. Попробуйте позже.',
        timestamp: new Date().toISOString(),
        isError: true,
      };

      setMessages((prev) => [...prev, errorMessage]);

      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  /**
   * Load chat history
   */
  const loadHistory = useCallback(async (sid) => {
    const targetSessionId = sid || sessionId;
    if (!targetSessionId) return;

    setLoading(true);
    try {
      const data = await aiService.getChatHistory(targetSessionId);
      setMessages(data.messages || []);
      setSessionId(targetSessionId);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  /**
   * Start new chat
   */
  const startNewChat = useCallback(async (title) => {
    try {
      const session = await aiService.createSession(title);
      setSessionId(session.id);
      setMessages([]);
      return session;
    } catch (err) {
      console.error('Failed to create session:', err);
      throw err;
    }
  }, []);

  /**
   * Clear current chat
   */
  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
  }, []);

  /**
   * Send voice message
   */
  const sendVoiceMessage = useCallback(async (audioBlob) => {
    setLoading(true);
    try {
      // First transcribe
      const transcription = await aiService.transcribeVoice(audioBlob);

      // Then send as regular message
      if (transcription.text) {
        await sendMessage(transcription.text);
      }

      return transcription;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  return {
    // Data
    messages,
    sessionId,

    // State
    loading,
    error,

    // Actions
    sendMessage,
    sendVoiceMessage,
    loadHistory,
    startNewChat,
    clearChat,
  };
};

/**
 * Hook for managing chat sessions
 */
export const useChatSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load sessions
   */
  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await aiService.getChatSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Delete session
   */
  const deleteSession = useCallback(async (sessionId) => {
    try {
      await aiService.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      return true;
    } catch (err) {
      console.error('Failed to delete session:', err);
      return false;
    }
  }, []);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return {
    sessions,
    loading,
    loadSessions,
    deleteSession,
  };
};

export default useAIChat;
