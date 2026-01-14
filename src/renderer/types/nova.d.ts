/**
 * Nova API type declarations for renderer
 */

export interface NovaStatus {
  status: string;
  version: string;
  isDev: boolean;
  configValid: boolean;
  missingKeys: string[];
}

/**
 * IPC Result type
 */
export interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Voice Pipeline Status
 */
export interface VoicePipelineStatus {
  state: string;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  sttProvider: string | null;
  llmProvider: string | null;
  isTTSSpeaking: boolean;
  currentTranscript: string;
  currentResponse: string;
}

/**
 * Voice Pipeline Config
 */
export interface VoicePipelineConfig {
  sttProvider?: 'deepgram' | 'vosk' | 'whisper';
  llmProvider?: 'fireworks' | 'openrouter';
  ttsEnabled?: boolean;
  bargeInEnabled?: boolean;
  systemPrompt?: string;
}

/**
 * Voice control API (legacy wake word only)
 */
export interface VoiceAPI {
  startWakeWord: () => Promise<{ success: boolean; error?: string }>;
  stopWakeWord: () => Promise<{ success: boolean; error?: string }>;
  pauseWakeWord: () => Promise<{ success: boolean; error?: string }>;
  resumeWakeWord: () => Promise<{ success: boolean; error?: string }>;
  setSensitivity: (sensitivity: number) => Promise<{ success: boolean; error?: string }>;
  getAudioDevices: () => Promise<Array<{ index: number; name: string; isDefault: boolean }>>;
  setAudioDevice: (deviceIndex: number) => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<{
    wakeWordActive: boolean;
    wakeWordPaused: boolean;
    configValid: boolean;
  }>;
}

/**
 * Full Voice Pipeline API (STT + LLM + TTS)
 */
export interface NovaVoicePipelineAPI {
  // Lifecycle
  start: (config?: Partial<VoicePipelineConfig>) => Promise<IPCResult>;
  stop: () => Promise<IPCResult>;
  shutdown: () => Promise<IPCResult>;

  // Status
  getStatus: () => Promise<IPCResult<VoicePipelineStatus>>;

  // Interaction
  triggerWake: () => Promise<IPCResult>;
  sendText: (text: string) => Promise<IPCResult>;

  // Context management
  clearHistory: () => Promise<IPCResult>;
  getContext: () => Promise<IPCResult>;
  getMetrics: () => Promise<IPCResult>;

  // Configuration
  updateConfig: (config: Partial<VoicePipelineConfig>) => Promise<IPCResult>;
  getConfig: () => Promise<IPCResult<VoicePipelineConfig | null>>;

  // Memory management
  getConversationHistory: (limit?: number) => Promise<IPCResult>;
  clearMemory: () => Promise<IPCResult>;
  getMemoryStats: () => Promise<IPCResult>;
  searchMemory: (query: {
    type?: string;
    tags?: string[];
    minImportance?: number;
    text?: string;
    limit?: number;
  }) => Promise<IPCResult>;
  getAllSessions: () => Promise<IPCResult>;

  // Budget & Cost tracking
  getBudgetStats: () => Promise<IPCResult>;
  setDailyBudget: (budget: number) => Promise<IPCResult>;
}

/**
 * Pipeline API (legacy)
 */
export interface PipelineAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<{
    state: string;
    isListening: boolean;
    isSpeaking: boolean;
    audioLevel: number;
    lastWakeWord?: unknown;
    error?: string;
  }>;
  triggerWake: () => Promise<{ success: boolean; error?: string }>;
  cancel: () => Promise<{ success: boolean; error?: string }>;
  pause: () => Promise<{ success: boolean; error?: string }>;
  resume: () => Promise<{ success: boolean; error?: string }>;
  setInputDevice: (deviceIndex: number) => Promise<{ success: boolean; error?: string }>;
  setOutputDevice: (deviceIndex: number) => Promise<{ success: boolean; error?: string }>;
  getConfig: () => Promise<Record<string, unknown> | null>;
  updateConfig: (config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  startSpeaking: () => Promise<{ success: boolean; error?: string }>;
  finishSpeaking: () => Promise<{ success: boolean; error?: string }>;
}

export interface NovaAPI {
  // App info
  getVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  isDev: () => Promise<boolean>;

  // Nova status
  getStatus: () => Promise<NovaStatus>;

  // Platform info
  platform: string;

  // Voice control (wake word only - legacy)
  voice: VoiceAPI;

  // Full Voice Pipeline (STT + LLM + TTS)
  nova: NovaVoicePipelineAPI;

  // Audio Pipeline control (legacy)
  pipeline: PipelineAPI;

  // IPC communication
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;

  // Logging helper
  log: (level: string, module: string, message: string, meta?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    nova?: NovaAPI;
  }
}
