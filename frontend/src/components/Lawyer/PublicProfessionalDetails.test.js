/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n';
import PublicProfessionalDetails from './PublicProfessionalDetails';

global.IS_REACT_ACT_ENVIRONMENT = true;

function render(profile) {
  localStorage.setItem('language', 'ru');
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<LanguageProvider><PublicProfessionalDetails profile={profile} /></LanguageProvider>));
  return { host, cleanup: () => act(() => root.unmount()) };
}

test('renders professional fields as text with public provenance labels and a hardened LinkedIn link', () => {
  const view = render({
    headline: '<img src=x onerror=alert(1)>Senior counsel',
    workExperience: [{ title: 'Partner', company: 'Firm', startDate: '2020', endDate: 'Present' }],
    education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2019' }],
    certificates: [{ name: 'Bar certificate', issuer: 'Board', issuedAt: '2021' }],
    linkedinUrl: 'https://www.linkedin.com/in/senior-counsel',
    provenance: { headline: 'self_reported', education: 'document_checked', certificates: 'changed_after_check' },
  });

  expect(view.host.querySelector('img')).toBeNull();
  expect(view.host.textContent).toContain('<img src=x onerror=alert(1)>Senior counsel');
  expect(view.host.textContent).toContain('Предоставлено юристом');
  expect(view.host.textContent).toContain('Документ проверен');
  expect(view.host.textContent).toContain('Изменено после проверки');
  expect(view.host.querySelector('a').getAttribute('rel')).toBe('noopener noreferrer nofollow');
  expect(view.host.querySelector('iframe, embed, object')).toBeNull();
  view.cleanup();
});

test('does not render an unsafe LinkedIn URL', () => {
  const view = render({ linkedinUrl: 'https://www.linkedin.com.evil.example/in/person' });
  expect(view.host.querySelector('a')).toBeNull();
  view.cleanup();
});
