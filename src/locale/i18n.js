import { createI18n } from 'vue-i18n';
import flatpickr from 'flatpickr';
import { english as flatpickrLocaleEn } from 'flatpickr/dist/l10n/default';
import { Mandarin as flatpickrLocaleZh } from 'flatpickr/dist/l10n/zh';
import { enUS as datefnsLocaleEn, zhCN as datefnsLocaleZh } from 'date-fns/locale';
import { setDefaultOptions as setDateFnsOptions } from 'date-fns';
import setPunktLanguage from './punktStrings';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';

const LOCALES = {
  'en-US': {
    flatpickr: flatpickrLocaleEn,
    datefns: datefnsLocaleEn,
  },
  'zh-CN': {
    flatpickr: flatpickrLocaleZh,
    datefns: datefnsLocaleZh,
  },
};
const STORAGE_KEY = 'okr-language';
const FALLBACK_LOCALE = import.meta.env.VITE_I18N_FALLBACK_LOCALE || 'en-US';

// Last language chosen on this device, else the browser's language, else the
// configured default. Signed-in users' saved preference overrides this later.
function initialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES[stored]) {
      return stored;
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  if ((navigator.language || '').toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }
  return import.meta.env.VITE_I18N_LOCALE || 'en-US';
}

const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: FALLBACK_LOCALE,
  messages: {
    'en-US': en,
    'zh-CN': zh,
  },
});

setLanguage(initialLocale());

export function setLanguage(lang) {
  if (!Object.hasOwnProperty.call(LOCALES, lang)) {
    return;
  }

  i18n.global.locale.value = lang;
  flatpickr.localize(LOCALES[lang].flatpickr);
  setDateFnsOptions({ locale: LOCALES[lang].datefns });
  setPunktLanguage(lang);

  document.querySelector('html').setAttribute('lang', lang);

  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not critical: the choice just won't survive a reload.
  }
}

export default i18n;
