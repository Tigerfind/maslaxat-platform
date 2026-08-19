import { canonicalPromotionScope } from './promotionCheckoutAttempt';

export function capturePromotionCheckoutScope({ packageId, specialization, location }) {
  return Object.freeze({
    packageId: String(packageId || '').trim(),
    specialization: String(specialization || '').trim(),
    location: String(location || '').trim(),
  });
}

export function promotionCheckoutResponseState({ mounted, requestedScope, currentScope }) {
  if (!mounted) return 'unmounted';
  return canonicalPromotionScope(requestedScope) === canonicalPromotionScope(currentScope)
    ? 'current'
    : 'scope_changed';
}
