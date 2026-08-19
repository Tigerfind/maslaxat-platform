import { campaignAction, isAuditReasonValid } from './AdminPromotionsPage';

test('requires an audit-safe reason between 3 and 120 trimmed characters', () => {
  expect(isAuditReasonValid('  ok  ')).toBe(false);
  expect(isAuditReasonValid('pilot review')).toBe(true);
  expect(isAuditReasonValid(`x${'a'.repeat(120)}`)).toBe(false);
});

test('uses cancel only before payment and refund for paid service states', () => {
  expect(campaignAction('pending_payment')).toBe('cancel');
  expect(campaignAction('active')).toBe('refund');
  expect(campaignAction('queued')).toBe('refund');
  expect(campaignAction('refund_pending')).toBeNull();
  expect(campaignAction('refunded')).toBeNull();
});
