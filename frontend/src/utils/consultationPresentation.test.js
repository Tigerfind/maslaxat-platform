import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  __resetUnknownStatusDiagnostics,
  getConsultationActions,
  getConsultationBucket,
  getConsultationFormat,
  getConsultationStatus,
  getCancellationTypeKey,
  getJoinState,
  isPaymentExpired,
  safeRequestError,
} from './consultationPresentation';

describe('consultation presentation policy', () => {
  beforeEach(() => {
    __resetUnknownStatusDiagnostics();
    vi.restoreAllMocks();
  });

  test('unknown status is never presented as pending and diagnostic is deduplicated', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getConsultationStatus({ status: 'future_status', policy: { status: 'unknown', statusKnown: false } })).toMatchObject({ status: 'unknown', labelKey: 'status_unknown' });
    getConsultationStatus('future_status');
    expect(warning).toHaveBeenCalledTimes(1);
  });

  test('uses server bucket and only server-provided actions', () => {
    const consultation = { status: 'completed', policy: { status: 'completed', statusKnown: true, bucket: 'archived', availableActions: ['view_details', 'unarchive'] } };
    expect(getConsultationBucket(consultation)).toBe('archived');
    expect(getConsultationActions(consultation)).toEqual(['view_details', 'unarchive']);
  });

  test.each([
    [{ type: 'chat' }, 'chat'],
    [{ type: 'phone', meetingProvider: 'webrtc' }, 'audio'],
    [{ type: 'video', meetingProvider: 'webrtc' }, 'video'],
    [{ type: 'video', meetingProvider: 'zoom' }, 'zoom'],
  ])('maps consultation format', (consultation, expected) => {
    expect(getConsultationFormat(consultation).key).toBe(expected);
  });

  test('server clock controls payment expiry but stale join policy never auto-enables', () => {
    const offset = 60_000;
    const now = Date.parse('2026-01-01T10:00:00Z');
    expect(isPaymentExpired({ status: 'payment_pending', paymentExpiresAt: '2026-01-01T10:00:30Z' }, now, offset)).toBe(true);
    const join = getJoinState({ policy: { availableActions: [], canJoin: false, reason: 'TOO_EARLY', joinAvailableAt: '2026-01-01T10:00:30Z' } }, now, offset);
    expect(join).toMatchObject({ visible: true, enabled: false, reason: 'TOO_EARLY' });
  });

  test('maps provider cancellation without exposing backend labels', () => {
    expect(getCancellationTypeKey({ type: 'provider_cancelled' })).toBe('cancellation_provider_cancelled');
  });

  test('uses stable codes and never exposes Russian server text in Uzbek or English', () => {
    const error = { response: { data: { code: 'PAYMENT_REQUIRED', error: 'Сначала оплатите' } } };
    const t = (key) => key === 'consultations.error_PAYMENT_REQUIRED' ? 'Complete payment first.' : key;
    expect(safeRequestError(error, 'Fallback', { language: 'en', t })).toBe('Complete payment first.');
    expect(safeRequestError({ response: { data: { error: 'Внутренняя ошибка' } } }, 'Fallback', { language: 'uz', t })).toBe('Fallback');
    expect(safeRequestError({ response: { data: { error: 'Безопасный текст' } } }, 'Fallback', { language: 'ru', t })).toBe('Безопасный текст');
  });
});
