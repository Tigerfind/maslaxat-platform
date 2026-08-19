export async function runLatestRequest(coordinator, key, request, handlers = {}) {
  const current = coordinator.begin(key);
  handlers.onStart?.();
  try {
    const result = await request(current.signal);
    if (!coordinator.isCurrent(current)) return { stale: true };
    handlers.onSuccess?.(result);
    return { stale: false, result };
  } catch (error) {
    if (!coordinator.isCurrent(current)) return { stale: true };
    handlers.onError?.(error);
    return { stale: false, error };
  } finally {
    if (coordinator.isCurrent(current)) handlers.onFinally?.();
  }
}
