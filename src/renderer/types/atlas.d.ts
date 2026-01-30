/**
 * Atlas API type declarations for renderer
 */

export interface AtlasStatus {
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

// =============================================================================
// CODING AGENT TYPES
// =============================================================================

/** Coding request */
export interface CodingRequest {
  prompt: string;
  files?: string[];
  continueSession?: string;
  config?: Partial<CodingAgentConfig>;
}

/** Coding response */
export interface CodingResponse {
  success: boolean;
  sessionId: string;
  message: string;
  changes: FileEdit[];
  errors: string[];
  toolCallCount: number;
  duration: number;
  summary: string;
}

/** Agent state */
export type AgentState =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting-for-tool'
  | 'error'
  | 'complete';

/** Coding session */
export interface CodingSession {
  id: string;
  startTime: number;
  endTime?: number;
  state: AgentState;
  config: CodingAgentConfig;
  filesModified: string[];
  toolCalls: ToolCallWithResult[];
  errors: string[];
  success?: boolean;
  summary?: string;
}

/** Agent config */
export interface CodingAgentConfig {
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  model: string;
  streaming: boolean;
  autoFix: boolean;
  runTests: boolean;
  requireConfirmation: boolean;
  taskTimeout: number;
  enabledTools: string[];
}

/** File edit */
export interface FileEdit {
  file: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  oldContent?: string;
  newContent?: string;
  newPath?: string;
  description?: string;
}

/** Edit result */
export interface EditResult {
  success: boolean;
  file: string;
  error?: string;
  originalContent?: string;
  diff?: string;
}

/** Tool call */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Tool result */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
  filesAffected?: string[];
}

/** Tool call with result */
export interface ToolCallWithResult extends ToolCall {
  result: ToolResult;
  startTime: number;
  endTime: number;
}

/** Voice command */
export interface VoiceCommand {
  raw: string;
  intent: string;
  confidence: number;
  entities: {
    files?: string[];
    symbols?: string[];
    queries?: string[];
    commands?: string[];
    languages?: string[];
    numbers?: number[];
    quotedStrings?: string[];
  };
  clarifications?: string[];
}

/** Coding context */
export interface CodingContext {
  project: {
    root: string;
    name?: string;
    language: string;
    framework?: string;
    packageManager?: string;
  };
  activeFiles: Array<{
    path: string;
    relativePath: string;
    language: string;
    lines?: number;
  }>;
  errors: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
  gitStatus?: {
    branch: string;
    clean: boolean;
    staged: string[];
    unstaged: string[];
  };
}

// =============================================================================
// VOICE PIPELINE TYPES
// =============================================================================

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
  /** Refresh audio device list and detect changes (036-B) */
  refreshAudioDevices: () => Promise<{
    success: boolean;
    devices: Array<{ index: number; name: string; isDefault: boolean }>;
    changed: boolean;
  }>;
  /** Start monitoring for audio device changes (036-B) */
  startDeviceMonitoring: () => Promise<{ success: boolean; error?: string }>;
  /** Stop monitoring for audio device changes (036-B) */
  stopDeviceMonitoring: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<{
    wakeWordActive: boolean;
    wakeWordPaused: boolean;
    configValid: boolean;
  }>;
}

/**
 * Full Voice Pipeline API (STT + LLM + TTS)
 */
export interface AtlasVoicePipelineAPI {
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

  // Personality management
  getPersonality: () => Promise<
    IPCResult<{
      preset: string;
      traits: {
        friendliness: number;
        formality: number;
        humor: number;
        curiosity: number;
        energy: number;
        patience: number;
      };
    }>
  >;
  setPersonalityPreset: (preset: string) => Promise<IPCResult>;
  setPersonalityTrait: (trait: string, value: number) => Promise<IPCResult>;

