/**
 * Atlas Desktop - Main Process i18n Manager
 * Handles internationalization for the Electron main process
 */

import { app } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  SupportedLocale,
  LocaleInfo,
  I18nConfig,
  I18nState,
  LocaleTranslations,
  InterpolationParams,
  DEFAULT_I18N_CONFIG,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  getLocaleInfo,
} from '../../shared/types/i18n';

const logger = createModuleLogger('i18n');

/**
 * i18n Manager singleton instance
 */
let i18nInstance: I18nManager | null = null;

/**
 * i18n Manager for the main process
 * Handles locale detection, translation loading, and language switching
 */
export class I18nManager extends EventEmitter {
  private config: I18nConfig;
  private currentLocale: SupportedLocale;
  private translations: Map<SupportedLocale, LocaleTranslations>;
  private localesDir: string;
  private initialized: boolean = false;

  constructor(config: Partial<I18nConfig> = {}) {
    super();
    this.config = { ...DEFAULT_I18N_CONFIG, ...config };
    this.currentLocale = this.config.locale;
    this.translations = new Map();

    // Determine locales directory based on environment
    const isDev = !app.isPackaged;
    if (isDev) {
      this.localesDir = join(__dirname, 'locales');
    } else {
      this.localesDir = join(app.getAppPath(), 'dist', 'main', 'i18n', 'locales');
    }

    logger.debug('i18n Manager created', {
      config: this.config,
      localesDir: this.localesDir,
    });
  }

  /**
   * Initialize the i18n manager
   * Loads translations and detects system locale if enabled
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('i18n Manager already initialized');
      return;
    }

    logger.info('Initializing i18n Manager...');

    try {
      // Load all translations
      await this.loadAllTranslations();

      // Auto-detect system locale if enabled
      if (this.config.autoDetect) {
        const detectedLocale = this.detectSystemLocale();
        if (detectedLocale !== this.currentLocale) {
          await this.setLocale(detectedLocale);
        }
      }

      this.initialized = true;
      logger.info('i18n Manager initialized', {
        locale: this.currentLocale,
        loadedLocales: Array.from(this.translations.keys()),
      });

      this.emit('initialized', this.getState());
    } catch (error) {
      logger.error('Failed to initialize i18n Manager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Detect system locale from Electron app
   */
  detectSystemLocale(): SupportedLocale {
    try {
      // Get system locale from Electron
      const systemLocale = app.getLocale();
      logger.debug('Detected system locale', { systemLocale });

      // Try exact match first
      if (isSupportedLocale(systemLocale)) {
        return systemLocale;
      }

      // Try base language code (e.g., 'en-US' -> 'en')
      const baseLocale = systemLocale.split('-')[0].toLowerCase();
      if (isSupportedLocale(baseLocale)) {
        return baseLocale;
      }

      // Fallback to default
      logger.debug('System locale not supported, using fallback', {
        systemLocale,
        fallback: this.config.fallbackLocale,
      });
      return this.config.fallbackLocale;
    } catch (error) {
      logger.warn('Failed to detect system locale', { error: (error as Error).message });
      return this.config.fallbackLocale;
    }
  }

  /**
   * Load all supported translations
   */
  private async loadAllTranslations(): Promise<void> {
    const locales = Object.keys(SUPPORTED_LOCALES) as SupportedLocale[];

    for (const locale of locales) {
      try {
        await this.loadTranslations(locale);
      } catch (error) {
        logger.warn('Failed to load translations for locale', {
          locale,
          error: (error as Error).message,
        });
        // Continue loading other locales
      }
    }

    // Ensure at least the fallback locale is loaded
    if (!this.translations.has(this.config.fallbackLocale)) {
      throw new Error(`Failed to load fallback locale: ${this.config.fallbackLocale}`);
    }
  }

  /**
   * Load translations for a specific locale
   */
  private async loadTranslations(locale: SupportedLocale): Promise<void> {
    const filePath = join(this.localesDir, `${locale}.json`);

    if (!existsSync(filePath)) {
      throw new Error(`Locale file not found: ${filePath}`);
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const translations = JSON.parse(content) as LocaleTranslations;
      this.translations.set(locale, translations);
      logger.debug('Loaded translations', { locale, filePath });
    } catch (error) {
      throw new Error(`Failed to parse locale file ${filePath}: ${(error as Error).message}`);
    }
  }

  /**
   * Get current locale
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  /**
   * Get current locale info
   */
  getLocaleInfo(): LocaleInfo {
    return getLocaleInfo(this.currentLocale);
  }

  /**
   * Set current locale
   */
  async setLocale(locale: SupportedLocale): Promise<void> {
    if (!isSupportedLocale(locale)) {
      throw new Error(`Unsupported locale: ${locale}`);
    }

    if (!this.translations.has(locale)) {
      await this.loadTranslations(locale);
    }

    const previousLocale = this.currentLocale;
    this.currentLocale = locale;
    this.config.locale = locale;

    logger.info('Locale changed', { from: previousLocale, to: locale });
    this.emit('locale-changed', { locale, previousLocale });
  }

