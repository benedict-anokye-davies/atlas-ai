/**
 * Nova TTS - IPC Handlers
 * Electron IPC handlers for Nova TTS communication between main and renderer processes
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getNovaTTS, shutdownNovaTTS } from '../nova-tts';
import type {
  SynthesisOptions,
  VoiceCloneConfig,
  NovaTTSEngine,
} from '../nova-tts/types';

const logger = createModuleLogger('NovaTTS-IPC');

// IPC channel names
const IPC_CHANNELS = {
  // Queries (renderer -> main)
  GET_VOICES: 'nova-tts:get-voices',
  GET_VOICE: 'nova-tts:get-voice',
  IS_VOICE_DOWNLOADED: 'nova-tts:is-voice-downloaded',
  GET_ENGINE_INFO: 'nova-tts:get-engine-info',
  GET_ACTIVE_ENGINE: 'nova-tts:get-active-engine',
  GET_QUEUE: 'nova-tts:get-queue',
  GET_RECOMMENDED_VOICES: 'nova-tts:get-recommended-voices',
  SEARCH_VOICES: 'nova-tts:search-voices',
  
  // Commands (renderer -> main)
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
  
  // Events (main -> renderer)
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
 * Get the main window for sending events
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Send event to renderer
 */
function sendToRenderer(channel: string, ...args: any[]): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

/**
 * Set up Nova TTS event forwarding to renderer
 */
function setupEventForwarding(): void {
  const tts = getNovaTTS();

  tts.on('download-progress', (progress) => {
    sendToRenderer(IPC_CHANNELS.DOWNLOAD_PROGRESS, progress);
  });

  tts.on('clone-progress', (voiceId, stage, progress) => {
    sendToRenderer(IPC_CHANNELS.CLONE_PROGRESS, voiceId, stage, progress);
  });

  tts.on('synthesis-start', (id, text, options) => {
    sendToRenderer(IPC_CHANNELS.SYNTHESIS_START, id, text, options);
  });

  tts.on('audio-chunk', (chunk) => {
    // Convert Buffer to base64 for IPC transfer
    const serializedChunk = {
      ...chunk,
      data: chunk.data.toString('base64'),
    };
    sendToRenderer(IPC_CHANNELS.AUDIO_CHUNK, serializedChunk);
  });

  tts.on('synthesis-complete', (result) => {
    // Convert Buffer to base64 for IPC transfer
    const serializedResult = {
      ...result,
      audio: result.audio.toString('base64'),
    };
    sendToRenderer(IPC_CHANNELS.SYNTHESIS_COMPLETE, serializedResult);
  });

  tts.on('synthesis-error', (id, error) => {
    sendToRenderer(IPC_CHANNELS.SYNTHESIS_ERROR, id, error.message);
  });

  tts.on('playback-start', () => {
    sendToRenderer(IPC_CHANNELS.PLAYBACK_START);
  });

  tts.on('playback-end', () => {
    sendToRenderer(IPC_CHANNELS.PLAYBACK_END);
  });

  tts.on('queue-update', (queue) => {
    sendToRenderer(IPC_CHANNELS.QUEUE_UPDATE, queue);
  });

  tts.on('engine-status', (engine, status) => {
    sendToRenderer(IPC_CHANNELS.ENGINE_STATUS, engine, status);
  });

  logger.info('Nova TTS event forwarding set up');
}

/**
 * Register all Nova TTS IPC handlers
 */