  // Connectivity management
  getConnectivity: () => Promise<
    IPCResult<{
      status: {
        isOnline: boolean;
        lastCheck: number;
        lastOnline: number | null;
        consecutiveFailures: number;
        latency: number | null;
      };
      services: {
        fireworks: boolean;
        deepgram: boolean;
        elevenlabs: boolean;
        internet: boolean;
      };
    }>
  >;
  isOnline: () => Promise<IPCResult<boolean>>;
  checkConnectivity: () => Promise<IPCResult<boolean>>;
  isServiceAvailable: (
    service: 'fireworks' | 'deepgram' | 'elevenlabs' | 'internet'
  ) => Promise<IPCResult<boolean>>;

  // API key management (for onboarding)
  validateApiKey: (
    keyType: 'porcupine' | 'deepgram' | 'elevenlabs' | 'fireworks' | 'openrouter',
    key: string
  ) => Promise<{ success: boolean; error?: string }>;
  setApiKey: (
    keyType: 'porcupine' | 'deepgram' | 'elevenlabs' | 'fireworks' | 'openrouter',
    key: string
  ) => Promise<{ success: boolean; error?: string }>;
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

/**
 * System API for window controls
 */
export interface SystemAPI {
  toggleDevTools: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  quit: () => Promise<void>;
  getStats?: () => Promise<
    IPCResult<{
      cpu: number;
      memory: number;
      gpu?: number;
      disk?: number;
      uptime: number;
    }>
  >;
}

/**
 * Development API (048-B)
 */
export interface DevAPI {
  getStatus: () => Promise<
    IPCResult<{
      isDev: boolean;
      devServerPort: number;
      statePersistence: boolean;
      nodeVersion: string;
      electronVersion: string;
      platform: string;
      arch: string;
    }>
  >;
  reloadMain: () => Promise<IPCResult>;
  clearState: () => Promise<IPCResult>;
  getState: () => Promise<
    IPCResult<{
      windowState: unknown;
      voiceState: unknown;
      isFreshRestart: boolean;
    }>
  >;
  toggleDevTools: () => Promise<IPCResult>;
  reloadRenderer: () => Promise<IPCResult>;
}

/**
 * Privacy settings configuration
 */
export interface PrivacySettings {
  /** Enable local-only mode (no cloud services) */
  localOnlyMode: boolean;
  /** Anonymize user data before processing */
  anonymizeData: boolean;
  /** Enable conversation logging */
  enableConversationLogging: boolean;
  /** Enable voice recording storage */
  storeVoiceRecordings: boolean;
  /** Enable analytics collection */
  enableAnalytics: boolean;
  /** Data retention period in days (0 = indefinite) */
  dataRetentionDays: number;
  /** Enable telemetry */
  enableTelemetry: boolean;
}

/**
 * Consent status for various data uses
 */
export interface ConsentStatus {
  /** Consent for voice processing */
  voiceProcessing: boolean;
  /** Consent for LLM processing */
  llmProcessing: boolean;
  /** Consent for memory storage */
  memoryStorage: boolean;
  /** Consent for analytics */
  analytics: boolean;
  /** Timestamp of last consent update */
  lastUpdated: number;
}

/**
 * Data statistics for privacy dashboard
 */
export interface DataStats {
  /** Total conversations stored */
  conversationCount: number;
  /** Total memory entries */
  memoryEntryCount: number;
  /** Total voice recordings (if stored) */
  voiceRecordingCount: number;
  /** Total data size in bytes */
  totalDataSizeBytes: number;
  /** Oldest data timestamp */
  oldestDataTimestamp: number | null;
  /** Data by type */
  dataByType: {
    conversations: number;
    memories: number;
    preferences: number;
    voiceData: number;
  };
}

/**
 * Activity log entry
 */
export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: 'voice' | 'llm' | 'memory' | 'file' | 'browser' | 'system';
  action: string;
  details?: string;
  dataAccessed?: string[];
}

/**
 * Keyboard Shortcuts API (Session 047-B)
 */
