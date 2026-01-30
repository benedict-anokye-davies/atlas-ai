/**
 * Atlas Desktop - Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { FullVoicePipelineStatus } from '../shared/types/voice';

/**
 * IPC Result type
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Voice Pipeline Config
 */
interface VoicePipelineConfig {
  sttProvider?: 'deepgram' | 'vosk' | 'whisper';
  llmProvider?: 'fireworks' | 'openrouter';
  ttsEnabled?: boolean;
  bargeInEnabled?: boolean;
  systemPrompt?: string;
}

/**
 * Atlas API exposed to renderer
 */
const atlasAPI = {
  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getAppPath: (): Promise<string> => ipcRenderer.invoke('get-app-path'),
  isDev: (): Promise<boolean> => ipcRenderer.invoke('is-dev'),

  // Atlas status
  getStatus: (): Promise<{
    status: string;
    version: string;
    isDev: boolean;
  }> => ipcRenderer.invoke('get-atlas-status'),

  // Platform info
  platform: process.platform,

  // Voice control (wake word only - legacy)
  voice: {
    startWakeWord: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:start-wake-word'),
    stopWakeWord: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:stop-wake-word'),
    pauseWakeWord: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:pause-wake-word'),
    resumeWakeWord: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:resume-wake-word'),
    setSensitivity: (sensitivity: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:set-sensitivity', sensitivity),
    getAudioDevices: (): Promise<Array<{ index: number; name: string; isDefault: boolean }>> =>
      ipcRenderer.invoke('voice:get-audio-devices'),
    setAudioDevice: (deviceIndex: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:set-audio-device', deviceIndex),
    refreshAudioDevices: (): Promise<{
      success: boolean;
      devices: Array<{ index: number; name: string; isDefault: boolean }>;
      changed: boolean;
    }> => ipcRenderer.invoke('voice:refresh-audio-devices'),
    startDeviceMonitoring: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:start-device-monitoring'),
    stopDeviceMonitoring: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:stop-device-monitoring'),
    getStatus: (): Promise<{
      wakeWordActive: boolean;
      wakeWordPaused: boolean;
      configValid: boolean;
    }> => ipcRenderer.invoke('voice:get-status'),
  },

  // Full Voice Pipeline (STT + LLM + TTS)
  atlas: {
    // Lifecycle
    start: (config?: Partial<VoicePipelineConfig>): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:start', config),
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:stop'),
    shutdown: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:shutdown'),

    // Status
    getStatus: (): Promise<IPCResult<FullVoicePipelineStatus>> =>
      ipcRenderer.invoke('atlas:get-status'),

    // Interaction
    triggerWake: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:trigger-wake'),
    sendText: (text: string, options?: { skipTTS?: boolean }): Promise<IPCResult> => ipcRenderer.invoke('atlas:send-text', text, options),

    // Context management
    clearHistory: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:clear-history'),
    getContext: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:get-context'),
    getMetrics: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:get-metrics'),

    // Configuration
    updateConfig: (config: Partial<VoicePipelineConfig>): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:update-config', config),
    getConfig: (): Promise<IPCResult<VoicePipelineConfig | null>> =>
      ipcRenderer.invoke('atlas:get-config'),

    // Memory management
    getConversationHistory: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:get-conversation-history', limit),
    clearMemory: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:clear-memory'),
    getMemoryStats: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:get-memory-stats'),
    searchMemory: (query: {
      type?: string;
      tags?: string[];
      minImportance?: number;
      text?: string;
      limit?: number;
    }): Promise<IPCResult> => ipcRenderer.invoke('atlas:search-memory', query),
    getAllSessions: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:get-all-sessions'),

    // Memory Forgetting (Selective deletion)
    forget: (options: {
      memoryIds?: string[];
      contentPattern?: string;
      tags?: string[];
      dateRange?: { start: number; end: number };
      force?: boolean;
      reason?: string;
      permanent?: boolean;
    }): Promise<
      IPCResult<{
        processed: number;
        decayed: number;
        deleted: number;
        consolidated: number;
        protected: number;
        durationMs: number;
        results: Array<{
          memoryId: string;
          action:
          | 'kept'
          | 'decayed'
          | 'flagged_for_deletion'
          | 'flagged_for_consolidation'
          | 'protected';
          reason: string;
        }>;
        errors: Array<{ memoryId: string; error: string }>;
      }>
    > => ipcRenderer.invoke('memory:forget', options),
    getForgettingStats: (): Promise<
      IPCResult<{
        accessHistorySize: number;
        pendingGDPRRequests: number;
        isProcessing: boolean;
        lastActivityAge: number;
      }>
    > => ipcRenderer.invoke('memory:get-forgetting-stats'),
    processDecay: (reason?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('memory:process-decay', reason),
    recordAccess: (memoryId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('memory:record-access', memoryId),

    // GDPR Compliance
    gdprDelete: (request: {
      type: 'specific' | 'all' | 'date_range' | 'category';
      memoryIds?: string[];
      dateRange?: { start: number; end: number };
      categories?: string[];
      includeVectorStore?: boolean;
      includeConversations?: boolean;
    }): Promise<IPCResult<string>> => ipcRenderer.invoke('memory:gdpr-delete', request),
    getGdprStatus: (
      requestId: string
    ): Promise<
      IPCResult<{
        requestId: string;
        requestedAt: number;
        type: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        completedAt?: number;
        deletedCount?: number;
        error?: string;
        certificateHash?: string;
      } | null>
    > => ipcRenderer.invoke('memory:get-gdpr-status', requestId),
    exportGdprAudit: (): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('memory:export-gdpr-audit'),

    // Forgetting Manager Control
    startForgetting: (): Promise<IPCResult> => ipcRenderer.invoke('memory:start-forgetting'),
    stopForgetting: (): Promise<IPCResult> => ipcRenderer.invoke('memory:stop-forgetting'),

    // Budget & Cost tracking
    getBudgetStats: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:get-budget-stats'),
    setDailyBudget: (budget: number): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:set-daily-budget', budget),

    // Personality management
    getPersonality: (): Promise<
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
    > => ipcRenderer.invoke('atlas:get-personality'),
    setPersonalityPreset: (preset: string): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:set-personality-preset', preset),
    setPersonalityTrait: (trait: string, value: number): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:set-personality-trait', trait, value),

    // Connectivity management
    getConnectivity: (): Promise<
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
    > => ipcRenderer.invoke('atlas:get-connectivity'),
    isOnline: (): Promise<IPCResult<boolean>> => ipcRenderer.invoke('atlas:is-online'),
    checkConnectivity: (): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('atlas:check-connectivity'),
    isServiceAvailable: (
      service: 'fireworks' | 'deepgram' | 'elevenlabs' | 'internet'
    ): Promise<IPCResult<boolean>> => ipcRenderer.invoke('atlas:is-service-available', service),

    // GPU detection and capabilities
    setGPUInfo: (webglInfo: {
      vendor: string;
      renderer: string;
      unmaskedVendor?: string;
      unmaskedRenderer?: string;
      version?: 1 | 2;
      maxTextureSize?: number;
      maxViewportDims?: [number, number];
      maxRenderbufferSize?: number;
      maxVertexAttribs?: number;
      maxVertexUniformVectors?: number;
      maxVaryingVectors?: number;
      maxFragmentUniformVectors?: number;
      maxTextureImageUnits?: number;
      maxVertexTextureImageUnits?: number;
      maxCombinedTextureImageUnits?: number;
      extensions?: string[];
      antialias?: boolean;
      floatTextures?: boolean;
      instancedArrays?: boolean;
      vertexArrayObjects?: boolean;
    }): Promise<
      IPCResult<{
        gpu: {
          vendor: string;
          renderer: string;
          tier: 'high' | 'medium' | 'low' | 'integrated';
          estimatedVRAM: number;
        };
        config: {
          particleCount: number;
          maxDpr: number;
          enablePostProcessing: boolean;
          enableAntialias: boolean;
          shadowQuality: 0 | 1 | 2 | 3;
          bloomIntensity: number;
          targetFps: number;
          maxAnimations: number;
        };
        success: boolean;
        error?: string;
      }>
    > => ipcRenderer.invoke('atlas:set-gpu-info', webglInfo),
    getGPUCapabilities: (): Promise<
      IPCResult<{
        gpu: {
          vendor: string;
          renderer: string;
          tier: 'high' | 'medium' | 'low' | 'integrated';
          estimatedVRAM: number;
        };
        config: {
          particleCount: number;
          maxDpr: number;
          enablePostProcessing: boolean;
          enableAntialias: boolean;
          shadowQuality: 0 | 1 | 2 | 3;
          bloomIntensity: number;
          targetFps: number;
          maxAnimations: number;
        };
        success: boolean;
        error?: string;
      } | null>
    > => ipcRenderer.invoke('atlas:get-gpu-capabilities'),
    getRecommendedParticles: (): Promise<IPCResult<number>> =>
      ipcRenderer.invoke('atlas:get-recommended-particles'),
    getRenderConfig: (): Promise<
      IPCResult<{
        particleCount: number;
        maxDpr: number;
        enablePostProcessing: boolean;
        enableAntialias: boolean;
        shadowQuality: 0 | 1 | 2 | 3;
        bloomIntensity: number;
        targetFps: number;
        maxAnimations: number;
      }>
    > => ipcRenderer.invoke('atlas:get-render-config'),

    // Smart Provider management
    getCurrentProviders: (): Promise<
      IPCResult<{
        stt: 'deepgram' | 'vosk' | 'whisper' | null;
        tts: 'elevenlabs' | 'piper' | 'system' | null;
        llm: 'fireworks' | 'openrouter' | 'local' | null;
      }>
    > => ipcRenderer.invoke('atlas:get-current-providers'),
    forceSTTProvider: (provider: 'deepgram' | 'vosk' | 'whisper'): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:force-stt-provider', provider),
    forceTTSProvider: (provider: 'elevenlabs' | 'piper' | 'system'): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:force-tts-provider', provider),
    forceLLMProvider: (provider: 'fireworks' | 'openrouter' | 'local'): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:force-llm-provider', provider),
    reselectProviders: (): Promise<
      IPCResult<{
        stt: 'deepgram' | 'vosk' | 'whisper' | null;
        tts: 'elevenlabs' | 'piper' | 'system' | null;
        llm: 'fireworks' | 'openrouter' | 'local' | null;
      }>
    > => ipcRenderer.invoke('atlas:reselect-providers'),

    // Response cache management
    getCacheStats: (): Promise<
      IPCResult<{
        hits: number;
        misses: number;
        hitRate: number;
        entries: number;
      } | null>
    > => ipcRenderer.invoke('atlas:get-cache-stats'),
    clearCache: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:clear-cache'),
    setCacheEnabled: (enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('atlas:set-cache-enabled', enabled),
    isCacheEnabled: (): Promise<IPCResult<boolean>> => ipcRenderer.invoke('atlas:is-cache-enabled'),
  },

  // Auto Update API
  updater: {
    // Get current update state
    getState: (): Promise<
      IPCResult<{
        status:
        | 'idle'
        | 'checking'
        | 'available'
        | 'not-available'
        | 'downloading'
        | 'downloaded'
        | 'error';
        updateInfo: {
          version: string;
          releaseNotes?: string | null;
          releaseName?: string | null;
          releaseDate: string;
        } | null;
        progress: {
          total: number;
          transferred: number;
          percent: number;
          bytesPerSecond: number;
          eta?: number;
        } | null;
        error: {
          message: string;
          code?: string;
          recoverable: boolean;
        } | null;
        lastCheck: string | null;
        readyToInstall: boolean;
        currentVersion: string;
      }>
    > => ipcRenderer.invoke('updater:get-state'),

    // Check for updates
    checkForUpdates: (): Promise<
      IPCResult<{
        version: string;
        releaseNotes?: string | null;
        releaseName?: string | null;
        releaseDate: string;
      } | null>
    > => ipcRenderer.invoke('updater:check-for-updates'),

    // Download update (if not auto-downloading)
    downloadUpdate: (): Promise<IPCResult> => ipcRenderer.invoke('updater:download-update'),

    // Install update (quit and install)
    installUpdate: (silent?: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('updater:install-update', silent),

    // Schedule update for next restart
    installOnQuit: (): Promise<IPCResult> => ipcRenderer.invoke('updater:install-on-quit'),

    // Cancel ongoing download
    cancelDownload: (): Promise<IPCResult> => ipcRenderer.invoke('updater:cancel-download'),

    // Get updater configuration
    getConfig: (): Promise<
      IPCResult<{
        enabled: boolean;
        checkInterval: number;
        autoDownload: boolean;
        autoInstallOnQuit: boolean;
        allowDowngrade: boolean;
        allowPrerelease: boolean;
        channel: 'stable' | 'beta' | 'alpha';
      }>
    > => ipcRenderer.invoke('updater:get-config'),

    // Update configuration
    updateConfig: (config: {
      enabled?: boolean;
      checkInterval?: number;
      autoDownload?: boolean;
      autoInstallOnQuit?: boolean;
      allowDowngrade?: boolean;
      allowPrerelease?: boolean;
      channel?: 'stable' | 'beta' | 'alpha';
    }): Promise<IPCResult> => ipcRenderer.invoke('updater:update-config', config),

    // Get rollback information
    getRollbackInfo: (): Promise<
      IPCResult<{
        previousVersion: string;
        backupPath: string;
        createdAt: string;
        available: boolean;
      } | null>
    > => ipcRenderer.invoke('updater:get-rollback-info'),

    // Perform rollback
    rollback: (): Promise<IPCResult<{ rolledBack: boolean }>> =>
      ipcRenderer.invoke('updater:rollback'),
  },

  // Development API (048-A: HMR for main process)
  dev: {
    // Get development status
    getStatus: (): Promise<
      IPCResult<{
        isDev: boolean;
        devServerPort: number;
        statePersistence: boolean;
        nodeVersion: string;
        electronVersion: string;
        platform: string;
        arch: string;
      }>
    > => ipcRenderer.invoke('dev:get-status'),

    // Force reload main process
    reloadMain: (): Promise<IPCResult> => ipcRenderer.invoke('dev:reload-main'),

    // Clear development state
    clearState: (): Promise<IPCResult> => ipcRenderer.invoke('dev:clear-state'),

    // Get development state
    getState: (): Promise<
      IPCResult<{
        windowState: unknown;
        voiceState: unknown;
        isFreshRestart: boolean;
      }>
    > => ipcRenderer.invoke('dev:get-state'),

    // Toggle DevTools
    toggleDevTools: (): Promise<IPCResult> => ipcRenderer.invoke('dev:toggle-devtools'),

    // Reload renderer
    reloadRenderer: (): Promise<IPCResult> => ipcRenderer.invoke('dev:reload-renderer'),
  },

  // Notification API
  notifications: {
    // Create a notification
    create: (options: {
      type: 'info' | 'success' | 'warning' | 'error';
      title: string;
      message?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      timeout?: number;
      dismissible?: boolean;
      actions?: Array<{ label: string; primary?: boolean; dismissOnClick?: boolean }>;
      source?: string;
      icon?: string;
      showSystemNotification?: boolean;
      playSound?: boolean;
    }): Promise<IPCResult<string>> => ipcRenderer.invoke('notification:create', options),

    // Dismiss a notification
    dismiss: (id: string): Promise<IPCResult> => ipcRenderer.invoke('notification:dismiss', id),

    // Dismiss all notifications
    dismissAll: (): Promise<IPCResult> => ipcRenderer.invoke('notification:dismiss-all'),

    // Get notification history
    getHistory: (): Promise<
      IPCResult<
        Array<{
          id: string;
          type: 'info' | 'success' | 'warning' | 'error';
          title: string;
          message?: string;
          priority: 'low' | 'normal' | 'high' | 'urgent';
          timestamp: number;
          read: boolean;
          dismissible: boolean;
        }>
      >
    > => ipcRenderer.invoke('notification:get-history'),

    // Clear notification history
    clearHistory: (): Promise<IPCResult> => ipcRenderer.invoke('notification:clear-history'),

    // Get notification settings
    getSettings: (): Promise<
      IPCResult<{
        maxVisibleToasts: number;
        maxHistorySize: number;
        soundEnabled: boolean;
        systemNotificationsEnabled: boolean;
        toastPosition: string;
        doNotDisturb: boolean;
      }>
    > => ipcRenderer.invoke('notification:get-settings'),

    // Update notification settings
    updateSettings: (settings: {
      maxVisibleToasts?: number;
      maxHistorySize?: number;
      soundEnabled?: boolean;
      systemNotificationsEnabled?: boolean;
      toastPosition?: string;
      doNotDisturb?: boolean;
    }): Promise<IPCResult> => ipcRenderer.invoke('notification:update-settings', settings),

    // Quick notification helpers
    info: (title: string, message?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('notification:info', title, message),
    success: (title: string, message?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('notification:success', title, message),
    warning: (title: string, message?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('notification:warning', title, message),
    error: (title: string, message?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('notification:error', title, message),
  },

  // Keyboard Shortcuts API
  shortcuts: {
    // Get current shortcut status
    getStatus: (): Promise<
      IPCResult<
        Array<{
          action: string;
          accelerator: string;
          registered: boolean;
          scope: 'global' | 'local';
          error?: string;
        }>
      >
    > => ipcRenderer.invoke('shortcuts:get-status'),

    // Get shortcut configuration
    getConfig: (): Promise<
      IPCResult<{
        bindings: Record<string, string>;
        disabled: string[];
        globalEnabled: boolean;
      }>
    > => ipcRenderer.invoke('shortcuts:get-config'),

    // Get all shortcut bindings
    getBindings: (): Promise<
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
    > => ipcRenderer.invoke('shortcuts:get-bindings'),

    // Update shortcut configuration
    updateConfig: (config: {
      bindings?: Record<string, string>;
      disabled?: string[];
      globalEnabled?: boolean;
    }): Promise<IPCResult> => ipcRenderer.invoke('shortcuts:update-config', config),

    // Set custom binding for an action
    setBinding: (action: string, accelerator: string): Promise<IPCResult> =>
      ipcRenderer.invoke('shortcuts:set-binding', action, accelerator),

    // Reset binding to default
    resetBinding: (action: string): Promise<IPCResult> =>
      ipcRenderer.invoke('shortcuts:reset-binding', action),

    // Enable/disable a shortcut
    setEnabled: (action: string, enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('shortcuts:set-enabled', action, enabled),

    // Enable/disable all global shortcuts
    setGlobalEnabled: (enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('shortcuts:set-global-enabled', enabled),
  },

  // 045-A: Background Research API
  research: {
    // Get research queue status
    getQueue: (): Promise<IPCResult<{ size: number; topics: string[] }>> =>
      ipcRenderer.invoke('research:get-queue'),

    // Get current research state
    getState: (): Promise<IPCResult<'idle' | 'researching' | 'paused' | 'disabled'>> =>
      ipcRenderer.invoke('research:get-state'),

    // Queue a topic for research
    queueTopic: (
      query: string,
      priority?: 'high' | 'medium' | 'low'
    ): Promise<IPCResult<{ queued: boolean; topicId: string }>> =>
      ipcRenderer.invoke('research:queue-topic', query, priority),

    // Get research result for a query
    getResult: (
      query: string
    ): Promise<
      IPCResult<{
        id: string;
        topicId: string;
        query: string;
        summary: string;
        facts: string[];
        sources: string[];
        confidence: number;
        researchedAt: number;
        expiresAt: number;
      } | null>
    > => ipcRenderer.invoke('research:get-result', query),

    // Get all research results
    getAllResults: (): Promise<
      IPCResult<
        Array<{
          id: string;
          topicId: string;
          query: string;
          summary: string;
          facts: string[];
          sources: string[];
          confidence: number;
          researchedAt: number;
          expiresAt: number;
        }>
      >
    > => ipcRenderer.invoke('research:get-all-results'),

    // Get research context for a query
    getContext: (query: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('research:get-context', query),

    // Clear research queue
    clearQueue: (): Promise<IPCResult> => ipcRenderer.invoke('research:clear-queue'),

    // Clear research results
    clearResults: (): Promise<IPCResult> => ipcRenderer.invoke('research:clear-results'),

    // Notify activity (pauses research if enabled)
    notifyActivity: (): Promise<IPCResult> => ipcRenderer.invoke('research:notify-activity'),

    // Enable/disable research
    setEnabled: (enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('research:set-enabled', enabled),
  },

  // 045-C: Task Scheduler API
  scheduler: {
    // Create a task
    createTask: (
      title: string,
      scheduledAt: number,
      options?: {
        description?: string;
        priority?: 'urgent' | 'high' | 'medium' | 'low';
        recurrence?: { type: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom' };
        reminders?: Array<{ minutesBefore: number; sent: boolean }>;
        category?: string;
        tags?: string[];
      }
    ): Promise<
      IPCResult<{
        id: string;
        title: string;
        description?: string;
        priority: 'urgent' | 'high' | 'medium' | 'low';
        scheduledAt: number;
        completed: boolean;
        createdAt: number;
        updatedAt: number;
      }>
    > => ipcRenderer.invoke('scheduler:create-task', title, scheduledAt, options),

    // Create a reminder (quick task)
    createReminder: (
      title: string,
      inMinutes: number,
      description?: string
    ): Promise<
      IPCResult<{
        id: string;
        title: string;
        description?: string;
        priority: 'urgent' | 'high' | 'medium' | 'low';
        scheduledAt: number;
        completed: boolean;
        createdAt: number;
        updatedAt: number;
      }>
    > => ipcRenderer.invoke('scheduler:create-reminder', title, inMinutes, description),

    // Get all tasks
    getAllTasks: (): Promise<
      IPCResult<
        Array<{
          id: string;
          title: string;
          description?: string;
          priority: 'urgent' | 'high' | 'medium' | 'low';
          scheduledAt: number;
          completed: boolean;
          completedAt?: number;
          createdAt: number;
          updatedAt: number;
        }>
      >
    > => ipcRenderer.invoke('scheduler:get-all-tasks'),

    // Get pending tasks
    getPendingTasks: (): Promise<
      IPCResult<
        Array<{
          id: string;
          title: string;
          description?: string;
          priority: 'urgent' | 'high' | 'medium' | 'low';
          scheduledAt: number;
          completed: boolean;
          createdAt: number;
          updatedAt: number;
        }>
      >
    > => ipcRenderer.invoke('scheduler:get-pending-tasks'),

    // Get due tasks
    getDueTasks: (): Promise<
      IPCResult<
        Array<{
          id: string;
          title: string;
          description?: string;
          priority: 'urgent' | 'high' | 'medium' | 'low';
          scheduledAt: number;
          completed: boolean;
          createdAt: number;
          updatedAt: number;
        }>
      >
    > => ipcRenderer.invoke('scheduler:get-due-tasks'),

    // Get upcoming tasks
    getUpcomingTasks: (
      withinMs: number
    ): Promise<
      IPCResult<
        Array<{
          id: string;
          title: string;
          description?: string;
          priority: 'urgent' | 'high' | 'medium' | 'low';
          scheduledAt: number;
          completed: boolean;
          createdAt: number;
          updatedAt: number;
        }>
      >
    > => ipcRenderer.invoke('scheduler:get-upcoming-tasks', withinMs),

    // Complete a task
    completeTask: (
      id: string
    ): Promise<
      IPCResult<{
        id: string;
        title: string;
        completed: boolean;
        completedAt?: number;
      } | null>
    > => ipcRenderer.invoke('scheduler:complete-task', id),

    // Delete a task
    deleteTask: (id: string): Promise<IPCResult> => ipcRenderer.invoke('scheduler:delete-task', id),

    // Snooze a task
    snoozeTask: (
      id: string,
      minutes: number
    ): Promise<
      IPCResult<{
        id: string;
        title: string;
        scheduledAt: number;
      } | null>
    > => ipcRenderer.invoke('scheduler:snooze-task', id, minutes),

    // Get scheduler statistics
    getStats: (): Promise<
      IPCResult<{
        total: number;
        pending: number;
        due: number;
        overdue: number;
        completed: number;
        byPriority: Record<string, number>;
        byCategory: Record<string, number>;
      }>
    > => ipcRenderer.invoke('scheduler:get-stats'),

    // Clear completed tasks
    clearCompleted: (): Promise<IPCResult<number>> =>
      ipcRenderer.invoke('scheduler:clear-completed'),
  },

  // Performance Profiler API
  performance: {
    // Get complete performance data (metrics, snapshots, status)
    getData: (): Promise<
      IPCResult<{
        metrics: Record<
          string,
          { current: number; avg: number; min: number; max: number; unit: string }
        >;
        snapshots: Array<{
          timestamp: number;
          memory: {
            heapUsed: number;
            heapTotal: number;
            rss: number;
            percentUsed: number;
          };
          cpu: { usage: number; cores: number };
          ipc: {
            avgLatency: number;
            maxLatency: number;
            messageCount: number;
            errorCount: number;
          };
          voice?: {
            wakeWordDetection?: number;
            sttLatency?: number;
            llmFirstToken?: number;
            ttsFirstAudio?: number;
            totalResponseTime?: number;
          };
          bottlenecks: Array<{
            type: string;
            severity: 'low' | 'medium' | 'high' | 'critical';
            description: string;
            value: number;
            threshold: number;
            recommendation: string;
          }>;
        }>;
        status: {
          enabled: boolean;
          running: boolean;
          uptime: number;
          snapshotCount: number;
        };
      }>
    > => ipcRenderer.invoke('atlas:get-performance-data'),

    // Get metrics summary
    getMetrics: (): Promise<
      IPCResult<
        Record<string, { current: number; avg: number; min: number; max: number; unit: string }>
      >
    > => ipcRenderer.invoke('atlas:get-performance-metrics'),

    // Get metric history for a specific metric
    getMetricHistory: (
      metricName: string,
      limit?: number
    ): Promise<
      IPCResult<Array<{ timestamp: number; value: number; metadata?: Record<string, unknown> }>>
    > => ipcRenderer.invoke('atlas:get-metric-history', metricName, limit),

    // Get performance snapshots
    getSnapshots: (limit?: number): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('atlas:get-performance-snapshots', limit),

    // Take a manual performance snapshot
    takeSnapshot: (): Promise<IPCResult<unknown>> =>
      ipcRenderer.invoke('atlas:take-performance-snapshot'),

    // Export performance report to file
    exportReport: (filename?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('atlas:export-performance-report', filename),

    // Generate performance report (without saving)
    generateReport: (): Promise<
      IPCResult<{
        generatedAt: string;
        duration: number;
        summary: {
          avgFps: number;
          avgMemory: number;
          avgCpu: number;
          avgIpcLatency: number;
          bottleneckCount: number;
        };
        recommendations: string[];
      }>
    > => ipcRenderer.invoke('atlas:generate-performance-report'),

    // Start the profiler
    start: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:start-profiler'),

    // Stop the profiler
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:stop-profiler'),

    // Reset profiler metrics
    reset: (): Promise<IPCResult> => ipcRenderer.invoke('atlas:reset-profiler'),

    // Update profiler configuration
    updateConfig: (config: {
      enabled?: boolean;
      sampleInterval?: number;
      historySize?: number;
      autoExport?: boolean;
      exportInterval?: number;
    }): Promise<IPCResult> => ipcRenderer.invoke('atlas:update-profiler-config', config),

    // Get profiler status
    getStatus: (): Promise<
      IPCResult<{
        enabled: boolean;
        running: boolean;
        uptime: number;
        snapshotCount: number;
        metricCount: number;
      }>
    > => ipcRenderer.invoke('atlas:get-profiler-status'),

    // Update render metrics from renderer (for FPS tracking)
    updateRenderMetrics: (metrics: {
      fps: number;
      avgFps: number;
      frameTime: number;
      particleCount: number;
      drawCalls: number;
      triangles: number;
      gpuMemory?: number;
    }): Promise<IPCResult> => ipcRenderer.invoke('atlas:update-render-metrics', metrics),

    // Record voice pipeline timing
    recordVoiceTiming: (
      stage:
        | 'wakeWordDetection'
        | 'vadProcessing'
        | 'sttLatency'
        | 'llmFirstToken'
        | 'llmTotalTime'
        | 'ttsFirstAudio'
        | 'ttsTotalTime'
        | 'totalResponseTime',
      duration: number
    ): Promise<IPCResult> => ipcRenderer.invoke('atlas:record-voice-timing', stage, duration),

    // Get startup timing data
    getStartupTiming: (): Promise<
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
    > => ipcRenderer.invoke('atlas:get-startup-timing'),
  },

  // 046-A: Keychain (Secure Storage) API
  keychain: {
    // Get an API key (returns null if not found)
    getKey: (keyName: string): Promise<IPCResult<string | null>> =>
      ipcRenderer.invoke('keychain:get-key', keyName),

    // Set an API key
    setKey: (keyName: string, value: string): Promise<IPCResult> =>
      ipcRenderer.invoke('keychain:set-key', keyName, value),

    // Delete an API key
    deleteKey: (keyName: string): Promise<IPCResult> =>
      ipcRenderer.invoke('keychain:delete-key', keyName),

    // Check if an API key exists
    hasKey: (keyName: string): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('keychain:has-key', keyName),

    // List all stored keys (names only, not values)
    listKeys: (): Promise<IPCResult<Array<{ name: string; storage: string; hasValue: boolean }>>> =>
      ipcRenderer.invoke('keychain:list-keys'),

    // Get a masked version of a key for display (e.g., "***abc1")
    getMaskedKey: (keyName: string): Promise<IPCResult<string | null>> =>
      ipcRenderer.invoke('keychain:get-masked-key', keyName),

    // Clear all API keys (for app reset)
    clearAll: (): Promise<IPCResult> => ipcRenderer.invoke('keychain:clear-all'),

    // Check keychain health
    checkHealth: (): Promise<
      IPCResult<{
        keychainAvailable: boolean;
        fallbackAvailable: boolean;
        keysStored: number;
      }>
    > => ipcRenderer.invoke('keychain:check-health'),

    // Get list of supported API key names
    getSupportedKeys: (): Promise<IPCResult<string[]>> =>
      ipcRenderer.invoke('keychain:get-supported-keys'),
  },

  // T3-022: Desktop Tools API
  tools: {
    // Get all tool definitions for LLM function calling
    list: (): Promise<
      IPCResult<
        Array<{
          type: 'function';
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>
      >
    > => ipcRenderer.invoke('tools:list'),

    // Get tool summary (categories and counts)
    getSummary: (): Promise<
      IPCResult<{
        totalTools: number;
        categories: Record<string, number>;
        toolNames: string[];
      }>
    > => ipcRenderer.invoke('tools:get-summary'),

    // Get tools by category
    getByCategory: (
      category: string
    ): Promise<
      IPCResult<
        Array<{
          type: 'function';
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>
      >
    > => ipcRenderer.invoke('tools:get-by-category', category),

    // Execute a single tool
    execute: (
      toolName: string,
      args?: Record<string, unknown>
    ): Promise<
      IPCResult<{
        success: boolean;
        toolName: string;
        result?: unknown;
        error?: string;
        duration: number;
      }>
    > => ipcRenderer.invoke('tools:execute', toolName, args || {}),

    // Execute multiple tools sequentially
    executeBatch: (
      calls: Array<{ name: string; arguments?: Record<string, unknown> }>
    ): Promise<
      IPCResult<
        Array<{
          success: boolean;
          toolName: string;
          result?: unknown;
          error?: string;
          duration: number;
        }>
      >
    > => ipcRenderer.invoke('tools:execute-batch', calls),

    // Execute multiple tools in parallel
    executeParallel: (
      calls: Array<{ name: string; arguments?: Record<string, unknown> }>
    ): Promise<
      IPCResult<
        Array<{
          success: boolean;
          toolName: string;
          result?: unknown;
          error?: string;
          duration: number;
        }>
      >
    > => ipcRenderer.invoke('tools:execute-parallel', calls),

    // Check if a tool exists
    has: (toolName: string): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('tools:has', toolName),

    // Get total tool count
    count: (): Promise<IPCResult<number>> => ipcRenderer.invoke('tools:count'),
  },

  // Coding Agent API
  coding: {
    // Execute a coding task
    execute: (request: {
      prompt: string;
      files?: string[];
      workspacePath?: string;
      maxIterations?: number;
    }): Promise<
      IPCResult<{
        success: boolean;
        output: string;
        filesModified: string[];
        toolCalls: Array<{
          name: string;
          arguments: Record<string, unknown>;
          result: unknown;
        }>;
        sessionId: string;
      }>
    > => ipcRenderer.invoke('coding:execute', request),

    // Execute with streaming output
    executeStream: (request: {
      prompt: string;
      files?: string[];
      workspacePath?: string;
    }): Promise<IPCResult> => ipcRenderer.invoke('coding:execute-stream', request),

    // Execute a voice command
    voiceCommand: (
      command: string
    ): Promise<
      IPCResult<{
        success: boolean;
        output: string;
        sessionId: string;
      }>
    > => ipcRenderer.invoke('coding:voice-command', command),

    // Parse a voice command without executing
    parseVoice: (
      command: string
    ): Promise<
      IPCResult<{
        intent: string;
        confidence: number;
        entities: Record<string, unknown>;
      }>
    > => ipcRenderer.invoke('coding:parse-voice', command),

    // Get current session
    getSession: (): Promise<
      IPCResult<{
        id: string;
        state: string;
        startTime: string;
        toolCalls: number;
        filesModified: string[];
      } | null>
    > => ipcRenderer.invoke('coding:get-session'),

    // Abort current task
    abort: (): Promise<IPCResult> => ipcRenderer.invoke('coding:abort'),

    // Update agent config
    updateConfig: (config: {
      maxIterations?: number;
      maxFileSize?: number;
      allowedExtensions?: string[];
      autoSave?: boolean;
    }): Promise<IPCResult> => ipcRenderer.invoke('coding:update-config', config),

    // Get current config
    getConfig: (): Promise<
      IPCResult<{
        maxIterations: number;
        maxFileSize: number;
        allowedExtensions: string[];
        autoSave: boolean;
      }>
    > => ipcRenderer.invoke('coding:get-config'),

    // Get project context
    getContext: (
      workspacePath?: string
    ): Promise<
      IPCResult<{
        files: number;
        symbols: number;
        errors: number;
        gitStatus: string;
      }>
    > => ipcRenderer.invoke('coding:get-context', workspacePath),

    // Get edit history
    getEditHistory: (
      limit?: number
    ): Promise<
      IPCResult<
        Array<{
          file: string;
          type: string;
          timestamp: string;
          canRollback: boolean;
        }>
      >
    > => ipcRenderer.invoke('coding:get-edit-history', limit),

    // Rollback recent edits
    rollback: (
      count?: number
    ): Promise<
      IPCResult<{
        rolledBack: number;
        files: string[];
      }>
    > => ipcRenderer.invoke('coding:rollback', count),
  },

  // Task Framework API (T2 Phase 0)
  tasks: {
    // Create and enqueue a new task
    create: (options: {
      name: string;
      description?: string;
      priority?: 'urgent' | 'high' | 'normal' | 'low';
      steps: Array<{
        name: string;
        type: 'tool' | 'llm' | 'wait' | 'condition' | 'parallel' | 'loop' | 'delay';
        config: Record<string, unknown>;
        timeout?: number;
        retryCount?: number;
        errorStrategy?: 'fail' | 'skip' | 'retry' | 'rollback';
      }>;
      context?: Record<string, unknown>;
      tags?: string[];
    }): Promise<
      IPCResult<{
        id: string;
        name: string;
        status: string;
        priority: string;
        createdAt: number;
      }>
    > => ipcRenderer.invoke('task:create', options),

    // Get task by ID
    get: (
      taskId: string
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        description?: string;
        status: string;
        priority: string;
        progress: number;
        currentStep?: number;
        steps: Array<{
          name: string;
          status: string;
          result?: unknown;
          error?: string;
        }>;
        createdAt: number;
        startedAt?: number;
        completedAt?: number;
      } | null>
    > => ipcRenderer.invoke('task:get', taskId),

    // Get all queued tasks
    getQueued: (): Promise<
      IPCResult<
        Array<{
          id: string;
          name: string;
          priority: string;
          createdAt: number;
        }>
      >
    > => ipcRenderer.invoke('task:get-queued'),

    // Get all running tasks
    getRunning: (): Promise<
      IPCResult<
        Array<{
          id: string;
          name: string;
          priority: string;
          progress: number;
          currentStep?: number;
          startedAt: number;
        }>
      >
    > => ipcRenderer.invoke('task:get-running'),

    // Get recent completed tasks
    getRecent: (
      limit?: number
    ): Promise<
      IPCResult<
        Array<{
          id: string;
          name: string;
          status: string;
          completedAt: number;
          duration: number;
        }>
      >
    > => ipcRenderer.invoke('task:get-recent', limit),

    // Get task queue statistics
    getStats: (): Promise<
      IPCResult<{
        queued: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        avgDuration: number;
        successRate: number;
      }>
    > => ipcRenderer.invoke('task:get-stats'),

    // Cancel a task
    cancel: (taskId: string, reason?: string): Promise<IPCResult<{ cancelled: boolean }>> =>
      ipcRenderer.invoke('task:cancel', taskId, reason),

    // Pause a task
    pause: (taskId: string): Promise<IPCResult<{ paused: boolean }>> =>
      ipcRenderer.invoke('task:pause', taskId),

    // Resume a task
    resume: (taskId: string): Promise<IPCResult<{ resumed: boolean }>> =>
      ipcRenderer.invoke('task:resume', taskId),

    // Clear completed tasks
    clearCompleted: (): Promise<IPCResult<{ cleared: number }>> =>
      ipcRenderer.invoke('task:clear-completed'),
  },

  // GEPA Self-Improvement API (T4 Phase 8)
  gepa: {
    // Get GEPA system status
    getStatus: (): Promise<
      IPCResult<{
        initialized: boolean;
        schedulerRunning: boolean;
        lastOptimization: Date | null;
        nextScheduledRun: Date | null;
        pendingProposals: number;
        activeABTests: number;
      }>
    > => ipcRenderer.invoke('gepa:get-status'),

    // Get optimization history
    getOptimizationHistory: (): Promise<
      IPCResult<
        Array<{
          id: string;
          date: Date;
          target: string;
          description: string;
          status: string;
          improvement: number | null;
        }>
      >
    > => ipcRenderer.invoke('gepa:get-optimization-history'),

    // Run manual optimization
    runOptimization: (): Promise<
      IPCResult<{
        proposalsGenerated: number;
        proposalsApplied: number;
        targets: string[];
      }>
    > => ipcRenderer.invoke('gepa:run-optimization'),

    // Get metrics summary
    getMetrics: (): Promise<
      IPCResult<{
        successRate: number;
        avgLatency: number;
        satisfactionScore: number;
        totalInteractions: number;
        corrections: number;
        failures: number;
      }>
    > => ipcRenderer.invoke('gepa:get-metrics'),

    // Get A/B tests
    getABTests: (): Promise<
      IPCResult<
        Array<{
          id: string;
          name: string;
          status: string;
          targetMetric: string;
          variants: Array<{ name: string; sampleSize: number }>;
          winner: string | null;
        }>
      >
    > => ipcRenderer.invoke('gepa:get-ab-tests'),

    // Create an A/B test
    createABTest: (config: {
      name: string;
      targetMetric: string;
      variants: Array<{ name: string; config: Record<string, unknown> }>;
    }): Promise<IPCResult<{ id: string; name: string }>> =>
      ipcRenderer.invoke('gepa:create-ab-test', config),

    // Get rollback points
    getRollbackPoints: (): Promise<
      IPCResult<
        Array<{
          id: string;
          createdAt: Date;
          reason: string;
          size: number;
        }>
      >
    > => ipcRenderer.invoke('gepa:get-rollback-points'),

    // Rollback to a snapshot
    rollback: (snapshotId: string): Promise<IPCResult<{ rolledBack: boolean }>> =>
      ipcRenderer.invoke('gepa:rollback', snapshotId),

    // Get change reports
    getChangeReports: (): Promise<
      IPCResult<
        Array<{
          id: string;
          timestamp: Date;
          type: string;
          summary: string;
          details: string;
        }>
      >
    > => ipcRenderer.invoke('gepa:get-change-reports'),

    // Get daily digest
    getDailyDigest: (): Promise<
      IPCResult<{
        date: Date;
        optimizationsApplied: number;
        testsCompleted: number;
        successRateChange: number;
        highlights: string[];
      }>
    > => ipcRenderer.invoke('gepa:get-daily-digest'),

    // Get pending code modifications
    getPendingModifications: (): Promise<
      IPCResult<
        Array<{
          id: string;
          type: string;
          filePath: string;
          description: string;
          risk: string;
          createdAt: Date;
        }>
      >
    > => ipcRenderer.invoke('gepa:get-pending-modifications'),

    // Approve a pending modification
    approveModification: (modificationId: string): Promise<IPCResult<{ approved: boolean }>> =>
      ipcRenderer.invoke('gepa:approve-modification', modificationId),

    // Reject a pending modification
    rejectModification: (
      modificationId: string,
      reason?: string
    ): Promise<IPCResult<{ rejected: boolean }>> =>
      ipcRenderer.invoke('gepa:reject-modification', modificationId, reason),

    // Set optimization schedule
    setSchedule: (config: {
      enabled: boolean;
      hour?: number;
      minute?: number;
    }): Promise<IPCResult<{ updated: boolean }>> => ipcRenderer.invoke('gepa:set-schedule', config),
  },

  // T3-Phase 5: Trading API
  trading: {
    // Portfolio
    getAggregatedBalance: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-aggregated-balance'),
    getExchangeBalance: (exchangeId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-exchange-balance', exchangeId),
    getAllPositions: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-all-positions'),
    getPositionSummary: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-position-summary'),
    getPerformance: (period: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-performance', period),
    getPnL: (period?: string, exchangeId?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-pnl', period, exchangeId),
    getExchanges: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-exchanges'),
    takeSnapshot: (): Promise<IPCResult> => ipcRenderer.invoke('trading:take-snapshot'),
    getSnapshots: (since?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-snapshots', since),

    // Alerts
    createAlert: (request: {
      exchange: string;
      symbol: string;
      target: number;
      condition: string;
      message?: string;
    }): Promise<IPCResult> => ipcRenderer.invoke('trading:create-alert', request),
    cancelAlert: (alertId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:cancel-alert', alertId),
    getAlerts: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-alerts'),
    getActiveAlerts: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-active-alerts'),
    getAlertsByExchange: (exchangeId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-alerts-by-exchange', exchangeId),
    getAlertsBySymbol: (symbol: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-alerts-by-symbol', symbol),
    updateAlert: (alertId: string, updates: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:update-alert', alertId, updates),
    reactivateAlert: (alertId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:reactivate-alert', alertId),
    getAlertStats: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-alert-stats'),
    clearAlerts: (): Promise<IPCResult> => ipcRenderer.invoke('trading:clear-alerts'),

    // History
    getTrades: (query?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-trades', query),
    getOrders: (query?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-orders', query),
    getRecentTrades: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-recent-trades', limit),
    getRecentOrders: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-recent-orders', limit),
    getTradeSummary: (since?: number, until?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-trade-summary', since, until),
    getMostTraded: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:get-most-traded', limit),
    getHistoryCounts: (): Promise<IPCResult> => ipcRenderer.invoke('trading:get-history-counts'),
    syncHistory: (): Promise<IPCResult> => ipcRenderer.invoke('trading:sync-history'),
    clearHistoryCache: (): Promise<IPCResult> => ipcRenderer.invoke('trading:clear-history-cache'),

    // Autonomous Trading
    autonomousStart: (config?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:start', config),
    autonomousStop: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:stop'),
    autonomousPause: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:pause'),
    autonomousResume: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:resume'),
    autonomousStatus: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:status'),
    autonomousConfig: (updates?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:autonomous:config', updates),

    // Kill Switch
    killswitchTrigger: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:killswitch:trigger'),
    killswitchReset: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:killswitch:reset'),
    killswitchStatus: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:killswitch:status'),

    // Backtesting
    backtestRun: (config: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backtest:run', config),
    backtestStatus: (backtestId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backtest:status', backtestId),
    backtestResult: (backtestId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backtest:result', backtestId),
    backtestCancel: (backtestId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backtest:cancel', backtestId),
    backtestList: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backtest:list'),

    // Signals
    signalsList: (symbol?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:signals:list', symbol),
    signalsSubscribe: (symbol: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:signals:subscribe', symbol),
    signalsUnsubscribe: (symbol: string): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:signals:unsubscribe', symbol),

    // Risk Management
    riskMetrics: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:risk:metrics'),
    riskLimits: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:risk:limits'),

    // Feedback & Learning
    feedbackSubmit: (feedback: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:feedback:submit', feedback),

    // Go Backend Connection
    backendConnect: (config?: { host: string; port: number }): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backend:connect', config),
    backendDisconnect: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backend:disconnect'),
    backendStatus: (): Promise<IPCResult> =>
      ipcRenderer.invoke('trading:backend:status'),

    // Real-time Event Listeners (from Go backend via WebSocket)
    onTrade: (callback: (trade: unknown) => void): (() => void) => {
      const listener = (_event: unknown, trade: unknown) => callback(trade);
      ipcRenderer.on('trading:trade', listener);
      return () => ipcRenderer.removeListener('trading:trade', listener);
    },
    onPosition: (callback: (position: unknown) => void): (() => void) => {
      const listener = (_event: unknown, position: unknown) => callback(position);
      ipcRenderer.on('trading:position', listener);
      return () => ipcRenderer.removeListener('trading:position', listener);
    },
    onRegimeChange: (callback: (regime: unknown) => void): (() => void) => {
      const listener = (_event: unknown, regime: unknown) => callback(regime);
      ipcRenderer.on('trading:regime-change', listener);
      return () => ipcRenderer.removeListener('trading:regime-change', listener);
    },
    onRiskAlert: (callback: (alert: unknown) => void): (() => void) => {
      const listener = (_event: unknown, alert: unknown) => callback(alert);
      ipcRenderer.on('trading:risk-alert', listener);
      return () => ipcRenderer.removeListener('trading:risk-alert', listener);
    },
    onWsStatus: (callback: (status: { connected: boolean }) => void): (() => void) => {
      const listener = (_event: unknown, status: { connected: boolean }) => callback(status);
      ipcRenderer.on('trading:ws-status', listener);
      return () => ipcRenderer.removeListener('trading:ws-status', listener);
    },
  },

  // Career Module API
  career: {
    // Profile Management
    getProfile: (): Promise<IPCResult> => ipcRenderer.invoke('career:profile:get'),
    createProfile: (profileData: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:create', profileData),
    updateProfile: (updates: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:update', updates),
    addSkill: (skill: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:add-skill', skill),
    setGoals: (goals: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:set-goals', goals),
    addDreamCompany: (company: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:add-dream-company', company),
    getProfileCompleteness: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:profile:completeness'),

    // Skills Gap Analysis
    analyzeSkillsGap: (targetCompany: string, targetRole?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:skills-gap:analyze', targetCompany, targetRole),
    getCompanyProfile: (company: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:skills-gap:company-profile', company),
    getAvailableCompanies: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:skills-gap:available-companies'),
    buildRoadmap: (targetCompany: string, targetRole?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:skills-gap:roadmap', targetCompany, targetRole),

    // Job Search
    searchJobs: (query: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:jobs:search', query),
    searchRemoteJobs: (keywords: string[]): Promise<IPCResult> =>
      ipcRenderer.invoke('career:jobs:search-remote', keywords),
    searchFreelanceJobs: (keywords: string[]): Promise<IPCResult> =>
      ipcRenderer.invoke('career:jobs:search-freelance', keywords),
    getJobRecommendations: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:jobs:recommendations'),
    saveJob: (job: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:jobs:save', job),
    getSavedJobs: (): Promise<IPCResult> => ipcRenderer.invoke('career:jobs:saved'),

    // CV/Resume
    analyzeCV: (cvContent: string, targetRole?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:cv:analyze', cvContent, targetRole),
    tailorCVForJob: (cvContent: string, job: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:cv:tailor-for-job', cvContent, job),
    tailorCVForCompany: (cvContent: string, company: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:cv:tailor-for-company', cvContent, company),
    generateCV: (template?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:cv:generate', template),
    getCVVersions: (): Promise<IPCResult> => ipcRenderer.invoke('career:cv:versions'),
    saveCVVersion: (content: string, name: string, targetRole?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:cv:save-version', content, name, targetRole),

    // Application Tracking
    createApplication: (
      job: Record<string, unknown>,
      cvVersionId?: string,
      coverLetter?: string
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:create', job, cvVersionId, coverLetter),
    updateApplicationStatus: (
      applicationId: string,
      status: string,
      notes?: string
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:update-status', applicationId, status, notes),
    getApplication: (applicationId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:get', applicationId),
    listApplications: (): Promise<IPCResult> => ipcRenderer.invoke('career:applications:list'),
    getApplicationsByStatus: (status: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:by-status', status),
    getApplicationAnalytics: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:analytics'),
    scheduleInterview: (
      applicationId: string,
      interview: Record<string, unknown>
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:schedule-interview', applicationId, interview),
    getUpcomingInterviews: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:applications:upcoming-interviews'),

    // Interview Prep
    generateInterviewPlan: (
      company: string,
      role: string,
      interviewDate?: number
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('career:interview:generate-prep', company, role, interviewDate),
    getMockQuestions: (
      type: 'technical' | 'behavioral' | 'system-design',
      count?: number
    ): Promise<IPCResult> => ipcRenderer.invoke('career:interview:mock-questions', type, count),
    addSTARStory: (story: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('career:interview:add-star-story', story),
    getSTARStories: (): Promise<IPCResult> => ipcRenderer.invoke('career:interview:star-stories'),
    recordPracticeSession: (
      questionId: string,
      response: string,
      rating: number
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('career:interview:record-practice', questionId, response, rating),
    getPracticeStats: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:interview:practice-stats'),

    // Event listeners
    onProfileUpdated: (callback: (profile: unknown) => void): (() => void) => {
      const listener = (_event: unknown, profile: unknown) => callback(profile);
      ipcRenderer.on('career:profile-updated', listener);
      return () => ipcRenderer.removeListener('career:profile-updated', listener);
    },
    onJobSaved: (callback: (job: unknown) => void): (() => void) => {
      const listener = (_event: unknown, job: unknown) => callback(job);
      ipcRenderer.on('career:job-saved', listener);
      return () => ipcRenderer.removeListener('career:job-saved', listener);
    },
    onApplicationCreated: (callback: (app: unknown) => void): (() => void) => {
      const listener = (_event: unknown, app: unknown) => callback(app);
      ipcRenderer.on('career:application-created', listener);
      return () => ipcRenderer.removeListener('career:application-created', listener);
    },
    onInterviewScheduled: (
      callback: (app: unknown, interview: unknown) => void
    ): (() => void) => {
      const listener = (_event: unknown, app: unknown, interview: unknown) =>
        callback(app, interview);
      ipcRenderer.on('career:interview-scheduled', listener);
      return () => ipcRenderer.removeListener('career:interview-scheduled', listener);
    },
  },

  // T3-Phase 6: Finance API
  finance: {
    // Connection
    initialize: (config?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:initialize', config),
    getStatus: (): Promise<IPCResult<string>> => ipcRenderer.invoke('finance:status'),
    authorize: (): Promise<IPCResult> => ipcRenderer.invoke('finance:authorize'),
    exchangeCode: (code: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:exchange-code', code),
    disconnect: (): Promise<IPCResult> => ipcRenderer.invoke('finance:disconnect'),
    shutdown: (): Promise<IPCResult> => ipcRenderer.invoke('finance:shutdown'),

    // Accounts
    getAccounts: (): Promise<IPCResult> => ipcRenderer.invoke('finance:accounts'),
    getBalance: (accountId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:balance', accountId),
    getAllBalances: (): Promise<IPCResult> => ipcRenderer.invoke('finance:all-balances'),

    // Transactions
    getTransactions: (filter?: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:transactions', filter),
    getPendingTransactions: (accountId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:pending-transactions', accountId),
    recategorize: (transactionId: string, category: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:recategorize', transactionId, category),

    // Analytics
    getSpendingByCategory: (from?: string, to?: string, currency?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:spending-by-category', from, to, currency),
    getSpendingReport: (from: string, to: string, currency?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:spending-report', from, to, currency),
    getInsights: (from: string, to: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:insights', from, to),

    // Budgets
    createBudget: (
      category: string,
      amount: number,
      period: string,
      options?: { currency?: string; alertThreshold?: number }
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:create-budget', category, amount, period, options),
    updateBudget: (
      id: string,
      updates: { amount?: number; period?: string; alertThreshold?: number; active?: boolean }
    ): Promise<IPCResult> => ipcRenderer.invoke('finance:update-budget', id, updates),
    deleteBudget: (id: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:delete-budget', id),
    getBudgets: (): Promise<IPCResult> => ipcRenderer.invoke('finance:budgets'),
    getBudgetStatus: (id: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:budget-status', id),
    getAllBudgetStatuses: (): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:all-budget-statuses'),
    getBudgetSummary: (): Promise<IPCResult> => ipcRenderer.invoke('finance:budget-summary'),

    // Direct Debits & Standing Orders
    getDirectDebits: (accountId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:direct-debits', accountId),
    getStandingOrders: (accountId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:standing-orders', accountId),

    // Credit Cards
    getCards: (): Promise<IPCResult> => ipcRenderer.invoke('finance:cards'),
    getCardBalance: (cardId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:card-balance', cardId),
    getCardTransactions: (cardId: string, from?: string, to?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('finance:card-transactions', cardId, from, to),

    // Providers
    getProviders: (): Promise<IPCResult> => ipcRenderer.invoke('finance:providers'),
  },

  // T5-205: Speaker ID API (Multi-User Voice Recognition)
  speaker: {
    // Initialize Pyannote speaker ID system
    initialize: (): Promise<IPCResult> => ipcRenderer.invoke('speaker:initialize'),

    // Check if system is configured (has HuggingFace token)
    isConfigured: (): Promise<IPCResult<boolean>> => ipcRenderer.invoke('speaker:is-configured'),

    // Identify speaker from audio buffer
    identify: (
      audioBuffer: ArrayBuffer,
      threshold?: number
    ): Promise<
      IPCResult<{
        speakerId: string | null;
        confidence: number;
        isKnown: boolean;
        name?: string;
      }>
    > => ipcRenderer.invoke('speaker:identify', audioBuffer, threshold),

    // Identify speaker from audio file
    identifyFile: (
      audioPath: string,
      threshold?: number
    ): Promise<
      IPCResult<{
        speakerId: string | null;
        confidence: number;
        isKnown: boolean;
        name?: string;
      }>
    > => ipcRenderer.invoke('speaker:identify-file', audioPath, threshold),

    // Enroll a new speaker with audio samples
    enroll: (
      name: string,
      audioSamples: ArrayBuffer[]
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        enrolledAt: Date;
        sampleCount: number;
      }>
    > => ipcRenderer.invoke('speaker:enroll', name, audioSamples),

    // Enroll speaker from audio file paths
    enrollFiles: (
      name: string,
      audioPaths: string[]
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        enrolledAt: Date;
        sampleCount: number;
      }>
    > => ipcRenderer.invoke('speaker:enroll-files', name, audioPaths),

    // Update speaker with additional samples
    update: (
      speakerId: string,
      audioSamples: ArrayBuffer[]
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        sampleCount: number;
      }>
    > => ipcRenderer.invoke('speaker:update', speakerId, audioSamples),

    // Get all enrolled speakers
    list: (): Promise<
      IPCResult<
        Array<{
          id: string;
          name: string;
          enrolledAt: Date;
          sampleCount: number;
        }>
      >
    > => ipcRenderer.invoke('speaker:list'),

    // Get speaker by ID
    get: (
      speakerId: string
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        enrolledAt: Date;
        sampleCount: number;
      } | null>
    > => ipcRenderer.invoke('speaker:get', speakerId),

    // Get speaker by name
    getByName: (
      name: string
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        enrolledAt: Date;
        sampleCount: number;
      } | null>
    > => ipcRenderer.invoke('speaker:get-by-name', name),

    // Delete a speaker
    delete: (speakerId: string): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('speaker:delete', speakerId),

    // Get speaker count
    count: (): Promise<IPCResult<number>> => ipcRenderer.invoke('speaker:count'),

    // Perform speaker diarization on audio (who speaks when)
    diarize: (
      audioBuffer: ArrayBuffer,
      numSpeakers?: number
    ): Promise<
      IPCResult<
        Array<{
          speaker: string;
          start: number;
          end: number;
          confidence: number;
        }>
      >
    > => ipcRenderer.invoke('speaker:diarize', audioBuffer, numSpeakers),

    // Diarize audio file
    diarizeFile: (
      audioPath: string,
      numSpeakers?: number
    ): Promise<
      IPCResult<
        Array<{
          speaker: string;
          start: number;
          end: number;
          confidence: number;
        }>
      >
    > => ipcRenderer.invoke('speaker:diarize-file', audioPath, numSpeakers),

    // Extract voice embedding from audio
    extractEmbedding: (audioBuffer: ArrayBuffer): Promise<IPCResult<number[]>> =>
      ipcRenderer.invoke('speaker:extract-embedding', audioBuffer),

    // Compare two embeddings (returns similarity 0-1)
    compareEmbeddings: (emb1: number[], emb2: number[]): Promise<IPCResult<number>> =>
      ipcRenderer.invoke('speaker:compare-embeddings', emb1, emb2),

    // Set Python path for Pyannote
    setPythonPath: (pythonPath: string): Promise<IPCResult> =>
      ipcRenderer.invoke('speaker:set-python-path', pythonPath),
  },

  // Dashboard API (Phase 12: Backend Wiring)
  dashboard: {
    // Initialize dashboard and load all data
    initialize: (): Promise<
      IPCResult<{
        goals: Array<{
          id: string;
          title: string;
          category: string;
          progress: number;
          target?: string;
          createdAt: number;
          updatedAt: number;
        }>;
        workflows: Array<{
          id: string;
          name: string;
          status: string;
          lastRun?: number;
          nextRun?: number;
          currentStep?: number;
          totalSteps?: number;
          trigger?: string;
        }>;
        agents: Array<{
          id: string;
          name: string;
          icon?: string;
          status: string;
          taskCount: number;
          currentTask?: string;
          lastActive?: number;
        }>;
        integrations: Array<{
          id: string;
          name: string;
          icon: string;
          status: string;
          lastSync?: number;
          error?: string;
        }>;
      }>
    > => ipcRenderer.invoke('dashboard:initialize'),

    // Get all dashboard data
    getData: (): Promise<IPCResult> => ipcRenderer.invoke('dashboard:get-data'),

    // Goals
    getGoals: (): Promise<IPCResult> => ipcRenderer.invoke('dashboard:get-goals'),
    saveGoals: (
      goals: Array<{
        id: string;
        title: string;
        category: string;
        progress: number;
        target?: string;
        createdAt: number;
        updatedAt: number;
      }>
    ): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-goals', goals),
    saveGoal: (goal: {
      id: string;
      title: string;
      category: string;
      progress: number;
      target?: string;
      createdAt: number;
      updatedAt: number;
    }): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-goal', goal),
    deleteGoal: (goalId: string): Promise<IPCResult<{ deleted: boolean }>> =>
      ipcRenderer.invoke('dashboard:delete-goal', goalId),
    updateGoalProgress: (
      goalId: string,
      progress: number
    ): Promise<IPCResult<{ updated: boolean }>> =>
      ipcRenderer.invoke('dashboard:update-goal-progress', goalId, progress),

    // Workflows
    getWorkflows: (): Promise<IPCResult> => ipcRenderer.invoke('dashboard:get-workflows'),
    saveWorkflows: (
      workflows: Array<{
        id: string;
        name: string;
        status: string;
        lastRun?: number;
        nextRun?: number;
        currentStep?: number;
        totalSteps?: number;
        trigger?: string;
      }>
    ): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-workflows', workflows),
    saveWorkflow: (workflow: {
      id: string;
      name: string;
      status: string;
      lastRun?: number;
      nextRun?: number;
      currentStep?: number;
      totalSteps?: number;
      trigger?: string;
    }): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-workflow', workflow),
    deleteWorkflow: (workflowId: string): Promise<IPCResult<{ deleted: boolean }>> =>
      ipcRenderer.invoke('dashboard:delete-workflow', workflowId),

    // Agents
    getAgents: (): Promise<IPCResult> => ipcRenderer.invoke('dashboard:get-agents'),
    saveAgents: (
      agents: Array<{
        id: string;
        name: string;
        icon?: string;
        status: string;
        taskCount: number;
        currentTask?: string;
        lastActive?: number;
      }>
    ): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-agents', agents),

    // Integrations
    getIntegrations: (): Promise<IPCResult> => ipcRenderer.invoke('dashboard:get-integrations'),
    saveIntegrations: (
      integrations: Array<{
        id: string;
        name: string;
        icon: string;
        status: string;
        lastSync?: number;
        error?: string;
      }>
    ): Promise<IPCResult> => ipcRenderer.invoke('dashboard:save-integrations', integrations),
    updateIntegrationStatus: (
      integrationId: string,
      status: 'connected' | 'warning' | 'disconnected' | 'unconfigured',
      error?: string
    ): Promise<IPCResult> =>
      ipcRenderer.invoke('dashboard:update-integration-status', integrationId, status, error),

    // Metrics
    getMetrics: (): Promise<
      IPCResult<{
        credits: number;
        agents: number;
        workflows: number;
        tools: number;
        runsQueued: number;
        runsCompleted24h: number;
        integrations: number;
        integrationsHealthy: number;
      }>
    > => ipcRenderer.invoke('dashboard:get-metrics'),

    // Health checks
    checkIntegrationHealth: (): Promise<
      IPCResult<
        Array<{
          id: string;
          status: 'connected' | 'warning' | 'disconnected' | 'unconfigured';
          latency?: number;
          error?: string;
        }>
      >
    > => ipcRenderer.invoke('dashboard:check-integration-health'),
  },

  // JARVIS Brain (Cognitive System)
  brain: {
    // Get brain statistics
    getStats: (): Promise<
      IPCResult<{
        nodeCount: number;
        edgeCount: number;
        entityCount: number;
        associationCount: number;
        recentMemories: number;
        topConcepts: Array<{ label: string; importance: number }>;
      }>
    > => ipcRenderer.invoke('brain:get-stats'),

    // Get visualization data for 3D graph
    getVisualization: (options?: {
      limit?: number;
      centerNode?: string;
      depth?: number;
    }): Promise<
      IPCResult<{
        nodes: Array<{
          id: string;
          label: string;
          type: string;
          importance: number;
          x?: number;
          y?: number;
          z?: number;
        }>;
        edges: Array<{
          source: string;
          target: string;
          type: string;
          weight: number;
        }>;
      }>
    > => ipcRenderer.invoke('brain:get-visualization', options),

    // Recall information about a topic
    recall: (
      topic: string,
      options?: { limit?: number; threshold?: number }
    ): Promise<
      IPCResult<{
        memories: Array<{
          id: string;
          content: string;
          type: string;
          importance: number;
          relevance: number;
          timestamp: number;
        }>;
        associations: Array<{
          concept: string;
          strength: number;
        }>;
      }>
    > => ipcRenderer.invoke('brain:recall', topic, options),

    // Learn new information
    learn: (
      content: string,
      options?: {
        type?: string;
        importance?: number;
        tags?: string[];
        relatedTo?: string[];
      }
    ): Promise<
      IPCResult<{
        nodeId: string;
        connections: number;
      }>
    > => ipcRenderer.invoke('brain:learn', content, options),

    // Get entity information
    getEntity: (
      name: string
    ): Promise<
      IPCResult<{
        id: string;
        name: string;
        type: string;
        facts: Array<{ key: string; value: string; confidence: number }>;
        relationships: Array<{ target: string; type: string; strength: number }>;
      } | null>
    > => ipcRenderer.invoke('brain:get-entity', name),

    // Get what the brain knows about the user
    getUserKnowledge: (): Promise<
      IPCResult<{
        name: string;
        preferences: Array<{ key: string; value: string }>;
        interests: string[];
        recentTopics: string[];
        facts: Array<{ content: string; learned: number }>;
      }>
    > => ipcRenderer.invoke('brain:get-user-knowledge'),

    // Ask the brain a question (reasoning)
    ask: (
      question: string
    ): Promise<
      IPCResult<{
        answer: string;
        confidence: number;
        sources: Array<{ content: string; type: string }>;
        reasoning: string[];
      }>
    > => ipcRenderer.invoke('brain:ask', question),

    // Create an association between concepts
    associate: (
      concept1: string,
      concept2: string,
      relationship?: string,
      strength?: number
    ): Promise<
      IPCResult<{
        edgeId: string;
        strengthened: boolean;
      }>
    > => ipcRenderer.invoke('brain:associate', concept1, concept2, relationship, strength),
  },

  // Code Intelligence API (Self-Coding Capabilities)
  codeIntelligence: {
    // Get code intelligence system status
    getStatus: (): Promise<
      IPCResult<{
        initialized: boolean;
        indexing: boolean;
        workspaceRoot: string | null;
        stats: {
          totalFiles: number;
          totalSymbols: number;
          totalReferences: number;
          indexedLanguages: string[];
        } | null;
        activeSessions: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:get-status'),

    // Initialize code intelligence for a workspace
    initialize: (
      workspaceRoot?: string
    ): Promise<
      IPCResult<{
        workspaceRoot: string;
        filesIndexed: number;
        symbolsFound: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:initialize', workspaceRoot),

    // Shutdown code intelligence
    shutdown: (): Promise<IPCResult<{ shutdown: boolean }>> =>
      ipcRenderer.invoke('code-intelligence:shutdown'),

    // Find a symbol by name
    findSymbol: (
      symbolName: string,
      options?: { kind?: string; fuzzy?: boolean }
    ): Promise<
      IPCResult<
        Array<{
          name: string;
          kind: string;
          filePath: string;
          line: number;
          column: number;
          documentation?: string;
        }>
      >
    > => ipcRenderer.invoke('code-intelligence:find-symbol', symbolName, options),

    // Find all references to a symbol
    findReferences: (
      symbolName: string,
      filePath?: string
    ): Promise<
      IPCResult<
        Array<{
          filePath: string;
          line: number;
          column: number;
          context: string;
          isDefinition: boolean;
        }>
      >
    > => ipcRenderer.invoke('code-intelligence:find-references', symbolName, filePath),

    // Go to definition of a symbol
    goToDefinition: (
      symbolName: string,
      filePath?: string
    ): Promise<
      IPCResult<{
        filePath: string;
        line: number;
        column: number;
        preview: string;
      } | null>
    > => ipcRenderer.invoke('code-intelligence:go-to-definition', symbolName, filePath),

    // Build context for a coding task
    buildContext: (
      taskDescription: string,
      options?: {
        maxFiles?: number;
        maxTokens?: number;
        includeTests?: boolean;
      }
    ): Promise<
      IPCResult<{
        primaryFiles: Array<{
          path: string;
          relevance: number;
          content: string;
        }>;
        supportingFiles: Array<{
          path: string;
          relevance: number;
          summary: string;
        }>;
        symbols: Array<{
          name: string;
          kind: string;
          file: string;
        }>;
        totalTokens: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:build-context', taskDescription, options),

    // Start a coding session
    startSession: (
      taskDescription: string
    ): Promise<
      IPCResult<{
        sessionId: string;
        taskDescription: string;
        startedAt: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:start-session', taskDescription),

    // Get session details
    getSession: (
      sessionId: string
    ): Promise<
      IPCResult<{
        sessionId: string;
        taskDescription: string;
        startedAt: number;
        changes: Array<{
          filePath: string;
          description: string;
          timestamp: number;
          validated: boolean;
          errors: string[];
        }>;
        totalChanges: number;
        lastValidation: { success: boolean; errors: string[] } | null;
      } | null>
    > => ipcRenderer.invoke('code-intelligence:get-session', sessionId),

    // Apply a code change
    applyChange: (
      sessionId: string,
      change: {
        filePath: string;
        oldContent?: string;
        newContent: string;
        description: string;
      }
    ): Promise<
      IPCResult<{
        applied: boolean;
        changeIndex: number;
        validation: {
          success: boolean;
          errors: string[];
        };
      }>
    > => ipcRenderer.invoke('code-intelligence:apply-change', sessionId, change),

    // Validate current state
    validate: (
      sessionId: string
    ): Promise<
      IPCResult<{
        success: boolean;
        errors: Array<{
          file: string;
          line: number;
          column: number;
          message: string;
          severity: string;
        }>;
      }>
    > => ipcRenderer.invoke('code-intelligence:validate', sessionId),

    // Revert last change
    revertLast: (
      sessionId: string
    ): Promise<
      IPCResult<{
        reverted: boolean;
        filePath: string;
        remainingChanges: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:revert-last', sessionId),

    // End a coding session
    endSession: (
      sessionId: string,
      options?: { discardChanges?: boolean }
    ): Promise<
      IPCResult<{
        ended: boolean;
        totalChanges: number;
        finalValidation: { success: boolean; errors: string[] };
      }>
    > => ipcRenderer.invoke('code-intelligence:end-session', sessionId, options),

    // Force rebuild the index
    rebuildIndex: (): Promise<
      IPCResult<{
        filesIndexed: number;
        symbolsFound: number;
        duration: number;
      }>
    > => ipcRenderer.invoke('code-intelligence:rebuild-index'),

    // Get index statistics
    getIndexStats: (): Promise<
      IPCResult<{
        totalFiles: number;
        totalSymbols: number;
        totalReferences: number;
        indexedLanguages: string[];
        lastIndexed: number | null;
        indexDuration: number | null;
      }>
    > => ipcRenderer.invoke('code-intelligence:get-index-stats'),

    // Event listeners for indexing progress
    onIndexProgress: (
      callback: (progress: { current: number; total: number; file: string }) => void
    ): (() => void) => {
      const listener = (
        _event: unknown,
        progress: { current: number; total: number; file: string }
      ) => callback(progress);
      ipcRenderer.on('code-intelligence:index-progress', listener);
      return () => ipcRenderer.removeListener('code-intelligence:index-progress', listener);
    },

    onIndexComplete: (
      callback: (stats: { filesIndexed: number; symbolsFound: number; duration: number }) => void
    ): (() => void) => {
      const listener = (
        _event: unknown,
        stats: { filesIndexed: number; symbolsFound: number; duration: number }
      ) => callback(stats);
      ipcRenderer.on('code-intelligence:index-complete', listener);
      return () => ipcRenderer.removeListener('code-intelligence:index-complete', listener);
    },

    onValidationResult: (
      callback: (result: { sessionId: string; success: boolean; errors: unknown[] }) => void
    ): (() => void) => {
      const listener = (
        _event: unknown,
        result: { sessionId: string; success: boolean; errors: unknown[] }
      ) => callback(result);
      ipcRenderer.on('code-intelligence:validation-result', listener);
      return () => ipcRenderer.removeListener('code-intelligence:validation-result', listener);
    },
  },

  // Career Discovery System (legacy - separate from main career module)
  careerDiscovery: {
    // Profile
    initProfile: (userId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:initProfile', userId),
    getProfile: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:getProfile'),

    // Discovery
    startDiscovery: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:startDiscovery'),
    getNextQuestion: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:getNextQuestion'),
    answerQuestion: (questionId: string, answer: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('career:answerQuestion', questionId, answer),
    getResults: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:getResults'),

    // Skills
    analyzeSkillGaps: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:analyzeSkillGaps'),

    // Projects
    addProject: (project: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('career:addProject', project),
    getPortfolio: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:getPortfolio'),

    // Goals
    addGoal: (goal: unknown, isLongTerm: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('career:addGoal', goal, isLongTerm),
    updateGoalStatus: (goalId: string, status: string): Promise<IPCResult> =>
      ipcRenderer.invoke('career:updateGoalStatus', goalId, status),

    // Stats
    getStats: (): Promise<IPCResult> =>
      ipcRenderer.invoke('career:getStats'),
  },

  // Study System
  study: {
    // Courses
    createCourse: (course: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('study:createCourse', course),
    getCourses: (): Promise<IPCResult> =>
      ipcRenderer.invoke('study:getCourses'),

    // Modules
    addModule: (courseId: string, module: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('study:addModule', courseId, module),

    // PDF Ingestion
    ingestPDF: (courseId: string, moduleId: string, pdfPath: string): Promise<IPCResult> =>
      ipcRenderer.invoke('study:ingestPDF', courseId, moduleId, pdfPath),

    // Flashcards
    getDueFlashcards: (moduleId?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('study:getDueFlashcards', moduleId),
    reviewFlashcard: (flashcardId: string, quality: number): Promise<IPCResult> =>
      ipcRenderer.invoke('study:reviewFlashcard', flashcardId, quality),
    createFlashcard: (moduleId: string, flashcard: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('study:createFlashcard', moduleId, flashcard),

    // Study Sessions
    startSession: (moduleId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('study:startSession', moduleId),
    endSession: (sessionId: string, stats: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('study:endSession', sessionId, stats),

    // Export
    exportToObsidian: (courseId: string, vaultPath: string): Promise<IPCResult> =>
      ipcRenderer.invoke('study:exportToObsidian', courseId, vaultPath),

    // Stats & Practice
    getStats: (): Promise<IPCResult> =>
      ipcRenderer.invoke('study:getStats'),
    generatePracticeQuestions: (moduleId: string, count: number): Promise<IPCResult> =>
      ipcRenderer.invoke('study:generatePracticeQuestions', moduleId, count),
  },

  // Autonomous Trading Bot
  tradingBot: {
    // Control
    start: (): Promise<IPCResult> => ipcRenderer.invoke('bot:start'),
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('bot:stop'),
    emergencyStop: (): Promise<IPCResult> => ipcRenderer.invoke('bot:emergencyStop'),
    getStatus: (): Promise<IPCResult> => ipcRenderer.invoke('bot:getStatus'),

    // Configuration
    setDryRun: (dryRun: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:setDryRun', dryRun),
    setRiskParameters: (params: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:setRiskParameters', params),
    enableStrategy: (strategyId: string, enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:enableStrategy', strategyId, enabled),

    // Exchanges
    addExchange: (config: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:addExchange', config),
    removeExchange: (exchangeId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:removeExchange', exchangeId),

    // Symbols
    addSymbol: (symbol: string): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:addSymbol', symbol),
    removeSymbol: (symbol: string): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:removeSymbol', symbol),

    // Analytics
    getPerformance: (): Promise<IPCResult> => ipcRenderer.invoke('bot:getPerformance'),
    getActivePositions: (): Promise<IPCResult> => ipcRenderer.invoke('bot:getActivePositions'),
    getTradeHistory: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('bot:getTradeHistory', limit),

    // Events
    onTrade: (callback: (trade: unknown) => void): (() => void) => {
      const listener = (_event: unknown, trade: unknown) => callback(trade);
      ipcRenderer.on('bot:trade', listener);
      return () => ipcRenderer.removeListener('bot:trade', listener);
    },
    onSignal: (callback: (signal: unknown) => void): (() => void) => {
      const listener = (_event: unknown, signal: unknown) => callback(signal);
      ipcRenderer.on('bot:signal', listener);
      return () => ipcRenderer.removeListener('bot:signal', listener);
    },
    onStatusChange: (callback: (status: unknown) => void): (() => void) => {
      const listener = (_event: unknown, status: unknown) => callback(status);
      ipcRenderer.on('bot:statusChange', listener);
      return () => ipcRenderer.removeListener('bot:statusChange', listener);
    },
  },

  // Proactive Engine
  proactive: {
    // Control
    start: (): Promise<IPCResult> => ipcRenderer.invoke('proactive:start'),
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('proactive:stop'),
    setEnabled: (enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:setEnabled', enabled),

    // Triggers
    getTriggers: (): Promise<IPCResult> => ipcRenderer.invoke('proactive:getTriggers'),
    addTrigger: (trigger: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:addTrigger', trigger),
    removeTrigger: (triggerId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:removeTrigger', triggerId),
    enableTrigger: (triggerId: string, enabled: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:enableTrigger', triggerId, enabled),

    // Context
    getContext: (): Promise<IPCResult> => ipcRenderer.invoke('proactive:getContext'),
    setContextVariable: (key: string, value: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:setContextVariable', key, value),
    recordInteraction: (): Promise<IPCResult> => ipcRenderer.invoke('proactive:recordInteraction'),

    // Briefing
    generateBriefing: (type: 'morning' | 'evening'): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:generateBriefing', type),

    // Events
    emitEvent: (eventName: string, data?: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('proactive:emitEvent', eventName, data),

    // Listeners
    onSpeak: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('proactive:speak', listener);
      return () => ipcRenderer.removeListener('proactive:speak', listener);
    },
    onNotify: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('proactive:notify', listener);
      return () => ipcRenderer.removeListener('proactive:notify', listener);
    },
    onSuggest: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('proactive:suggest', listener);
      return () => ipcRenderer.removeListener('proactive:suggest', listener);
    },
    onAlert: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('proactive:alert', listener);
      return () => ipcRenderer.removeListener('proactive:alert', listener);
    },
  },

  // Discord Integration
  discord: {
    // Connection
    connect: (config: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('discord:connect', config),
    disconnect: (): Promise<IPCResult> => ipcRenderer.invoke('discord:disconnect'),
    getStatus: (): Promise<IPCResult> => ipcRenderer.invoke('discord:getStatus'),

    // Notifications
    sendNotification: (notification: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('discord:sendNotification', notification),
    sendTradeAlert: (trade: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('discord:sendTradeAlert', trade),
    sendStudyReminder: (topic: string, dueCards: number): Promise<IPCResult> =>
      ipcRenderer.invoke('discord:sendStudyReminder', topic, dueCards),
    sendDailySummary: (summary: unknown): Promise<IPCResult> =>
      ipcRenderer.invoke('discord:sendDailySummary', summary),

    // Events
    onConnected: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('discord:connected', listener);
      return () => ipcRenderer.removeListener('discord:connected', listener);
    },
    onDisconnected: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('discord:disconnected', listener);
      return () => ipcRenderer.removeListener('discord:disconnected', listener);
    },
  },

  // Spotify Integration
  spotify: {
    // Authentication
    authenticate: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:authenticate'),
    logout: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:logout'),
    getStatus: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:getStatus'),

    // Playback
    getCurrentPlayback: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:getCurrentPlayback'),
    play: (uri?: string, contextUri?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:play', uri, contextUri),
    pause: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:pause'),
    next: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:next'),
    previous: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:previous'),
    seek: (positionMs: number): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:seek', positionMs),
    setVolume: (volumePercent: number): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:setVolume', volumePercent),
    setShuffle: (state: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:setShuffle', state),
    setRepeat: (state: 'off' | 'context' | 'track'): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:setRepeat', state),

    // Library
    saveTrack: (trackId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:saveTrack', trackId),
    removeTrack: (trackId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:removeTrack', trackId),
    isTrackSaved: (trackId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:isTrackSaved', trackId),

    // Search & Browse
    search: (query: string, types?: string[]): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:search', query, types),
    getDevices: (): Promise<IPCResult> => ipcRenderer.invoke('spotify:getDevices'),
    transferPlayback: (deviceId: string, play?: boolean): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:transferPlayback', deviceId, play),
    getPlaylists: (limit?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:getPlaylists', limit),
    addToQueue: (uri: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:addToQueue', uri),

    // Voice command
    executeVoiceCommand: (command: string): Promise<IPCResult> =>
      ipcRenderer.invoke('spotify:executeVoiceCommand', command),

    // Events
    onPlaybackChanged: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('spotify:playbackChanged', listener);
      return () => ipcRenderer.removeListener('spotify:playbackChanged', listener);
    },
    onAuthenticated: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('spotify:authenticated', listener);
      return () => ipcRenderer.removeListener('spotify:authenticated', listener);
    },
    onLoggedOut: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('spotify:loggedOut', listener);
      return () => ipcRenderer.removeListener('spotify:loggedOut', listener);
    },
  },

  // Media Control (works with any media player via system media keys)
  media: {
    play: (): Promise<IPCResult> => ipcRenderer.invoke('media:play'),
    pause: (): Promise<IPCResult> => ipcRenderer.invoke('media:pause'),
    playPause: (): Promise<IPCResult> => ipcRenderer.invoke('media:playPause'),
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('media:stop'),
    next: (): Promise<IPCResult> => ipcRenderer.invoke('media:next'),
    previous: (): Promise<IPCResult> => ipcRenderer.invoke('media:previous'),
    volumeUp: (amount?: number): Promise<IPCResult> => ipcRenderer.invoke('media:volumeUp', amount),
    volumeDown: (amount?: number): Promise<IPCResult> => ipcRenderer.invoke('media:volumeDown', amount),
    mute: (): Promise<IPCResult> => ipcRenderer.invoke('media:mute'),
    control: (action: string, amount?: number): Promise<IPCResult> =>
      ipcRenderer.invoke('media:control', action, amount),
  },

  // Banking Integration (UK Open Banking via TrueLayer)
  banking: {
    // Connection
    isConnected: (): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('banking:is-connected'),
    getAuthorizationUrl: (institutionId?: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('banking:get-authorization-url', institutionId),
    completeAuthorization: (code: string): Promise<IPCResult<{ accessToken: string; refreshToken: string }>> =>
      ipcRenderer.invoke('banking:complete-authorization', code),
    disconnect: (institutionId?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:disconnect', institutionId),

    // Accounts
    getAccounts: (): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('banking:get-accounts'),
    getBalanceSummary: (): Promise<IPCResult<{ totalBalance: number; totalAvailable: number; netWorth: number; byType: Record<string, number> }>> =>
      ipcRenderer.invoke('banking:get-balance-summary'),
    syncAccounts: (institutionId?: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:sync-accounts', institutionId),
    getConnectedInstitutions: (): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('banking:get-connected-institutions'),

    // Transactions
    getTransactions: (options?: { accountId?: string; startDate?: string; endDate?: string; limit?: number; category?: string }): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('banking:get-transactions', options),
    getSpendingSummary: (period: 'day' | 'week' | 'month' | 'year'): Promise<IPCResult<{ totalSpent: number; totalIncome: number; netChange: number; byCategory: Record<string, number> }>> =>
      ipcRenderer.invoke('banking:get-spending-summary', period),

    // UK Payments (Open Banking Payment Initiation)
    createPayment: (request: { recipientName: string; amount: number; sortCode: string; accountNumber: string; reference?: string }): Promise<IPCResult<{ paymentId: string; status: string }>> =>
      ipcRenderer.invoke('banking:create-payment', request),
    confirmPayment: (paymentId: string, pin?: string): Promise<IPCResult<{ paymentId: string; status: string; confirmationCode?: string }>> =>
      ipcRenderer.invoke('banking:confirm-payment', paymentId, pin),
    cancelPayment: (paymentId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:cancel-payment', paymentId),
    getPaymentStatus: (paymentId: string): Promise<IPCResult<{ paymentId: string; status: string }>> =>
      ipcRenderer.invoke('banking:get-payment-status', paymentId),
    initiateUKPayment: (request: { recipientName: string; amount: number; sortCode: string; accountNumber: string; reference?: string }): Promise<IPCResult<{ paymentId: string; authUrl: string }>> =>
      ipcRenderer.invoke('banking:initiate-uk-payment', request),
    getUKPaymentStatus: (paymentId: string): Promise<IPCResult<{ status: string; details?: unknown }>> =>
      ipcRenderer.invoke('banking:get-uk-payment-status', paymentId),

    // Quick Pay (saved recipients)
    quickPay: (recipientName: string, amount: number, description?: string): Promise<IPCResult<{ paymentId: string; status: string }>> =>
      ipcRenderer.invoke('banking:quick-pay', recipientName, amount, description),
    getSavedRecipients: (): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('banking:get-saved-recipients'),
    saveRecipient: (recipient: { name: string; sortCode: string; accountNumber: string; nickname?: string }): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:save-recipient', recipient),
    deleteRecipient: (name: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:delete-recipient', name),

    // Security
    setupPin: (pin: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:setup-pin', pin),
    verifyPin: (pin: string): Promise<IPCResult<boolean>> =>
      ipcRenderer.invoke('banking:verify-pin', pin),
    changePin: (oldPin: string, newPin: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:change-pin', oldPin, newPin),
    getSpendingLimits: (): Promise<IPCResult<{ daily: { limit: number; spent: number; remaining: number }; weekly: { limit: number; spent: number; remaining: number }; monthly: { limit: number; spent: number; remaining: number } }>> =>
      ipcRenderer.invoke('banking:get-spending-limits'),
    setSpendingLimit: (type: 'daily' | 'weekly' | 'monthly' | 'per_transaction', amount: number): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:set-spending-limit', type, amount),
    getSecuritySettings: (): Promise<IPCResult<unknown>> =>
      ipcRenderer.invoke('banking:get-security-settings'),
    updateSecuritySettings: (settings: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:update-security-settings', settings),

    // =========================================================================
    // Enhanced Features - Transaction Categorization
    // =========================================================================
    categorizeTransaction: (txId: string, description: string, merchantName?: string): Promise<IPCResult<{ category: string; confidence: number }>> =>
      ipcRenderer.invoke('banking:categorize-transaction', txId, description, merchantName),
    correctCategory: (merchantPattern: string, correctCategory: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:correct-category', merchantPattern, correctCategory),
    suggestCategories: (description: string): Promise<IPCResult<Array<{ category: string; confidence: number }>>> =>
      ipcRenderer.invoke('banking:suggest-categories', description),
    getCategorizerStats: (): Promise<IPCResult<{ totalCategorized: number; corrections: number; accuracy: number }>> =>
      ipcRenderer.invoke('banking:get-categorizer-stats'),

    // =========================================================================
    // Enhanced Features - Balance Alerts
    // =========================================================================
    createBalanceAlert: (accountId: string, type: 'low_balance' | 'large_withdrawal' | 'overdraft' | 'daily_spending', threshold?: number): Promise<IPCResult<{ id: string }>> =>
      ipcRenderer.invoke('banking:create-alert-config', accountId, type, threshold),
    getBalanceAlerts: (): Promise<IPCResult<Array<{ id: string; type: string; threshold?: number; enabled: boolean }>>> =>
      ipcRenderer.invoke('banking:get-alert-configs'),
    updateBalanceAlert: (alertId: string, updates: Record<string, unknown>): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:update-alert-config', alertId, updates),
    deleteBalanceAlert: (alertId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:delete-alert-config', alertId),
    checkBalanceAlerts: (accountId: string, balance: number): Promise<IPCResult<Array<{ type: string; message: string }>>> =>
      ipcRenderer.invoke('banking:check-balance-alerts', accountId, balance),

    // =========================================================================
    // Enhanced Features - Recurring Payments
    // =========================================================================
    getSubscriptions: (): Promise<IPCResult<Array<{ id: string; merchantName: string; amount: number; frequency: string; isActive: boolean }>>> =>
      ipcRenderer.invoke('banking:get-subscriptions'),
    detectRecurringPayments: (transactions: unknown[]): Promise<IPCResult<Array<{ merchantName: string; amount: number; frequency: string }>>> =>
      ipcRenderer.invoke('banking:detect-recurring'),
    markSubscriptionInactive: (subscriptionId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:mark-subscription-inactive', subscriptionId),
    getSubscriptionAlerts: (): Promise<IPCResult<Array<{ type: string; subscription: string; message: string }>>> =>
      ipcRenderer.invoke('banking:get-subscription-alerts'),

    // =========================================================================
    // Enhanced Features - Spending Predictions
    // =========================================================================
    predictSpending: (currentBalance: number, daysAhead?: number): Promise<IPCResult<{ predictedBalance: number; predictedSpending: number; confidence: number; trend: string }>> =>
      ipcRenderer.invoke('banking:predict-spending', currentBalance, daysAhead),
    getPredictionHistory: (): Promise<IPCResult<Array<{ date: string; predicted: number; actual: number; accuracy: number }>>> =>
      ipcRenderer.invoke('banking:get-prediction-history'),
    updatePredictionModel: (transactions: unknown[]): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:update-prediction-model', transactions),

    // =========================================================================
    // Enhanced Features - Budget Management
    // =========================================================================
    setBudget: (budget: { category: string; amount: number; period: 'weekly' | 'monthly' | 'yearly' }): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:set-budget', budget),
    getBudgets: (): Promise<IPCResult<Array<{ category: string; amount: number; period: string; spent: number; remaining: number }>>> =>
      ipcRenderer.invoke('banking:get-budgets'),
    getBudgetStatus: (category: string): Promise<IPCResult<{ budget: number; spent: number; remaining: number; percentUsed: number }>> =>
      ipcRenderer.invoke('banking:get-budget-status', category),
    deleteBudget: (category: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:delete-budget', category),
    getBudgetAlerts: (): Promise<IPCResult<Array<{ category: string; percentUsed: number; message: string }>>> =>
      ipcRenderer.invoke('banking:get-budget-alerts'),

    // =========================================================================
    // Enhanced Features - Payment Scheduling
    // =========================================================================
    schedulePayment: (payment: { recipientName: string; amount: number; date: string; frequency?: string; reference?: string }): Promise<IPCResult<{ id: string }>> =>
      ipcRenderer.invoke('banking:schedule-payment', payment),
    getScheduledPayments: (): Promise<IPCResult<Array<{ id: string; recipientName: string; amount: number; nextDue: string; frequency: string; status: string }>>> =>
      ipcRenderer.invoke('banking:get-scheduled-payments'),
    getUpcomingPayments: (days?: number): Promise<IPCResult<Array<{ recipientName: string; amount: number; dueDate: string; type: string }>>> =>
      ipcRenderer.invoke('banking:get-upcoming-payments', days),
    cancelScheduledPayment: (paymentId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:cancel-scheduled-payment', paymentId),
    pauseScheduledPayment: (paymentId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:pause-scheduled-payment', paymentId),
    resumeScheduledPayment: (paymentId: string): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:resume-scheduled-payment', paymentId),

    // =========================================================================
    // Enhanced Features - Transaction Search & Export
    // =========================================================================
    searchTransactions: (filter: { textQuery?: string; categories?: string[]; minAmount?: number; maxAmount?: number; startDate?: string; endDate?: string }): Promise<IPCResult<unknown[]>> =>
      ipcRenderer.invoke('banking:search-transactions', filter),
    exportTransactions: (transactions: unknown[], format: 'csv' | 'json' | 'qif' | 'ofx'): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('banking:export-transactions', transactions, format),
    getTaxSummary: (startDate: string, endDate: string): Promise<IPCResult<{ totalIncome: number; totalExpenses: number; byCategory: Record<string, number> }>> =>
      ipcRenderer.invoke('banking:get-tax-summary', startDate, endDate),
    downloadExport: (content: string, filename: string): Promise<IPCResult<string>> =>
      ipcRenderer.invoke('banking:download-export', content, filename),

    // =========================================================================
    // Enhanced Features - Direct Debits & Standing Orders
    // =========================================================================
    getDirectDebits: (): Promise<IPCResult<Array<{ id: string; merchantName: string; lastAmount: number; frequency: string; nextExpected?: string }>>> =>
      ipcRenderer.invoke('banking:get-direct-debits'),
    getStandingOrders: (): Promise<IPCResult<Array<{ id: string; merchantName: string; amount: number; frequency: string; nextExpected?: string }>>> =>
      ipcRenderer.invoke('banking:get-standing-orders'),
    getMonthlyCommitted: (): Promise<IPCResult<number>> =>
      ipcRenderer.invoke('banking:get-monthly-committed'),
    getUpcomingDirectDebits: (days?: number): Promise<IPCResult<Array<{ merchantName: string; amount: number; expectedDate: string }>>> =>
      ipcRenderer.invoke('banking:get-upcoming-direct-debits', days),

    // =========================================================================
    // Enhanced Features - Payee Validation (UK CoP)
    // =========================================================================
    validatePayee: (name: string, sortCode: string, accountNumber: string): Promise<IPCResult<{ match: 'exact' | 'close' | 'no_match' | 'unavailable'; actualName?: string; bankName?: string }>> =>
      ipcRenderer.invoke('banking:validate-payee', name, sortCode, accountNumber),
    lookupBank: (sortCode: string): Promise<IPCResult<{ bankName: string; branchName?: string }>> =>
      ipcRenderer.invoke('banking:lookup-bank', sortCode),
    getSavedPayees: (): Promise<IPCResult<Array<{ name: string; sortCode: string; accountNumber: string; validated: boolean }>>> =>
      ipcRenderer.invoke('banking:get-saved-payees'),
    savePayee: (payee: { name: string; sortCode: string; accountNumber: string }): Promise<IPCResult> =>
      ipcRenderer.invoke('banking:save-payee', payee),

    // =========================================================================
    // Enhanced Features - Events
    // =========================================================================
    onBudgetAlert: (callback: (data: { category: string; percentUsed: number; message: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { category: string; percentUsed: number; message: string }) => callback(data);
      ipcRenderer.on('banking:budget-alert', listener);
      return () => ipcRenderer.removeListener('banking:budget-alert', listener);
    },
    onBalanceAlert: (callback: (data: { type: string; accountId: string; message: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { type: string; accountId: string; message: string }) => callback(data);
      ipcRenderer.on('banking:balance-alert', listener);
      return () => ipcRenderer.removeListener('banking:balance-alert', listener);
    },
    onSubscriptionAlert: (callback: (data: { type: string; merchantName: string; message: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { type: string; merchantName: string; message: string }) => callback(data);
      ipcRenderer.on('banking:subscription-alert', listener);
      return () => ipcRenderer.removeListener('banking:subscription-alert', listener);
    },
    onScheduledPaymentDue: (callback: (data: { paymentId: string; recipientName: string; amount: number; dueDate: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { paymentId: string; recipientName: string; amount: number; dueDate: string }) => callback(data);
      ipcRenderer.on('banking:scheduled-payment-due', listener);
      return () => ipcRenderer.removeListener('banking:scheduled-payment-due', listener);
    },

    // Events
    onAccountUpdated: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('banking:account-updated', listener);
      return () => ipcRenderer.removeListener('banking:account-updated', listener);
    },
    onPaymentStatusChanged: (callback: (data: { paymentId: string; status: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { paymentId: string; status: string }) => callback(data);
      ipcRenderer.on('banking:payment-status-changed', listener);
      return () => ipcRenderer.removeListener('banking:payment-status-changed', listener);
    },
    onSecurityAlert: (callback: (data: { type: string; message: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { type: string; message: string }) => callback(data);
      ipcRenderer.on('banking:security-alert', listener);
      return () => ipcRenderer.removeListener('banking:security-alert', listener);
    },
  },

  // Audio Pipeline control (wake word + VAD only - legacy)
  pipeline: {
    start: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:start'),
    stop: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('pipeline:stop'),
    getStatus: (): Promise<{
      state: string;
      isListening: boolean;
      isSpeaking: boolean;
      audioLevel: number;
      lastWakeWord?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('pipeline:get-status'),
    triggerWake: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:trigger-wake'),
    cancel: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:cancel'),
    pause: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:pause'),
    resume: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:resume'),
    setInputDevice: (deviceIndex: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:set-input-device', deviceIndex),
    setOutputDevice: (deviceIndex: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:set-output-device', deviceIndex),
    getConfig: (): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('pipeline:get-config'),
    updateConfig: (
      config: Record<string, unknown>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:update-config', config),
    startSpeaking: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:start-speaking'),
    finishSpeaking: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('pipeline:finish-speaking'),
  },

  // IPC communication
  send: (channel: string, data?: unknown): void => {
    const validChannels = [
      'atlas:wake',
      'atlas:listen',
      'atlas:speak',
      'atlas:stop',
      'atlas:settings',
      // Notification channels
      'notification:show-system',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const validChannels = [
      'atlas:status',
      'atlas:transcript',
      'atlas:response',
      'atlas:error',
      'atlas:audio-level',
      // Legacy pipeline events
      'atlas:pipeline-state',
      'atlas:wake-word',
      'atlas:wake-feedback', // Wake word feedback for UI visualization
      'atlas:speech-start',
      'atlas:speech-segment',
      'atlas:barge-in',
      'atlas:listening-timeout',
      'atlas:processing-timeout',
      // VAD adaptive events
      'atlas:still-listening', // VAD detected pause but expects more
      'atlas:listening-state', // Current listening state
      // Voice pipeline events (STT + LLM + TTS)
      'atlas:state-change',
      'atlas:transcript-interim',
      'atlas:transcript-final',
      'atlas:emotion-detected', // User emotion detected from speech/text
      'atlas:response-start',
      'atlas:response-chunk',
      'atlas:response-complete',
      'atlas:audio-chunk',
      'atlas:synthesis-complete',
      'atlas:speaking-start',
      'atlas:speaking-end',
      'atlas:started',
      'atlas:stopped',
      'atlas:provider-change',
      // Tool execution events (Claude Code-like UI)
      'atlas:tool-start',
      'atlas:tool-complete',
      'atlas:tool-error',
      // TTS audio for visualization
      'atlas:tts-audio',
      // Budget events
      'atlas:budget-update',
      'atlas:budget-warning',
      'atlas:budget-exceeded',
      // Banking events
      'banking:account-updated',
      'banking:payment-status-changed',
      'banking:security-alert',
      // Tray events
      'atlas:open-settings',
      // Error notifications
      'atlas:error-notification',
      // Audio device events
      'atlas:audio-devices-changed',
      // Connectivity events
      'atlas:connectivity-change',
      // Warmup events
      'atlas:warmup-status',
      // Smart Provider events
      'atlas:stt-provider-change',
      'atlas:tts-provider-change',
      'atlas:llm-provider-change',
      // Auto Update events
      'atlas:update-checking',
      'atlas:update-available',
      'atlas:update-not-available',
      'atlas:update-progress',
      'atlas:update-downloaded',
      'atlas:update-error',
      'atlas:update-cancelled',
      'atlas:update-scheduled',
      'atlas:update-action',
      'atlas:in-app-notification',
      // Keyboard Shortcut events
      'atlas:shortcut',
      'atlas:shortcuts-config',
      'atlas:open-command-palette',
      'atlas:focus-input',
      // 045-A: Background Research events
      'atlas:research-result',
      'atlas:research-status',
      // 045-B: Smart Notification events
      'atlas:smart-notification',
      'atlas:notification-dismissed',
      // 045-C: Task Scheduler events
      'atlas:task-created',
      'atlas:task-due',
      'atlas:reminder-sent',
      // Notification Center events
      'notification:created',
      'notification:clicked',
      'notification:action',
      'notification:settings-changed',
      'notification:history-cleared',
      // Task Framework events (T2 Phase 0)
      'task:queued',
      'task:started',
      'task:progress',
      'task:step-started',
      'task:step-completed',
      'task:completed',
      'task:cancelled',
      'task:paused',
      'task:resumed',
      'task:error',
      // T5-205: Speaker ID events
      'speaker:identified',
      'speaker:enrolled',
      'speaker:diarization-complete',
      'speaker:error',
      // Business Module events
      'business:reminder',
      'business:reminders-updated',
      'business:timer-started',
      'business:timer-stopped',
      'business:invoice-created',
      'business:payment-received',
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        callback(...args);
      ipcRenderer.on(channel, subscription);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    return () => { }; // No-op cleanup for invalid channels
  },

  invoke: async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const validChannels = [
      'get-app-version',
      'get-app-path',
      'is-dev',
      'get-atlas-status',
      'get-config',
      'log',
      'atlas:process-audio',
      'atlas:send-message',
      // Wake word channels
      'voice:start-wake-word',
      'voice:stop-wake-word',
      'voice:pause-wake-word',
      'voice:resume-wake-word',
      'voice:set-sensitivity',
      'voice:get-audio-devices',
      'voice:set-audio-device',
      'voice:refresh-audio-devices',
      'voice:start-device-monitoring',
      'voice:stop-device-monitoring',
      'voice:get-status',
      // Legacy pipeline channels
      'pipeline:start',
      'pipeline:stop',
      'pipeline:get-status',
      'pipeline:trigger-wake',
      'pipeline:cancel',
      'pipeline:pause',
      'pipeline:resume',
      'pipeline:set-input-device',
      'pipeline:set-output-device',
      'pipeline:get-config',
      'pipeline:update-config',
      'pipeline:start-speaking',
      'pipeline:finish-speaking',
      // Voice pipeline channels (STT + LLM + TTS)
      'atlas:start',
      'atlas:stop',
      'atlas:shutdown',
      'atlas:get-status',
      'atlas:trigger-wake',
      'atlas:send-text',
      'atlas:clear-history',
      'atlas:get-context',
      'atlas:get-metrics',
      'atlas:update-config',
      'atlas:get-config',
      // Memory channels
      'atlas:get-conversation-history',
      'atlas:clear-memory',
      'atlas:get-memory-stats',
      'atlas:search-memory',
      'atlas:get-all-sessions',
      // Budget channels
      'atlas:get-budget-stats',
      'atlas:set-daily-budget',
      // Personality channels
      'atlas:get-personality',
      'atlas:set-personality-preset',
      'atlas:set-personality-trait',
      // Connectivity channels
      'atlas:get-connectivity',
      'atlas:is-online',
      'atlas:check-connectivity',
      'atlas:is-service-available',
      // GPU channels
      'atlas:set-gpu-info',
      'atlas:get-gpu-capabilities',
      'atlas:get-recommended-particles',
      'atlas:get-render-config',
      // Smart Provider channels
      'atlas:get-current-providers',
      'atlas:force-stt-provider',
      'atlas:force-tts-provider',
      'atlas:force-llm-provider',
      'atlas:reselect-providers',
      // Response Cache channels
      'atlas:get-cache-stats',
      'atlas:clear-cache',
      'atlas:set-cache-enabled',
      'atlas:is-cache-enabled',
      // Error action channels
      'atlas:retry-last',
      'atlas:set-offline-mode',
      // Warmup channels
      'warmup:get-status',
      // Auto Update channels
      'updater:get-state',
      'updater:check-for-updates',
      'updater:download-update',
      'updater:install-update',
      'updater:install-on-quit',
      'updater:cancel-download',
      'updater:get-config',
      'updater:update-config',
      'updater:get-rollback-info',
      'updater:rollback',
      // Keyboard Shortcuts channels
      'shortcuts:get-status',
      'shortcuts:get-config',
      'shortcuts:get-bindings',
      'shortcuts:update-config',
      'shortcuts:set-binding',
      'shortcuts:reset-binding',
      'shortcuts:set-enabled',
      'shortcuts:set-global-enabled',
      // Development channels (048-A)
      'dev:get-status',
      'dev:reload-main',
      'dev:clear-state',
      'dev:get-state',
      'dev:toggle-devtools',
      'dev:reload-renderer',
      // Performance Profiler channels (048-C)
      'profiler:get-snapshot',
      'profiler:get-memory',
      'profiler:get-cpu',
      'profiler:get-event-loop',
      'profiler:get-summary',
      'profiler:get-recent',
      'profiler:start-monitoring',
      'profiler:stop-monitoring',
      'profiler:start-session',
      'profiler:end-session',
      'profiler:get-sessions',
      'profiler:force-gc',
      'profiler:get-heap-info',
      'profiler:clear',
      // 045-A: Background Research channels
      'research:get-queue',
      'research:get-state',
      'research:queue-topic',
      'research:get-result',
      'research:get-all-results',
      'research:get-context',
      'research:clear-queue',
      'research:clear-results',
      'research:notify-activity',
      'research:set-enabled',
      // 045-C: Task Scheduler channels
      'scheduler:create-task',
      'scheduler:create-reminder',
      'scheduler:get-all-tasks',
      'scheduler:get-pending-tasks',
      'scheduler:get-due-tasks',
      'scheduler:get-upcoming-tasks',
      'scheduler:complete-task',
      'scheduler:delete-task',
      'scheduler:snooze-task',
      'scheduler:get-stats',
      'scheduler:clear-completed',
      // 046-A: Keychain (Secure Storage) channels
      'keychain:get-key',
      'keychain:set-key',
      'keychain:delete-key',
      'keychain:has-key',
      'keychain:list-keys',
      'keychain:get-masked-key',
      'keychain:clear-all',
      'keychain:check-health',
      'keychain:get-supported-keys',
      // T3-022: Tools channels
      'tools:list',
      'tools:get-summary',
      'tools:get-by-category',
      'tools:execute',
      'tools:execute-batch',
      'tools:execute-parallel',
      'tools:has',
      'tools:count',
      // Coding Agent channels
      'coding:execute',
      'coding:execute-stream',
      'coding:voice-command',
      'coding:parse-voice',
      'coding:get-session',
      'coding:abort',
      'coding:update-config',
      'coding:get-config',
      'coding:get-context',
      'coding:get-edit-history',
      'coding:rollback',
      // T3-Phase 5: Trading channels
      'trading:get-aggregated-balance',
      'trading:get-exchange-balance',
      'trading:get-all-positions',
      'trading:get-position-summary',
      'trading:get-performance',
      'trading:get-pnl',
      'trading:get-exchanges',
      'trading:take-snapshot',
      'trading:get-snapshots',
      'trading:create-alert',
      'trading:cancel-alert',
      'trading:get-alerts',
      'trading:get-active-alerts',
      'trading:get-alerts-by-exchange',
      'trading:get-alerts-by-symbol',
      'trading:update-alert',
      'trading:reactivate-alert',
      'trading:get-alert-stats',
      'trading:clear-alerts',
      'trading:get-trades',
      'trading:get-orders',
      'trading:get-recent-trades',
      'trading:get-recent-orders',
      'trading:get-trade-summary',
      'trading:get-most-traded',
      'trading:get-history-counts',
      'trading:sync-history',
      'trading:clear-history-cache',
      // Autonomous Trading channels
      'trading:autonomous:start',
      'trading:autonomous:stop',
      'trading:autonomous:pause',
      'trading:autonomous:resume',
      'trading:autonomous:status',
      'trading:autonomous:config',
      'trading:killswitch:trigger',
      'trading:killswitch:reset',
      'trading:killswitch:status',
      'trading:backtest:run',
      'trading:backtest:status',
      'trading:backtest:result',
      'trading:backtest:cancel',
      'trading:backtest:list',
      'trading:signals:list',
      'trading:signals:subscribe',
      'trading:signals:unsubscribe',
      'trading:risk:metrics',
      'trading:risk:limits',
      'trading:feedback:submit',
      'trading:backend:connect',
      'trading:backend:disconnect',
      'trading:backend:status',
      // T3-Phase 6: Finance channels
      'finance:initialize',
      'finance:status',
      'finance:authorize',
      'finance:exchange-code',
      'finance:disconnect',
      'finance:shutdown',
      'finance:accounts',
      'finance:balance',
      'finance:all-balances',
      'finance:transactions',
      'finance:pending-transactions',
      'finance:recategorize',
      'finance:spending-by-category',
      'finance:spending-report',
      'finance:insights',
      'finance:create-budget',
      'finance:update-budget',
      'finance:delete-budget',
      'finance:budgets',
      'finance:budget-status',
      'finance:all-budget-statuses',
      'finance:budget-summary',
      'finance:direct-debits',
      'finance:standing-orders',
      'finance:cards',
      'finance:card-balance',
      'finance:card-transactions',
      'finance:providers',
      // Banking Integration channels (UK Open Banking)
      'banking:is-connected',
      'banking:get-authorization-url',
      'banking:complete-authorization',
      'banking:disconnect',
      'banking:get-accounts',
      'banking:get-balance-summary',
      'banking:sync-accounts',
      'banking:get-connected-institutions',
      'banking:get-transactions',
      'banking:get-spending-summary',
      'banking:create-payment',
      'banking:confirm-payment',
      'banking:cancel-payment',
      'banking:get-payment-status',
      'banking:initiate-uk-payment',
      'banking:get-uk-payment-status',
      'banking:quick-pay',
      'banking:get-saved-recipients',
      'banking:save-recipient',
      'banking:delete-recipient',
      'banking:setup-pin',
      'banking:verify-pin',
      'banking:change-pin',
      'banking:get-spending-limits',
      'banking:set-spending-limit',
      'banking:get-security-settings',
      'banking:update-security-settings',
      // Task Framework channels (T2 Phase 0)
      'task:create',
      'task:get',
      'task:get-queued',
      'task:get-running',
      'task:get-recent',
      'task:get-stats',
      'task:cancel',
      'task:pause',
      'task:resume',
      'task:clear-completed',
      // T5-205: Speaker ID channels
      'speaker:initialize',
      'speaker:is-configured',
      'speaker:identify',
      'speaker:identify-file',
      'speaker:enroll',
      'speaker:enroll-files',
      'speaker:update',
      'speaker:list',
      'speaker:get',
      'speaker:get-by-name',
      'speaker:delete',
      'speaker:count',
      'speaker:diarize',
      'speaker:diarize-file',
      'speaker:extract-embedding',
      'speaker:compare-embeddings',
      'speaker:set-python-path',
      // Dashboard channels (Phase 12)
      'dashboard:initialize',
      'dashboard:get-data',
      'dashboard:get-goals',
      'dashboard:save-goals',
      'dashboard:save-goal',
      'dashboard:delete-goal',
      'dashboard:update-goal-progress',
      'dashboard:get-workflows',
      'dashboard:save-workflows',
      'dashboard:save-workflow',
      'dashboard:delete-workflow',
      'dashboard:execute-workflow',
      'dashboard:get-agents',
      'dashboard:save-agents',
      'dashboard:get-integrations',
      'dashboard:save-integrations',
      'dashboard:update-integration-status',
      'dashboard:get-metrics',
      'dashboard:check-integration-health',
      // Brain (Cognitive) channels
      'brain:get-stats',
      'brain:get-visualization',
      'brain:recall',
      'brain:learn',
      'brain:get-entity',
      'brain:get-user-knowledge',
      'brain:ask',
      'brain:associate',
      // Intelligence Platform channels
      'intelligence:entity:create',
      'intelligence:entity:get',
      'intelligence:entity:update',
      'intelligence:entity:delete',
      'intelligence:entity:search',
      'intelligence:entity:byType',
      'intelligence:relationship:create',
      'intelligence:relationship:forEntity',
      'intelligence:relationship:delete',
      'intelligence:graph:findPaths',
      'intelligence:graph:connected',
      'intelligence:graph:centrality',
      'intelligence:graph:communities',
      'intelligence:graph:influential',
      'intelligence:agent:query',
      'intelligence:agent:querySpecific',
      'intelligence:agent:alerts',
      'intelligence:agent:recommendations',
      'intelligence:agent:status',
      'intelligence:cop:state',
      'intelligence:cop:summary',
      'intelligence:cop:alerts',
      'intelligence:cop:acknowledge',
      'intelligence:cop:snooze',
      'intelligence:cop:startContext',
      'intelligence:cop:endContext',
      'intelligence:playbook:list',
      'intelligence:playbook:get',
      'intelligence:playbook:execute',
      'intelligence:playbook:stop',
      'intelligence:playbook:status',
      'intelligence:dynamic:patterns',
      'intelligence:dynamic:predictions',
      'intelligence:dynamic:behavior',
      'intelligence:dynamic:feedback',
      'intelligence:security:status',
      'intelligence:security:audit',
      'intelligence:security:permissions',
      // Code Intelligence channels (Self-Coding)
      'code-intelligence:get-status',
      'code-intelligence:initialize',
      'code-intelligence:shutdown',
      'code-intelligence:find-symbol',
      'code-intelligence:find-references',
      'code-intelligence:go-to-definition',
      'code-intelligence:build-context',
      'code-intelligence:start-session',
      'code-intelligence:get-session',
      'code-intelligence:apply-change',
      'code-intelligence:validate',
      'code-intelligence:revert-last',
      'code-intelligence:end-session',
      'code-intelligence:rebuild-index',
      'code-intelligence:get-index-stats',
      // Business Module channels
      'business:overview',
      'business:clients:list',
      'business:clients:get',
      'business:clients:create',
      'business:clients:update',
      'business:clients:log-interaction',
      'business:clients:stats',
      'business:projects:list',
      'business:projects:get',
      'business:projects:create',
      'business:projects:update-status',
      'business:projects:add-milestone',
      'business:projects:stats',
      'business:time:start',
      'business:time:stop',
      'business:time:status',
      'business:time:create-entry',
      'business:time:entries',
      'business:invoices:list',
      'business:invoices:get',
      'business:invoices:create',
      'business:invoices:record-payment',
      'business:invoices:mark-sent',
      'business:invoices:generate-text',
      'business:invoices:stats',
      'business:expenses:list',
      'business:expenses:create',
      'business:expenses:category-breakdown',
      'business:expenses:vat-summary',
      'business:expenses:stats',
      'business:leads:list',
      'business:leads:get',
      'business:leads:create',
      'business:leads:update-status',
      'business:leads:convert-to-client',
      'business:leads:pipeline',
      'business:reminders:list',
      'business:reminders:acknowledge',
      'business:reminders:snooze',
      'business:reminders:voice-summary',
      'business:reports:weekly',
      'business:reports:monthly',
      'business:reports:quarterly',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Invalid channel: ${channel}`);
  },

  // Logging helper
  log: (level: string, module: string, message: string, meta?: Record<string, unknown>): void => {
    ipcRenderer.invoke('log', level, module, message, meta);
  },
};

// Expose to renderer
contextBridge.exposeInMainWorld('atlas', atlasAPI);

// Type declaration for renderer
export type AtlasAPI = typeof atlasAPI;

// eslint-disable-next-line no-console
console.log('[Atlas] Preload script loaded');
