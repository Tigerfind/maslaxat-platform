function defaultRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createPromotionAttribution(lawyer, requestIdFactory = defaultRequestId) {
  if (lawyer?.placement !== 'sponsored' || !lawyer.promotionAttributionToken) return null;
  const bookingStartRequestId = requestIdFactory();
  return {
    attributionToken: lawyer.promotionAttributionToken,
    profileRequestId: `${bookingStartRequestId}:profile`,
    bookingStartRequestId,
    bookingRequestId: `${bookingStartRequestId}:booking`,
  };
}

export function withPromotionBooking(input, attribution) {
  if (!attribution?.attributionToken || !attribution?.bookingRequestId) return input;
  return {
    ...input,
    promotionAttributionToken: attribution.attributionToken,
    promotionRequestId: attribution.bookingRequestId,
  };
}

export function promotionProfileSearch(attribution) {
  if (!attribution?.attributionToken) return '';
  return `?attributionToken=${encodeURIComponent(attribution.attributionToken)}`;
}
