/**
 * Nova TTS - Preload API
 * Exposes Nova TTS functionality to the renderer process
 */

import { ipcRenderer, contextBridge, IpcRendererEvent } from 'electron';

// ============================================================================
// Type Definitions
// ============================================================================

/** Voice clone configuration */
export interface VoiceCloneConfig {
  name: string;
  description?: string;
  audioSamples: Buffer[] | string[];
  labels?: Record<string, string>;
}

/** Speech synthesis options */
export interface SpeakOptions {
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
  speed?: number;
  pitch?: number;
}

/** Download progress event */
export interface DownloadProgress {
  voiceId: string;
  progress: number;
  downloaded: number;
  total: number;
  status: 'downloading' | 'complete' | 'error';
  error?: string;
}

/** Audio chunk from synthesis */
export interface AudioChunk {
  id: string;
  data: Buffer;
  index: number;
  isLast: boolean;
}

/** Synthesis result */
export interface SynthesisResult {
  id: string;
  text: string;
  audioBuffer?: Buffer;
  duration?: number;
  cached: boolean;
}

/** Queue item */
export interface QueueItem {
  id: string;
  text: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  priority: number;
}

// IPC channel names (must match main process)
const IPC_CHANNELS = {
  GET_VOICES: 'nova-tts:get-voices',
  GET_VOICE: 'nova-tts:get-voice',
  IS_VOICE_DOWNLOADED: 'nova-tts:is-voice-downloaded',
  GET_ENGINE_INFO: 'nova-tts:get-engine-info',
  GET_ACTIVE_ENGINE: 'nova-tts:get-active-engine',
  GET_QUEUE: 'nova-tts:get-queue',
  GET_RECOMMENDED_VOICES: 'nova-tts:get-recommended-voices',
  SEARCH_VOICES: 'nova-tts:search-voices',
  DOWNLOAD_VOICE: 'nova-tts:download-voice',
  DELETE_VOICE: 'nova-tts:delete-voice',
  CLONE_VOICE: 'nova-tts:clone-voice',
  DELETE_CLONED_VOICE: 'nova-tts:delete-cloned-voice',
  SPEAK: 'nova-tts:speak',
  SYNTHESIZE: 'nova-tts:synthesize',
  STOP: 'nova-tts:stop',
  PAUSE: 'nova-tts:pause',
  RESUME: 'nova-tts:resume',
  CLEAR_QUEUE: 'nova-tts:clear-queue',
  SET_ACTIVE_ENGINE: 'nova-tts:set-active-engine',
  PREVIEW_VOICE: 'nova-tts:preview-voice',
  DOWNLOAD_PROGRESS: 'nova-tts:download-progress',
  CLONE_PROGRESS: 'nova-tts:clone-progress',
  SYNTHESIS_START: 'nova-tts:synthesis-start',
  AUDIO_CHUNK: 'nova-tts:audio-chunk',
  SYNTHESIS_COMPLETE: 'nova-tts:synthesis-complete',
  SYNTHESIS_ERROR: 'nova-tts:synthesis-error',
  PLAYBACK_START: 'nova-tts:playback-start',
  PLAYBACK_END: 'nova-tts:playback-end',
  QUEUE_UPDATE: 'nova-tts:queue-update',
  ENGINE_STATUS: 'nova-tts:engine-status',
} as const;

/**
 * Nova TTS API exposed to renderer
 */
