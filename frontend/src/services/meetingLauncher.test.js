import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from './api';
import { launchConsultation } from './meetingLauncher';

vi.mock('./api', () => ({ default: { post: vi.fn() } }));

describe('launchConsultation', () => {
  beforeEach(() => {
    api.post.mockReset();
  });

  test('открывает вкладку до запроса и затем направляет её на Zoom URL', async () => {
    const popup = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    api.post.mockResolvedValue({ data: { url: 'https://zoom.us/j/123' } });

    await launchConsultation({ id: 'consultation-1', meetingProvider: 'zoom', type: 'video' }, vi.fn());

    expect(open.mock.invocationCallOrder[0]).toBeLessThan(api.post.mock.invocationCallOrder[0]);
    expect(api.post).toHaveBeenCalledWith('/client/consultations/consultation-1/join');
    expect(api.post).toHaveBeenCalledWith('/zoom/consultations/consultation-1/access');
    expect(popup.location.replace).toHaveBeenCalledWith('https://zoom.us/j/123');
    expect(popup.opener).toBeNull();
    open.mockRestore();
  });

  test('закрывает пустую вкладку при ошибке API', async () => {
    const popup = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    api.post.mockRejectedValue(new Error('network'));

    await expect(launchConsultation({ id: 'consultation-2', meetingProvider: 'zoom' }, vi.fn())).rejects.toThrow('network');
    expect(popup.close).toHaveBeenCalled();
    open.mockRestore();
  });

  test('WebRTC не открывается, если сервер не разрешил временное окно', async () => {
    const navigate = vi.fn();
    api.post.mockRejectedValueOnce(Object.assign(new Error('too early'), { response: { status: 403, data: { code: 'TOO_EARLY' } } }));
    await expect(launchConsultation({ id: 'consultation-3', meetingProvider: 'webrtc', type: 'video' }, navigate)).rejects.toThrow('too early');
    expect(navigate).not.toHaveBeenCalled();
  });
});
