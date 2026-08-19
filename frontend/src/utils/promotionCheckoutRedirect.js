const PAYCOM_CHECKOUT_HOST = 'checkout.paycom.uz';

export function promotionCheckoutUrl(rawUrl, {
  environment = process.env.NODE_ENV,
  configuredHost = process.env.REACT_APP_PROMOTION_CHECKOUT_TEST_HOST,
} = {}) {
  try {
    const url = new URL(rawUrl);
    const devHostAllowed = environment !== 'production' && configuredHost && url.hostname === configuredHost;
    const allowedHost = url.hostname === PAYCOM_CHECKOUT_HOST || devHostAllowed;
    if (url.protocol !== 'https:' || !allowedHost || url.port || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function navigateToPromotionCheckout(rawUrl, assign = (url) => window.location.assign(url), options) {
  const safeUrl = promotionCheckoutUrl(rawUrl, options);
  if (!safeUrl) return false;
  assign(safeUrl);
  return true;
}
