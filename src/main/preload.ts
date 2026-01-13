/**
 * Nova Desktop - Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * IPC Result type
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Voice Pipeline Status
 */
interface VoicePipelineStatus {
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
interface VoicePipelineConfig {
  sttProvider?: 'deepgram' | 'vosk' | 'whisper';
  llmProvider?: 'fireworks' | 'openrouter';
  ttsEnabled?: boolean;
  bargeInEnabled?: boolean;
  systemPrompt?: string;
}

/**
 * Nova API exposed to renderer
 */
const novaAPI = {
  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getAppPath: (): Promise<string> => ipcRenderer.invoke('get-app-path'),
  isDev: (): Promise<boolean> => ipcRenderer.invoke('is-dev'),

  // Nova status
  getStatus: (): Promise<{
    status: string;
    version: string;
    isDev: boolean;
  }> => ipcRenderer.invoke('get-nova-status'),

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
    getStatus: (): Promise<{
      wakeWordActive: boolean;
      wakeWordPaused: boolean;
      configValid: boolean;
    }> => ipcRenderer.invoke('voice:get-status'),
  },

  // Full Voice Pipeline (STT + LLM + TTS)
  nova: {
    // Lifecycle
    start: (config?: Partial<VoicePipelineConfig>): Promise<IPCResult> =>
      ipcRenderer.invoke('nova:start', config),
    stop: (): Promise<IPCResult> => ipcRenderer.invoke('nova:stop'),
    shutdown: (): Promise<IPCResult> => ipcRenderer.invoke('nova:shutdown'),

    // Status
    getStatus: (): Promise<IPCResult<VoicePipelineStatus>> => ipcRenderer.invoke('nova:get-status'),

    // Interaction
    triggerWake: (): Promise<IPCResult> => ipcRenderer.invoke('nova:trigger-wake'),
    sendText: (text: string): Promise<IPCResult> => ipcRenderer.invoke('nova:send-text', text),

    // Context management
    clearHistory: (): Promise<IPCResult> => ipcRenderer.invoke('nova:clear-history'),
    getContext: (): Promise<IPCResult> => ipcRenderer.invoke('nova:get-context'),
    getMetrics: (): Promise<IPCResult> => ipcRenderer.invoke('nova:get-metrics'),

    // Configuration
    updateConfig: (config: Partial<VoicePipelineConfig>): Promise<IPCResult> =>
      ipcRenderer.invoke('nova:update-config', config),
    getConfig: (): Promise<IPCResult<VoicePipelineConfig | null>> =>
      ipcRenderer.invoke('nova:get-config'),
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
    const validChannels = ['nova:wake', 'nova:listen', 'nova:speak', 'nova:stop', 'nova:settings'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const validChannels = [
      'nova:status',
      'nova:transcript',
      'nova:response',
      'nova:error',
      'nova:audio-level',
      // Legacy pipeline events
      'nova:pipeline-state',
      'nova:wake-word',
      'nova:speech-start',
      'nova:speech-segment',
      'nova:barge-in',
      'nova:listening-timeout',
      'nova:processing-timeout',
      // Voice pipeline events (STT + LLM + TTS)
      'nova:state-change',
      'nova:transcript-interim',
      'nova:transcript-final',
      'nova:response-start',
      'nova:response-chunk',
      'nova:response-complete',
      'nova:audio-chunk',
      'nova:synthesis-complete',
      'nova:speaking-start',
      'nova:speaking-end',
      'nova:started',
      'nova:stopped',
      'nova:provider-change',
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
    return () => {}; // No-op cleanup for invalid channels
  },

  invoke: async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const validChannels = [
      'get-app-version',
      'get-app-path',
      'is-dev',
      'get-nova-status',
      'get-config',
      'log',
      'nova:process-audio',
      'nova:send-message',
      // Wake word channels
      'voice:start-wake-word',
      'voice:stop-wake-word',
      'voice:pause-wake-word',
      'voice:resume-wake-word',
      'voice:set-sensitivity',
      'voice:get-audio-devices',
      'voice:set-audio-device',
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
      'nova:start',
      'nova:stop',
      'nova:shutdown',
      'nova:get-status',
      'nova:trigger-wake',
      'nova:send-text',
      'nova:clear-history',
      'nova:get-context',
      'nova:get-metrics',
      'nova:update-config',
      'nova:get-config',
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
contextBridge.exposeInMainWorld('nova', novaAPI);

// Type declaration for renderer
export type NovaAPI = typeof novaAPI;

console.log('[Nova] Preload script loaded');
