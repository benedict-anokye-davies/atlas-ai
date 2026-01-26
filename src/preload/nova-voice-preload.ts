/**
 * NovaVoice Preload API
 * Exposes NovaVoice functionality to the renderer process
 */

import { ipcRenderer, contextBridge } from 'electron';

/**
 * IPC Channel names (duplicated here for preload isolation)
 */
const NOVA_VOICE_CHANNELS = {
  // Initialization
  INITIALIZE: 'nova-voice:initialize',
  SHUTDOWN: 'nova-voice:shutdown',
  GET_STATUS: 'nova-voice:get-status',
  
  // Pipeline control
  START_LISTENING: 'nova-voice:start-listening',
  STOP_LISTENING: 'nova-voice:stop-listening',
  PROCESS_AUDIO: 'nova-voice:process-audio',
  INTERRUPT: 'nova-voice:interrupt',
  
  // TTS
  SPEAK: 'nova-voice:speak',
  SPEAK_SSML: 'nova-voice:speak-ssml',
  STOP_SPEAKING: 'nova-voice:stop-speaking',
  SET_VOICE: 'nova-voice:set-voice',
  GET_VOICES: 'nova-voice:get-voices',
  
  // Configuration
  SET_CONFIG: 'nova-voice:set-config',
  GET_CONFIG: 'nova-voice:get-config',
  GET_METRICS: 'nova-voice:get-metrics',
  
  // Events (sent from main to renderer)
  EVENT_STATE_CHANGE: 'nova-voice:event:state-change',
  EVENT_VAD_RESULT: 'nova-voice:event:vad-result',
  EVENT_SPEECH_START: 'nova-voice:event:speech-start',
  EVENT_SPEECH_END: 'nova-voice:event:speech-end',
  EVENT_STT_PARTIAL: 'nova-voice:event:stt-partial',
  EVENT_STT_FINAL: 'nova-voice:event:stt-final',
  EVENT_TTS_START: 'nova-voice:event:tts-start',
  EVENT_TTS_CHUNK: 'nova-voice:event:tts-chunk',
  EVENT_TTS_END: 'nova-voice:event:tts-end',
  EVENT_ERROR: 'nova-voice:event:error',
  EVENT_METRICS: 'nova-voice:event:metrics',
} as const;

/**
 * NovaVoice Preload API interface
 */
export interface NovaVoiceAPI {
  // Initialization
  initialize: (config?: unknown, preset?: string) => Promise<{ success: boolean; state?: string; error?: string }>;
  shutdown: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<{
    initialized: boolean;
    state: string;
    metrics: unknown | null;
  }>;
  
