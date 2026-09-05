export const INSTALL_PROMPT_EVENT = 'maslaxat:show-install';
export const INSTALL_DISMISS_KEY = 'maslaxat-install-dismissed';
export const INSTALL_PROMPT_VERSION = 'm6-v1';

export function getInstallEnvironment({
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  standalone = typeof navigator !== 'undefined' && navigator.standalone === true,
  displayModeStandalone = typeof window !== 'undefined'
    && window.matchMedia?.('(display-mode: standalone)').matches,
} = {}) {
  const ios = /iPad|iPhone|iPod/.test(userAgent)
    || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent));
  const safari = ios && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return {
    installed: Boolean(standalone || displayModeStandalone),
    ios,
    iosSafari: safari,
  };
}

export function wasInstallPromptDismissed(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    return storage?.getItem(INSTALL_DISMISS_KEY) === INSTALL_PROMPT_VERSION;
  } catch (error) {
    return false;
  }
}

export function dismissInstallPrompt(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    storage?.setItem(INSTALL_DISMISS_KEY, INSTALL_PROMPT_VERSION);
  } catch (error) { /* Storage may be unavailable in private browsing. */ }
}

export function requestInstallPrompt() {
  window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
}
