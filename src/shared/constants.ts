/**
 * Atlas Desktop - Shared Constants
 * Centralized configuration values to avoid magic numbers and hardcoded URLs
 */

// ============================================================================
// Network URLs
// ============================================================================

/**
 * Default URLs for local services
 */
export const LOCAL_SERVICE_URLS = {
  /** Ollama LLM server */
  OLLAMA_BASE: 'http://localhost:11434',
  OLLAMA_API: 'http://localhost:11434/v1',
  OLLAMA_TAGS: 'http://localhost:11434/api/tags',
  
  /** Faster-Whisper STT server */
  WHISPER_SERVER: 'http://localhost:8765',
  WHISPER_WEBSOCKET: 'ws://localhost:8765/nova-voice',
} as const;

// ============================================================================
// Timeouts and Intervals (in milliseconds)
// ============================================================================

/**
 * API and network timeouts
 */
export const TIMEOUTS = {
  /** Default API request timeout */
  API_REQUEST: 30000,
  /** Health check timeout */
  HEALTH_CHECK: 5000,
  /** Connection retry delay */
  RETRY_DELAY: 1000,
  /** Maximum retry delay (exponential backoff cap) */
  MAX_RETRY_DELAY: 30000,
  /** Circuit breaker reset timeout */
  CIRCUIT_BREAKER_RESET: 30000,
  /** WebSocket ping interval */
  WEBSOCKET_PING: 30000,
  /** IPC response timeout */
  IPC_TIMEOUT: 10000,
} as const;

/**
 * Voice pipeline timings
 */
export const VOICE_TIMINGS = {
  /** Silence duration before ending utterance (VAD) */
  VAD_SILENCE_DURATION: 1500,
  /** Early processing delay after sentence end */
  EARLY_PROCESSING_DELAY: 500,
  /** Wake word detection cooldown */
  WAKE_WORD_COOLDOWN: 1000,
  /** Audio chunk processing interval */
  AUDIO_CHUNK_INTERVAL: 100,
  /** TTS streaming chunk size (ms) */
  TTS_CHUNK_DURATION: 250,
} as const;

/**
 * Polling and update intervals
 */
export const INTERVALS = {
  /** Health check polling */
  HEALTH_CHECK: 60000,
  /** Memory optimizer check */
  MEMORY_CHECK: 30000,
  /** Activity tracker sampling */
  ACTIVITY_SAMPLE: 60000,
  /** Context builder update */
  CONTEXT_UPDATE: 5000,
  /** Auto-save interval */
  AUTO_SAVE: 300000,
  /** Cleanup stale data */
  CLEANUP: 3600000,
} as const;

// ============================================================================
// Limits and Thresholds
// ============================================================================

/**
 * Buffer and queue limits
 */
export const LIMITS = {
  /** Maximum command length for terminal execution */
  MAX_COMMAND_LENGTH: 4096,
  /** Maximum file size for reading (10MB) */
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  /** Maximum conversation history entries */
  MAX_HISTORY_ENTRIES: 100,
  /** Maximum retry attempts */
  MAX_RETRY_ATTEMPTS: 3,
  /** Maximum concurrent API requests */
  MAX_CONCURRENT_REQUESTS: 5,
  /** Maximum error notifications to keep */
  MAX_ERROR_NOTIFICATIONS: 100,
  /** Maximum log entries in memory */
  MAX_LOG_ENTRIES: 1000,
} as const;

/**
 * Audio processing thresholds
 */
export const AUDIO_THRESHOLDS = {
  /** Default VAD threshold (0-1) */
  VAD_DEFAULT: 0.5,
  /** Wake word sensitivity (0-1) */
  WAKE_WORD_SENSITIVITY: 0.7,
  /** Noise reduction threshold */
  NOISE_REDUCTION: 0.3,
  /** Audio ducking level (0-1) */
  AUDIO_DUCKING_LEVEL: 0.3,
} as const;

/**
 * Performance thresholds
 */
export const PERFORMANCE_THRESHOLDS = {
  /** Memory warning threshold (MB) */
  MEMORY_WARNING_MB: 400,
  /** Memory critical threshold (MB) */
  MEMORY_CRITICAL_MB: 500,
  /** CPU warning threshold (%) */
  CPU_WARNING_PERCENT: 80,
  /** Target frame rate */
  TARGET_FPS: 60,
} as const;

// ============================================================================
// Default Configuration Values
// ============================================================================

/**
 * Default audio settings
 */
export const AUDIO_DEFAULTS = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
  BUFFER_SIZE: 4096,
} as const;

/**
 * Default UI settings
 */
export const UI_DEFAULTS = {
  /** Animation duration (ms) */
  ANIMATION_DURATION: 300,
  /** Debounce delay for search (ms) */
  SEARCH_DEBOUNCE: 300,
  /** Toast notification duration (ms) */
  TOAST_DURATION: 5000,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get Ollama base URL from config or default
 */
export function getOllamaBaseUrl(configUrl?: string): string {
  return configUrl || LOCAL_SERVICE_URLS.OLLAMA_BASE;
}

/**
 * Get Whisper server URL from config or default
 */
export function getWhisperServerUrl(configUrl?: string): string {
  return configUrl || LOCAL_SERVICE_URLS.WHISPER_SERVER;
}
