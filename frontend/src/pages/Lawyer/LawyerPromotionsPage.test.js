/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../i18n';
import { CampaignMetrics, CheckoutTerms } from './LawyerPromotionsPage';

global.IS_REACT_ACT_ENVIRONMENT = true;

function renderWithLanguage(element) {
  localStorage.setItem('language', 'ru');
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<LanguageProvider>{element}</LanguageProvider>));
  return { container, cleanup: () => act(() => root.unmount()) };
}

test('queued checkout terms explain that payment starts after capacity becomes available', () => {
  const view = renderWithLanguage(<CheckoutTerms outcome="queued_after_payment" />);

  expect(view.container.textContent).toContain('После оплаты продвижение встанет в очередь');
  expect(view.container.textContent).toContain('Срок начнётся только после освобождения места');
  view.cleanup();
});

test('campaign metrics render the four server counters without deriving a rating', () => {
  const view = renderWithLanguage(<CampaignMetrics campaign={{
    impressions: 1200, profileViews: 80, bookingStarts: 12, bookings: 5,
  }} />);

  expect(view.container.textContent).toContain('1 200');
  expect(view.container.textContent).toContain('80');
  expect(view.container.textContent).toContain('12');
  expect(view.container.textContent).toContain('5');
  expect(view.container.textContent).not.toContain('Рейтинг');
  view.cleanup();
});
