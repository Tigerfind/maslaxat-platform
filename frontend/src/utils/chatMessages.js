const FALLBACK_TOKEN = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export const createClientMessageId = () => (
  window.crypto?.randomUUID?.() || FALLBACK_TOKEN()
);

export const sameMessage = (left, right) => Boolean(
  (left?.id && right?.id && left.id === right.id)
  || (left?.clientMessageId && right?.clientMessageId && left.clientMessageId === right.clientMessageId)
);

export const mergeChatMessages = (current = [], incoming = []) => {
  const merged = [...current];
  incoming.forEach((message) => {
    const index = merged.findIndex((item) => sameMessage(item, message));
    if (index >= 0) merged[index] = { ...merged[index], ...message };
    else merged.push(message);
  });
  return merged.sort((left, right) => {
    const time = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    return time || String(left.id || left.clientMessageId || '').localeCompare(String(right.id || right.clientMessageId || ''));
  });
};

export const normalizeMessagePage = (data) => {
  if (Array.isArray(data)) return { messages: data, nextCursor: null, hasMore: false };
  return {
    messages: Array.isArray(data?.messages) ? data.messages : [],
    nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
    hasMore: data?.hasMore === true,
  };
};

export const isConsultationWritable = (consultation, capability = 'chatWritable') => {
  if (!consultation) return false;
  if (typeof consultation.policy?.[capability] === 'boolean') return consultation.policy[capability];
  if (typeof consultation.readOnly === 'boolean') return !consultation.readOnly;
  return !consultation.archivedAt && ['accepted', 'in_progress'].includes(consultation.status);
};

export const emitMessageWithAck = (socket, payload, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error('Message acknowledgement timed out');
    error.code = 'ACK_TIMEOUT';
    reject(error);
  }, timeoutMs);
  socket.emit('send-message', payload, (result) => {
    clearTimeout(timer);
    if (result?.ok && result.message) resolve(result.message);
    else {
      const error = new Error(result?.error || 'Message send failed');
      error.code = result?.code || 'MESSAGE_SEND_FAILED';
      reject(error);
    }
  });
});

export const sendChatMessage = async ({ socket, api, consultationId, text, clientMessageId, timeoutMs }) => {
  const payload = { consultationId, text, clientMessageId };
  if (socket?.connected) {
    try {
      return await emitMessageWithAck(socket, payload, timeoutMs);
    } catch (error) {
      if (error.code !== 'ACK_TIMEOUT' && error.code !== 'MESSAGE_SEND_FAILED') throw error;
    }
  }
  const response = await api.post(`/chat/${consultationId}/messages`, payload);
  return response.data;
};
