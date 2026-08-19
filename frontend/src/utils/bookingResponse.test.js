import { bookingErrorAction, bookingResponseAction } from './bookingResponse';

test('pending checkout response redirects to Payme', () => {
  expect(bookingResponseAction({
    requiresPayment: true,
    paymentStatus: 'pending',
    checkoutUrl: 'https://checkout.test',
  })).toBe('redirect_checkout');
});

test('delayed paid response after back navigation completes without redirecting checkout', () => {
  expect(bookingResponseAction({
    requiresPayment: false,
    paymentStatus: 'paid',
    consultation: { status: 'pending' },
    checkoutUrl: null,
  })).toBe('complete_booking');
});

test('free booking without a payment shows the success step', () => {
  expect(bookingResponseAction({
    requiresPayment: false,
    paymentId: null,
    consultation: { status: 'pending', isFree: true },
  })).toBe('show_success');
});

test('cancelled booking response clears the terminal attempt instead of redirecting', () => {
  expect(bookingResponseAction({
    requiresPayment: false,
    paymentId: 'payment-1',
    paymentStatus: 'failed',
    consultation: { status: 'cancelled' },
    checkoutUrl: null,
  })).toBe('restart_booking');
});

test('exact booking terms conflict rotates the persisted attempt without automatic retry', () => {
  expect(bookingErrorAction({
    response: { status: 409, data: { code: 'BOOKING_TERMS_CHANGED' } },
  })).toBe('rotate_terms');
});

test.each([
  [{ response: { status: 409, data: { code: 'OTHER_CONFLICT' } } }],
  [{ response: { status: 500, data: { code: 'BOOKING_TERMS_CHANGED' } } }],
  [new Error('network')],
])('unrelated error retains the active attempt', (error) => {
  expect(bookingErrorAction(error)).toBe('retain_attempt');
});
