/**
 * Nova Configuration Types
 */

export interface NovaConfig {
  // API Keys
  porcupineApiKey: string;
  deepgramApiKey: string;
  elevenlabsApiKey: string;
  fireworksApiKey: string;
  openrouterApiKey: string;
  perplexityApiKey?: string;

  // ElevenLabs settings
  elevenlabsVoiceId: string;

  // LLM settings
  fireworksModel: string;
  openrouterModel: string;

  // Environment
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logDir: string;

  // Audio settings
  audioSampleRate: number;
  audioChannels: number;

  // Voice settings
  wakeWordSensitivity: number;
  vadThreshold: number;
  vadSilenceDuration: number;

  // User settings
  userName: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export const DEFAULT_CONFIG: Partial<NovaConfig> = {
  elevenlabsVoiceId: 'onyx',
  fireworksModel: 'accounts/fireworks/models/deepseek-r1',
  openrouterModel: 'anthropic/claude-3.5-sonnet',
  nodeEnv: 'development',
  logLevel: 'debug',
  logDir: '~/.nova/logs',
  audioSampleRate: 16000,
  audioChannels: 1,
  wakeWordSensitivity: 0.5,
  vadThreshold: 0.5,
  vadSilenceDuration: 1500,
  userName: 'User',
};

export const REQUIRED_API_KEYS = [
  'porcupineApiKey',
  'deepgramApiKey',
  'elevenlabsApiKey',
  'fireworksApiKey',
  'openrouterApiKey',
] as const;

export const OPTIONAL_API_KEYS = [
  'perplexityApiKey',
] as const;
