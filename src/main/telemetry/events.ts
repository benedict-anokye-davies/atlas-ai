/**
 * Atlas Desktop - Telemetry Event Definitions
 * Privacy-first telemetry event types and categories
 *
 * All events are opt-in only and anonymized. No personally identifiable
 * information (PII) is collected. Users must explicitly consent to telemetry.
 */

// ============================================================================
// Event Categories
// ============================================================================

/**
 * High-level event categories for organization
 */
export enum TelemetryCategory {
  /** Application lifecycle events */
  APP = 'app',
  /** Voice pipeline events */
  VOICE = 'voice',
  /** LLM interaction events */
  LLM = 'llm',
  /** Text-to-speech events */
  TTS = 'tts',
  /** Speech-to-text events */
  STT = 'stt',
  /** UI interaction events */
  UI = 'ui',
  /** Agent tool usage events */
  AGENT = 'agent',
  /** Memory system events */
  MEMORY = 'memory',
  /** Error and crash events */
  ERROR = 'error',
  /** Performance metrics */
  PERFORMANCE = 'performance',
  /** Feature usage events */
  FEATURE = 'feature',
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Application lifecycle events
 */
export enum AppEvent {
  /** Application started */
  STARTED = 'app.started',
  /** Application ready */
  READY = 'app.ready',
  /** Application quit */
  QUIT = 'app.quit',
  /** Application crashed */
  CRASHED = 'app.crashed',
  /** Application updated */
  UPDATED = 'app.updated',
  /** Settings changed */
  SETTINGS_CHANGED = 'app.settings_changed',
  /** Window created */
  WINDOW_CREATED = 'app.window_created',
  /** Window closed */
  WINDOW_CLOSED = 'app.window_closed',
}

/**
 * Voice pipeline events
 */
export enum VoiceEvent {
  /** Wake word detected */
  WAKE_WORD_DETECTED = 'voice.wake_word_detected',
  /** Voice activity started */
  VAD_STARTED = 'voice.vad_started',
  /** Voice activity ended */
  VAD_ENDED = 'voice.vad_ended',
  /** Voice pipeline started */
  PIPELINE_STARTED = 'voice.pipeline_started',
  /** Voice pipeline completed */
  PIPELINE_COMPLETED = 'voice.pipeline_completed',
  /** Voice pipeline error */
  PIPELINE_ERROR = 'voice.pipeline_error',
  /** Audio device changed */
  AUDIO_DEVICE_CHANGED = 'voice.audio_device_changed',
}

/**
 * LLM interaction events
 */
export enum LLMEvent {
  /** LLM request started */
  REQUEST_STARTED = 'llm.request_started',
  /** LLM response received */
  RESPONSE_RECEIVED = 'llm.response_received',
  /** LLM stream started */
  STREAM_STARTED = 'llm.stream_started',
  /** LLM stream completed */
  STREAM_COMPLETED = 'llm.stream_completed',
  /** LLM error */
  ERROR = 'llm.error',
  /** LLM provider fallback */
  FALLBACK = 'llm.fallback',
  /** Tool call made */
  TOOL_CALL = 'llm.tool_call',
}

/**
 * Text-to-speech events
 */
export enum TTSEvent {
  /** TTS synthesis started */
  SYNTHESIS_STARTED = 'tts.synthesis_started',
  /** TTS synthesis completed */
  SYNTHESIS_COMPLETED = 'tts.synthesis_completed',
  /** TTS playback started */
  PLAYBACK_STARTED = 'tts.playback_started',
  /** TTS playback completed */
  PLAYBACK_COMPLETED = 'tts.playback_completed',
  /** TTS error */
  ERROR = 'tts.error',
  /** TTS provider fallback */
  FALLBACK = 'tts.fallback',
}

/**
 * Speech-to-text events
 */
export enum STTEvent {
  /** STT transcription started */
  TRANSCRIPTION_STARTED = 'stt.transcription_started',
  /** STT transcription completed */
  TRANSCRIPTION_COMPLETED = 'stt.transcription_completed',
  /** STT error */
  ERROR = 'stt.error',
  /** STT provider fallback */
  FALLBACK = 'stt.fallback',
}

/**
 * UI interaction events
 */
export enum UIEvent {
  /** Orb clicked */
  ORB_CLICKED = 'ui.orb_clicked',
  /** Settings opened */
  SETTINGS_OPENED = 'ui.settings_opened',
  /** Settings closed */
  SETTINGS_CLOSED = 'ui.settings_closed',
  /** Theme changed */
  THEME_CHANGED = 'ui.theme_changed',
  /** Keyboard shortcut used */
  SHORTCUT_USED = 'ui.shortcut_used',
  /** Tray icon clicked */
  TRAY_CLICKED = 'ui.tray_clicked',
}

/**
 * Agent tool usage events
 */
export enum AgentEvent {
  /** Tool invoked */
  TOOL_INVOKED = 'agent.tool_invoked',
  /** Tool completed */
  TOOL_COMPLETED = 'agent.tool_completed',
  /** Tool error */
  TOOL_ERROR = 'agent.tool_error',
  /** File access */
  FILE_ACCESS = 'agent.file_access',
  /** Web search */
  WEB_SEARCH = 'agent.web_search',
  /** Browser action */
  BROWSER_ACTION = 'agent.browser_action',
  /** Terminal command */
  TERMINAL_COMMAND = 'agent.terminal_command',
}

/**
 * Memory system events
 */
export enum MemoryEvent {
  /** Memory stored */
  STORED = 'memory.stored',
  /** Memory retrieved */
  RETRIEVED = 'memory.retrieved',
  /** Memory consolidated */
  CONSOLIDATED = 'memory.consolidated',
  /** Memory cleared */
  CLEARED = 'memory.cleared',
}

/**
 * Error events
 */
export enum ErrorEvent {
  /** Uncaught exception */
  UNCAUGHT_EXCEPTION = 'error.uncaught_exception',
  /** Unhandled rejection */
  UNHANDLED_REJECTION = 'error.unhandled_rejection',
  /** API error */
  API_ERROR = 'error.api_error',
  /** Network error */
  NETWORK_ERROR = 'error.network_error',
  /** Audio error */
  AUDIO_ERROR = 'error.audio_error',
}

/**
 * Performance metrics events
 */
export enum PerformanceEvent {
  /** Startup time recorded */
  STARTUP_TIME = 'performance.startup_time',
  /** Response latency recorded */
  RESPONSE_LATENCY = 'performance.response_latency',
  /** Memory usage recorded */
  MEMORY_USAGE = 'performance.memory_usage',
  /** CPU usage recorded */
  CPU_USAGE = 'performance.cpu_usage',
  /** Frame rate recorded */
  FRAME_RATE = 'performance.frame_rate',
}

/**
 * Feature usage events
 */
export enum FeatureEvent {
  /** Feature enabled */
  ENABLED = 'feature.enabled',
  /** Feature disabled */
  DISABLED = 'feature.disabled',
  /** Feature used */
  USED = 'feature.used',
}

// ============================================================================
// Event Data Interfaces
// ============================================================================

/**
 * Base telemetry event structure
 */
export interface TelemetryEvent {
  /** Event type identifier */
  type: string;
  /** Event category */
  category: TelemetryCategory;
  /** Event timestamp (ISO 8601) */
  timestamp: string;
  /** Session identifier (anonymous) */
  sessionId: string;
  /** Optional event properties (anonymized) */
  properties?: Record<string, TelemetryValue>;
  /** Optional performance metrics */
  metrics?: Record<string, number>;
}

/**
 * Allowed telemetry property value types
 */
export type TelemetryValue = string | number | boolean | null | undefined;

/**
 * App event data
 */
export interface AppEventData {
  /** Application version */
  version?: string;
  /** Platform (win32, darwin, linux) */
  platform?: string;
  /** Architecture (x64, arm64) */
  arch?: string;
  /** Electron version */
  electronVersion?: string;
  /** Is development build */
  isDev?: boolean;
  /** Session duration in ms (on quit) */
  sessionDuration?: number;
}

/**
 * Voice event data
 */
export interface VoiceEventData {
  /** Pipeline duration in ms */
  duration?: number;
  /** Audio duration in ms */
  audioDuration?: number;
  /** Provider used (deepgram, vosk, etc.) */
  provider?: string;
  /** Success status */
  success?: boolean;
  /** Error type (if any) */
  errorType?: string;
}

/**
 * LLM event data
 */
export interface LLMEventData {
  /** Provider used (fireworks, openrouter) */
  provider?: string;
  /** Model identifier (no full model string for privacy) */
  modelType?: 'deepseek' | 'claude' | 'gpt' | 'other';
  /** Time to first token in ms */
  ttft?: number;
  /** Total response time in ms */
  totalTime?: number;
  /** Number of tool calls */
  toolCallCount?: number;
  /** Success status */
  success?: boolean;
  /** Is fallback provider */
  isFallback?: boolean;
  /** Error type (if any) */
  errorType?: string;
}

/**
 * TTS event data
 */
export interface TTSEventData {
  /** Provider used (elevenlabs, offline) */
  provider?: string;
  /** Synthesis time in ms */
  synthesisTime?: number;
  /** Audio duration in ms */
  audioDuration?: number;
  /** Success status */
  success?: boolean;
  /** Is fallback provider */
  isFallback?: boolean;
  /** Error type (if any) */
  errorType?: string;
}

/**
 * STT event data
 */
export interface STTEventData {
  /** Provider used (deepgram, vosk) */
  provider?: string;
  /** Transcription time in ms */
  transcriptionTime?: number;
  /** Audio duration in ms */
  audioDuration?: number;
  /** Success status */
  success?: boolean;
  /** Is fallback provider */
  isFallback?: boolean;
  /** Error type (if any) */
  errorType?: string;
}

/**
 * Agent tool event data
 */
export interface AgentEventData {
  /** Tool name (file_read, web_search, etc.) */
  toolName?: string;
  /** Execution time in ms */
  executionTime?: number;
  /** Success status */
  success?: boolean;
  /** Error type (if any) */
  errorType?: string;
}

/**
 * Error event data
 */
export interface ErrorEventData {
  /** Error category */
  category?: string;
  /** Error type/code (no message for privacy) */
  errorType?: string;
  /** Component where error occurred */
  component?: string;
  /** Is recoverable */
  recoverable?: boolean;
  /** Was fallback used */
  fallbackUsed?: boolean;
}

/**
 * Performance event data
 */
export interface PerformanceEventData {
  /** Metric name */
  metric?: string;
  /** Metric value */
  value?: number;
  /** Unit of measurement */
  unit?: 'ms' | 'bytes' | 'percent' | 'fps' | 'count';
  /** Percentile (for latency metrics) */
  percentile?: 50 | 90 | 95 | 99;
}

/**
 * Feature usage event data
 */
export interface FeatureEventData {
  /** Feature identifier */
  featureId?: string;
  /** Feature category */
  featureCategory?: string;
  /** Usage count in session */
  usageCount?: number;
}

/**
 * Session analytics data
 */
export interface SessionAnalytics {
  /** Session identifier (anonymous) */
  sessionId: string;
  /** Session start timestamp */
  startTime: string;
  /** Session end timestamp */
  endTime?: string;
  /** Session duration in ms */
  duration?: number;
  /** Number of voice interactions */
  voiceInteractions: number;
  /** Number of LLM requests */
  llmRequests: number;
  /** Number of tool uses */
  toolUses: number;
  /** Number of errors */
  errors: number;
  /** Average response latency */
  avgResponseLatency?: number;
  /** Features used in session */
  featuresUsed: string[];
}

// ============================================================================
// Data Collection Disclosure
// ============================================================================

/**
 * Clear disclosure of what data is collected
 * This should be shown to users before enabling telemetry
 */
export const DATA_COLLECTION_DISCLOSURE = {
  title: 'Atlas Usage Analytics',
  description: `
Atlas can collect anonymous usage data to help improve the application.
All data collection is opt-in and can be disabled at any time.
`,
  whatWeCollect: [
    'Application version and platform (Windows, macOS, Linux)',
    'Feature usage counts (which features are used, not what you say)',
    'Performance metrics (response times, memory usage)',
    'Error types and frequencies (not error messages or personal data)',
    'Session duration and interaction counts',
  ],
  whatWeNeverCollect: [
    'Your voice recordings or transcriptions',
    'Your conversations with Atlas',
    'Your files, documents, or personal data',
    'Your location or IP address',
    'Any personally identifiable information',
  ],
  howWeUseIt: [
    'Identify and fix common errors',
    'Improve application performance',
    'Understand which features are most valuable',
    'Prioritize development of new features',
  ],
  dataRetention: '90 days, then automatically deleted',
  optOut: 'You can disable telemetry at any time in Settings',
} as const;

// ============================================================================
// Event Validation
// ============================================================================

/**
 * Validate that an event doesn't contain PII
 */
export function validateEventData(data: Record<string, unknown>): boolean {
  const piiPatterns = [
    // Email patterns
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    // Phone patterns
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    // IP address patterns
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    // File paths with usernames
    /[/\\]Users[/\\][^/\\]+[/\\]/i,
    /[/\\]home[/\\][^/\\]+[/\\]/i,
    // API keys or tokens
    /sk-[a-zA-Z0-9]{32,}/,
    /pk-[a-zA-Z0-9]{32,}/,
  ];

  const checkValue = (value: unknown): boolean => {
    if (typeof value === 'string') {
      for (const pattern of piiPatterns) {
        if (pattern.test(value)) {
          return false;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) {
        if (!checkValue(v)) {
          return false;
        }
      }
    }
    return true;
  };

  return checkValue(data);
}

/**
 * Sanitize event data to remove potential PII
 */
export function sanitizeEventData(
  data: Record<string, unknown>
): Record<string, TelemetryValue> {
  const sanitized: Record<string, TelemetryValue> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip complex objects
    if (typeof value === 'object' && value !== null) {
      continue;
    }

    // Skip potential PII fields
    const sensitiveKeys = [
      'email', 'phone', 'address', 'name', 'user', 'password',
      'token', 'key', 'secret', 'path', 'file', 'message', 'text',
      'query', 'search', 'content', 'body', 'data',
    ];
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      continue;
    }

    // Validate and add safe values
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      value === undefined
    ) {
      // Truncate long strings
      if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = value.substring(0, 100);
      } else {
        sanitized[key] = value as TelemetryValue;
      }
    }
  }

  return sanitized;
}
