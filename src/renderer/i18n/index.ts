/* eslint-disable no-console */
/**
 * Atlas Desktop - Renderer Process i18n Setup
 * Internationalization for the React frontend using i18next
 */

import {
  SupportedLocale,
  LocaleInfo,
  I18nConfig,
  I18nState,
  InterpolationParams,
  DEFAULT_LOCALE,
  DEFAULT_I18N_CONFIG,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  getLocaleInfo,
} from '../../shared/types/i18n';

// Import locale files directly for the renderer (bundled by Vite)
import enTranslations from '../../main/i18n/locales/en.json';
import esTranslations from '../../main/i18n/locales/es.json';
import frTranslations from '../../main/i18n/locales/fr.json';

/**
 * Translation resources organized by locale
 */
const resources: Record<SupportedLocale, Record<string, unknown>> = {
  en: enTranslations,
  es: esTranslations,
  fr: frTranslations,
};

/**
 * i18n Manager singleton for renderer process
 */
class RendererI18nManager {
  private currentLocale: SupportedLocale;
  private config: I18nConfig;
  private listeners: Set<(locale: SupportedLocale) => void>;
  private initialized: boolean = false;

  constructor() {
    this.currentLocale = DEFAULT_LOCALE;
    this.config = { ...DEFAULT_I18N_CONFIG };
    this.listeners = new Set();
  }

  /**
   * Initialize i18n manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Try to get locale from localStorage
    const savedLocale = this.loadSavedLocale();
    if (savedLocale) {
      this.currentLocale = savedLocale;
    } else if (this.config.autoDetect) {
      // Auto-detect from browser/system
      this.currentLocale = this.detectSystemLocale();
    }

    // Sync with main process
    await this.syncWithMainProcess();

    // Apply RTL direction if needed
    this.applyDirection();

    this.initialized = true;
    console.log('[i18n] Initialized with locale:', this.currentLocale);
  }

  /**
   * Detect system locale from browser
   */
  private detectSystemLocale(): SupportedLocale {
    const browserLocale =
      navigator.language ||
      (navigator as Navigator & { userLanguage?: string }).userLanguage ||
      'en';

    // Try exact match
    if (isSupportedLocale(browserLocale)) {
      return browserLocale;
    }

    // Try base language code
    const baseLocale = browserLocale.split('-')[0].toLowerCase();
    if (isSupportedLocale(baseLocale)) {
      return baseLocale;
    }

    return DEFAULT_LOCALE;
  }

  /**
   * Load saved locale from localStorage
   */
  private loadSavedLocale(): SupportedLocale | null {
    try {
      const saved = localStorage.getItem('atlas-locale');
      if (saved && isSupportedLocale(saved)) {
        return saved;
      }
    } catch (error) {
      console.warn('[i18n] Failed to load saved locale:', error);
    }
    return null;
  }

  /**
   * Save locale to localStorage
   */
  private saveLocale(locale: SupportedLocale): void {
    try {
      localStorage.setItem('atlas-locale', locale);
    } catch (error) {
      console.warn('[i18n] Failed to save locale:', error);
    }
  }

  /**
   * Sync locale with main process
   */
  private async syncWithMainProcess(): Promise<void> {
    try {
      // Get state from main process if available
      if (typeof window !== 'undefined' && window.atlas?.i18n) {
        const result = await window.atlas.i18n.getState();
        if (result.success && result.data) {
          // Prefer main process locale if different
          if (result.data.currentLocale !== this.currentLocale) {
            // Update main process with renderer locale
            await window.atlas.i18n.setLocale(this.currentLocale);
          }
        }
      }
    } catch (error) {
      console.warn('[i18n] Failed to sync with main process:', error);
    }
  }

  /**
   * Apply text direction based on locale
   */
  private applyDirection(): void {
    const direction = getLocaleInfo(this.currentLocale).direction;
    document.documentElement.dir = direction;
    document.documentElement.lang = this.currentLocale;
  }

  /**
   * Get current locale
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  /**
   * Get locale info for current locale
   */
  getLocaleInfo(): LocaleInfo {
    return getLocaleInfo(this.currentLocale);
  }

  /**
   * Set locale
   */
  async setLocale(locale: SupportedLocale): Promise<void> {
    if (!isSupportedLocale(locale)) {
      console.warn('[i18n] Unsupported locale:', locale);
      return;
    }

    const previousLocale = this.currentLocale;
    this.currentLocale = locale;

    // Save to localStorage
    this.saveLocale(locale);

    // Apply direction
    this.applyDirection();

    // Notify main process
    if (typeof window !== 'undefined' && window.atlas?.i18n) {
      try {
        await window.atlas.i18n.setLocale(locale);
      } catch (error) {
        console.warn('[i18n] Failed to notify main process:', error);
      }
    }

    // Notify listeners
    this.listeners.forEach((listener) => listener(locale));

    console.log('[i18n] Locale changed:', previousLocale, '->', locale);
  }