export const novaTTSAPI = {
  // Voice management
  getVoices: () => ipcRenderer.invoke(IPC_CHANNELS.GET_VOICES),
  getVoice: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_VOICE, voiceId),
  isVoiceDownloaded: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.IS_VOICE_DOWNLOADED, voiceId),
  downloadVoice: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_VOICE, voiceId),
  deleteVoice: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_VOICE, voiceId),
  getRecommendedVoices: () => ipcRenderer.invoke(IPC_CHANNELS.GET_RECOMMENDED_VOICES),
  searchVoices: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_VOICES, query),

  // Voice cloning
  cloneVoice: (config: VoiceCloneConfig) => ipcRenderer.invoke(IPC_CHANNELS.CLONE_VOICE, config),
  deleteClonedVoice: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_CLONED_VOICE, voiceId),

  // Speech synthesis
  speak: (text: string, options?: SpeakOptions) => ipcRenderer.invoke(IPC_CHANNELS.SPEAK, text, options),
  synthesize: (text: string, options: SpeakOptions) => ipcRenderer.invoke(IPC_CHANNELS.SYNTHESIZE, text, options),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.STOP),
  pause: () => ipcRenderer.invoke(IPC_CHANNELS.PAUSE),
  resume: () => ipcRenderer.invoke(IPC_CHANNELS.RESUME),
  previewVoice: (voiceId: string) => ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_VOICE, voiceId),

  // Queue management
  getQueue: () => ipcRenderer.invoke(IPC_CHANNELS.GET_QUEUE),
  clearQueue: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_QUEUE),

  // Engine management
  getEngineInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ENGINE_INFO),
  getActiveEngine: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIVE_ENGINE),
  setActiveEngine: (engine: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_ACTIVE_ENGINE, engine),

  // Event listeners
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_: IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, listener);
  },

  onCloneProgress: (callback: (voiceId: string, stage: string, progress: number) => void) => {
    const listener = (_: IpcRendererEvent, voiceId: string, stage: string, progress: number) => 
      callback(voiceId, stage, progress);
    ipcRenderer.on(IPC_CHANNELS.CLONE_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CLONE_PROGRESS, listener);
  },

  onSynthesisStart: (callback: (id: string, text: string, options: SpeakOptions) => void) => {
    const listener = (_: IpcRendererEvent, id: string, text: string, options: SpeakOptions) => 
      callback(id, text, options);
    ipcRenderer.on(IPC_CHANNELS.SYNTHESIS_START, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SYNTHESIS_START, listener);
  },

  onAudioChunk: (callback: (chunk: AudioChunk) => void) => {
    const listener = (_: IpcRendererEvent, chunk: AudioChunk) => callback(chunk);
    ipcRenderer.on(IPC_CHANNELS.AUDIO_CHUNK, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_CHUNK, listener);
  },

  onSynthesisComplete: (callback: (result: SynthesisResult) => void) => {
    const listener = (_: IpcRendererEvent, result: SynthesisResult) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.SYNTHESIS_COMPLETE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SYNTHESIS_COMPLETE, listener);
  },

  onSynthesisError: (callback: (id: string, error: string) => void) => {
    const listener = (_: IpcRendererEvent, id: string, error: string) => callback(id, error);
    ipcRenderer.on(IPC_CHANNELS.SYNTHESIS_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SYNTHESIS_ERROR, listener);
  },

  onPlaybackStart: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.PLAYBACK_START, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PLAYBACK_START, listener);
  },

  onPlaybackEnd: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.PLAYBACK_END, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PLAYBACK_END, listener);
  },

  onQueueUpdate: (callback: (queue: QueueItem[]) => void) => {
    const listener = (_: IpcRendererEvent, queue: QueueItem[]) => callback(queue);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_UPDATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_UPDATE, listener);
  },

  onEngineStatus: (callback: (engine: string, status: string) => void) => {
    const listener = (_: IpcRendererEvent, engine: string, status: string) => callback(engine, status);
    ipcRenderer.on(IPC_CHANNELS.ENGINE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ENGINE_STATUS, listener);
  },
};

// Type for window augmentation
declare global {
  interface Window {
    novaTTS?: typeof novaTTSAPI;
  }
}

/**
 * Expose Nova TTS API to renderer via context bridge
 * Call this in your preload script
 */
export function exposeNovaTTSAPI(): void {
  // Check if already exposed to avoid double registration
  if (window.novaTTS) {
    return;
  }

  contextBridge.exposeInMainWorld('novaTTS', novaTTSAPI);

  // Also expose under electronAPI.tts for compatibility
  const existingAPI = (window as any).electronAPI || {};
  contextBridge.exposeInMainWorld('electronAPI', {
    ...existingAPI,
    tts: novaTTSAPI,
  });
}

export default novaTTSAPI;
