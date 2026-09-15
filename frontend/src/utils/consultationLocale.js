export const CONSULTATION_TIMEZONE = 'Asia/Tashkent';

export const localeForLanguage = (language) => ({
  ru: 'ru-RU',
  uz: 'uz-UZ',
  en: 'en-US',
}[language] || 'ru-RU');

export const zoomLocaleForLanguage = (language) => ({
  ru: 'ru-RU',
  uz: 'en-US',
  en: 'en-US',
}[language] || 'en-US');

export const formatConsultationDateTime = (value, language, timezone = CONSULTATION_TIMEZONE) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export const formatConsultationCurrency = (value, language, currency = 'UZS') => new Intl.NumberFormat(
  localeForLanguage(language),
  { style: 'currency', currency, maximumFractionDigits: 0 },
).format(Number(value) || 0);

export const formatMoneyInput = (value, language) => new Intl.NumberFormat(
  localeForLanguage(language),
  { maximumFractionDigits: 0 },
).format(Number(value) || 0).replace(/[\u00a0\u202f]/g, ' ');

export const parseMoneyInput = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
};

export const consultationDialogPaperSx = {
  m: { xs: 1.5, sm: 4 },
  width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
  maxHeight: { xs: 'calc(100dvh - 24px)', sm: 'calc(100dvh - 64px)' },
  overflowY: 'auto',
  '& .MuiDialogTitle-root': { overflowWrap: 'anywhere' },
  '& .MuiDialogActions-root': { flexWrap: 'wrap' },
};
