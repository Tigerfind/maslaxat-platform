import { describe, expect, test, vi } from 'vitest';
import { isConsultationWritable, mergeChatMessages, normalizeMessagePage, sendChatMessage } from './chatMessages';

describe('chat message idempotency helpers', () => {
  test('merges history and realtime messages by server or client id', () => {
    const current = [{ id: '1', text: 'first' }, { clientMessageId: 'client-token', text: 'pending' }];
    const incoming = [{ id: '1', text: 'first updated' }, { id: '2', clientMessageId: 'client-token', text: 'saved' }];
    expect(mergeChatMessages(current, incoming)).toEqual([
      { id: '1', text: 'first updated' },
      { id: '2', clientMessageId: 'client-token', text: 'saved' },
    ]);
  });

  test('normalizes cursor envelopes and legacy arrays', () => {
    expect(normalizeMessagePage({ messages: [{ id: '1' }], nextCursor: 'cursor', hasMore: true })).toEqual({ messages: [{ id: '1' }], nextCursor: 'cursor', hasMore: true });
    expect(normalizeMessagePage([{ id: 'legacy' }])).toEqual({ messages: [{ id: 'legacy' }], nextCursor: null, hasMore: false });
  });

  test.each(['accepted', 'in_progress'])('%s is writable', (status) => {
    expect(isConsultationWritable({ status })).toBe(true);
  });

  test.each(['payment_pending', 'payment_expired', 'pending', 'completed', 'cancelled', 'rejected'])('%s is read-only', (status) => {
    expect(isConsultationWritable({ status })).toBe(false);
  });

  test('socket timeout falls back to REST with the same clientMessageId', async () => {
    const socket = { connected: true, emit: vi.fn() };
    const api = { post: vi.fn().mockResolvedValue({ data: { id: 'saved' } }) };
    const result = await sendChatMessage({ socket, api, consultationId: 'c1', text: 'hello', clientMessageId: 'stable-token', timeoutMs: 1 });
    expect(result).toEqual({ id: 'saved' });
    expect(api.post).toHaveBeenCalledWith('/chat/c1/messages', {
      consultationId: 'c1', text: 'hello', clientMessageId: 'stable-token',
    });
  });

  test('authorization acknowledgement is not retried through REST', async () => {
    const socket = {
      connected: true,
      emit: vi.fn((event, payload, ack) => ack({ ok: false, code: 'ACCESS_DENIED', error: 'Access denied' })),
    };
    const api = { post: vi.fn() };
    await expect(sendChatMessage({ socket, api, consultationId: 'c1', text: 'hello', clientMessageId: 'stable-token' }))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(api.post).not.toHaveBeenCalled();
  });
});
