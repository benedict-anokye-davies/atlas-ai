/* eslint-disable no-console */
/**
 * Atlas Configuration Manager
 * Loads and validates environment configuration
 *
 * API keys are stored securely in OS keychain or encrypted fallback storage.
 * Environment variables are used for initial migration only.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { homedir } from 'os';
import {
  AtlasConfig,
  ConfigValidationResult,
  DEFAULT_CONFIG,
  DEFAULT_LOCAL_ONLY_CONFIG,
  REQUIRED_API_KEYS,
  OPTIONAL_API_KEYS,
  LocalOnlyConfig,
} from '../../shared/types/config';

// NOTE: We intentionally don't import logger here to avoid circular dependency.
// Logger imports config to get logDir/logLevel, and config would import logger for warnings.
// Instead, config logs warnings to console during initial load.

// NOTE: We also don't import keychain here directly to avoid circular dependencies.
// Use getSecureApiKey() for async key retrieval after initial config load.

// Load .env file
dotenvConfig();

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return resolve(path);
}

/**
 * Parse boolean from environment variable
 */
function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Load local-only configuration from environment variables
 */
function loadLocalOnlyConfig(): LocalOnlyConfig {
  return {
    enabled: parseEnvBoolean(process.env.LOCAL_ONLY_MODE, DEFAULT_LOCAL_ONLY_CONFIG.enabled),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_LOCAL_ONLY_CONFIG.ollamaBaseUrl,
    ollamaModel: process.env.OLLAMA_MODEL || DEFAULT_LOCAL_ONLY_CONFIG.ollamaModel,
    forceOfflineSTT: parseEnvBoolean(
      process.env.FORCE_OFFLINE_STT,
      DEFAULT_LOCAL_ONLY_CONFIG.forceOfflineSTT
    ),
    forceOfflineTTS: parseEnvBoolean(
      process.env.FORCE_OFFLINE_TTS,
      DEFAULT_LOCAL_ONLY_CONFIG.forceOfflineTTS
    ),
    showIndicator: parseEnvBoolean(
      process.env.LOCAL_ONLY_SHOW_INDICATOR,
      DEFAULT_LOCAL_ONLY_CONFIG.showIndicator
    ),
  };
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): AtlasConfig {
  const config: AtlasConfig = {
    // API Keys
    porcupineApiKey: process.env.PORCUPINE_API_KEY || '',
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
    cartesiaApiKey: process.env.CARTESIA_API_KEY || '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    fireworksApiKey: process.env.FIREWORKS_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,

    // TTS settings
    cartesiaVoiceId: process.env.CARTESIA_VOICE_ID || DEFAULT_CONFIG.cartesiaVoiceId!,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_CONFIG.elevenlabsVoiceId!,

    // LLM settings
    fireworksModel: process.env.FIREWORKS_MODEL || DEFAULT_CONFIG.fireworksModel!,
    openrouterModel: process.env.OPENROUTER_MODEL || DEFAULT_CONFIG.openrouterModel!,

    // Local-only mode settings
    localOnly: loadLocalOnlyConfig(),

    // Environment
    nodeEnv: (process.env.NODE_ENV as AtlasConfig['nodeEnv']) || 'development',
    logLevel: (process.env.LOG_LEVEL as AtlasConfig['logLevel']) || 'debug',
    logDir: expandPath(process.env.LOG_DIR || DEFAULT_CONFIG.logDir!),

    // Audio settings
    audioSampleRate: parseInt(
      process.env.AUDIO_SAMPLE_RATE || String(DEFAULT_CONFIG.audioSampleRate),
      10
    ),
    audioChannels: parseInt(process.env.AUDIO_CHANNELS || String(DEFAULT_CONFIG.audioChannels), 10),

    // Voice settings
    wakeWordSensitivity: parseFloat(
      process.env.WAKE_WORD_SENSITIVITY || String(DEFAULT_CONFIG.wakeWordSensitivity)
    ),
    vadThreshold: parseFloat(process.env.VAD_THRESHOLD || String(DEFAULT_CONFIG.vadThreshold)),
    vadSilenceDuration: parseInt(
      process.env.VAD_SILENCE_DURATION || String(DEFAULT_CONFIG.vadSilenceDuration),
      10
    ),

    // System Audio Ducking settings
    audioDuckingEnabled: parseEnvBoolean(
      process.env.AUDIO_DUCKING_ENABLED,
      DEFAULT_CONFIG.audioDuckingEnabled!
    ),
    audioDuckingLevel: parseFloat(
      process.env.AUDIO_DUCKING_LEVEL || String(DEFAULT_CONFIG.audioDuckingLevel)
    ),
    audioDuckingAttackMs: parseInt(
      process.env.AUDIO_DUCKING_ATTACK_MS || String(DEFAULT_CONFIG.audioDuckingAttackMs),
      10
    ),
    audioDuckingReleaseMs: parseInt(
      process.env.AUDIO_DUCKING_RELEASE_MS || String(DEFAULT_CONFIG.audioDuckingReleaseMs),
      10
    ),

    // User settings
    userName: process.env.USER_NAME || DEFAULT_CONFIG.userName!,
  };

  return config;
}