  // Pipeline control
  startListening: () => Promise<{ success: boolean; error?: string }>;
  stopListening: () => Promise<{ success: boolean; error?: string }>;
  processAudio: (chunk: {
    data: number[];
    timestamp: number;
    duration: number;
    format: { sampleRate: number; channels: number; bitsPerSample: number };
    isFinal?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  interrupt: () => Promise<{ success: boolean; error?: string }>;
  
  // TTS
  speak: (text: string, options?: unknown) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  speakSSML: (ssml: string, options?: unknown) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  stopSpeaking: () => Promise<{ success: boolean; error?: string }>;
  setVoice: (voiceId: string) => Promise<{ success: boolean; error?: string }>;
  getVoices: () => Promise<{ success: boolean; voices: unknown[]; error?: string }>;
  
  // Configuration
  setConfig: (config: unknown) => Promise<{ success: boolean; error?: string }>;
  getConfig: () => Promise<{ success: boolean; config?: unknown; error?: string }>;
  getMetrics: () => Promise<{ success: boolean; metrics?: unknown; error?: string }>;
  
  // Event listeners
  onStateChange: (callback: (state: string) => void) => () => void;
  onVadResult: (callback: (result: unknown) => void) => () => void;
  onSpeechStart: (callback: () => void) => () => void;
  onSpeechEnd: (callback: (data: { duration: number }) => void) => () => void;
  onSttPartial: (callback: (transcription: unknown) => void) => () => void;
  onSttFinal: (callback: (transcription: unknown) => void) => () => void;
  onTtsStart: (callback: (data: { text: string }) => void) => () => void;
  onTtsChunk: (callback: (chunk: unknown) => void) => () => void;
  onTtsEnd: (callback: () => void) => () => void;
  onError: (callback: (error: { message: string; stack?: string }) => void) => () => void;
  onMetrics: (callback: (metrics: unknown) => void) => () => void;
}

/**
 * Create event listener that returns unsubscribe function
 */
function createEventListener<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * Create event listener for void callbacks (no arguments)
 */
function createVoidEventListener(channel: string, callback: () => void): () => void {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * NovaVoice API implementation
 */
export const novaVoiceAPI: NovaVoiceAPI = {
  // ==========================================
  // INITIALIZATION
  // ==========================================
  
  initialize: (config, preset) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.INITIALIZE, config, preset);
  },
  
  shutdown: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.SHUTDOWN);
  },
  
  getStatus: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.GET_STATUS);
  },
  
  // ==========================================
  // PIPELINE CONTROL
  // ==========================================
  
  startListening: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.START_LISTENING);
  },
  
  stopListening: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.STOP_LISTENING);
  },
  
  processAudio: (chunk) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.PROCESS_AUDIO, chunk);
  },
  
  interrupt: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.INTERRUPT);
  },
  
  // ==========================================
  // TTS
  // ==========================================
  
  speak: (text, options) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.SPEAK, text, options);
  },
  
  speakSSML: (ssml, options) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.SPEAK_SSML, ssml, options);
  },
  
  stopSpeaking: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.STOP_SPEAKING);
  },
  
  setVoice: (voiceId) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.SET_VOICE, voiceId);
  },
  
  getVoices: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.GET_VOICES);
  },
  
  // ==========================================
  // CONFIGURATION
  // ==========================================
  
  setConfig: (config) => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.SET_CONFIG, config);
  },
  
  getConfig: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.GET_CONFIG);
  },
  
  getMetrics: () => {
    return ipcRenderer.invoke(NOVA_VOICE_CHANNELS.GET_METRICS);
  },
  
  // ==========================================
  // EVENT LISTENERS
  // ==========================================
  
  onStateChange: (callback) => {
    return createEventListener<string>(NOVA_VOICE_CHANNELS.EVENT_STATE_CHANGE, callback);
  },
  
  onVadResult: (callback) => {
    return createEventListener<unknown>(NOVA_VOICE_CHANNELS.EVENT_VAD_RESULT, callback);
  },
  
  onSpeechStart: (callback) => {
    return createVoidEventListener(NOVA_VOICE_CHANNELS.EVENT_SPEECH_START, callback);
  },
  
  onSpeechEnd: (callback) => {
    return createEventListener<{ duration: number }>(NOVA_VOICE_CHANNELS.EVENT_SPEECH_END, callback);
  },
  
  onSttPartial: (callback) => {
    return createEventListener<unknown>(NOVA_VOICE_CHANNELS.EVENT_STT_PARTIAL, callback);
  },
  
  onSttFinal: (callback) => {
    return createEventListener<unknown>(NOVA_VOICE_CHANNELS.EVENT_STT_FINAL, callback);
  },
  
  onTtsStart: (callback) => {
    return createEventListener<{ text: string }>(NOVA_VOICE_CHANNELS.EVENT_TTS_START, callback);
  },
  
  onTtsChunk: (callback) => {
    return createEventListener<unknown>(NOVA_VOICE_CHANNELS.EVENT_TTS_CHUNK, callback);
  },
  
  onTtsEnd: (callback) => {
    return createVoidEventListener(NOVA_VOICE_CHANNELS.EVENT_TTS_END, callback);
  },
  
  onError: (callback) => {
    return createEventListener<{ message: string; stack?: string }>(NOVA_VOICE_CHANNELS.EVENT_ERROR, callback);
  },
  
  onMetrics: (callback) => {
    return createEventListener<unknown>(NOVA_VOICE_CHANNELS.EVENT_METRICS, callback);
  },
};

/**
 * Expose NovaVoice API to renderer via context bridge
 * Call this in preload.ts
 */
export function exposeNovaVoiceAPI(): void {
  contextBridge.exposeInMainWorld('novaVoice', novaVoiceAPI);
}

/**
 * TypeScript declaration for window.novaVoice
 * Add this to global.d.ts or use it in renderer
 */
declare global {
  interface Window {
    novaVoice: NovaVoiceAPI;
  }
}
