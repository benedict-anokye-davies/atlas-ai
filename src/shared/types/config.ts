/**
 * Atlas Configuration Types
 */

/**
 * Local-only mode configuration
 * When enabled, all processing stays on device
 */
export interface LocalOnlyConfig {
  /** Enable local-only mode (no external API calls) */
  enabled: boolean;
  /** Ollama base URL for local LLM */
  ollamaBaseUrl: string;
  /** Ollama model to use */
  ollamaModel: string;
  /** Force offline STT (Vosk) even if online providers available */
  forceOfflineSTT: boolean;
  /** Force offline TTS (system/piper) even if online providers available */
  forceOfflineTTS: boolean;
  /** Show local-only indicator in UI */
  showIndicator: boolean;
}

export interface AtlasConfig {
  // API Keys
  porcupineApiKey: string;
  deepgramApiKey: string;
  cartesiaApiKey: string;  // Cartesia TTS (~90ms latency, fastest)
  elevenlabsApiKey: string;
  fireworksApiKey: string;
  openrouterApiKey: string;
  perplexityApiKey?: string;

  // TTS settings
  cartesiaVoiceId: string;  // Cartesia voice ID (default: Barbershop Man)
  elevenlabsVoiceId: string;

  // LLM settings
  fireworksModel: string;
  openrouterModel: string;

  // Local-only mode settings
  localOnly: LocalOnlyConfig;

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

  // System Audio Ducking settings
  /** Enable system audio ducking when Atlas speaks (lowers other app volumes) */
  audioDuckingEnabled: boolean;
  /** Target volume level when ducking (0-1, e.g., 0.3 = 30% of original) */
  audioDuckingLevel: number;
  /** Attack time in ms (how fast to lower volume) */
  audioDuckingAttackMs: number;
  /** Release time in ms (how fast to restore volume) */
  audioDuckingReleaseMs: number;

  // User settings
  userName: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Default local-only mode configuration
 */
export const DEFAULT_LOCAL_ONLY_CONFIG: LocalOnlyConfig = {
  enabled: false,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  forceOfflineSTT: false,
  forceOfflineTTS: false,
  showIndicator: true,
};

export const DEFAULT_CONFIG: Partial<AtlasConfig> = {
  cartesiaVoiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091', // Barbershop Man - warm male voice
  elevenlabsVoiceId: 'paul', // Warm British voice - JARVIS-like
  // GLM-4.7 Thinking: #1 open-source LLM (Jan 2026), 95% AIME, best reasoning
  fireworksModel: 'accounts/fireworks/models/glm-4p7',
  openrouterModel: 'anthropic/claude-3.5-sonnet',
  localOnly: DEFAULT_LOCAL_ONLY_CONFIG,
  nodeEnv: 'development',
  logLevel: 'debug',
  logDir: '~/.atlas/logs',
  audioSampleRate: 16000,
  audioChannels: 1,
  wakeWordSensitivity: 0.7, // Increased for better wake word detection
  vadThreshold: 0.5,
  vadSilenceDuration: 1500,
  // System Audio Ducking defaults (opt-in feature)
  audioDuckingEnabled: false,
  audioDuckingLevel: 0.3, // Reduce to 30% of original volume
  audioDuckingAttackMs: 150,
  audioDuckingReleaseMs: 500,
  userName: 'Ben',
};

export const REQUIRED_API_KEYS = [
  'porcupineApiKey',
  'deepgramApiKey',
  'fireworksApiKey',
] as const;

export const OPTIONAL_API_KEYS = ['cartesiaApiKey', 'elevenlabsApiKey', 'openrouterApiKey', 'perplexityApiKey'] as const;
