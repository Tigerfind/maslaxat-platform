import { describe, expect, test } from 'vitest';
import {
  CONSULTATION_TIMEZONE,
  formatConsultationCurrency,
  formatConsultationDateTime,
  formatMoneyInput,
  localeForLanguage,
  parseMoneyInput,
  zoomLocaleForLanguage,
} from './consultationLocale';

describe('consultation locale helpers', () => {
  test.each([
    ['ru', 'ru-RU'],
    ['uz', 'uz-UZ'],
    ['en', 'en-US'],
  ])('maps %s to its browser locale', (language, locale) => {
    expect(localeForLanguage(language)).toBe(locale);
    expect(formatConsultationCurrency(125000, language, 'UZS')).toContain('125');
  });

  test('formats consultation timestamps in Asia/Tashkent', () => {
    expect(CONSULTATION_TIMEZONE).toBe('Asia/Tashkent');
    for (const language of ['ru', 'uz', 'en']) {
      expect(formatConsultationDateTime('2026-01-15T10:00:00Z', language)).toMatch(/(15[:.]00|3:00 PM)/);
    }
  });

  test('maps unsupported Uzbek Zoom SDK UI to English', () => {
    expect(zoomLocaleForLanguage('ru')).toBe('ru-RU');
    expect(zoomLocaleForLanguage('uz')).toBe('en-US');
    expect(zoomLocaleForLanguage('en')).toBe('en-US');
  });

  test('formats and parses lawyer prices with readable digit groups', () => {
    expect(formatMoneyInput(1500000, 'ru')).toBe('1 500 000');
    expect(parseMoneyInput('1 500 000 сум')).toBe(1500000);
    expect(parseMoneyInput('')).toBe(0);
  });
});
