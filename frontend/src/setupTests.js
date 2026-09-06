import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// eslint-disable-next-line no-undef
globalThis.jest = Object.assign({}, vi, {
  isolateModules(callback) {
    vi.resetModules();
    return callback();
  },
});

const values = new Map();
const storage = {
  getItem: (key) => values.get(String(key)) ?? null,
  setItem: (key, value) => values.set(String(key), String(value)),
  removeItem: (key) => values.delete(String(key)),
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}
afterEach(() => storage.clear());