/**
 * Validate configuration
 */
function validateConfig(config: AtlasConfig): ConfigValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required API keys
  for (const key of REQUIRED_API_KEYS) {
    if (!config[key]) {
      missing.push(key);
    }
  }

  // Check optional API keys
  for (const key of OPTIONAL_API_KEYS) {
    if (!config[key]) {
      warnings.push(`Optional: ${key} not set`);
    }
  }

  // Validate ranges
  if (config.wakeWordSensitivity < 0 || config.wakeWordSensitivity > 1) {
    warnings.push('wakeWordSensitivity should be between 0 and 1');
  }

  if (config.vadThreshold < 0 || config.vadThreshold > 1) {
    warnings.push('vadThreshold should be between 0 and 1');
  }

  if (config.audioSampleRate < 8000 || config.audioSampleRate > 48000) {
    warnings.push('audioSampleRate should be between 8000 and 48000');
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

// Singleton config instance
let configInstance: AtlasConfig | null = null;
let validationResult: ConfigValidationResult | null = null;

/**
 * Get configuration (loads once, caches result)
 */
export function getConfig(): AtlasConfig {
  if (!configInstance) {
    configInstance = loadConfig();
    validationResult = validateConfig(configInstance);

    // Use console for config warnings to avoid circular dependency with logger
    // Logger imports config to get settings, so we can't import logger here
    if (!validationResult.valid) {
      console.error('[Config] Missing required configuration:', validationResult.missing);
    }

    if (validationResult.warnings.length > 0) {
      console.warn('[Config] Configuration warnings:', validationResult.warnings);
    }
  }

  return configInstance;
}

/**
 * Get validation result
 */
export function getConfigValidation(): ConfigValidationResult {
  if (!validationResult) {
    getConfig(); // This will populate validationResult
  }
  return validationResult!;
}

/**
 * Check if config is valid (all required keys present)
 */
export function isConfigValid(): boolean {
  return getConfigValidation().valid;
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof AtlasConfig>(key: K): AtlasConfig[K] {
  return getConfig()[key];
}

/**
 * Check if a specific API key is configured
 */
export function hasApiKey(
  key: (typeof REQUIRED_API_KEYS)[number] | (typeof OPTIONAL_API_KEYS)[number]
): boolean {
  const config = getConfig();
  return !!config[key];
}

/**
 * Reload configuration (for testing or hot reload)
 */
export function reloadConfig(): AtlasConfig {
  configInstance = null;
  validationResult = null;
  return getConfig();
}

/**
 * Get config as safe object (masks API keys)
 */
export function getSafeConfig(): Record<string, unknown> {
  const config = getConfig();
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key.toLowerCase().includes('apikey') || key.toLowerCase().includes('key')) {
      safe[key] = value ? '***' + String(value).slice(-4) : 'NOT SET';
    } else {
      safe[key] = value;
    }
  }

  return safe;
}

