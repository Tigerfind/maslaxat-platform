import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReconnectTracker } from './zoomReconnect';

afterEach(() => vi.useRealTimers());

describe('Zoom reconnect tracker', () => {
  it('reports one start and one success across duplicate SDK callbacks', () => {
    const report = vi.fn();
    const tracker = createReconnectTracker(report, vi.fn());
    tracker.started(); tracker.started(); tracker.connected(); tracker.connected();
    expect(report.mock.calls.map(([event]) => event)).toEqual(['reconnect_started', 'reconnect_succeeded']);
  });

  it('reports timeout failure once', () => {
    vi.useFakeTimers();
    const report = vi.fn(); const timeout = vi.fn();
    const tracker = createReconnectTracker(report, timeout, 100);
    tracker.started(); vi.advanceTimersByTime(101);
    expect(report).toHaveBeenLastCalledWith('reconnect_failed');
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
