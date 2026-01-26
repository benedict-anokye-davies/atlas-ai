/**
 * Atlas Desktop - Internationalization (i18n) Types
 * Type definitions for localization system
 */

/**
 * Supported locale codes
 * ISO 639-1 language codes
 */
export type SupportedLocale = 'en' | 'es' | 'fr';

/**
 * Text direction for locale
 */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Locale metadata
 */
export interface LocaleInfo {
  /** ISO 639-1 code */
  code: SupportedLocale;
  /** Native language name (e.g., "English", "Espanol") */
  nativeName: string;
  /** English name */
  englishName: string;
  /** Text direction */
  direction: TextDirection;
  /** Date format pattern */
  dateFormat: string;
  /** Time format pattern */
  timeFormat: string;
  /** Number decimal separator */
  decimalSeparator: string;
  /** Number thousands separator */
  thousandsSeparator: string;
  /** Currency format pattern */
  currencyFormat: string;
  /** Voice language code for TTS (BCP 47) */
  voiceLanguage: string;
  /** STT language code (varies by provider) */
  sttLanguage: string;
  /** Flag emoji or icon */
  flag: string;
}

/**
 * All supported locales metadata
 */
export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleInfo> = {
  en: {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
    direction: 'ltr',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: 'h:mm A',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    currencyFormat: '${{value}}',
    voiceLanguage: 'en-US',
    sttLanguage: 'en-US',
    flag: 'US',
  },
  es: {
    code: 'es',
    nativeName: 'Espanol',
    englishName: 'Spanish',
    direction: 'ltr',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: 'HH:mm',
    decimalSeparator: ',',
    thousandsSeparator: '.',
    currencyFormat: '{{value}} EUR',
    voiceLanguage: 'es-ES',
    sttLanguage: 'es-ES',
    flag: 'ES',
  },
  fr: {
    code: 'fr',
    nativeName: 'Francais',
    englishName: 'French',
    direction: 'ltr',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: 'HH:mm',
    decimalSeparator: ',',
    thousandsSeparator: ' ',
    currencyFormat: '{{value}} EUR',
    voiceLanguage: 'fr-FR',
    sttLanguage: 'fr-FR',
    flag: 'FR',
  },
};

/**
 * Default locale
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Check if a locale is supported
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale in SUPPORTED_LOCALES;
}

/**
 * Get locale info with fallback
 */
export function getLocaleInfo(locale: string): LocaleInfo {
  if (isSupportedLocale(locale)) {
    return SUPPORTED_LOCALES[locale];
  }
  // Try base language code (e.g., 'en-US' -> 'en')
  const baseLocale = locale.split('-')[0];
  if (isSupportedLocale(baseLocale)) {
    return SUPPORTED_LOCALES[baseLocale];
  }
  return SUPPORTED_LOCALES[DEFAULT_LOCALE];
}

/**
 * i18n configuration
 */
export interface I18nConfig {
  /** Current locale */
  locale: SupportedLocale;
  /** Fallback locale */
  fallbackLocale: SupportedLocale;
  /** Auto-detect system locale */
  autoDetect: boolean;
  /** Sync voice language with locale */
  syncVoiceLanguage: boolean;
}

/**
 * Default i18n configuration
 */
export const DEFAULT_I18N_CONFIG: I18nConfig = {
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  autoDetect: true,
  syncVoiceLanguage: true,
};

/**
 * Interpolation parameters for translations
 */
export type InterpolationParams = Record<string, string | number>;

/**
 * Plural form rules
 */
export interface PluralForms {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Translation value can be string, nested object, or plural forms
 */
export type TranslationValue = string | TranslationObject | PluralForms;

/**
 * Translation object (nested structure)
 */
export interface TranslationObject {
  [key: string]: TranslationValue;
}

/**
 * Locale translations structure
 */
export interface LocaleTranslations {
  common: {
    atlas: string;
    settings: string;
    close: string;
    save: string;
    cancel: string;
    reset: string;
    apply: string;
    loading: string;
    error: string;
    success: string;
    warning: string;
    info: string;
    yes: string;
    no: string;
    ok: string;
    retry: string;
    connected: string;
    disconnected: string;
    online: string;
    offline: string;
  };
  voice: {
    listening: string;
    speaking: string;
    thinking: string;
    idle: string;
    wakeWordPrompt: string;
    pushToTalk: string;
    processing: string;
    transcribing: string;
    responding: string;
    error: string;
  };
  settings: {
    title: string;
    sections: {
      audio: string;
      voice: string;
      visual: string;
      behavior: string;
      providers: string;
      personality: string;
      budget: string;
      advanced: string;
      language: string;
    };
    audio: {
      inputDevice: string;
      outputDevice: string;
      volume: string;
      testAudio: string;
      selectDevice: string;
    };
    voice: {
      voiceId: string;
      speed: string;
      stability: string;
      wakeWord: string;
      sensitivity: string;
    };
    visual: {
      theme: string;
      particleCount: string;
      adaptivePerformance: string;
      qualityPreset: string;
      effects: string;
      orbColor: string;
      brightness: string;
    };
    behavior: {
      autoStart: string;
      pushToTalk: string;
      minimizeToTray: string;
      startMinimized: string;
      privacyMode: string;
      bargeIn: string;
    };
    language: {
      title: string;
      description: string;
      currentLanguage: string;
      selectLanguage: string;
      autoDetect: string;
      syncVoice: string;
    };
    budget: {
      dailyLimit: string;
      warningThreshold: string;
      currentUsage: string;
      remaining: string;
    };
  };
  errors: {
    generic: string;
    network: string;
    apiKey: string;
    microphone: string;
    wakeWord: string;
    stt: string;
    llm: string;
    tts: string;
    budget: string;
    rateLimited: string;
    timeout: string;
  };
  notifications: {
    budgetWarning: string;
    budgetExceeded: string;
    updateAvailable: string;
    updateDownloaded: string;
    providerChanged: string;
    offlineMode: string;
    connected: string;
    disconnected: string;
  };
  accessibility: {
    skipToMain: string;
    openSettings: string;
    closeSettings: string;
    voiceState: string;
    audioLevel: string;
    orbVisualization: string;
    keyboardShortcuts: string;
  };
}

/**
 * i18n state for IPC communication
 */
export interface I18nState {
  currentLocale: SupportedLocale;
  config: I18nConfig;
  availableLocales: LocaleInfo[];
}

/**
 * IPC result for i18n operations
 */
export interface I18nIPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
