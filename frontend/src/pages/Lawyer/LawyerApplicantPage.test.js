import React from 'react';
import { vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LawyerApplicantPage from './LawyerApplicantPage';
import { LanguageProvider } from '../../i18n';

vi.mock('react-redux', () => ({ useSelector: (select) => select({ auth: { user: { id: 'u1', name: 'Aziza' } } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/GlassKit/GlassShell', () => ({
  __esModule: true,
  default: ({ title, children }) => <section><h2>{title}</h2>{children}</section>,
}));
vi.mock('../../components/Lawyer/LinkedInPdfImport', () => ({
  __esModule: true,
  default: () => <div>Импорт профиля из LinkedIn</div>,
}));

test('applicant landing exposes safe profile and 2FA actions inside member shell', () => {
  const view = renderToStaticMarkup(<LanguageProvider><LawyerApplicantPage /></LanguageProvider>);

  expect(view).toContain('Кабинет кандидата');
  expect(view).toContain('Заполнить профиль');
  expect(view).toContain('Настроить 2FA');
  expect(view).not.toContain('consultation-requests');
});
