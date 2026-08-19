/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n';
import { SponsoredLabel } from './LawyersPageGlass';

test('shows a visible localized advertising label with a screen-reader description', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('language', 'ru');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <LanguageProvider>
        <SponsoredLabel />
      </LanguageProvider>,
    );
  });

  expect(container.textContent).toContain('Продвигается');
  expect(container.querySelector('[aria-label="Рекламное размещение"]')).not.toBeNull();

  act(() => root.unmount());
  container.remove();
});
