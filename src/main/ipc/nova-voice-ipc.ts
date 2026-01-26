/**
 * NovaVoice IPC Handlers
 * Electron IPC communication for the unified voice engine
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  NovaVoice,
  getNovaVoice,
  initializeNovaVoice,
  shutdownNovaVoice,
  PipelineConfig,
  PipelineState,
  LatencyMetrics,
  AudioChunk,
  Voice,
  TTSSynthesisOptions,
  ULTRA_LOW_LATENCY_PRESET,
  BALANCED_PRESET,
  HIGH_QUALITY_PRESET,
} from '../voice/nova-voice';

const logger = createModuleLogger('NovaVoice-IPC');

/**
 * IPC Channel names
 */
export const NOVA_VOICE_CHANNELS = {
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
 * Window reference for sending events
 */
let mainWindow: BrowserWindow | null = null;

/**
 * Send event to renderer
 */
function sendToRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Setup event forwarding from NovaVoice to renderer
 */
function setupEventForwarding(voice: NovaVoice): void {
  voice.on('state-change', (state: PipelineState) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_STATE_CHANGE, state);
  });
  
  voice.on('vad-result', (result) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_VAD_RESULT, result);
  });
  
  voice.on('vad-speech-start', () => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_SPEECH_START);
  });
  
  voice.on('vad-speech-end', () => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_SPEECH_END, { duration: 0 });
  });
  
  voice.on('stt-partial', (transcription) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_STT_PARTIAL, transcription);
  });
  
  voice.on('stt-final', (transcription) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_STT_FINAL, transcription);
  });
  
  voice.on('tts-start', (text: string) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_TTS_START, { text });
  });
  
  voice.on('tts-chunk', (chunk: AudioChunk) => {
    // Convert Float32Array to serializable format for IPC
    const serializedChunk = {
      data: Array.from(chunk.data instanceof Float32Array 
        ? chunk.data 
        : new Float32Array(chunk.data.buffer)),
      timestamp: chunk.timestamp,
      duration: chunk.duration,
      format: chunk.format,
      isFinal: chunk.isFinal,
      metadata: chunk.metadata,
    };
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_TTS_CHUNK, serializedChunk);
  });
  
  voice.on('tts-complete', () => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_TTS_END);
  });
  
  voice.on('error', (error: Error) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_ERROR, {
      message: error.message,
      stack: error.stack,
    });
  });
  
  voice.on('latency-metrics', (metrics: LatencyMetrics) => {
    sendToRenderer(NOVA_VOICE_CHANNELS.EVENT_METRICS, metrics);
  });
}

/**
 * Register all NovaVoice IPC handlers
 */
