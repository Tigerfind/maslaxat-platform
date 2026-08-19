import {
  capturePromotionCheckoutScope,
  promotionCheckoutResponseState,
} from './promotionCheckoutState';

test('captures an immutable normalized checkout scope before the financial request', () => {
  const mutable = { packageId: 'pkg-1', specialization: ' Civil law ', location: ' Tashkent ' };
  const captured = capturePromotionCheckoutScope(mutable);

  mutable.packageId = 'pkg-2';
  mutable.specialization = 'Family law';

  expect(captured).toEqual({ packageId: 'pkg-1', specialization: 'Civil law', location: 'Tashkent' });
  expect(Object.isFrozen(captured)).toBe(true);
});

test.each([
  [{ packageId: 'pkg-2', specialization: 'Civil law', location: 'Tashkent' }],
  [{ packageId: 'pkg-1', specialization: 'Family law', location: 'Tashkent' }],
  [{ packageId: 'pkg-1', specialization: 'Civil law', location: 'Samarkand' }],
])('rejects a financial response when current scope differs from requested scope', (currentScope) => {
  const requestedScope = capturePromotionCheckoutScope({
    packageId: 'pkg-1', specialization: 'Civil law', location: 'Tashkent',
  });

  expect(promotionCheckoutResponseState({ mounted: true, requestedScope, currentScope }))
    .toBe('scope_changed');
});

test('ignores a financial response after component unmount even when scope matches', () => {
  const requestedScope = capturePromotionCheckoutScope({
    packageId: 'pkg-1', specialization: 'Civil law', location: 'Tashkent',
  });

  expect(promotionCheckoutResponseState({ mounted: false, requestedScope, currentScope: requestedScope }))
    .toBe('unmounted');
});

test('accepts a financial response only for the still-mounted matching scope', () => {
  const requestedScope = capturePromotionCheckoutScope({
    packageId: 'pkg-1', specialization: 'Civil law', location: 'Tashkent',
  });

  expect(promotionCheckoutResponseState({
    mounted: true,
    requestedScope,
    currentScope: { packageId: 'pkg-1', specialization: ' Civil law ', location: ' Tashkent ' },
  })).toBe('current');
});
