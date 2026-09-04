export function createReconnectTracker(report, onTimeout, timeoutMs = 15000) {
  let reconnecting = false;
  let timer = null;
  return {
    started() {
      if (reconnecting) return;
      reconnecting = true;
      report('reconnect_started');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!reconnecting) return;
        reconnecting = false;
        report('reconnect_failed');
        onTimeout();
      }, timeoutMs);
    },
    connected() {
      clearTimeout(timer);
      if (!reconnecting) return false;
      reconnecting = false;
      report('reconnect_succeeded');
      return true;
    },
    failed() {
      clearTimeout(timer);
      if (!reconnecting) return;
      reconnecting = false;
      report('reconnect_failed');
    },
    dispose() { clearTimeout(timer); reconnecting = false; },
    isReconnecting() { return reconnecting; },
  };
}
