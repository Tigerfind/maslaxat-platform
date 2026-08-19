import {
  canonicalPromotionScope,
  createPromotionCheckoutAttempt,
  createPromotionCheckoutAttemptStore,
} from './promotionCheckoutAttempt';

beforeEach(() => sessionStorage.clear());

test('keeps one idempotency key for every retry of the same checkout attempt', () => {
  const attempt = createPromotionCheckoutAttempt(() => 'promotion-attempt-1');

  expect(attempt.key).toBe('promotion-attempt-1');
  expect(attempt.retryKey()).toBe('promotion-attempt-1');
  expect(attempt.retryKey()).toBe('promotion-attempt-1');
});

test('creates a different key only when the caller starts a new attempt', () => {
  const keys = ['promotion-attempt-1', 'promotion-attempt-2'];
  const keyFactory = () => keys.shift();

  expect(createPromotionCheckoutAttempt(keyFactory).key).toBe('promotion-attempt-1');
  expect(createPromotionCheckoutAttempt(keyFactory).key).toBe('promotion-attempt-2');
});

test('reuses the persisted key after an uncertain page reload for the same canonical scope', () => {
  const scope = { packageId: 'pkg-1', specialization: ' Civil law ', location: ' Tashkent ' };
  const firstStore = createPromotionCheckoutAttemptStore(sessionStorage, () => 'promotion-attempt-1');
  const first = firstStore.getOrCreate(scope);

  const reloadedStore = createPromotionCheckoutAttemptStore(sessionStorage, () => 'must-not-rotate');

  expect(canonicalPromotionScope(scope)).toBe('pkg-1:Civil law:Tashkent');
  expect(reloadedStore.getOrCreate(scope).key).toBe(first.key);
});

test('keeps an uncertain attempt until terminal success or explicit cancel clears it', () => {
  const keys = ['promotion-attempt-1', 'promotion-attempt-2', 'promotion-attempt-3'];
  const store = createPromotionCheckoutAttemptStore(sessionStorage, () => keys.shift());
  const scope = { packageId: 'pkg-1', specialization: 'Civil law', location: '' };

  expect(store.getOrCreate(scope).key).toBe('promotion-attempt-1');
  expect(createPromotionCheckoutAttemptStore(sessionStorage, () => keys.shift()).getOrCreate(scope).key)
    .toBe('promotion-attempt-1');

  store.clear(scope);
  expect(store.getOrCreate(scope).key).toBe('promotion-attempt-2');
});

test('changing package or scope removes the previous persisted attempt', () => {
  const keys = ['promotion-attempt-1', 'promotion-attempt-2', 'promotion-attempt-3'];
  const store = createPromotionCheckoutAttemptStore(sessionStorage, () => keys.shift());
  const firstScope = { packageId: 'pkg-1', specialization: 'Civil law', location: 'Tashkent' };
  const changedScope = { packageId: 'pkg-2', specialization: 'Family law', location: 'Tashkent' };

  expect(store.getOrCreate(firstScope).key).toBe('promotion-attempt-1');
  expect(store.getOrCreate(changedScope).key).toBe('promotion-attempt-2');
  expect(store.getOrCreate(firstScope).key).toBe('promotion-attempt-3');
});
