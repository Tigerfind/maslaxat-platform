import translations from './translations';

test('новые consultation/payment строки определены на трёх языках', () => {
  const keys = [
    'statusPaymentPending', 'tabPaymentPending', 'pay', 'paymentSuccess', 'searchPlaceholder',
    'periodLabel', 'joinOpensAt', 'countdownNow', 'addCalendar', 'emptyPaymentTitle',
    'detailsTitle', 'paymentTitle', 'lawyerSummary', 'historyTitle', 'payment_paid',
    'status_payment_pending', 'type_video',
  ];
  for (const language of ['ru', 'uz', 'en']) {
    for (const key of keys) expect(translations.consultations[language][key]).toEqual(expect.any(String));
    expect(translations.lawyerConsult[language].summaryPrompt).toEqual(expect.any(String));
  }
});
