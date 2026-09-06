import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from './api';
import { launchConsultation } from './meetingLauncher';

vi.mock('./api', () => ({ default: { post: vi.fn() } }));

describe('launchConsultation', () => {
  beforeEach(() => {
    api.post.mockReset();
  });

  test('Zoom всегда открывает единый защищённый meeting route', async () => {
    const navigate = vi.fn();
    await launchConsultation({ id: 'consultation-1', meetingProvider: 'zoom', type: 'video' }, navigate);
    expect(navigate).toHaveBeenCalledWith('/consultations/zoom/consultation-1');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('WebRTC не открывается, если сервер не разрешил временное окно', async () => {
    const navigate = vi.fn();
    api.post.mockRejectedValueOnce(Object.assign(new Error('too early'), { response: { status: 403, data: { code: 'TOO_EARLY' } } }));
    await expect(launchConsultation({ id: 'consultation-3', meetingProvider: 'webrtc', type: 'video' }, navigate)).rejects.toThrow('too early');
    expect(navigate).not.toHaveBeenCalled();
  });
});