export interface ShortcutsAPI {
  /** Get current shortcut status */
  getStatus: () => Promise<
    IPCResult<
      Array<{
        action: string;
        accelerator: string;
        registered: boolean;
        scope: 'global' | 'local';
        error?: string;
      }>
    >
  >;
  /** Get shortcut configuration */
  getConfig: () => Promise<
    IPCResult<{
      bindings: Record<string, string>;
      disabled: string[];
      globalEnabled: boolean;
    }>
  >;
  /** Get all shortcut bindings */
  getBindings: () => Promise<
    IPCResult<
      Array<{
        action: string;
        accelerator: string;
        acceleratorMac?: string;
        scope: 'global' | 'local';
        description: string;
        customizable: boolean;
        isHold?: boolean;
      }>
    >
  >;
  /** Update shortcut configuration */
  updateConfig: (config: {
    bindings?: Record<string, string>;
    disabled?: string[];
    globalEnabled?: boolean;
  }) => Promise<IPCResult>;
  /** Set custom binding for an action */
  setBinding: (action: string, accelerator: string) => Promise<IPCResult>;
  /** Reset binding to default */
  resetBinding: (action: string) => Promise<IPCResult>;
  /** Enable/disable a shortcut */
  setEnabled: (action: string, enabled: boolean) => Promise<IPCResult>;
  /** Enable/disable all global shortcuts */
  setGlobalEnabled: (enabled: boolean) => Promise<IPCResult>;
}

/**
 * Privacy API for managing user privacy controls
 */
export interface PrivacyAPI {
  /** Get current privacy settings */
  getSettings: () => Promise<IPCResult<PrivacySettings>>;
  /** Update privacy settings */
  updateSettings: (settings: PrivacySettings) => Promise<IPCResult>;
  /** Get data statistics */
  getDataStats: () => Promise<IPCResult<DataStats>>;
  /** Get consent status */
  getConsentStatus: () => Promise<IPCResult<ConsentStatus>>;
  /** Update consent status */
  updateConsent: (consent: ConsentStatus) => Promise<IPCResult>;
  /** Export all personal data (GDPR compliance) */
  exportData: () => Promise<IPCResult<{ path?: string }>>;
  /** Delete all personal data */
  deleteAllData: () => Promise<IPCResult>;
  /** Delete a specific data category */
  deleteCategory: (
    category: 'conversations' | 'memories' | 'voiceData' | 'preferences'
  ) => Promise<IPCResult>;
  /** Get activity log */
  getActivityLog: (options?: {
    limit?: number;
    type?: string;
  }) => Promise<IPCResult<ActivityLogEntry[]>>;
}

/**
 * Task step configuration for creating tasks
 */
export interface TaskStepConfig {
  name: string;
  type: 'tool' | 'llm' | 'wait' | 'condition' | 'parallel' | 'loop' | 'delay';
  config: Record<string, unknown>;
  timeout?: number;
  retryCount?: number;
  errorStrategy?: 'fail' | 'skip' | 'retry' | 'rollback';
}

/**
 * Task information
 */
export interface TaskInfo {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority: string;
  progress?: number;
  currentStep?: number;
  steps?: Array<{
    name: string;
    status: string;
    result?: unknown;
    error?: string;
  }>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
}

/**
 * Task queue statistics
 */
export interface TaskQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDuration: number;
  successRate: number;
}

/**
 * Tool definition for LLM function calling
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
  duration: number;
}

/**
 * Tool summary
 */
export interface ToolSummary {
  totalTools: number;
  categories: Record<string, number>;
  toolNames: string[];
}

/**
 * Tools API (T3-022)
 */
export interface ToolsAPI {
  /** Get all tool definitions for LLM function calling */
  list: () => Promise<IPCResult<ToolDefinition[]>>;

  /** Get tool summary (categories and counts) */
  getSummary: () => Promise<IPCResult<ToolSummary>>;