export type { AtlasConfig, ConfigValidationResult, LocalOnlyConfig };

// =============================================================================
// Local-Only Mode Management
// =============================================================================

/** Runtime local-only state (can be toggled without restarting) */
let localOnlyModeOverride: boolean | null = null;

/**
 * Check if local-only mode is currently enabled
 * This considers both the config setting and any runtime override
 */
export function isLocalOnlyMode(): boolean {
  if (localOnlyModeOverride !== null) {
    return localOnlyModeOverride;
  }
  return getConfig().localOnly.enabled;
}

/**
 * Get the current local-only configuration
 */
export function getLocalOnlyConfig(): LocalOnlyConfig {
  const config = getConfig().localOnly;
  return {
    ...config,
    // Apply runtime override if set
    enabled: isLocalOnlyMode(),
  };
}

/**
 * Enable or disable local-only mode at runtime
 * This allows toggling without restarting the app
 *
 * @param enabled - Whether to enable local-only mode
 * @returns The new local-only state
 */
export function setLocalOnlyMode(enabled: boolean): boolean {
  localOnlyModeOverride = enabled;
  console.log(`[Config] Local-only mode ${enabled ? 'enabled' : 'disabled'}`);
  return enabled;
}

/**
 * Reset local-only mode to use the config value
 */
export function resetLocalOnlyMode(): boolean {
  localOnlyModeOverride = null;
  return getConfig().localOnly.enabled;
}

/**
 * Update local-only configuration at runtime
 * Note: Some changes may require component restart
 *
 * @param updates - Partial LocalOnlyConfig to apply
 */
export function updateLocalOnlyConfig(updates: Partial<LocalOnlyConfig>): LocalOnlyConfig {
  if (!configInstance) {
    getConfig(); // Ensure config is loaded
  }

  configInstance!.localOnly = {
    ...configInstance!.localOnly,
    ...updates,
  };

  // Handle enabled separately via the override system
  if (updates.enabled !== undefined) {
    setLocalOnlyMode(updates.enabled);
  }

  return getLocalOnlyConfig();
}

/**
 * Check if Ollama is configured for local LLM
 */
export function isOllamaConfigured(): boolean {
  const config = getLocalOnlyConfig();
  return !!config.ollamaBaseUrl && !!config.ollamaModel;
}

// =============================================================================
// API Key Management
// =============================================================================

/**
 * API key name mapping from config keys to keychain keys
 */
const CONFIG_TO_KEYCHAIN_MAP: Record<string, string> = {
  porcupineApiKey: 'PORCUPINE_API_KEY',
  deepgramApiKey: 'DEEPGRAM_API_KEY',
  cartesiaApiKey: 'CARTESIA_API_KEY',
  elevenlabsApiKey: 'ELEVENLABS_API_KEY',
  fireworksApiKey: 'FIREWORKS_API_KEY',
  openrouterApiKey: 'OPENROUTER_API_KEY',
  perplexityApiKey: 'PERPLEXITY_API_KEY',
};

/**
 * Cache for secure API keys to avoid repeated keychain lookups
 */
let secureKeyCache: Map<string, string | null> | null = null;

/**
 * Get an API key from secure storage (keychain)
 * This is the preferred method for retrieving API keys after app initialization.
 *
 * @param configKey - The config key name (e.g., 'deepgramApiKey')
 * @returns The API key value or null if not found
 */
