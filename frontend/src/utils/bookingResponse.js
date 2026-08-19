export function bookingResponseAction(response = {}) {
  if (response.consultation?.status === 'cancelled'
    || ['failed', 'cancelled', 'refunded'].includes(response.paymentStatus)) {
    return 'restart_booking';
  }
  if (response.requiresPayment === true
    && ['pending', 'processing'].includes(response.paymentStatus)
    && response.checkoutUrl) {
    return 'redirect_checkout';
  }
  if (response.paymentStatus === 'paid'
    || (response.paymentId && response.requiresPayment === false)) return 'complete_booking';
  return 'show_success';
}

export function bookingErrorAction(error) {
  return error?.response?.status === 409
    && error?.response?.data?.code === 'BOOKING_TERMS_CHANGED'
    ? 'rotate_terms'
    : 'retain_attempt';
}