  /** Get tools by category */
  getByCategory: (category: string) => Promise<IPCResult<ToolDefinition[]>>;

  /** Execute a single tool */
  execute: (
    toolName: string,
    args?: Record<string, unknown>
  ) => Promise<IPCResult<ToolExecutionResult>>;

  /** Execute multiple tools sequentially */
  executeBatch: (
    calls: Array<{ name: string; arguments?: Record<string, unknown> }>
  ) => Promise<IPCResult<ToolExecutionResult[]>>;

  /** Execute multiple tools in parallel */
  executeParallel: (
    calls: Array<{ name: string; arguments?: Record<string, unknown> }>
  ) => Promise<IPCResult<ToolExecutionResult[]>>;

  /** Check if a tool exists */
  has: (toolName: string) => Promise<IPCResult<boolean>>;

  /** Get total tool count */
  count: () => Promise<IPCResult<number>>;
}

/**
 * Task Framework API (T2 Phase 0)
 */
export interface TasksAPI {
  /** Create and enqueue a new task */
  create: (options: {
    name: string;
    description?: string;
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    steps: TaskStepConfig[];
    context?: Record<string, unknown>;
    tags?: string[];
  }) => Promise<IPCResult<TaskInfo>>;

  /** Get task by ID */
  get: (taskId: string) => Promise<IPCResult<TaskInfo | null>>;

  /** Get all queued tasks */
  getQueued: () => Promise<IPCResult<TaskInfo[]>>;

  /** Get all running tasks */
  getRunning: () => Promise<IPCResult<TaskInfo[]>>;

  /** Get recent completed tasks */
  getRecent: (limit?: number) => Promise<IPCResult<TaskInfo[]>>;

  /** Get task queue statistics */
  getStats: () => Promise<IPCResult<TaskQueueStats>>;

  /** Cancel a task */
  cancel: (taskId: string, reason?: string) => Promise<IPCResult<{ cancelled: boolean }>>;

  /** Pause a task */
  pause: (taskId: string) => Promise<IPCResult<{ paused: boolean }>>;

  /** Resume a task */
  resume: (taskId: string) => Promise<IPCResult<{ resumed: boolean }>>;

  /** Clear completed tasks */
  clearCompleted: () => Promise<IPCResult<{ cleared: number }>>;
}

/**
 * Dashboard persisted goal type
 */
export interface DashboardPersistedGoal {
  id: string;
  title: string;
  category: string;
  progress: number;
  target?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Dashboard persisted workflow type
 */
export interface DashboardPersistedWorkflow {
  id: string;
  name: string;
  status: string;
  lastRun?: number;
  nextRun?: number;
  currentStep?: number;
  totalSteps?: number;
  trigger?: string;
}

/**
 * Dashboard persisted agent type
 */
export interface DashboardPersistedAgent {
  id: string;
  name: string;
  icon?: string;
  status: string;
  taskCount: number;
  currentTask?: string;
  lastActive?: number;
}

/**
 * Dashboard persisted integration type
 */
export interface DashboardPersistedIntegration {
  id: string;
  name: string;
  icon: string;
  status: string;
  lastSync?: number;
  error?: string;
}

/**
 * Dashboard metrics
 */
export interface DashboardMetrics {
  credits: number;
  agents: number;
  workflows: number;
  tools: number;
  runsQueued: number;
  runsCompleted24h: number;
  integrations: number;
  integrationsHealthy: number;
}

/**
 * Dashboard data returned from initialize/getData
 */
export interface DashboardData {
  goals: DashboardPersistedGoal[];
  workflows: DashboardPersistedWorkflow[];
  agents: DashboardPersistedAgent[];
  integrations: DashboardPersistedIntegration[];
}

/**
 * Integration health check result
 */
export interface IntegrationHealth {
  id: string;
  status: 'connected' | 'warning' | 'disconnected' | 'unconfigured';
  latency?: number;
  error?: string;
}

/**
 * Dashboard API (Phase 12: Backend Wiring)
 */
export interface DashboardAPI {
  /** Initialize dashboard and load all data */
  initialize: () => Promise<IPCResult<DashboardData>>;

