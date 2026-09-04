import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from './api';
import { launchConsultation } from './meetingLauncher';

vi.mock('./api', () => ({ default: { post: vi.fn() } }));

describe('launchConsultation', () => {
  beforeEach(() => {
    api.post.mockReset();
  });

  test('Zoom проходит общий server join gate до защищённого meeting route', async () => {
    const navigate = vi.fn();
    api.post.mockResolvedValueOnce({ data: {} });
    await launchConsultation({ id: 'consultation-1', meetingProvider: 'zoom', type: 'video', policy: { canJoin: true, availableActions: ['join'] } }, navigate);
    expect(api.post).toHaveBeenCalledWith('/client/consultations/consultation-1/join');
    expect(navigate).toHaveBeenCalledWith('/consultations/zoom/consultation-1');
  });

  test('Zoom не открывается до разрешения server policy', async () => {
    const navigate = vi.fn();
    await expect(launchConsultation({ id: 'consultation-2', meetingProvider: 'zoom', policy: { canJoin: false, availableActions: [], reason: 'TOO_EARLY', joinAvailableAt: '2099-01-01T00:00:00Z' } }, navigate)).rejects.toMatchObject({ code: 'TOO_EARLY' });
    expect(api.post).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('просроченный локальный opensAt не обходит устаревший запрет server policy', async () => {
    const navigate = vi.fn();
    await expect(launchConsultation({ id: 'consultation-stale', meetingProvider: 'zoom', policy: { canJoin: false, availableActions: [], reason: 'TOO_EARLY', joinAvailableAt: '2020-01-01T00:00:00Z' } }, navigate, { now: Date.now() })).rejects.toMatchObject({ code: 'TOO_EARLY' });
    expect(api.post).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('audio on WebRTC uses the call route instead of chat', async () => {
    const navigate = vi.fn();
    api.post.mockResolvedValueOnce({ data: {} });
    await launchConsultation({ id: 'consultation-3', meetingProvider: 'webrtc', type: 'phone', policy: { canJoin: true, availableActions: ['join'] } }, navigate);
    expect(navigate).toHaveBeenCalledWith('/consultations/video/consultation-3');
  });

  test('legacy lawyer DTO uses the authoritative generic join endpoint', async () => {
    const navigate = vi.fn();
    api.post.mockResolvedValueOnce({ data: {} });
    await launchConsultation({ id: 'consultation-4', meetingProvider: 'zoom', type: 'video' }, navigate);
    expect(api.post).toHaveBeenCalledWith('/consultations/consultation-4/join');
    expect(navigate).toHaveBeenCalledWith('/consultations/zoom/consultation-4');
  });

  test('chat opens without requiring media join policy', async () => {
    const navigate = vi.fn();
    await launchConsultation({ id: 'consultation-5', type: 'chat', policy: { canJoin: false, availableActions: ['open_chat'] } }, navigate);
    expect(api.post).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/consultations/chat/consultation-5');
  });

  test('legacy lawyer audio uses generic join and the WebRTC call route', async () => {
    const navigate = vi.fn();
    api.post.mockResolvedValueOnce({ data: {} });
    await launchConsultation({ id: 'consultation-6', meetingProvider: 'webrtc', type: 'phone' }, navigate);
    expect(api.post).toHaveBeenCalledWith('/consultations/consultation-6/join');
    expect(navigate).toHaveBeenCalledWith('/consultations/video/consultation-6');
  });
});
