import translations from './translations';

test('новые строки каталога, доверия и расписания определены на трёх языках', () => {
  const keys = [
    ['lawyers', 'sortRecommended'], ['lawyers', 'verifiedDocuments'], ['lawyers', 'verifiedDocumentsHint'],
    ['lawyers', 'responseTime'], ['lawyerProfile', 'verifiedDocuments'], ['lawyerProfile', 'responseTime'],
    ['lawyers', 'sortLabel'], ['lawyers', 'doc_diploma'], ['lawyers', 'doc_license'],
    ['lawyerPanel', 'scheduleRequiredTitle'], ['lawyerPanel', 'scheduleRequiredText'],
    ['lawyerPanel', 'availabilityProgress'], ['lawyerPanel', 'availabilityLoadError'],
    ['onboarding', 'scheduleProgress'], ['adminManage', 'scheduleStatus'], ['adminManage', 'scheduleSlots'],
    ['adminManage', 'docVerify'], ['adminManage', 'docVerified'],
  ];
  for (const language of ['ru', 'uz', 'en']) {
    for (const [section, key] of keys) {
      expect(translations[section][language][key]).toEqual(expect.any(String));
      expect(translations[section][language][key].length).toBeGreaterThan(0);
    }
  }
});
