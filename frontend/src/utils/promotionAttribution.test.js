import { createPromotionAttribution, promotionProfileSearch, withPromotionBooking } from './promotionAttribution';

test('creates separate bounded request ids only for sponsored lawyers', () => {
  expect(createPromotionAttribution({ id: 'organic' })).toBeNull();
  const attribution = createPromotionAttribution({
    id: 'lawyer-1',
    placement: 'sponsored',
    promotionAttributionToken: 'signed-token-1',
  }, () => 'request-1');
  expect(attribution).toEqual({
    attributionToken: 'signed-token-1',
    profileRequestId: 'request-1:profile',
    bookingStartRequestId: 'request-1',
    bookingRequestId: 'request-1:booking',
  });
  const search = promotionProfileSearch(attribution);
  expect(new URLSearchParams(search).get('attributionToken')).toBe('signed-token-1');
});

test('adds only server-recognized promotion fields to booking input', () => {
  const input = { question: 'Help' };
  expect(withPromotionBooking(input, null)).toEqual(input);
  expect(withPromotionBooking(input, {
    attributionToken: 'signed-token-1',
    bookingRequestId: 'booking-1',
  })).toEqual({
    question: 'Help',
    promotionAttributionToken: 'signed-token-1',
    promotionRequestId: 'booking-1',
  });
});