  /**
   * Get translation by key path
   * @param key Dot-notation key path (e.g., 'common.settings')
   * @param params Interpolation parameters
   * @returns Translated string
   */
  t(key: string, params?: InterpolationParams): string {
    const translations = this.translations.get(this.currentLocale);
    const fallbackTranslations = this.translations.get(this.config.fallbackLocale);

    let value = this.getNestedValue(translations, key);

    // Fallback to default locale if translation not found
    if (value === undefined && fallbackTranslations) {
      value = this.getNestedValue(fallbackTranslations, key);
    }

    // Return key if no translation found
    if (value === undefined) {
      logger.warn('Translation not found', { key, locale: this.currentLocale });
      return key;
    }

    // Handle string values
    if (typeof value === 'string') {
      return this.interpolate(value, params);
    }

    // Handle plural forms
    if (typeof value === 'object' && 'one' in value) {
      return this.handlePlural(value as { one: string; other: string }, params);
    }

    logger.warn('Invalid translation value type', { key, type: typeof value });
    return key;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): string | undefined {
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

    return typeof current === 'string' ? current : undefined;
  }

  /**
   * Interpolate parameters into translation string
   */
  private interpolate(text: string, params?: InterpolationParams): string {
    if (!params) {
      return text;
    }

    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }

  /**
   * Handle plural form selection
   */
  private handlePlural(
    forms: { one: string; other: string; zero?: string; few?: string; many?: string },
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
   * Format date according to current locale
   */
  formatDate(date: Date | number, style: 'short' | 'medium' | 'long' = 'medium'): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const localeInfo = this.getLocaleInfo();

    try {
      return new Intl.DateTimeFormat(localeInfo.voiceLanguage, {
        dateStyle: style,
      }).format(d);
    } catch (error) {
      logger.warn('Failed to format date', { error: (error as Error).message });
      return d.toLocaleDateString();
    }
  }

  /**
   * Format time according to current locale
   */
  formatTime(date: Date | number, style: 'short' | 'medium' | 'long' = 'short'): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const localeInfo = this.getLocaleInfo();

    try {
      return new Intl.DateTimeFormat(localeInfo.voiceLanguage, {
        timeStyle: style,
      }).format(d);
    } catch (error) {
      logger.warn('Failed to format time', { error: (error as Error).message });
      return d.toLocaleTimeString();
    }
  }

  /**
   * Format number according to current locale
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
    } catch (error) {
      logger.warn('Failed to format number', { error: (error as Error).message });
      return String(value);
    }
  }

  /**
   * Get voice language code for TTS
   */
  getVoiceLanguage(): string {
    return this.getLocaleInfo().voiceLanguage;
  }

  /**
   * Get STT language code
   */
  getSTTLanguage(): string {
    return this.getLocaleInfo().sttLanguage;
  }

  /**
   * Get available locales
   */
  getAvailableLocales(): LocaleInfo[] {
    return Object.values(SUPPORTED_LOCALES);
  }

  /**
   * Get i18n state for IPC communication
   */
  getState(): I18nState {
    return {
      currentLocale: this.currentLocale,
      config: { ...this.config },
      availableLocales: this.getAvailableLocales(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<I18nConfig>): void {
    const previousConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    logger.debug('i18n config updated', { from: previousConfig, to: this.config });
    this.emit('config-changed', { config: this.config, previousConfig });

    // Handle locale change through config
    if (newConfig.locale && newConfig.locale !== this.currentLocale) {
      this.setLocale(newConfig.locale).catch((error) => {
        logger.error('Failed to change locale via config', { error: (error as Error).message });
      });
    }
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get configuration
   */
  getConfig(): I18nConfig {
    return { ...this.config };
  }

  /**
   * Shutdown manager
   */
  shutdown(): void {
    this.translations.clear();
    this.initialized = false;
    this.removeAllListeners();
    logger.info('i18n Manager shutdown');
  }
}

/**
 * Get the singleton i18n Manager instance
 */
export function getI18nManager(config?: Partial<I18nConfig>): I18nManager {
  if (!i18nInstance) {
    i18nInstance = new I18nManager(config);
  }
  return i18nInstance;
}

/**
 * Shutdown the i18n Manager
 */
export function shutdownI18nManager(): void {
  if (i18nInstance) {
    i18nInstance.shutdown();
    i18nInstance = null;
  }
}

/**
 * Convenience function to get translation
 */
export function t(key: string, params?: InterpolationParams): string {
  const manager = getI18nManager();
  return manager.t(key, params);
}

export default {
  getI18nManager,
  shutdownI18nManager,
  t,
};
