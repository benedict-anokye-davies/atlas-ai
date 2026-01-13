/**
 * Nova Configuration Manager
 * Loads and validates environment configuration
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { homedir } from 'os';
import {
  NovaConfig,
  ConfigValidationResult,
  DEFAULT_CONFIG,
  REQUIRED_API_KEYS,
  OPTIONAL_API_KEYS,
} from '../../shared/types/config';

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
 * Load configuration from environment variables
 */
function loadConfig(): NovaConfig {
  const config: NovaConfig = {
    // API Keys
    porcupineApiKey: process.env.PORCUPINE_API_KEY || '',
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    fireworksApiKey: process.env.FIREWORKS_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,

    // ElevenLabs settings
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_CONFIG.elevenlabsVoiceId!,

    // LLM settings
    fireworksModel: process.env.FIREWORKS_MODEL || DEFAULT_CONFIG.fireworksModel!,
    openrouterModel: process.env.OPENROUTER_MODEL || DEFAULT_CONFIG.openrouterModel!,

    // Environment
    nodeEnv: (process.env.NODE_ENV as NovaConfig['nodeEnv']) || 'development',
    logLevel: (process.env.LOG_LEVEL as NovaConfig['logLevel']) || 'debug',
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

    // User settings
    userName: process.env.USER_NAME || DEFAULT_CONFIG.userName!,
  };

  return config;
}

/**
 * Validate configuration
 */
function validateConfig(config: NovaConfig): ConfigValidationResult {
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
let configInstance: NovaConfig | null = null;
let validationResult: ConfigValidationResult | null = null;

/**
 * Get configuration (loads once, caches result)
 */
export function getConfig(): NovaConfig {
  if (!configInstance) {
    configInstance = loadConfig();
    validationResult = validateConfig(configInstance);

    if (!validationResult.valid) {
      console.error('[Nova Config] Missing required configuration:');
      validationResult.missing.forEach((key) => {
        console.error(`  - ${key}`);
      });
    }

    if (validationResult.warnings.length > 0) {
      console.warn('[Nova Config] Warnings:');
      validationResult.warnings.forEach((warning) => {
        console.warn(`  - ${warning}`);
      });
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
export function getConfigValue<K extends keyof NovaConfig>(key: K): NovaConfig[K] {
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
export function reloadConfig(): NovaConfig {
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

export { NovaConfig, ConfigValidationResult };
