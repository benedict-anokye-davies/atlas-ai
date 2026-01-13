/**
 * Nova Desktop - IPC Handlers
 * Centralized IPC handler registration for main process
 * Handles communication between main and renderer for voice pipeline
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  VoicePipeline,
  getVoicePipeline,
  shutdownVoicePipeline,
  VoicePipelineConfig,
} from '../voice/voice-pipeline';
import { WakeWordEvent, VoicePipelineState } from '../../shared/types/voice';
import { TranscriptionResult } from '../../shared/types/stt';
import { LLMStreamChunk, LLMResponse } from '../../shared/types/llm';
import { TTSAudioChunk, TTSSynthesisResult } from '../../shared/types/tts';

const logger = createModuleLogger('IPC');

// Track the main window for sending events
let mainWindow: BrowserWindow | null = null;

// Voice pipeline instance
let voicePipeline: VoicePipeline | null = null;

/**
 * Set the main window reference for event forwarding
 */
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Send event to renderer if window exists
 */
function sendToRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Initialize the voice pipeline with event forwarding
 */
async function initializeVoicePipeline(
  config?: Partial<VoicePipelineConfig>
): Promise<VoicePipeline> {
  if (voicePipeline) {
    return voicePipeline;
  }

  voicePipeline = getVoicePipeline(config);

  // Forward all pipeline events to renderer

  // State changes
  voicePipeline.on(
    'state-change',
    (state: VoicePipelineState, previousState: VoicePipelineState) => {
      logger.debug('Pipeline state change', { from: previousState, to: state });
      sendToRenderer('nova:state-change', { state, previousState });
    }
  );

  // Wake word
  voicePipeline.on('wake-word', (event: WakeWordEvent) => {
    logger.info('Wake word detected', { keyword: event.keyword });
    sendToRenderer('nova:wake-word', event);
  });

  // Speech events
  voicePipeline.on('speech-start', () => {
    sendToRenderer('nova:speech-start');
  });

  voicePipeline.on('speech-end', (duration: number) => {
    sendToRenderer('nova:speech-end', { duration });
  });

  // Transcription events
  voicePipeline.on('transcript-interim', (text: string) => {
    sendToRenderer('nova:transcript-interim', { text });
  });

  voicePipeline.on('transcript-final', (result: TranscriptionResult) => {
    sendToRenderer('nova:transcript-final', result);
  });

  // LLM response events
  voicePipeline.on('response-start', () => {
    sendToRenderer('nova:response-start');
  });

  voicePipeline.on('response-chunk', (chunk: LLMStreamChunk) => {
    sendToRenderer('nova:response-chunk', chunk);
  });

  voicePipeline.on('response-complete', (response: LLMResponse) => {
    sendToRenderer('nova:response-complete', response);
  });

  // TTS events
  voicePipeline.on('audio-chunk', (chunk: TTSAudioChunk) => {
    // Convert Buffer to base64 for IPC transfer
    sendToRenderer('nova:audio-chunk', {
      data: chunk.data.toString('base64'),
      format: chunk.format,
      isFinal: chunk.isFinal,
      duration: chunk.duration,
    });
  });

  voicePipeline.on('synthesis-complete', (result: TTSSynthesisResult) => {
    sendToRenderer('nova:synthesis-complete', {
      audioBase64: result.audio.toString('base64'),
      format: result.format,
      duration: result.duration,
      characterCount: result.characterCount,
    });
  });

  voicePipeline.on('speaking-start', () => {
    sendToRenderer('nova:speaking-start');
  });

  voicePipeline.on('speaking-end', () => {
    sendToRenderer('nova:speaking-end');
  });

  // Barge-in
  voicePipeline.on('barge-in', () => {
    logger.info('Barge-in detected');
    sendToRenderer('nova:barge-in');
  });

  // Audio level (throttled)
  let lastAudioLevelTime = 0;
  voicePipeline.on('audio-level', (level: number) => {
    const now = Date.now();
    // Throttle to ~30fps
    if (now - lastAudioLevelTime > 33) {
      lastAudioLevelTime = now;
      sendToRenderer('nova:audio-level', { level });
    }
  });

  // Errors
  voicePipeline.on('error', (error: Error, component: string) => {
    logger.error('Pipeline error', { component, error: error.message });
    sendToRenderer('nova:error', {
      type: component,
      message: error.message,
    });
  });

  // Started/stopped
  voicePipeline.on('started', () => {
    logger.info('Voice pipeline started');
    sendToRenderer('nova:started');
  });

  voicePipeline.on('stopped', () => {
    logger.info('Voice pipeline stopped');
    sendToRenderer('nova:stopped');
  });

  // Provider changes
  voicePipeline.on('provider-change', (type: 'stt' | 'llm', provider: string) => {
    logger.info('Provider changed', { type, provider });
    sendToRenderer('nova:provider-change', { type, provider });
  });

  logger.info('Voice pipeline initialized with IPC event forwarding');
  return voicePipeline;
}