export function registerNovaVoiceIPC(window: BrowserWindow): void {
  mainWindow = window;
  
  logger.info('Registering NovaVoice IPC handlers');
  
  // ==========================================
  // INITIALIZATION
  // ==========================================
  
  /**
   * Initialize NovaVoice engine
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.INITIALIZE,
    async (_event, config?: Partial<PipelineConfig>, preset?: string) => {
      try {
        // Apply preset if specified
        let effectiveConfig = config || {};
        
        if (preset === 'ultra-low-latency') {
          effectiveConfig = { ...ULTRA_LOW_LATENCY_PRESET, ...config };
        } else if (preset === 'balanced') {
          effectiveConfig = { ...BALANCED_PRESET, ...config };
        } else if (preset === 'high-quality') {
          effectiveConfig = { ...HIGH_QUALITY_PRESET, ...config };
        }
        
        const voice = await initializeNovaVoice(effectiveConfig);
        setupEventForwarding(voice);
        
        logger.info('NovaVoice initialized via IPC');
        
        return {
          success: true,
          state: voice.getState(),
        };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to initialize NovaVoice', { error: err.message });
        return {
          success: false,
          error: err.message,
        };
      }
    }
  );
  
  /**
   * Shutdown NovaVoice engine
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.SHUTDOWN, async () => {
    try {
      await shutdownNovaVoice();
      logger.info('NovaVoice shutdown via IPC');
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to shutdown NovaVoice', { error: err.message });
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Get current status
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.GET_STATUS, () => {
    const voice = getNovaVoice();
    if (!voice) {
      return {
        initialized: false,
        state: PipelineState.IDLE,
        metrics: null,
      };
    }
    
    return {
      initialized: true,
      state: voice.getState(),
      metrics: voice.getLatencyMetrics(),
    };
  });
  
  // ==========================================
  // PIPELINE CONTROL
  // ==========================================
  
  /**
   * Start listening for voice input
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.START_LISTENING, async () => {
    try {
      const voice = getNovaVoice();
      if (!voice) {
        return { success: false, error: 'NovaVoice not initialized' };
      }
      
      await voice.startListening();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Stop listening for voice input
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.STOP_LISTENING, async () => {
    try {
      const voice = getNovaVoice();
      if (!voice) {
        return { success: false, error: 'NovaVoice not initialized' };
      }
      
      await voice.stopListening();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Process audio input
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.PROCESS_AUDIO,
    async (_event, serializedChunk: {
      data: number[];
      timestamp: number;
      duration: number;
      format: { sampleRate: number; channels: number; bitDepth?: number; encoding?: string };
      isFinal?: boolean;
    }) => {
      try {
        const voice = getNovaVoice();
        if (!voice) {
          return { success: false, error: 'NovaVoice not initialized' };
        }
        
        // Convert serialized data back to Float32Array
        const chunk: AudioChunk = {
          data: new Float32Array(serializedChunk.data),
          timestamp: serializedChunk.timestamp,
          duration: serializedChunk.duration,
          format: {
            sampleRate: serializedChunk.format.sampleRate,
            channels: serializedChunk.format.channels,
            bitDepth: serializedChunk.format.bitDepth || 16,
            encoding: (serializedChunk.format.encoding as AudioChunk['format']['encoding']) || 'pcm',
          },
          isFinal: serializedChunk.isFinal,
        };
        
        await voice.processAudioInput(chunk);
        return { success: true };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }
  );
  
  /**
   * Interrupt current operation
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.INTERRUPT, async () => {
    try {
      const voice = getNovaVoice();
      if (!voice) {
        return { success: false, error: 'NovaVoice not initialized' };
      }
      
      voice.interrupt();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });
  
  // ==========================================
  // TTS
  // ==========================================
  
  /**
   * Speak text
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.SPEAK,
    async (_event, text: string, options?: Partial<TTSSynthesisOptions>) => {
      try {
        const voice = getNovaVoice();
        if (!voice) {
          return { success: false, error: 'NovaVoice not initialized' };
        }
        
        const result = await voice.speak(text, options);
        return { success: true, result };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }
  );
  
  /**
   * Speak SSML
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.SPEAK_SSML,
    async (_event, ssml: string, options?: Partial<TTSSynthesisOptions>) => {
      try {
        const voice = getNovaVoice();
        if (!voice) {
          return { success: false, error: 'NovaVoice not initialized' };
        }
        
        const result = await voice.speakSSML(ssml, options);
        return { success: true, result };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }
  );
  
  /**
   * Stop speaking
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.STOP_SPEAKING, async () => {
    try {
      const voice = getNovaVoice();
      if (!voice) {
        return { success: false, error: 'NovaVoice not initialized' };
      }
      
      await voice.stopSpeaking();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Set voice
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.SET_VOICE,
    async (_event, voiceId: string) => {
      try {
        const voice = getNovaVoice();
        if (!voice) {
          return { success: false, error: 'NovaVoice not initialized' };
        }
        
        await voice.setVoice(voiceId);
        return { success: true };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }
  );
  
  /**
   * Get available voices
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.GET_VOICES, async () => {
    try {
      const voice = getNovaVoice();
      if (!voice) {
        return { success: false, error: 'NovaVoice not initialized', voices: [] };
      }
      
      const voices = await voice.getVoices();
      return { success: true, voices };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message, voices: [] };
    }
  });
  
  // ==========================================
  // CONFIGURATION
  // ==========================================
  
  /**
   * Set configuration
   */
  ipcMain.handle(
    NOVA_VOICE_CHANNELS.SET_CONFIG,
    async (_event, config: Partial<PipelineConfig>) => {
      try {
        const voice = getNovaVoice();
        if (!voice) {
          return { success: false, error: 'NovaVoice not initialized' };
        }
        
        voice.setConfig(config);
        return { success: true };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }
  );
  
  /**
   * Get current configuration
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.GET_CONFIG, () => {
    const voice = getNovaVoice();
    if (!voice) {
      return { success: false, error: 'NovaVoice not initialized', config: null };
    }
    
    return { success: true, config: voice.getConfig() };
  });
  
  /**
   * Get latency metrics
   */
  ipcMain.handle(NOVA_VOICE_CHANNELS.GET_METRICS, () => {
    const voice = getNovaVoice();
    if (!voice) {
      return { success: false, error: 'NovaVoice not initialized', metrics: null };
    }
    
    return { success: true, metrics: voice.getLatencyMetrics() };
  });
  
  logger.info('NovaVoice IPC handlers registered');
}

/**
 * Unregister all NovaVoice IPC handlers
 */
export function unregisterNovaVoiceIPC(): void {
  Object.values(NOVA_VOICE_CHANNELS).forEach((channel) => {
    if (!channel.includes(':event:')) {
      ipcMain.removeHandler(channel);
    }
  });
  
  mainWindow = null;
  logger.info('NovaVoice IPC handlers unregistered');
}
