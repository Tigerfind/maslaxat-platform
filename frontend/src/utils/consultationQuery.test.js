import { describe, expect, test } from 'vitest';
import { consultationQueryKey, parseConsultationQuery, serializeConsultationQuery } from './consultationQuery';

describe('consultation URL query', () => {
  test('normalizes invalid values safely', () => {
    expect(parseConsultationQuery(new URLSearchParams('tab=bad&period=week&page=-2'))).toEqual({ tab: 'all', search: '', period: 'all', page: 1 });
  });

  test('serializes only meaningful values', () => {
    expect(serializeConsultationQuery({ tab: 'completed', search: '  claim ', period: '30d', page: 2 }).toString()).toBe('tab=completed&search=claim&period=30d&page=2');
    expect(serializeConsultationQuery({ tab: 'all', search: '', period: 'all', page: 1 }).toString()).toBe('');
  });

  test('query identity changes for server filters', () => {
    expect(consultationQueryKey({ tab: 'all', search: '', period: 'all', page: 1 })).not.toBe(consultationQueryKey({ tab: 'all', search: 'x', period: 'all', page: 1 }));
  });
});