  /** Get all dashboard data */
  getData: () => Promise<IPCResult<DashboardData>>;

  /** Get all goals */
  getGoals: () => Promise<IPCResult<DashboardPersistedGoal[]>>;

  /** Save all goals */
  saveGoals: (goals: DashboardPersistedGoal[]) => Promise<IPCResult>;

  /** Save a single goal (upsert) */
  saveGoal: (goal: DashboardPersistedGoal) => Promise<IPCResult>;

  /** Delete a goal */
  deleteGoal: (goalId: string) => Promise<IPCResult<{ deleted: boolean }>>;

  /** Update goal progress */
  updateGoalProgress: (
    goalId: string,
    progress: number
  ) => Promise<IPCResult<{ updated: boolean }>>;

  /** Get all workflows */
  getWorkflows: () => Promise<IPCResult<DashboardPersistedWorkflow[]>>;

  /** Save all workflows */
  saveWorkflows: (workflows: DashboardPersistedWorkflow[]) => Promise<IPCResult>;

  /** Save a single workflow (upsert) */
  saveWorkflow: (workflow: DashboardPersistedWorkflow) => Promise<IPCResult>;

  /** Delete a workflow */
  deleteWorkflow: (workflowId: string) => Promise<IPCResult<{ deleted: boolean }>>;

  /** Get all agents */
  getAgents: () => Promise<IPCResult<DashboardPersistedAgent[]>>;

  /** Save all agents */
  saveAgents: (agents: DashboardPersistedAgent[]) => Promise<IPCResult>;

  /** Get all integrations */
  getIntegrations: () => Promise<IPCResult<DashboardPersistedIntegration[]>>;

  /** Save all integrations */
  saveIntegrations: (integrations: DashboardPersistedIntegration[]) => Promise<IPCResult>;

  /** Update a single integration's status */
  updateIntegrationStatus: (
    integrationId: string,
    status: 'connected' | 'warning' | 'disconnected' | 'unconfigured',
    error?: string
  ) => Promise<IPCResult>;

  /** Get real-time metrics */
  getMetrics: () => Promise<IPCResult<DashboardMetrics>>;

  /** Check integration health */
  checkIntegrationHealth: () => Promise<IPCResult<IntegrationHealth[]>>;
}

export interface AtlasAPI {
  // App info
  getVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  isDev: () => Promise<boolean>;

  // Atlas status
  getStatus: () => Promise<AtlasStatus>;

  // Platform info
  platform: string;

  // Voice control (wake word only - legacy)
  voice: VoiceAPI;

  // Full Voice Pipeline (STT + LLM + TTS)
  atlas: AtlasVoicePipelineAPI;

  // Audio Pipeline control (legacy)
  pipeline: PipelineAPI;

  // System controls
  system?: SystemAPI;

  // Development API (048-B)
  dev?: DevAPI;

  // Privacy API for managing user privacy controls
  privacy?: PrivacyAPI;

  // Keyboard Shortcuts API (Session 047-B)
  shortcuts: ShortcutsAPI;

  // Tools API (T3-022)
  tools?: ToolsAPI;

  // Task Framework API (T2 Phase 0)
  tasks?: TasksAPI;

  // Dashboard API (Phase 12)
  dashboard?: DashboardAPI;

  // Automation/Routines API
  automation?: {
    getSettings: () => Promise<IPCResult<unknown>>;
    updateSettings: (settings: unknown) => Promise<IPCResult>;
    getRoutines: () => Promise<IPCResult<unknown[]>>;
    getRoutine: (id: string) => Promise<IPCResult<unknown>>;
    createRoutine: (routine: unknown) => Promise<IPCResult<string>>;
    updateRoutine: (id: string, updates: unknown) => Promise<IPCResult>;
    deleteRoutine: (id: string) => Promise<IPCResult>;
    executeRoutine: (id: string) => Promise<IPCResult>;
  };

