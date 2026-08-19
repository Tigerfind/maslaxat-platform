import { navigateToPromotionCheckout } from './promotionCheckoutRedirect';

test.each([
  ['java', 'script:alert(1)'].join(''),
  'http://checkout.paycom.uz/order/1',
  'https://evil.test/order/1',
  'https://checkout.paycom.uz.evil.test/order/1',
  'not-a-url',
])('rejects unsafe checkout URL %s without navigating', (url) => {
  const assigned = [];

  expect(navigateToPromotionCheckout(url, (value) => assigned.push(value))).toBe(false);
  expect(assigned).toEqual([]);
});

test('navigates only to the exact HTTPS Paycom checkout host', () => {
  const assigned = [];
  const url = 'https://checkout.paycom.uz/order/1';

  expect(navigateToPromotionCheckout(url, (value) => assigned.push(value))).toBe(true);
  expect(assigned).toEqual([url]);
});

test('allows one explicit development host only outside production', () => {
  const assigned = [];
  const url = 'https://checkout.test/order/1';

  expect(navigateToPromotionCheckout(url, (value) => assigned.push(value), {
    environment: 'test', configuredHost: 'checkout.test',
  })).toBe(true);
  expect(navigateToPromotionCheckout(url, () => {}, {
    environment: 'production', configuredHost: 'checkout.test',
  })).toBe(false);
});
