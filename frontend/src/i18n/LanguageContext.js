import React, { createContext, useContext, useState, useEffect } from 'react';
import translations from './translations';

// Доступные языки
export const LANGUAGES = {
  ru: {
    code: 'ru',
    name: 'Русский',
    nativeName: 'Русский',
    flag: '🇷🇺',
  },
  uz: {
    code: 'uz',
    name: 'Uzbek',
    nativeName: 'Ўзбекча',
    flag: '🇺🇿',
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇬🇧',
  },
};

// Язык по умолчанию
const DEFAULT_LANGUAGE = 'ru';

// Создаем контекст
const LanguageContext = createContext();

/**
 * Provider для управления языком приложения
 */
export const LanguageProvider = ({ children }) => {
  // Инициализируем язык из localStorage или по умолчанию
  const [language, setLanguageState] = useState(() => {
    const saved = localStorage.getItem('language');
    return saved && LANGUAGES[saved] ? saved : DEFAULT_LANGUAGE;
  });

  // Сохраняем язык в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('language', language);
    // Устанавливаем атрибут lang для HTML
    document.documentElement.lang = language;
  }, [language]);

  /**
   * Функция перевода
   * @param {string} key - Ключ перевода в формате 'section.key'
   * @param {object} params - Параметры для замены в строке
   * @returns {string} Переведенная строка
   */
  const t = (key, params = {}) => {
    const [section, ...rest] = key.split('.');
    const translationKey = rest.join('.');

    // Ищем перевод
    const sectionTranslations = translations[section];
    if (!sectionTranslations) {
      console.warn(`Translation section not found: ${section}`);
      return key;
    }

    const languageTranslations = sectionTranslations[language];
    if (!languageTranslations) {
      console.warn(`Language not found in section ${section}: ${language}`);
      return key;
    }

    // Достаём перевод: сначала плоский ключ ('key'), затем вложенный путь
    // ('twoFA.title' → obj.twoFA.title) — чтобы работали секции с вложенными
    // объектами (login.twoFA.*, login.social.*). Обратная совместимость сохранена.
    const dig = (obj) => {
      if (!obj) return undefined;
      if (obj[translationKey] !== undefined) return obj[translationKey];
      return rest.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    };
    let translation = dig(languageTranslations);
    if (translation === undefined) {
      // Попробуем найти в русском как fallback
      translation = dig(sectionTranslations['ru']);
      if (translation === undefined) {
        console.warn(`Translation not found: ${key}`);
        return key;
      }
    }

    // Заменяем параметры {{param}}
    if (params && typeof translation === 'string') {
      Object.keys(params).forEach((param) => {
        translation = translation.replace(
          new RegExp(`{{${param}}}`, 'g'),
          params[param]
        );
      });
    }

    return translation;
  };

  /**
   * Смена языка
   * @param {string} newLanguage - Код нового языка
   */
  const setLanguage = (newLanguage) => {
    if (LANGUAGES[newLanguage]) {
      setLanguageState(newLanguage);
    } else {
      console.warn(`Unknown language: ${newLanguage}`);
    }
  };

  /**
   * Получить информацию о текущем языке
   */
  const getCurrentLanguage = () => LANGUAGES[language];

  /**
   * Получить список всех языков
   */
  const getAvailableLanguages = () => Object.values(LANGUAGES);

  const value = {
    language,
    setLanguage,
    t,
    getCurrentLanguage,
    getAvailableLanguages,
    languages: LANGUAGES,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

/**
 * Хук для использования переводов
 * @returns {object} { language, setLanguage, t, getCurrentLanguage, getAvailableLanguages, languages }
 */
export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};

export default LanguageContext;