  /**
   * Get translation by key
   */
  t(key: string, params?: InterpolationParams): string {
    const translations = resources[this.currentLocale];
    const fallbackTranslations = resources[this.config.fallbackLocale];

    let value = this.getNestedValue(translations, key);

    // Fallback to default locale
    if (value === undefined && fallbackTranslations) {
      value = this.getNestedValue(fallbackTranslations, key);
    }

    // Return key if not found
    if (value === undefined) {
      console.warn('[i18n] Translation not found:', key);
      return key;
    }

    // Handle string values
    if (typeof value === 'string') {
      return this.interpolate(value, params);
    }

    // Handle plural forms
    if (typeof value === 'object' && value !== null && 'one' in value) {
      return this.handlePlural(value as { one: string; other: string }, params);
    }

    return key;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: unknown, path: string): string | object | undefined {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }

    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    if (typeof current === 'string' || (typeof current === 'object' && current !== null)) {
      return current as string | object;
    }

    return undefined;
  }

  /**
   * Interpolate parameters
   */
  private interpolate(text: string, params?: InterpolationParams): string {
    if (!params) {
      return text;
    }

    return text.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : match;
    });
  }

  /**
   * Handle plural forms
   */
  private handlePlural(
    forms: { one: string; other: string; zero?: string },
    params?: InterpolationParams
  ): string {
    const count = params?.count;

    if (count === undefined || typeof count !== 'number') {
      return this.interpolate(forms.other, params);
    }

    if (count === 0 && forms.zero) {
      return this.interpolate(forms.zero, params);
    }

    if (count === 1) {
      return this.interpolate(forms.one, params);
    }

    return this.interpolate(forms.other, params);
  }

  /**
   * Format date according to locale
   */
  formatDate(date: Date | number, style: 'short' | 'medium' | 'long' = 'medium'): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const localeInfo = this.getLocaleInfo();

    try {
      return new Intl.DateTimeFormat(localeInfo.voiceLanguage, {
        dateStyle: style,
      }).format(d);
    } catch {
      return d.toLocaleDateString();
    }
  }

  /**
   * Format time according to locale
   */
  formatTime(date: Date | number, style: 'short' | 'medium' | 'long' = 'short'): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const localeInfo = this.getLocaleInfo();

    try {
      return new Intl.DateTimeFormat(localeInfo.voiceLanguage, {
        timeStyle: style,
      }).format(d);
    } catch {
      return d.toLocaleTimeString();
    }
  }

  /**
   * Format number according to locale
   */
  formatNumber(
    value: number,
    options?: { style?: 'decimal' | 'currency' | 'percent'; currency?: string }
  ): string {
    const localeInfo = this.getLocaleInfo();

    try {
      const formatOptions: Intl.NumberFormatOptions = {
        style: options?.style || 'decimal',
      };

      if (options?.style === 'currency') {
        formatOptions.currency = options.currency || 'USD';
      }

      return new Intl.NumberFormat(localeInfo.voiceLanguage, formatOptions).format(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Format relative time (e.g., "2 hours ago")
   */
  formatRelativeTime(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    const localeInfo = this.getLocaleInfo();

    try {
      const rtf = new Intl.RelativeTimeFormat(localeInfo.voiceLanguage, { numeric: 'auto' });

      if (diffSeconds < 60) {
        return rtf.format(-diffSeconds, 'second');
      }
      if (diffMinutes < 60) {
        return rtf.format(-diffMinutes, 'minute');
      }
      if (diffHours < 24) {
        return rtf.format(-diffHours, 'hour');
      }
      return rtf.format(-diffDays, 'day');
    } catch {
      return this.formatDate(d);
    }
  }

  /**
   * Get available locales
   */
  getAvailableLocales(): LocaleInfo[] {
    return Object.values(SUPPORTED_LOCALES);
  }

  /**
   * Get configuration
   */
  getConfig(): I18nConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<I18nConfig>): void {
    this.config = { ...this.config, ...newConfig };

    if (newConfig.locale && newConfig.locale !== this.currentLocale) {
      this.setLocale(newConfig.locale);
    }
  }

  /**
   * Get i18n state
   */
  getState(): I18nState {
    return {
      currentLocale: this.currentLocale,
      config: { ...this.config },
      availableLocales: this.getAvailableLocales(),
    };
  }

  /**
   * Subscribe to locale changes
   */
  subscribe(listener: (locale: SupportedLocale) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let i18nInstance: RendererI18nManager | null = null;

/**
 * Get the renderer i18n manager instance
 */
export function getI18n(): RendererI18nManager {
  if (!i18nInstance) {
    i18nInstance = new RendererI18nManager();
  }
  return i18nInstance;
}

/**
 * Initialize i18n (call once at app startup)
 */
export async function initializeI18n(): Promise<RendererI18nManager> {
  const manager = getI18n();
  await manager.initialize();
  return manager;
}

/**
 * Convenience translation function
 */
export function t(key: string, params?: InterpolationParams): string {
  return getI18n().t(key, params);
}

// Re-export types and utilities
export type { SupportedLocale, LocaleInfo, I18nConfig, I18nState, InterpolationParams };
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, getLocaleInfo };

export default getI18n;