  // Spotify API
  spotify?: {
    // Authentication
    authenticate: () => Promise<IPCResult>;
    logout: () => Promise<IPCResult>;
    getStatus: () => Promise<IPCResult<{ isAuthenticated: boolean; expiresAt?: number }>>;

    // Playback
    getCurrentPlayback: () => Promise<IPCResult<unknown>>;
    play: (uri?: string, contextUri?: string) => Promise<IPCResult>;
    pause: () => Promise<IPCResult>;
    next: () => Promise<IPCResult>;
    previous: () => Promise<IPCResult>;
    seek: (positionMs: number) => Promise<IPCResult>;
    setVolume: (volumePercent: number) => Promise<IPCResult>;
    setShuffle: (state: boolean) => Promise<IPCResult>;
    setRepeat: (state: 'off' | 'context' | 'track') => Promise<IPCResult>;

    // Library
    saveTrack: (trackId: string) => Promise<IPCResult>;
    removeTrack: (trackId: string) => Promise<IPCResult>;
    isTrackSaved: (trackId: string) => Promise<IPCResult<boolean>>;

    // Search & Browse
    search: (query: string, types?: string[]) => Promise<IPCResult<unknown>>;
    getDevices: () => Promise<IPCResult<unknown[]>>;
    transferPlayback: (deviceId: string, play?: boolean) => Promise<IPCResult>;
    getPlaylists: (limit?: number) => Promise<IPCResult<unknown[]>>;
    addToQueue: (uri: string) => Promise<IPCResult>;

    // Voice command
    executeVoiceCommand: (command: string) => Promise<IPCResult>;

    // Events
    onPlaybackChanged: (callback: (data: unknown) => void) => (() => void) | undefined;
    onAuthenticated: (callback: () => void) => (() => void) | undefined;
    onLoggedOut: (callback: () => void) => (() => void) | undefined;
  };

  // Weather API
  weather?: {
    getCurrent: () => Promise<IPCResult<unknown>>;
    getForecast: () => Promise<IPCResult<unknown[]>>;
  };

  // Calendar API
  calendar?: {
    getTodayEvents: () => Promise<IPCResult<unknown[]>>;
    getUpcomingEvents: (days?: number) => Promise<IPCResult<unknown[]>>;
    createEvent: (event: unknown) => Promise<IPCResult<string>>;
  };

  // Study API
  study?: {
    getStats: () => Promise<IPCResult<unknown>>;
    getCourses: () => Promise<IPCResult<unknown[]>>;
    startSession: (courseId: string) => Promise<IPCResult>;
    endSession: () => Promise<IPCResult>;
  };

  // Quick actions
  executeAction?: (action: string, params?: unknown) => Promise<IPCResult>;

  // Proactive suggestions API
  proactive?: {
    getSuggestions: () => Promise<IPCResult<unknown[]>>;
    onSuggestion: (callback: (suggestion: unknown) => void) => (() => void) | undefined;
    recordAction: (suggestionId: string, action: 'accepted' | 'dismissed') => Promise<IPCResult>;
    snoozeSuggestion: (suggestionId: string, duration: number) => Promise<IPCResult>;
    blockSuggestionType: (suggestionId: string, source: string) => Promise<IPCResult>;
  };

