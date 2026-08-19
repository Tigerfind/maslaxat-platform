function generateKey() {
  if (window.crypto?.randomUUID) return `promotion-${window.crypto.randomUUID()}`;
  return `promotion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPromotionCheckoutAttempt(keyFactory = generateKey) {
  const key = keyFactory();
  return Object.freeze({ key, retryKey: () => key });
}

const STORAGE_PREFIX = 'promotionCheckoutAttempt:';
const ACTIVE_STORAGE_KEY = `${STORAGE_PREFIX}active`;

export function canonicalPromotionScope({ packageId, specialization, location }) {
  return [packageId, specialization, location || ''].map((value) => String(value || '').trim()).join(':');
}

export function createPromotionCheckoutAttemptStore(storage = window.sessionStorage, keyFactory = generateKey) {
  const storageKey = (scope) => `${STORAGE_PREFIX}${canonicalPromotionScope(scope)}`;
  return {
    getOrCreate(scope) {
      const key = storageKey(scope);
      const activeKey = storage.getItem(ACTIVE_STORAGE_KEY);
      if (activeKey && activeKey !== key) storage.removeItem(activeKey);
      storage.setItem(ACTIVE_STORAGE_KEY, key);
      let idempotencyKey = storage.getItem(key);
      if (!idempotencyKey) {
        idempotencyKey = keyFactory();
        storage.setItem(key, idempotencyKey);
      }
      return createPromotionCheckoutAttempt(() => idempotencyKey);
    },
    clear(scope) {
      const key = storageKey(scope);
      storage.removeItem(key);
      if (storage.getItem(ACTIVE_STORAGE_KEY) === key) storage.removeItem(ACTIVE_STORAGE_KEY);
    },
    clearActive() {
      const activeKey = storage.getItem(ACTIVE_STORAGE_KEY);
      if (activeKey) storage.removeItem(activeKey);
      storage.removeItem(ACTIVE_STORAGE_KEY);
    },
  };
}
