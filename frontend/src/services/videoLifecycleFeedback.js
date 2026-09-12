export function notifyVideoLifecycleFailure(fallback, error, notify) {
  const reason = typeof error?.response?.data?.error === 'string'
    ? error.response.data.error.trim()
    : '';
  notify(`${fallback}${reason}`);
}
