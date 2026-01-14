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

// ============================================================================
// Input Validation Utilities
// ============================================================================

/** Maximum allowed text length for LLM input */
const MAX_TEXT_LENGTH = 10000;

/** Maximum config object depth */
const MAX_CONFIG_DEPTH = 3;

/** Rate limiting: requests per minute */
const RATE_LIMIT_REQUESTS = 60;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Validate and sanitize text input
 */
function validateTextInput(text: unknown): { valid: boolean; sanitized?: string; error?: string } {
  if (typeof text !== 'string') {
    return { valid: false, error: 'Text must be a string' };
  }

  if (text.length === 0) {
    return { valid: false, error: 'Text cannot be empty' };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return { valid: false, error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` };
  }

  // Sanitize: trim whitespace and normalize line endings
  const sanitized = text.trim().replace(/\r\n/g, '\n');

  return { valid: true, sanitized };
}

/**
 * Validate config object (prevent prototype pollution)
 */
function validateConfigObject(
  config: unknown,
  depth = 0
): { valid: boolean; sanitized?: Record<string, unknown>; error?: string } {
  if (depth > MAX_CONFIG_DEPTH) {
    return { valid: false, error: 'Config object too deeply nested' };
  }

  if (config === null || config === undefined) {
    return { valid: true, sanitized: {} };
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, error: 'Config must be an object' };
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    // Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      logger.warn('Blocked prototype pollution attempt', { key });
      continue;
    }

    // Recursively validate nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = validateConfigObject(value, depth + 1);
      if (!nested.valid) {
        return nested;
      }
      sanitized[key] = nested.sanitized;
    } else {
      sanitized[key] = value;
    }
  }

  return { valid: true, sanitized };
}

/**
 * Check rate limit for a channel
 */
function checkRateLimit(channel: string): boolean {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window

  let limiter = rateLimitMap.get(channel);
  if (!limiter || now > limiter.resetTime) {
    limiter = { count: 0, resetTime: now + windowMs };
    rateLimitMap.set(channel, limiter);
  }

  limiter.count++;

  if (limiter.count > RATE_LIMIT_REQUESTS) {
    logger.warn('Rate limit exceeded', { channel, count: limiter.count });
    return false;
  }

  return true;
}

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
  ipcMain.handle('nova:start', async (_event, config?: unknown): Promise<IPCResult> => {
    try {
      // Validate config if provided
      let validatedConfig: Partial<VoicePipelineConfig> | undefined;
      if (config !== undefined) {
        const validation = validateConfigObject(config);
        if (!validation.valid) {
          logger.warn('Invalid startup config rejected', { error: validation.error });
          return { success: false, error: validation.error };
        }
        validatedConfig = validation.sanitized as Partial<VoicePipelineConfig>;
      }

      const pipeline = await initializeVoicePipeline(validatedConfig);
      await pipeline.start();
      return { success: true };
    } catch (error) {
      logger.error('Failed to start pipeline', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

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
  ipcMain.handle('nova:send-text', async (_event, text: unknown): Promise<IPCResult> => {
    // Rate limit check
    if (!checkRateLimit('nova:send-text')) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait before sending more requests.',
      };
    }

    // Validate input
    const validation = validateTextInput(text);
    if (!validation.valid) {
      logger.warn('Invalid text input rejected', { error: validation.error });
      return { success: false, error: validation.error };
    }

    if (voicePipeline) {
      try {
        await voicePipeline.sendText(validation.sanitized!);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Clear conversation history
  ipcMain.handle('nova:clear-history', async (): Promise<IPCResult> => {
    if (voicePipeline) {
      await voicePipeline.clearHistory();
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
  ipcMain.handle('nova:update-config', (_event, config: unknown): IPCResult => {
    // Validate config object
    const validation = validateConfigObject(config);
    if (!validation.valid) {
      logger.warn('Invalid config object rejected', { error: validation.error });
      return { success: false, error: validation.error };
    }

    if (voicePipeline) {
      voicePipeline.updateConfig(validation.sanitized as Partial<VoicePipelineConfig>);
      return { success: true };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get pipeline config
  ipcMain.handle('nova:get-config', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getConfig() };
    }
    return { success: true, data: null };
  });

  // =========================================================================
  // Memory Handlers
  // =========================================================================

  // Get conversation history from memory
  ipcMain.handle('nova:get-conversation-history', (_event, limit?: number): IPCResult => {
    if (voicePipeline) {
      const memoryManager = voicePipeline.getMemoryManager();
      if (memoryManager) {
        const messages = memoryManager.getRecentMessages(limit);
        return { success: true, data: messages };
      }
      return { success: false, error: 'Memory manager not initialized' };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Clear all memory
  ipcMain.handle('nova:clear-memory', async (): Promise<IPCResult> => {
    if (voicePipeline) {
      const memoryManager = voicePipeline.getMemoryManager();
      if (memoryManager) {
        await memoryManager.clear();
        // Start a new session after clearing
        memoryManager.startSession({ device: 'desktop', startedAt: Date.now() });
        return { success: true };
      }
      return { success: false, error: 'Memory manager not initialized' };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get memory statistics
  ipcMain.handle('nova:get-memory-stats', (): IPCResult => {
    if (voicePipeline) {
      const memoryManager = voicePipeline.getMemoryManager();
      if (memoryManager) {
        const stats = memoryManager.getStats();
        return { success: true, data: stats };
      }
      return { success: false, error: 'Memory manager not initialized' };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Search memory entries
  ipcMain.handle(
    'nova:search-memory',
    (
      _event,
      query: {
        type?: string;
        tags?: string[];
        minImportance?: number;
        text?: string;
        limit?: number;
      }
    ): IPCResult => {
      // Validate query object
      const validation = validateConfigObject(query);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      if (voicePipeline) {
        const memoryManager = voicePipeline.getMemoryManager();
        if (memoryManager) {
          const results = memoryManager.searchEntries(
            validation.sanitized as {
              type?: 'conversation' | 'fact' | 'preference' | 'context';
              tags?: string[];
              minImportance?: number;
              text?: string;
              limit?: number;
            }
          );
          return { success: true, data: results };
        }
        return { success: false, error: 'Memory manager not initialized' };
      }
      return { success: false, error: 'Pipeline not initialized' };
    }
  );

  // Get all conversation sessions
  ipcMain.handle('nova:get-all-sessions', (): IPCResult => {
    if (voicePipeline) {
      const memoryManager = voicePipeline.getMemoryManager();
      if (memoryManager) {
        const sessions = memoryManager.getAllSessions();
        return { success: true, data: sessions };
      }
      return { success: false, error: 'Memory manager not initialized' };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // =========================================================================
  // Budget & Cost Tracking Handlers
  // =========================================================================

  // Get budget statistics
  ipcMain.handle('nova:get-budget-stats', (): IPCResult => {
    try {
      const { getCostTracker } = require('../utils/cost-tracker');
      const costTracker = getCostTracker();
      const stats = costTracker.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('Failed to get budget stats', { error });
      return { success: false, error: 'Cost tracker not available' };
    }
  });

  // Set daily budget
  ipcMain.handle('nova:set-daily-budget', (_event, budget: unknown): IPCResult => {
    if (typeof budget !== 'number' || budget < 0) {
      return { success: false, error: 'Budget must be a positive number' };
    }

    try {
      const { getCostTracker } = require('../utils/cost-tracker');
      const costTracker = getCostTracker();
      costTracker.setDailyBudget(budget);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set daily budget', { error });
      return { success: false, error: 'Cost tracker not available' };
    }
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
    // Memory channels
    'nova:get-conversation-history',
    'nova:clear-memory',
    'nova:get-memory-stats',
    'nova:search-memory',
    'nova:get-all-sessions',
    // Budget channels
    'nova:get-budget-stats',
    'nova:set-daily-budget',
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
