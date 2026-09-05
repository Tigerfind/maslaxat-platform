import translations from './translations';

const pwaKeys = [
  'skipToContent', 'offlineTitle', 'offlineMessage', 'onlineAgain', 'installTitle',
  'installMessage', 'installAction', 'dismissInstall', 'iosInstructions', 'installedTitle',
  'installedMessage', 'installStatus', 'installedStatus', 'installUnavailable',
];
const settingsKeys = ['pushUnsupported', 'pushInstallRequired'];

describe.each(['ru', 'uz', 'en'])('M6 translations: %s', (language) => {
  test.each(pwaKeys)('has pwa.%s', (key) => {
    expect(translations.pwa[language][key]).toEqual(expect.any(String));
    expect(translations.pwa[language][key].trim()).not.toBe('');
  });

  test.each(settingsKeys)('has settings.%s', (key) => {
    expect(translations.settings[language][key]).toEqual(expect.any(String));
    expect(translations.settings[language][key].trim()).not.toBe('');
  });
});
