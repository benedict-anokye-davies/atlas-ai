/**
 * Validation Constants
 * Centralized validation rules and constraints for UI components
 */

export const SETTINGS_VALIDATION = {
  /** Audio volume (0-100%) */
  AUDIO_VOLUME: {
    min: 0,
    max: 1,
    step: 0.05,
    format: (v: number) => `${Math.round(v * 100)}%`,
  },

  /** Wake word sensitivity (0-100%) */
  WAKE_WORD_SENSITIVITY: {
    min: 0,
    max: 1,
    step: 0.05,
    format: (v: number) => `${Math.round(v * 100)}%`,
  },

  /** Daily budget ($0.50 - $20.00) */
  DAILY_BUDGET: {
    min: 0.5,
    max: 20,
    step: 0.5,
    format: (v: number) => `$${v.toFixed(2)}`,
  },

  /** Particle count (1K - 50K) */
  PARTICLE_COUNT: {
    min: 1000,
    max: 50000,
    step: 1000,
    format: (v: number) => `${(v / 1000).toFixed(0)}K`,
  },

  /** Font scale (75% - 200%) */
  FONT_SCALE: {
    min: 0.75,
    max: 2.0,
    step: 0.05,
    format: (v: number) => `${Math.round(v * 100)}%`,
  },

  /** Conversation history (10 - 100 messages) */
  CONVERSATION_HISTORY: {
    min: 10,
    max: 100,
    step: 5,
    format: (v: number) => `${v} messages`,
  },

  /** Voice speed (0.5x - 2.0x) */
  VOICE_SPEED: {
    min: 0.5,
    max: 2.0,
    step: 0.1,
    format: (v: number) => `${v.toFixed(1)}x`,
  },

  /** Microphone test duration (milliseconds) */
  MIC_TEST_DURATION_MS: 5000,

  /** Copy success message display duration (milliseconds) */
  COPY_SUCCESS_DISPLAY_MS: 2000,

  /** Notification timeout (milliseconds) */
  NOTIFICATION_TIMEOUT_MS: 3000,

  /** Auto-save debounce delay (milliseconds) */
  AUTO_SAVE_DELAY_MS: 500,
} as const;

/**
 * Input validation limits
 */
export const INPUT_LIMITS = {
  /** Maximum text input length */
  MAX_TEXT_LENGTH: 10000,

  /** Maximum file upload size (bytes) */
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB

  /** Maximum API key length */
  MAX_API_KEY_LENGTH: 256,

  /** Minimum password length */
  MIN_PASSWORD_LENGTH: 8,

  /** Maximum username length */
  MAX_USERNAME_LENGTH: 50,
} as const;

/**
 * Network timeouts
 */
export const NETWORK_TIMEOUTS = {
  /** Default API request timeout */
  API_REQUEST: 30000,

  /** Retry delay for failed requests */
  RETRY_DELAY: 1000,

  /** Maximum retry delay (exponential backoff cap) */
  MAX_RETRY_DELAY: 10000,

  /** Health check timeout */
  HEALTH_CHECK: 5000,
} as const;