/**
 * Result type for IPC handlers
 */
interface IPCResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Register all IPC handlers
 */
export function registerIPCHandlers(): void {
  logger.info('Registering IPC handlers...');

  // =========================================================================
  // Voice Pipeline Handlers
  // =========================================================================

  // Start voice pipeline
  ipcMain.handle(
    'nova:start',
    async (_event, config?: Partial<VoicePipelineConfig>): Promise<IPCResult> => {
      try {
        const pipeline = await initializeVoicePipeline(config);
        await pipeline.start();
        return { success: true };
      } catch (error) {
        logger.error('Failed to start pipeline', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Stop voice pipeline
  ipcMain.handle('nova:stop', async (): Promise<IPCResult> => {
    try {
      if (voicePipeline) {
        await voicePipeline.stop();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Shutdown voice pipeline completely
  ipcMain.handle('nova:shutdown', async (): Promise<IPCResult> => {
    try {
      await shutdownVoicePipeline();
      voicePipeline = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Get pipeline status
  ipcMain.handle('nova:get-status', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getStatus() };
    }
    return {
      success: true,
      data: {
        state: 'idle',
        isListening: false,
        isSpeaking: false,
        audioLevel: 0,
        sttProvider: null,
        llmProvider: null,
        isTTSSpeaking: false,
        currentTranscript: '',
        currentResponse: '',
      },
    };
  });

  // Trigger wake (push-to-talk)
  ipcMain.handle('nova:trigger-wake', (): IPCResult => {
    if (voicePipeline) {
      voicePipeline.triggerWake();
      return { success: true };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Send text directly (bypass STT)
  ipcMain.handle('nova:send-text', async (_event, text: string): Promise<IPCResult> => {
    if (voicePipeline) {
      try {
        await voicePipeline.sendText(text);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Clear conversation history
  ipcMain.handle('nova:clear-history', (): IPCResult => {
    if (voicePipeline) {
      voicePipeline.clearHistory();
      return { success: true };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get conversation context
  ipcMain.handle('nova:get-context', (): IPCResult => {
    if (voicePipeline) {
      const context = voicePipeline.getConversationContext();
      return { success: true, data: context };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get interaction metrics
  ipcMain.handle('nova:get-metrics', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getMetrics() };
    }
    return { success: true, data: {} };
  });

  // Update pipeline config
  ipcMain.handle(
    'nova:update-config',
    (_event, config: Partial<VoicePipelineConfig>): IPCResult => {
      if (voicePipeline) {
        voicePipeline.updateConfig(config);
        return { success: true };
      }
      return { success: false, error: 'Pipeline not initialized' };
    }
  );

  // Get pipeline config
  ipcMain.handle('nova:get-config', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getConfig() };
    }
    return { success: true, data: null };
  });

  logger.info('IPC handlers registered');
}

/**
 * Unregister all IPC handlers
 */
export function unregisterIPCHandlers(): void {
  const channels = [
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

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('IPC handlers unregistered');
}

/**
 * Cleanup function for app shutdown
 */
export async function cleanupIPC(): Promise<void> {
  if (voicePipeline) {
    await voicePipeline.stop();
    voicePipeline = null;
  }
  unregisterIPCHandlers();
  mainWindow = null;
  logger.info('IPC cleanup complete');
}

export default {
  registerIPCHandlers,
  unregisterIPCHandlers,
  setMainWindow,
  cleanupIPC,
};