export function registerNovaTTSHandlers(): void {
  logger.info('Registering Nova TTS IPC handlers...');

  // Get all voices
  ipcMain.handle(IPC_CHANNELS.GET_VOICES, async () => {
    try {
      const tts = getNovaTTS();
      const voices = tts.getVoices();
      const downloadedVoiceIds = voices
        .filter(v => tts.isVoiceDownloaded(v.id))
        .map(v => v.id);
      
      return { voices, downloadedVoiceIds };
    } catch (error) {
      logger.error('Failed to get voices', { error: (error as Error).message });
      throw error;
    }
  });

  // Get single voice
  ipcMain.handle(IPC_CHANNELS.GET_VOICE, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      return tts.getVoice(voiceId);
    } catch (error) {
      logger.error('Failed to get voice', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Check if voice is downloaded
  ipcMain.handle(IPC_CHANNELS.IS_VOICE_DOWNLOADED, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      return tts.isVoiceDownloaded(voiceId);
    } catch (error) {
      logger.error('Failed to check voice download status', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Get engine info
  ipcMain.handle(IPC_CHANNELS.GET_ENGINE_INFO, async () => {
    try {
      const tts = getNovaTTS();
      return tts.getEngineInfo();
    } catch (error) {
      logger.error('Failed to get engine info', { error: (error as Error).message });
      throw error;
    }
  });

  // Get active engine
  ipcMain.handle(IPC_CHANNELS.GET_ACTIVE_ENGINE, async () => {
    try {
      const tts = getNovaTTS();
      return tts.getActiveEngine();
    } catch (error) {
      logger.error('Failed to get active engine', { error: (error as Error).message });
      throw error;
    }
  });

  // Get speech queue
  ipcMain.handle(IPC_CHANNELS.GET_QUEUE, async () => {
    try {
      const tts = getNovaTTS();
      return tts.getQueue();
    } catch (error) {
      logger.error('Failed to get queue', { error: (error as Error).message });
      throw error;
    }
  });

  // Get recommended voices
  ipcMain.handle(IPC_CHANNELS.GET_RECOMMENDED_VOICES, async () => {
    try {
      const tts = getNovaTTS();
      return tts.getRecommendedVoices();
    } catch (error) {
      logger.error('Failed to get recommended voices', { error: (error as Error).message });
      throw error;
    }
  });

  // Search voices
  ipcMain.handle(IPC_CHANNELS.SEARCH_VOICES, async (_, query: string) => {
    try {
      const tts = getNovaTTS();
      return tts.searchVoices(query);
    } catch (error) {
      logger.error('Failed to search voices', { query, error: (error as Error).message });
      throw error;
    }
  });

  // Download voice
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_VOICE, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      await tts.downloadVoice(voiceId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to download voice', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Delete voice
  ipcMain.handle(IPC_CHANNELS.DELETE_VOICE, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      await tts.deleteVoice(voiceId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete voice', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Clone voice
  ipcMain.handle(IPC_CHANNELS.CLONE_VOICE, async (_, config: VoiceCloneConfig) => {
    try {
      const tts = getNovaTTS();
      return await tts.cloneVoice(config);
    } catch (error) {
      logger.error('Failed to clone voice', { error: (error as Error).message });
      throw error;
    }
  });

  // Delete cloned voice
  ipcMain.handle(IPC_CHANNELS.DELETE_CLONED_VOICE, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      await tts.deleteClonedVoice(voiceId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete cloned voice', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Speak text
  ipcMain.handle(IPC_CHANNELS.SPEAK, async (_, text: string, options?: Partial<SynthesisOptions>) => {
    try {
      const tts = getNovaTTS();
      await tts.speak(text, options);
      return { success: true };
    } catch (error) {
      logger.error('Failed to speak', { error: (error as Error).message });
      throw error;
    }
  });

  // Synthesize text (returns audio)
  ipcMain.handle(IPC_CHANNELS.SYNTHESIZE, async (_, text: string, options: SynthesisOptions) => {
    try {
      const tts = getNovaTTS();
      const result = await tts.synthesize(text, options);
      // Convert Buffer to base64 for IPC transfer
      return {
        ...result,
        audio: result.audio.toString('base64'),
      };
    } catch (error) {
      logger.error('Failed to synthesize', { error: (error as Error).message });
      throw error;
    }
  });

  // Stop playback
  ipcMain.handle(IPC_CHANNELS.STOP, async () => {
    try {
      const tts = getNovaTTS();
      tts.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop', { error: (error as Error).message });
      throw error;
    }
  });

  // Pause playback
  ipcMain.handle(IPC_CHANNELS.PAUSE, async () => {
    try {
      const tts = getNovaTTS();
      tts.pause();
      return { success: true };
    } catch (error) {
      logger.error('Failed to pause', { error: (error as Error).message });
      throw error;
    }
  });

  // Resume playback
  ipcMain.handle(IPC_CHANNELS.RESUME, async () => {
    try {
      const tts = getNovaTTS();
      tts.resume();
      return { success: true };
    } catch (error) {
      logger.error('Failed to resume', { error: (error as Error).message });
      throw error;
    }
  });

  // Clear queue
  ipcMain.handle(IPC_CHANNELS.CLEAR_QUEUE, async () => {
    try {
      const tts = getNovaTTS();
      tts.clearQueue();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear queue', { error: (error as Error).message });
      throw error;
    }
  });

  // Set active engine
  ipcMain.handle(IPC_CHANNELS.SET_ACTIVE_ENGINE, async (_, engine: NovaTTSEngine) => {
    try {
      const tts = getNovaTTS();
      await tts.setActiveEngine(engine);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set active engine', { engine, error: (error as Error).message });
      throw error;
    }
  });

  // Preview voice
  ipcMain.handle(IPC_CHANNELS.PREVIEW_VOICE, async (_, voiceId: string) => {
    try {
      const tts = getNovaTTS();
      const previewText = "Hello! I'm your AI assistant. How can I help you today?";
      await tts.speak(previewText, { voiceId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to preview voice', { voiceId, error: (error as Error).message });
      throw error;
    }
  });

  // Set up event forwarding
  setupEventForwarding();

  logger.info('Nova TTS IPC handlers registered');
}

/**
 * Unregister all Nova TTS IPC handlers
 */
export function unregisterNovaTTSHandlers(): void {
  Object.values(IPC_CHANNELS).forEach(channel => {
    ipcMain.removeHandler(channel);
  });
  
  logger.info('Nova TTS IPC handlers unregistered');
}

/**
 * Initialize Nova TTS system
 */
export async function initializeNovaTTS(): Promise<void> {
  logger.info('Initializing Nova TTS...');
  
  try {
    const tts = getNovaTTS();
    await tts.initialize();
    registerNovaTTSHandlers();
    logger.info('Nova TTS initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Nova TTS', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Shutdown Nova TTS system
 */
export async function shutdownNovaTTSSystem(): Promise<void> {
  logger.info('Shutting down Nova TTS...');
  
  try {
    unregisterNovaTTSHandlers();
    await shutdownNovaTTS();
    logger.info('Nova TTS shutdown complete');
  } catch (error) {
    logger.error('Failed to shutdown Nova TTS', { error: (error as Error).message });
  }
}

export { IPC_CHANNELS };