  // Performance Profiler API
  performance?: {
    getData: () => Promise<
      IPCResult<{
        metrics: Record<
          string,
          { current: number; avg: number; min: number; max: number; unit: string }
        >;
        snapshots: Array<{
          timestamp: number;
          memory: { heapUsed: number; heapTotal: number; rss: number; percentUsed: number };
          cpu: { usage: number; cores: number };
          ipc: { avgLatency: number; maxLatency: number; messageCount: number; errorCount: number };
          voice?: {
            wakeWordDetection?: number;
            sttLatency?: number;
            llmFirstToken?: number;
            ttsFirstAudio?: number;
            totalResponseTime?: number;
          };
          bottlenecks: Array<{
            type: string;
            severity: string;
            description: string;
            value: number;
            threshold: number;
            recommendation: string;
          }>;
        }>;
        status: { enabled: boolean; running: boolean; uptime: number; snapshotCount: number };
      }>
    >;
    getMetrics: () => Promise<
      IPCResult<
        Record<string, { current: number; avg: number; min: number; max: number; unit: string }>
      >
    >;
    getMetricHistory: (
      metricName: string,
      limit?: number
    ) => Promise<IPCResult<Array<{ timestamp: number; value: number }>>>;
    getSnapshots: (limit?: number) => Promise<IPCResult<unknown[]>>;
    start: () => Promise<IPCResult>;
    stop: () => Promise<IPCResult>;
    recordMetric: (name: string, value: number, unit?: string) => Promise<IPCResult>;
    getStartupTiming: () => Promise<
      IPCResult<{
        timeline: Array<{
          phase: string;
          timestamp: number;
          type: 'start' | 'end';
          metadata?: Record<string, unknown>;
        }>;
        phases: Array<{
          phase: string;
          startMs: number;
          durationMs: number;
          metadata?: Record<string, unknown>;
        }>;
        totalDurationMs: number;
        isWarmStart: boolean;
        recommendations: string[];
        memoryUsage?: {
          heapUsed: number;
          heapTotal: number;
          external: number;
          rss: number;
        };
        slowModules: Array<{
          modulePath: string;
          loadTimeMs: number;
          size?: number;
        }>;
        phaseSummaries: Array<{
          phase: string;
          durationMs: number;
          percentOfTotal: number;
          status: 'fast' | 'acceptable' | 'slow' | 'critical';
        }>;
      }>
    >;
  };

  // Internationalization API
  i18n?: {
    getState: () => Promise<IPCResult<{ currentLocale: string }>>;
    setLocale: (locale: string) => Promise<IPCResult>;
  };

  // Coding Agent API
  coding?: {
    /** Execute a coding task with the autonomous agent */
    execute: (request: CodingRequest) => Promise<IPCResult<CodingResponse>>;
    /** Execute with streaming results */
    executeStream: (request: CodingRequest) => Promise<IPCResult>;
    /** Process a voice command for coding */
    voiceCommand: (
      text: string
    ) => Promise<IPCResult<{ command: VoiceCommand; response: CodingResponse }>>;
    /** Parse voice command without executing */
    parseVoice: (
      text: string
    ) => Promise<IPCResult<{ prompt: string; command: VoiceCommand } | null>>;
    /** Get current coding session */
    getSession: () => Promise<IPCResult<CodingSession | null>>;
    /** Abort current coding task */
    abort: () => Promise<IPCResult>;
    /** Update agent configuration */
    updateConfig: (config: Partial<CodingAgentConfig>) => Promise<IPCResult<CodingAgentConfig>>;
    /** Get agent configuration */
    getConfig: () => Promise<IPCResult<CodingAgentConfig>>;
    /** Get project context */
    getContext: (request?: { files?: string[] }) => Promise<IPCResult<CodingContext>>;
    /** Get edit history */
    getEditHistory: () => Promise<IPCResult<EditResult[]>>;
    /** Rollback edits */
    rollback: (count?: number) => Promise<IPCResult<{ rolledBack: number }>>;
  };

  // IPC communication
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;

  // Logging helper
  log: (level: string, module: string, message: string, meta?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    atlas?: AtlasAPI;
    nova?: AtlasAPI; // Backward compatibility alias
  }
}

// CSS Module declarations
// This allows importing .module.css files in TypeScript

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.sass' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.styl' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
