import { describe, expect, test } from 'vitest';
import { zoomTimeWarning } from './zoomTime';

describe('Zoom fixed interval warnings', () => {
  test.each([[601, null], [600, 600], [300, 300], [60, 60], [0, 0]])('%i seconds maps to %s', (seconds, key) => {
    expect(zoomTimeWarning(seconds)?.key ?? null).toBe(key);
  });
});
