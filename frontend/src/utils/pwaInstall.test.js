import {
  dismissInstallPrompt,
  getInstallEnvironment,
  INSTALL_PROMPT_VERSION,
  wasInstallPromptDismissed,
} from './pwaInstall';
import { vi } from 'vitest';

describe('PWA install helpers', () => {
  test('detects installed and supported iOS Safari without treating iOS Chrome as Safari', () => {
    expect(getInstallEnvironment({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1' }))
      .toMatchObject({ ios: true, iosSafari: true, installed: false });
    expect(getInstallEnvironment({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/120 Mobile Safari/604.1' }).iosSafari).toBe(false);
    expect(getInstallEnvironment({ userAgent: '', displayModeStandalone: true }).installed).toBe(true);
  });

  test('versions dismissal so a future prompt can be shown again', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(wasInstallPromptDismissed(storage)).toBe(false);
    dismissInstallPrompt(storage);
    expect(storage.setItem).toHaveBeenCalledWith('maslaxat-install-dismissed', INSTALL_PROMPT_VERSION);
    storage.getItem.mockReturnValue(INSTALL_PROMPT_VERSION);
    expect(wasInstallPromptDismissed(storage)).toBe(true);
  });
});
