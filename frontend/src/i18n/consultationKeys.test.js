import translations from './translations';

test('новые consultation/payment строки определены на трёх языках', () => {
  const keys = [
    'statusPaymentPending', 'tabPaymentPending', 'pay', 'paymentSuccess', 'searchPlaceholder',
    'periodLabel', 'joinOpensAt', 'countdownNow', 'addCalendar', 'emptyPaymentTitle',
    'detailsTitle', 'paymentTitle', 'lawyerSummary', 'historyTitle', 'payment_paid',
    'status_payment_pending', 'status_payment_expired', 'status_unknown', 'type_video',
    'format_audio', 'format_zoom', 'viewDetails', 'archive', 'unarchive', 'liveNow',
    'cancellation_client_cancelled', 'cancellation_provider_cancelled', 'cancellationReason', 'joinReason_PAYMENT_REQUIRED', 'joinReason_WINDOW_CLOSED',
    'rescheduleSlotsError', 'rescheduleConfirm', 'rebookUnavailable', 'rebookRetry', 'backToList', 'offline', 'error_PAYMENT_REQUIRED',
  ];
  for (const language of ['ru', 'uz', 'en']) {
    for (const key of keys) expect(translations.consultations[language][key]).toEqual(expect.any(String));
    expect(translations.lawyerConsult[language].summaryPrompt).toEqual(expect.any(String));
    expect(translations.lawyerConsult[language].awaitingConfirmation).toEqual(expect.any(String));
    expect(translations.zoomMeeting[language].equipment).toEqual(expect.any(String));
    expect(translations.zoomMeeting[language].joinError).toEqual(expect.any(String));
    expect(translations.zoomMeeting[language].retryPreflight).toEqual(expect.any(String));
    expect(translations.zoomMeeting[language].lifecycle_provider_cancelled).toEqual(expect.any(String));
    for (const key of ['loading', 'offline', 'messagesLabel', 'loadEarlier', 'retryEarlier']) expect(translations.chat[language][key]).toEqual(expect.any(String));
    for (const key of ['ratingLabel', 'commentLabel']) expect(translations.rating[language][key]).toEqual(expect.any(String));
    for (const key of ['micLevel', 'selectCamera', 'selectMic', 'selectSpeaker', 'closeShortcuts', 'closeChat', 'access_PAYMENT_REQUIRED', 'extensionUnavailable', 'confirmCompletion']) expect(translations.videoCall[language][key]).toEqual(expect.any(String));
    expect(translations.preview[language].close).toEqual(expect.any(String));
  }
});