export async function getSecureApiKey(
  configKey: keyof typeof CONFIG_TO_KEYCHAIN_MAP
): Promise<string | null> {
  // Check cache first
  if (secureKeyCache?.has(configKey)) {
    return secureKeyCache.get(configKey) ?? null;
  }

  try {
    // Dynamically import to avoid circular dependency
    const { getApiKey } = await import('../security/keychain');
    const keychainKey = CONFIG_TO_KEYCHAIN_MAP[configKey];

    if (!keychainKey) {
      console.warn(`[Config] Unknown config key: ${configKey}`);
      return null;
    }

    // Type assertion needed since we're dynamically mapping
    const value = await getApiKey(keychainKey as Parameters<typeof getApiKey>[0]);

    // Initialize cache if needed
    if (!secureKeyCache) {
      secureKeyCache = new Map();
    }

    // Cache the result
    secureKeyCache.set(configKey, value);

    return value;
  } catch (error) {
    console.error(`[Config] Failed to get secure API key: ${configKey}`, error);

    // Fall back to config value (from environment)
    const config = getConfig();
    return config[configKey as keyof AtlasConfig] as string | null;
  }
}

/**
 * Get all API keys from secure storage
 * Returns a partial config object with only API key fields
 */
export async function getSecureApiKeys(): Promise<Partial<AtlasConfig>> {
  const result: Partial<AtlasConfig> = {};

  for (const configKey of Object.keys(CONFIG_TO_KEYCHAIN_MAP)) {
    const value = await getSecureApiKey(configKey as keyof typeof CONFIG_TO_KEYCHAIN_MAP);
    if (value) {
      (result as Record<string, string>)[configKey] = value;
    }
  }

  return result;
}

/**
 * Invalidate the secure key cache
 * Call this after updating keys in the keychain
 */
export function invalidateSecureKeyCache(): void {
  secureKeyCache = null;
}

/**
 * Initialize secure storage and perform key migration if needed
 * Should be called early in app startup, after basic config is loaded
 */
export async function initializeSecureStorage(): Promise<{
  success: boolean;
  migrated: boolean;
  errors: string[];
}> {
  try {
    const { autoMigrateKeys } = await import('../security/key-migration');
    const result = await autoMigrateKeys();

    if (result === null) {
      // No migration needed
      return { success: true, migrated: false, errors: [] };
    }

    // Invalidate cache after migration
    invalidateSecureKeyCache();

    return {
      success: result.success,
      migrated: true,
      errors: result.errors,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[Config] Failed to initialize secure storage:', errorMessage);
    return {
      success: false,
      migrated: false,
      errors: [errorMessage],
    };
  }
}

/**
 * Store an API key in secure storage
 */
export async function setSecureApiKey(
  configKey: keyof typeof CONFIG_TO_KEYCHAIN_MAP,
  value: string
): Promise<boolean> {
  try {
    const { setApiKey } = await import('../security/keychain');
    const keychainKey = CONFIG_TO_KEYCHAIN_MAP[configKey];

    if (!keychainKey) {
      console.warn(`[Config] Unknown config key: ${configKey}`);
      return false;
    }

    const result = await setApiKey(keychainKey as Parameters<typeof setApiKey>[0], value);

    // Invalidate cache
    invalidateSecureKeyCache();

    return result.success;
  } catch (error) {
    console.error(`[Config] Failed to set secure API key: ${configKey}`, error);
    return false;
  }
}

/**
 * Delete an API key from secure storage
 */
export async function deleteSecureApiKey(
  configKey: keyof typeof CONFIG_TO_KEYCHAIN_MAP
): Promise<boolean> {
  try {
    const { deleteApiKey } = await import('../security/keychain');
    const keychainKey = CONFIG_TO_KEYCHAIN_MAP[configKey];

    if (!keychainKey) {
      console.warn(`[Config] Unknown config key: ${configKey}`);
      return false;
    }

    const result = await deleteApiKey(keychainKey as Parameters<typeof deleteApiKey>[0]);

    // Invalidate cache
    invalidateSecureKeyCache();

    return result.success;
  } catch (error) {
    console.error(`[Config] Failed to delete secure API key: ${configKey}`, error);
    return false;
  }
}
