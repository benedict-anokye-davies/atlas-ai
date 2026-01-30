/**
 * Atlas Desktop - IPC Handlers
 * Centralized IPC handler registration for main process
 * Handles communication between main and renderer for voice pipeline
 *
 * Note: This file uses inline require() for lazy loading of heavy modules
 * to improve application startup time. This is an intentional pattern.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

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
import { PersonalityPreset, PersonalityTraits } from '../../shared/types/personality';
import { getLLMManager } from '../llm/manager';
import {
  getConnectivityManager,
  ConnectivityStatus,
  ServiceAvailability,
} from '../utils/connectivity';
import {
  getSmartProviderManager,
  STTProvider,
  TTSProvider,
  LLMProvider,
} from '../providers/smart-provider';
import {
  detectGPUCapabilities,
  getCachedGPUCapabilities,
  getRecommendedParticleCount,
  getRecommendedRenderConfig,
} from '../utils/gpu-detector';
import type { GPUCapabilities, GPURenderingConfig } from '../../shared/types/gpu';
// User profile imports - reserved for future use
// import {
//   getUserProfileManager,
//   PrivacySettings,
//   ProfileExport,
//   CommunicationStyle,
//   LearnedPreference as ProfileLearnedPreference,
//   TopicInterest,
//   CommandUsage,
//   WorkflowPattern,
// } from '../memory/user-profile';
// import { getPreferenceLearner, LearnedPreference } from '../memory/preference-learner';
import {
  getBackgroundResearchManager,
  ResearchTopic,
  ResearchResult,
  ResearchState,
  getTaskScheduler,
  ScheduledTask,
} from '../intelligence';
import { getKeychainManager, SUPPORTED_API_KEYS, ApiKeyName } from '../security/keychain';
import {
  getCalendarManager,
  initializeCalendarManager,
  type CalendarEvent,
  type CalendarAccount,
  type Calendar,
  type CalendarManagerStatus,
  type EventSummary,
  type CreateEventRequest,
  type UpdateEventRequest,
  type DeleteEventRequest,
  type ListEventsRequest,
  type FreeBusyRequest,
  type FreeBusyResponse,
  type CalendarProvider,
} from '../integrations';
import {
  getGEPAStatus,
  getOptimizationHistory,
  runOptimization,
  getMetricsSummary,
  getABTests,
  createABTest,
  getRollbackPoints,
  rollbackToSnapshot,
  getChangeReports,
  getDailyDigest,
  getPendingModifications,
  approveModification,
  rejectModification,
  setOptimizationSchedule,
} from '../gepa';
import { getTaskQueueManager } from '../agent/task-queue';
import { registerAtlasHandlers } from './atlas-handlers';

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
      sendToRenderer('atlas:state-change', { state, previousState });
    }
  );

  // Wake word
  voicePipeline.on('wake-word', (event: WakeWordEvent) => {
    logger.info('Wake word detected', { keyword: event.keyword });
    sendToRenderer('atlas:wake-word', event);
  });

  // Speech events
  voicePipeline.on('speech-start', () => {
    sendToRenderer('atlas:speech-start');
  });

  voicePipeline.on('speech-end', (duration: number) => {
    sendToRenderer('atlas:speech-end', { duration });
  });

  // Transcription events
  voicePipeline.on('transcript-interim', (text: string) => {
    sendToRenderer('atlas:transcript-interim', { text });
  });

  voicePipeline.on('transcript-final', (result: TranscriptionResult) => {
    sendToRenderer('atlas:transcript-final', result);
  });

  // Emotion detection event
  voicePipeline.on('emotion-detected', (emotion) => {
    sendToRenderer('atlas:emotion-detected', emotion);
    logger.debug('Emotion detected and sent to renderer', {
      emotion: emotion.primary.type,
      intensity: emotion.primary.intensity,
    });
  });

  // LLM response events
  voicePipeline.on('response-start', () => {
    sendToRenderer('atlas:response-start');
  });

  voicePipeline.on('response-chunk', (chunk: LLMStreamChunk) => {
    sendToRenderer('atlas:response-chunk', chunk);
  });

  voicePipeline.on('response-complete', (response: LLMResponse) => {
    sendToRenderer('atlas:response-complete', response);
  });

  // TTS events
  voicePipeline.on('audio-chunk', (chunk: TTSAudioChunk) => {
    // Convert Buffer to base64 for IPC transfer
    logger.debug('[IPC] Sending audio-chunk to renderer', {
      format: chunk.format,
      isFinal: chunk.isFinal,
      dataLength: chunk.data?.length ?? 0,
    });
    sendToRenderer('atlas:audio-chunk', {
      data: chunk.data.toString('base64'),
      format: chunk.format,
      isFinal: chunk.isFinal,
      duration: chunk.duration,
    });
  });

  voicePipeline.on('synthesis-complete', (result: TTSSynthesisResult) => {
    sendToRenderer('atlas:synthesis-complete', {
      audioBase64: result.audio.toString('base64'),
      format: result.format,
      duration: result.duration,
      characterCount: result.characterCount,
    });
  });

  voicePipeline.on('speaking-start', () => {
    sendToRenderer('atlas:speaking-start');
  });

  voicePipeline.on('speaking-end', () => {
    sendToRenderer('atlas:speaking-end');
  });

  // Barge-in
  voicePipeline.on('barge-in', () => {
    logger.info('Barge-in detected');
    sendToRenderer('atlas:barge-in');
  });

  // Audio level (throttled)
  let lastAudioLevelTime = 0;
  voicePipeline.on('audio-level', (level: number) => {
    const now = Date.now();
    // Throttle to ~30fps
    if (now - lastAudioLevelTime > 33) {
      lastAudioLevelTime = now;
      sendToRenderer('atlas:audio-level', { level });
    }
  });

  // Errors
  voicePipeline.on('error', (error: Error, component: string) => {
    logger.error('Pipeline error', { component, error: error.message });
    sendToRenderer('atlas:error', {
      type: component,
      message: error.message,
    });
  });

  // Started/stopped
  voicePipeline.on('started', () => {
    logger.info('Voice pipeline started');
    sendToRenderer('atlas:started');
  });

  voicePipeline.on('stopped', () => {
    logger.info('Voice pipeline stopped');
    sendToRenderer('atlas:stopped');
  });

  // Provider changes
  voicePipeline.on('provider-change', (type: 'stt' | 'llm', provider: string) => {
    logger.info('Provider changed', { type, provider });
    sendToRenderer('atlas:provider-change', { type, provider });
  });

  // Tool execution events (for Claude Code-like UI)
  voicePipeline.on('tool-start', (toolName: string, params: Record<string, unknown>) => {
    logger.info('Tool execution started', { toolName });
    sendToRenderer('atlas:tool-start', { toolName, params, startTime: Date.now() });
  });

  voicePipeline.on('tool-complete', (toolName: string, result: unknown) => {
    logger.info('Tool execution completed', { toolName });
    sendToRenderer('atlas:tool-complete', { toolName, result, endTime: Date.now() });
  });

  voicePipeline.on('tool-error', (toolName: string, error: Error) => {
    logger.warn('Tool execution failed', { toolName, error: error.message });
    sendToRenderer('atlas:tool-error', { toolName, error: error.message, endTime: Date.now() });
  });

  logger.info('Voice pipeline initialized with IPC event forwarding');
  return voicePipeline;
}

/**
 * Result type for IPC handlers
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Track if task event forwarding is already set up
 */
let taskEventForwardingSetup = false;

/**
 * Set up task framework event forwarding to renderer
 */
function setupTaskEventForwarding(): void {
  if (taskEventForwardingSetup) {
    return;
  }

  try {
    const queueManager = getTaskQueueManager();

    // Forward task:queued event
    queueManager.on('task:queued', (task: unknown) => {
      sendToRenderer('task:queued', task);
    });

    // Forward task:started event
    queueManager.on('task:started', (task: unknown) => {
      sendToRenderer('task:started', task);
    });

    // Forward task:progress event
    queueManager.on('task:progress', (event: unknown) => {
      sendToRenderer('task:progress', event);
    });

    // Forward task:step-started event
    queueManager.on('task:step-started', (taskId: string, step: unknown) => {
      sendToRenderer('task:step-started', { taskId, step });
    });

    // Forward task:step-completed event
    queueManager.on('task:step-completed', (taskId: string, step: unknown, result: unknown) => {
      sendToRenderer('task:step-completed', { taskId, step, result });
    });

    // Forward task:completed event
    queueManager.on('task:completed', (event: unknown) => {
      sendToRenderer('task:completed', event);
    });

    // Forward task:cancelled event
    queueManager.on('task:cancelled', (taskId: string, reason?: string) => {
      sendToRenderer('task:cancelled', { taskId, reason });
    });

    // Forward task:paused event
    queueManager.on('task:paused', (taskId: string) => {
      sendToRenderer('task:paused', { taskId });
    });

    // Forward task:resumed event
    queueManager.on('task:resumed', (taskId: string) => {
      sendToRenderer('task:resumed', { taskId });
    });

    taskEventForwardingSetup = true;
    logger.info('[IPC] Task event forwarding set up');
  } catch (error) {
    logger.warn('[IPC] Failed to set up task event forwarding', {
      error: (error as Error).message,
    });
  }
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
  ipcMain.handle('atlas:start', async (_event, config?: unknown): Promise<IPCResult> => {
    logger.info('[atlas:start] IPC handler called', { hasConfig: config !== undefined });
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

      logger.info('[atlas:start] Calling initializeVoicePipeline...');
      const pipeline = await initializeVoicePipeline(validatedConfig);
      logger.info('[atlas:start] VoicePipeline created, calling start()...');
      await pipeline.start();
      logger.info('[atlas:start] VoicePipeline started successfully');
      return { success: true };
    } catch (error) {
      logger.error('Failed to start pipeline', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Stop voice pipeline
  ipcMain.handle('atlas:stop', async (): Promise<IPCResult> => {
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
  ipcMain.handle('atlas:shutdown', async (): Promise<IPCResult> => {
    try {
      await shutdownVoicePipeline();
      voicePipeline = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Get pipeline status
  ipcMain.handle('atlas:get-status', (): IPCResult => {
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
  ipcMain.handle('atlas:trigger-wake', (): IPCResult => {
    if (voicePipeline) {
      voicePipeline.triggerWake();
      return { success: true };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Send text - simple direct approach with tools
  ipcMain.handle('atlas:send-text', async (_event, text: unknown, _options?: { skipTTS?: boolean }): Promise<IPCResult> => {
    // Rate limit check
    if (!checkRateLimit('atlas:send-text')) {
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

    // Simple direct approach - no voice pipeline
    try {
      logger.info('[Chat] Processing with tools (simple path)', { textLength: validation.sanitized!.length });

      // Import and use simple chat with tools
      const { chatWithTools } = await import('../chat/simple-chat-tools');

      // Process and get response
      const response = await chatWithTools(validation.sanitized!);

      // Send response to renderer
      sendToRenderer('atlas:response', { type: 'text', content: response });

      return { success: true, data: response };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error('[Chat] Processing failed', { error: errorMsg });
      sendToRenderer('atlas:error', { type: 'llm', message: errorMsg });
      return { success: false, error: errorMsg };
    }
  });

  // Clear conversation history
  ipcMain.handle('atlas:clear-history', async (): Promise<IPCResult> => {
    if (voicePipeline) {
      await voicePipeline.clearHistory();
      return { success: true };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get conversation context
  ipcMain.handle('atlas:get-context', (): IPCResult => {
    if (voicePipeline) {
      const context = voicePipeline.getConversationContext();
      return { success: true, data: context };
    }
    return { success: false, error: 'Pipeline not initialized' };
  });

  // Get interaction metrics
  ipcMain.handle('atlas:get-metrics', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getMetrics() };
    }
    return { success: true, data: {} };
  });

  // Update pipeline config
  ipcMain.handle('atlas:update-config', (_event, config: unknown): IPCResult => {
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
  ipcMain.handle('atlas:get-config', (): IPCResult => {
    if (voicePipeline) {
      return { success: true, data: voicePipeline.getConfig() };
    }
    return { success: true, data: null };
  });

  // =========================================================================
  // Memory Handlers
  // =========================================================================

  // Get conversation history from memory
  ipcMain.handle('atlas:get-conversation-history', (_event, limit?: number): IPCResult => {
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
  ipcMain.handle('atlas:clear-memory', async (): Promise<IPCResult> => {
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
  ipcMain.handle('atlas:get-memory-stats', (): IPCResult => {
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
    'atlas:search-memory',
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
  ipcMain.handle('atlas:get-all-sessions', (): IPCResult => {
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
  // Memory Forgetting Handlers
  // =========================================================================

  // Forget memories by various criteria
  ipcMain.handle(
    'memory:forget',
    async (
      _event,
      options: {
        memoryIds?: string[];
        contentPattern?: string;
        tags?: string[];
        dateRange?: { start: number; end: number };
        force?: boolean;
        reason?: string;
        permanent?: boolean;
      }
    ): Promise<IPCResult> => {
      // Validate options
      const validation = validateConfigObject(options);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const { getForgettingManager } = require('../memory/forgetting');
        const forgettingManager = await getForgettingManager();

        const result = await forgettingManager.forget({
          memoryIds: options.memoryIds,
          contentPattern: options.contentPattern,
          tags: options.tags,
          dateRange: options.dateRange,
          force: options.force,
          reason: options.reason,
          permanent: options.permanent,
        });

        logger.info('Memory forget completed', {
          processed: result.processed,
          deleted: result.deleted,
          protected: result.protected,
        });

        return { success: true, data: result };
      } catch (error) {
        logger.error('Failed to forget memories', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get forgetting manager statistics
  ipcMain.handle('memory:get-forgetting-stats', async (): Promise<IPCResult> => {
    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      const stats = forgettingManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('Failed to get forgetting stats', { error });
      return { success: false, error: 'Forgetting manager not available' };
    }
  });

  // Process decay manually (for testing or maintenance)
  ipcMain.handle('memory:process-decay', async (_event, reason?: string): Promise<IPCResult> => {
    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      const result = await forgettingManager.processDecay(reason || 'manual');
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to process decay', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Record memory access for reinforcement
  ipcMain.handle('memory:record-access', async (_event, memoryId: unknown): Promise<IPCResult> => {
    if (typeof memoryId !== 'string') {
      return { success: false, error: 'Memory ID must be a string' };
    }

    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      forgettingManager.recordAccess(memoryId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to record memory access', { error });
      return { success: false, error: 'Forgetting manager not available' };
    }
  });

  // Submit GDPR deletion request
  ipcMain.handle(
    'memory:gdpr-delete',
    async (
      _event,
      request: {
        type: 'specific' | 'all' | 'date_range' | 'category';
        memoryIds?: string[];
        dateRange?: { start: number; end: number };
        categories?: string[];
        includeVectorStore?: boolean;
        includeConversations?: boolean;
      }
    ): Promise<IPCResult<string>> => {
      // Validate request
      const validation = validateConfigObject(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const validTypes = ['specific', 'all', 'date_range', 'category'];
      if (!validTypes.includes(request.type)) {
        return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
      }

      try {
        const { getForgettingManager } = require('../memory/forgetting');
        const forgettingManager = await getForgettingManager();

        const requestId = await forgettingManager.submitGDPRDeletionRequest({
          type: request.type,
          memoryIds: request.memoryIds,
          dateRange: request.dateRange,
          categories: request.categories as import('../memory/importance-scorer').MemoryCategory[],
          includeVectorStore: request.includeVectorStore ?? true,
          includeConversations: request.includeConversations ?? true,
        });

        logger.info('GDPR deletion request submitted', { requestId, type: request.type });
        return { success: true, data: requestId };
      } catch (error) {
        logger.error('Failed to submit GDPR deletion request', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get GDPR deletion request status
  ipcMain.handle(
    'memory:get-gdpr-status',
    async (_event, requestId: unknown): Promise<IPCResult> => {
      if (typeof requestId !== 'string') {
        return { success: false, error: 'Request ID must be a string' };
      }

      try {
        const { getForgettingManager } = require('../memory/forgetting');
        const forgettingManager = await getForgettingManager();
        const status = forgettingManager.getGDPRRequestStatus(requestId);
        return { success: true, data: status || null };
      } catch (error) {
        logger.error('Failed to get GDPR status', { error });
        return { success: false, error: 'Forgetting manager not available' };
      }
    }
  );

  // Export GDPR audit log
  ipcMain.handle('memory:export-gdpr-audit', async (): Promise<IPCResult<string>> => {
    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      const auditLog = await forgettingManager.exportGDPRAuditLog();
      return { success: true, data: auditLog };
    } catch (error) {
      logger.error('Failed to export GDPR audit log', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Start forgetting manager auto-decay
  ipcMain.handle('memory:start-forgetting', async (): Promise<IPCResult> => {
    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      forgettingManager.start();
      return { success: true };
    } catch (error) {
      logger.error('Failed to start forgetting manager', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Stop forgetting manager auto-decay
  ipcMain.handle('memory:stop-forgetting', async (): Promise<IPCResult> => {
    try {
      const { getForgettingManager } = require('../memory/forgetting');
      const forgettingManager = await getForgettingManager();
      forgettingManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop forgetting manager', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // =========================================================================
  // Selective Forgetting Handlers
  // =========================================================================

  // Check if message is a forget command
  ipcMain.handle('memory:detect-forget-command', (_event, message: unknown): IPCResult => {
    if (typeof message !== 'string') {
      return { success: false, error: 'Message must be a string' };
    }

    try {
      const { detectForgetCommand } = require('../memory/selective-forgetting');
      const command = detectForgetCommand(message);
      return { success: true, data: command };
    } catch (error) {
      logger.error('Failed to detect forget command', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Handle a forget command (detect and execute)
  ipcMain.handle(
    'memory:handle-forget-command',
    async (_event, message: unknown): Promise<IPCResult> => {
      if (typeof message !== 'string') {
        return { success: false, error: 'Message must be a string' };
      }

      try {
        const { handleForgetCommand } = require('../memory/selective-forgetting');
        const result = await handleForgetCommand(message);
        // Result is null if message is not a forget command
        return { success: true, data: result };
      } catch (error) {
        logger.error('Failed to handle forget command', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Execute a specific forget command
  ipcMain.handle(
    'memory:execute-forget',
    async (
      _event,
      command: {
        type: string;
        target?: string;
        count?: number;
        timeRange?: { start: number; end: number };
      }
    ): Promise<IPCResult> => {
      // Validate command
      const validTypes = [
        'forget_conversation',
        'forget_last',
        'forget_specific',
        'forget_topic',
        'forget_note',
        'forget_time_range',
        'dont_store',
      ];
      if (!command || !validTypes.includes(command.type)) {
        return {
          success: false,
          error: `Invalid command type. Must be one of: ${validTypes.join(', ')}`,
        };
      }

      try {
        const { executeForgetCommand } = require('../memory/selective-forgetting');
        const result = await executeForgetCommand({
          type: command.type,
          confidence: 1.0, // Manual execution = full confidence
          originalMessage: '',
          target: command.target,
          count: command.count,
          timeRange: command.timeRange
            ? { start: new Date(command.timeRange.start), end: new Date(command.timeRange.end) }
            : undefined,
        });
        return { success: result.success, data: result };
      } catch (error) {
        logger.error('Failed to execute forget command', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Forget current conversation
  ipcMain.handle('memory:forget-conversation', async (): Promise<IPCResult> => {
    try {
      const { getConversationMemory } = require('../memory/conversation-memory');
      const conversationMemory = await getConversationMemory();
      await conversationMemory.forgetConversation();
      return { success: true, data: { message: 'Conversation forgotten' } };
    } catch (error) {
      logger.error('Failed to forget conversation', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Forget last N turns
  ipcMain.handle('memory:forget-last-turns', async (_event, count: unknown): Promise<IPCResult> => {
    const turnCount = typeof count === 'number' && count > 0 ? count : 1;

    try {
      const { getConversationMemory } = require('../memory/conversation-memory');
      const conversationMemory = await getConversationMemory();
      const removed = conversationMemory.forgetLastTurns(turnCount);
      return { success: true, data: { removed } };
    } catch (error) {
      logger.error('Failed to forget last turns', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Forget a specific note
  ipcMain.handle(
    'memory:forget-note',
    async (
      _event,
      options: { notePath: string; removeFromIndex?: boolean; reason?: string }
    ): Promise<IPCResult> => {
      if (!options || typeof options.notePath !== 'string') {
        return { success: false, error: 'notePath is required' };
      }

      try {
        const { forgetNote } = require('../memory/note-writer');
        const result = await forgetNote(options.notePath, {
          removeFromIndex: options.removeFromIndex ?? true,
          reason: options.reason ?? 'ipc_request',
        });
        return { success: result.noteDeleted, data: result };
      } catch (error) {
        logger.error('Failed to forget note', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Forget multiple notes
  ipcMain.handle(
    'memory:forget-notes',
    async (
      _event,
      options: {
        directory?: string;
        pattern?: string;
        limit?: number;
        removeFromIndex?: boolean;
        reason?: string;
      }
    ): Promise<IPCResult> => {
      // Validate options
      const validation = validateConfigObject(options || {});
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const { forgetNotes } = require('../memory/note-writer');
        const result = await forgetNotes({
          directory: options?.directory as
            | 'people'
            | 'concepts'
            | 'skills'
            | 'tasks'
            | 'conversations'
            | 'research'
            | 'daily'
            | 'self'
            | 'profile',
          pattern: options?.pattern,
          limit: options?.limit,
          removeFromIndex: options?.removeFromIndex ?? true,
          reason: options?.reason ?? 'ipc_batch_request',
        });
        return { success: true, data: result };
      } catch (error) {
        logger.error('Failed to forget notes', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get forget capabilities description
  ipcMain.handle('memory:get-forget-capabilities', (): IPCResult => {
    try {
      const { getForgetCapabilities } = require('../memory/selective-forgetting');
      const capabilities = getForgetCapabilities();
      return { success: true, data: capabilities };
    } catch (error) {
      logger.error('Failed to get forget capabilities', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // =========================================================================
  // Budget & Cost Tracking Handlers
  // =========================================================================

  // Get budget statistics
  ipcMain.handle('atlas:get-budget-stats', (): IPCResult => {
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
  ipcMain.handle('atlas:set-daily-budget', (_event, budget: unknown): IPCResult => {
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

  // =========================================================================
  // Personality Handlers
  // =========================================================================

  // Get current personality settings
  ipcMain.handle('atlas:get-personality', (): IPCResult => {
    try {
      const llmManager = getLLMManager();
      const preset = llmManager.getCurrentPersonalityPreset();
      const traits = llmManager.getCurrentPersonalityTraits();

      return {
        success: true,
        data: {
          preset: preset || 'atlas',
          traits: traits || {
            friendliness: 0.9,
            formality: 0.3,
            humor: 0.7,
            curiosity: 0.9,
            energy: 0.8,
            patience: 0.9,
          },
        },
      };
    } catch (error) {
      logger.error('Failed to get personality', { error });
      return { success: false, error: 'Failed to get personality settings' };
    }
  });

  // Set personality preset
  ipcMain.handle('atlas:set-personality-preset', (_event, preset: unknown): IPCResult => {
    const validPresets: PersonalityPreset[] = ['atlas', 'professional', 'playful', 'minimal'];
    if (typeof preset !== 'string' || !validPresets.includes(preset as PersonalityPreset)) {
      return {
        success: false,
        error: `Invalid preset. Must be one of: ${validPresets.join(', ')}`,
      };
    }

    try {
      const llmManager = getLLMManager();
      llmManager.setPersonalityPreset(preset as PersonalityPreset);
      logger.info('Personality preset updated via IPC', { preset });
      return { success: true };
    } catch (error) {
      logger.error('Failed to set personality preset', { error });
      return { success: false, error: 'Failed to set personality preset' };
    }
  });

  // Set personality trait
  ipcMain.handle(
    'atlas:set-personality-trait',
    (_event, trait: unknown, value: unknown): IPCResult => {
      const validTraits: (keyof PersonalityTraits)[] = [
        'friendliness',
        'formality',
        'humor',
        'curiosity',
        'energy',
        'patience',
      ];

      if (typeof trait !== 'string' || !validTraits.includes(trait as keyof PersonalityTraits)) {
        return {
          success: false,
          error: `Invalid trait. Must be one of: ${validTraits.join(', ')}`,
        };
      }

      if (typeof value !== 'number' || value < 0 || value > 1) {
        return { success: false, error: 'Value must be a number between 0 and 1' };
      }

      try {
        const llmManager = getLLMManager();
        llmManager.setPersonalityTrait(trait as keyof PersonalityTraits, value);
        logger.debug('Personality trait updated via IPC', { trait, value });
        return { success: true };
      } catch (error) {
        logger.error('Failed to set personality trait', { error });
        return { success: false, error: 'Failed to set personality trait' };
      }
    }
  );

  // =========================================================================
  // Connectivity Handlers
  // =========================================================================

  // Get current connectivity status
  ipcMain.handle(
    'atlas:get-connectivity',
    (): IPCResult<{ status: ConnectivityStatus; services: ServiceAvailability }> => {
      try {
        const connectivity = getConnectivityManager();
        return {
          success: true,
          data: {
            status: connectivity.getStatus(),
            services: connectivity.getServiceAvailability(),
          },
        };
      } catch (error) {
        logger.error('Failed to get connectivity status', { error });
        return { success: false, error: 'Failed to get connectivity status' };
      }
    }
  );

  // Check if online
  ipcMain.handle('atlas:is-online', (): IPCResult<boolean> => {
    try {
      const connectivity = getConnectivityManager();
      return {
        success: true,
        data: connectivity.isOnline(),
      };
    } catch (error) {
      logger.error('Failed to check online status', { error });
      return { success: false, error: 'Failed to check online status' };
    }
  });

  // Force connectivity check
  ipcMain.handle('atlas:check-connectivity', async (): Promise<IPCResult<boolean>> => {
    try {
      const connectivity = getConnectivityManager();
      const isOnline = await connectivity.forceCheck();
      return {
        success: true,
        data: isOnline,
      };
    } catch (error) {
      logger.error('Failed to check connectivity', { error });
      return { success: false, error: 'Failed to check connectivity' };
    }
  });

  // Check if specific service is available
  ipcMain.handle('atlas:is-service-available', (_event, service: unknown): IPCResult<boolean> => {
    const validServices = ['fireworks', 'deepgram', 'elevenlabs', 'internet'];
    if (typeof service !== 'string' || !validServices.includes(service)) {
      return {
        success: false,
        error: `Invalid service. Must be one of: ${validServices.join(', ')}`,
      };
    }

    try {
      const connectivity = getConnectivityManager();
      return {
        success: true,
        data: connectivity.isServiceAvailable(service as keyof ServiceAvailability),
      };
    } catch (error) {
      logger.error('Failed to check service availability', { error });
      return { success: false, error: 'Failed to check service availability' };
    }
  });

  // =========================================================================
  // GPU Detection Handlers
  // =========================================================================

  // Set GPU info from renderer WebGL detection
  ipcMain.handle(
    'atlas:set-gpu-info',
    (
      _event,
      webglInfo: {
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
      }
    ): IPCResult<GPUCapabilities> => {
      // Validate required fields
      if (
        !webglInfo ||
        typeof webglInfo.vendor !== 'string' ||
        typeof webglInfo.renderer !== 'string'
      ) {
        return {
          success: false,
          error: 'Invalid WebGL info: vendor and renderer are required',
        };
      }

      try {
        const capabilities = detectGPUCapabilities(webglInfo);
        logger.info('GPU capabilities detected via IPC', {
          vendor: capabilities.gpu.vendor,
          tier: capabilities.gpu.tier,
          particleCount: capabilities.config.particleCount,
        });
        return {
          success: true,
          data: capabilities,
        };
      } catch (error) {
        logger.error('Failed to process GPU info', { error });
        return { success: false, error: 'Failed to process GPU info' };
      }
    }
  );

  // Get cached GPU capabilities
  ipcMain.handle('atlas:get-gpu-capabilities', (): IPCResult<GPUCapabilities | null> => {
    try {
      const capabilities = getCachedGPUCapabilities();
      return {
        success: true,
        data: capabilities,
      };
    } catch (error) {
      logger.error('Failed to get GPU capabilities', { error });
      return { success: false, error: 'Failed to get GPU capabilities' };
    }
  });

  // Get recommended particle count
  ipcMain.handle('atlas:get-recommended-particles', (): IPCResult<number> => {
    try {
      return {
        success: true,
        data: getRecommendedParticleCount(),
      };
    } catch (error) {
      logger.error('Failed to get recommended particle count', { error });
      return { success: false, error: 'Failed to get recommended particle count' };
    }
  });

  // Get recommended render configuration
  ipcMain.handle('atlas:get-render-config', (): IPCResult<GPURenderingConfig> => {
    try {
      return {
        success: true,
        data: getRecommendedRenderConfig(),
      };
    } catch (error) {
      logger.error('Failed to get render config', { error });
      return { success: false, error: 'Failed to get render config' };
    }
  });

  // =========================================================================
  // Smart Provider Handlers
  // =========================================================================

  // Get current providers
  ipcMain.handle(
    'atlas:get-current-providers',
    (): IPCResult<{
      stt: STTProvider | null;
      tts: TTSProvider | null;
      llm: LLMProvider | null;
    }> => {
      try {
        const smartProvider = getSmartProviderManager();
        return {
          success: true,
          data: smartProvider.getCurrentProviders(),
        };
      } catch (error) {
        logger.error('Failed to get current providers', { error });
        return { success: false, error: 'Failed to get current providers' };
      }
    }
  );

  // Force a specific STT provider
  ipcMain.handle('atlas:force-stt-provider', (_event, provider: unknown): IPCResult => {
    const validProviders: STTProvider[] = ['deepgram', 'vosk', 'whisper'];
    if (typeof provider !== 'string' || !validProviders.includes(provider as STTProvider)) {
      return {
        success: false,
        error: `Invalid STT provider. Must be one of: ${validProviders.join(', ')}`,
      };
    }

    try {
      const smartProvider = getSmartProviderManager();
      smartProvider.forceSTTProvider(provider as STTProvider);
      return { success: true };
    } catch (error) {
      logger.error('Failed to force STT provider', { error });
      return { success: false, error: 'Failed to force STT provider' };
    }
  });

  // Force a specific TTS provider
  ipcMain.handle('atlas:force-tts-provider', (_event, provider: unknown): IPCResult => {
    const validProviders: TTSProvider[] = ['elevenlabs', 'piper', 'system'];
    if (typeof provider !== 'string' || !validProviders.includes(provider as TTSProvider)) {
      return {
        success: false,
        error: `Invalid TTS provider. Must be one of: ${validProviders.join(', ')}`,
      };
    }

    try {
      const smartProvider = getSmartProviderManager();
      smartProvider.forceTTSProvider(provider as TTSProvider);
      return { success: true };
    } catch (error) {
      logger.error('Failed to force TTS provider', { error });
      return { success: false, error: 'Failed to force TTS provider' };
    }
  });

  // Force a specific LLM provider
  ipcMain.handle('atlas:force-llm-provider', (_event, provider: unknown): IPCResult => {
    const validProviders: LLMProvider[] = ['fireworks', 'openrouter', 'local'];
    if (typeof provider !== 'string' || !validProviders.includes(provider as LLMProvider)) {
      return {
        success: false,
        error: `Invalid LLM provider. Must be one of: ${validProviders.join(', ')}`,
      };
    }

    try {
      const smartProvider = getSmartProviderManager();
      smartProvider.forceLLMProvider(provider as LLMProvider);
      return { success: true };
    } catch (error) {
      logger.error('Failed to force LLM provider', { error });
      return { success: false, error: 'Failed to force LLM provider' };
    }
  });

  // Re-select all providers (useful after connectivity change)
  ipcMain.handle('atlas:reselect-providers', async (): Promise<IPCResult> => {
    try {
      const smartProvider = getSmartProviderManager();
      await smartProvider.selectAllProviders();
      return {
        success: true,
        data: smartProvider.getCurrentProviders(),
      };
    } catch (error) {
      logger.error('Failed to reselect providers', { error });
      return { success: false, error: 'Failed to reselect providers' };
    }
  });

  // =========================================================================
  // Auto Update Handlers
  // =========================================================================

  // Get updater state
  ipcMain.handle('updater:get-state', (): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      return {
        success: true,
        data: updater.getState(),
      };
    } catch (error) {
      logger.error('Failed to get updater state', { error });
      return { success: false, error: 'Updater not available' };
    }
  });

  // Check for updates
  ipcMain.handle('updater:check-for-updates', async (): Promise<IPCResult> => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      const updateInfo = await updater.checkForUpdates();
      return {
        success: true,
        data: updateInfo,
      };
    } catch (error) {
      logger.error('Failed to check for updates', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Download update
  ipcMain.handle('updater:download-update', async (): Promise<IPCResult> => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      logger.error('Failed to download update', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Install update (quit and install)
  ipcMain.handle('updater:install-update', (_event, silent?: boolean): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      updater.installUpdate(silent ?? false);
      return { success: true };
    } catch (error) {
      logger.error('Failed to install update', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Schedule update for next restart
  ipcMain.handle('updater:install-on-quit', (): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      updater.installOnQuit();
      return { success: true };
    } catch (error) {
      logger.error('Failed to schedule update', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel download
  ipcMain.handle('updater:cancel-download', (): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      updater.cancelDownload();
      return { success: true };
    } catch (error) {
      logger.error('Failed to cancel download', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get updater config
  ipcMain.handle('updater:get-config', (): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      return {
        success: true,
        data: updater.getConfig(),
      };
    } catch (error) {
      logger.error('Failed to get updater config', { error });
      return { success: false, error: 'Updater not available' };
    }
  });

  // Update updater config
  ipcMain.handle('updater:update-config', (_event, config: unknown): IPCResult => {
    const validation = validateConfigObject(config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      updater.updateConfig(validation.sanitized as Record<string, unknown>);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update updater config', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get rollback info
  ipcMain.handle('updater:get-rollback-info', (): IPCResult => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      return {
        success: true,
        data: updater.getRollbackInfo(),
      };
    } catch (error) {
      logger.error('Failed to get rollback info', { error });
      return { success: false, error: 'Updater not available' };
    }
  });

  // Perform rollback
  ipcMain.handle('updater:rollback', async (): Promise<IPCResult> => {
    try {
      const { getAutoUpdateManager } = require('../updater');
      const updater = getAutoUpdateManager();
      const success = await updater.rollback();
      return { success, data: { rolledBack: success } };
    } catch (error) {
      logger.error('Failed to rollback', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // =========================================================================
  // Response Cache Handlers
  // =========================================================================

  // Get cache statistics
  ipcMain.handle(
    'atlas:get-cache-stats',
    (): IPCResult<{ hits: number; misses: number; hitRate: number; entries: number } | null> => {
      try {
        const llmManager = getLLMManager();
        return {
          success: true,
          data: llmManager.getCacheStats(),
        };
      } catch (error) {
        logger.error('Failed to get cache stats', { error });
        return { success: false, error: 'Failed to get cache stats' };
      }
    }
  );

  // Clear response cache
  ipcMain.handle('atlas:clear-cache', (): IPCResult => {
    try {
      const llmManager = getLLMManager();
      llmManager.clearCache();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear cache', { error });
      return { success: false, error: 'Failed to clear cache' };
    }
  });

  // Enable/disable cache
  ipcMain.handle('atlas:set-cache-enabled', (_event, enabled: unknown): IPCResult => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Enabled must be a boolean' };
    }

    try {
      const llmManager = getLLMManager();
      llmManager.setCacheEnabled(enabled);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set cache enabled', { error });
      return { success: false, error: 'Failed to set cache enabled' };
    }
  });

  // Check if cache is enabled
  ipcMain.handle('atlas:is-cache-enabled', (): IPCResult<boolean> => {
    try {
      const llmManager = getLLMManager();
      return {
        success: true,
        data: llmManager.isCacheEnabled(),
      };
    } catch (error) {
      logger.error('Failed to check cache enabled', { error });
      return { success: false, error: 'Failed to check cache enabled' };
    }
  });

  // =========================================================================
  // Keyboard Shortcuts Handlers
  // =========================================================================

  // Get shortcut status
  ipcMain.handle('shortcuts:get-status', (): IPCResult => {
    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      return {
        success: true,
        data: manager.getStatus(),
      };
    } catch (error) {
      logger.error('Failed to get shortcut status', { error });
      return { success: false, error: 'Shortcut manager not available' };
    }
  });

  // Get shortcut config
  ipcMain.handle('shortcuts:get-config', (): IPCResult => {
    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      return {
        success: true,
        data: manager.getConfig(),
      };
    } catch (error) {
      logger.error('Failed to get shortcut config', { error });
      return { success: false, error: 'Shortcut manager not available' };
    }
  });

  // Get all shortcut bindings
  ipcMain.handle('shortcuts:get-bindings', (): IPCResult => {
    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      return {
        success: true,
        data: manager.getBindings(),
      };
    } catch (error) {
      logger.error('Failed to get shortcut bindings', { error });
      return { success: false, error: 'Shortcut manager not available' };
    }
  });

  // Update shortcut config
  ipcMain.handle('shortcuts:update-config', (_event, config: unknown): IPCResult => {
    const validation = validateConfigObject(config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      manager.updateConfig(validation.sanitized);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update shortcut config', { error });
      return { success: false, error: 'Failed to update shortcut config' };
    }
  });

  // Set custom binding
  ipcMain.handle(
    'shortcuts:set-binding',
    (_event, action: unknown, accelerator: unknown): IPCResult => {
      if (typeof action !== 'string') {
        return { success: false, error: 'Action must be a string' };
      }
      if (typeof accelerator !== 'string') {
        return { success: false, error: 'Accelerator must be a string' };
      }

      try {
        const { getShortcutManager } = require('../shortcuts');
        const manager = getShortcutManager();
        const success = manager.setBinding(action, accelerator);
        return {
          success,
          error: success ? undefined : 'Failed to set binding - may conflict with system shortcut',
        };
      } catch (error) {
        logger.error('Failed to set shortcut binding', { error });
        return { success: false, error: 'Failed to set shortcut binding' };
      }
    }
  );

  // Reset binding to default
  ipcMain.handle('shortcuts:reset-binding', (_event, action: unknown): IPCResult => {
    if (typeof action !== 'string') {
      return { success: false, error: 'Action must be a string' };
    }

    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      manager.resetBinding(action);
      return { success: true };
    } catch (error) {
      logger.error('Failed to reset shortcut binding', { error });
      return { success: false, error: 'Failed to reset shortcut binding' };
    }
  });

  // Enable/disable a shortcut
  ipcMain.handle(
    'shortcuts:set-enabled',
    (_event, action: unknown, enabled: unknown): IPCResult => {
      if (typeof action !== 'string') {
        return { success: false, error: 'Action must be a string' };
      }
      if (typeof enabled !== 'boolean') {
        return { success: false, error: 'Enabled must be a boolean' };
      }

      try {
        const { getShortcutManager } = require('../shortcuts');
        const manager = getShortcutManager();
        manager.setEnabled(action, enabled);
        return { success: true };
      } catch (error) {
        logger.error('Failed to set shortcut enabled', { error });
        return { success: false, error: 'Failed to set shortcut enabled' };
      }
    }
  );

  // Enable/disable all global shortcuts
  ipcMain.handle('shortcuts:set-global-enabled', (_event, enabled: unknown): IPCResult => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Enabled must be a boolean' };
    }

    try {
      const { getShortcutManager } = require('../shortcuts');
      const manager = getShortcutManager();
      manager.setGlobalEnabled(enabled);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set global shortcuts enabled', { error });
      return { success: false, error: 'Failed to set global shortcuts enabled' };
    }
  });

  // ============================================================================
  // 045-A: BACKGROUND RESEARCH HANDLERS
  // ============================================================================

  // Get research queue status
  ipcMain.handle('research:get-queue', (): IPCResult => {
    try {
      const manager = getBackgroundResearchManager();
      const status = manager.getQueueStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error('Failed to get research queue', { error });
      return { success: false, error: 'Failed to get research queue' };
    }
  });

  // Get research state
  ipcMain.handle('research:get-state', (): IPCResult<ResearchState> => {
    try {
      const manager = getBackgroundResearchManager();
      return { success: true, data: manager.getState() };
    } catch (error) {
      logger.error('Failed to get research state', { error });
      return { success: false, error: 'Failed to get research state' };
    }
  });

  // Queue a research topic
  ipcMain.handle(
    'research:queue-topic',
    (_event, query: unknown, priority?: unknown): IPCResult => {
      if (typeof query !== 'string') {
        return { success: false, error: 'Query must be a string' };
      }
      if (priority !== undefined && !['high', 'medium', 'low'].includes(priority as string)) {
        return { success: false, error: 'Priority must be high, medium, or low' };
      }

      try {
        const manager = getBackgroundResearchManager();
        const topic: ResearchTopic = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          query,
          priority: (priority as 'high' | 'medium' | 'low') || 'medium',
          source: 'user_interest',
          createdAt: Date.now(),
        };
        const queued = manager.queueTopic(topic);
        return { success: true, data: { queued, topicId: topic.id } };
      } catch (error) {
        logger.error('Failed to queue research topic', { error });
        return { success: false, error: 'Failed to queue research topic' };
      }
    }
  );

  // Get research result by query
  ipcMain.handle(
    'research:get-result',
    (_event, query: unknown): IPCResult<ResearchResult | null> => {
      if (typeof query !== 'string') {
        return { success: false, error: 'Query must be a string' };
      }

      try {
        const manager = getBackgroundResearchManager();
        const result = manager.getResult(query);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Failed to get research result', { error });
        return { success: false, error: 'Failed to get research result' };
      }
    }
  );

  // Get all research results
  ipcMain.handle('research:get-all-results', (): IPCResult<ResearchResult[]> => {
    try {
      const manager = getBackgroundResearchManager();
      const results = manager.getAllResults();
      return { success: true, data: results };
    } catch (error) {
      logger.error('Failed to get research results', { error });
      return { success: false, error: 'Failed to get research results' };
    }
  });

  // Get research context for a query
  ipcMain.handle('research:get-context', (_event, query: unknown): IPCResult<string> => {
    if (typeof query !== 'string') {
      return { success: false, error: 'Query must be a string' };
    }

    try {
      const manager = getBackgroundResearchManager();
      const context = manager.getResearchContext(query);
      return { success: true, data: context };
    } catch (error) {
      logger.error('Failed to get research context', { error });
      return { success: false, error: 'Failed to get research context' };
    }
  });

  // Clear research queue
  ipcMain.handle('research:clear-queue', (): IPCResult => {
    try {
      const manager = getBackgroundResearchManager();
      manager.clearQueue();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear research queue', { error });
      return { success: false, error: 'Failed to clear research queue' };
    }
  });

  // Clear research results
  ipcMain.handle('research:clear-results', (): IPCResult => {
    try {
      const manager = getBackgroundResearchManager();
      manager.clearResults();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear research results', { error });
      return { success: false, error: 'Failed to clear research results' };
    }
  });

  // Notify activity (pauses research)
  ipcMain.handle('research:notify-activity', (): IPCResult => {
    try {
      const manager = getBackgroundResearchManager();
      manager.notifyActivity();
      return { success: true };
    } catch (error) {
      logger.error('Failed to notify research activity', { error });
      return { success: false, error: 'Failed to notify research activity' };
    }
  });

  // Update research config
  ipcMain.handle('research:set-enabled', (_event, enabled: unknown): IPCResult => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Enabled must be a boolean' };
    }

    try {
      const manager = getBackgroundResearchManager();
      manager.setConfig({ enabled });
      return { success: true };
    } catch (error) {
      logger.error('Failed to set research enabled', { error });
      return { success: false, error: 'Failed to set research enabled' };
    }
  });

  // ============================================================================
  // 045-C: TASK SCHEDULER HANDLERS
  // ============================================================================

  // Create a task
  ipcMain.handle(
    'scheduler:create-task',
    (_event, title: unknown, scheduledAt: unknown, options?: unknown): IPCResult<ScheduledTask> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }
      if (typeof scheduledAt !== 'number') {
        return { success: false, error: 'ScheduledAt must be a timestamp' };
      }

      try {
        const scheduler = getTaskScheduler();
        const task = scheduler.createTask(
          title,
          scheduledAt,
          options as Partial<ScheduledTask> | undefined
        );
        return { success: true, data: task };
      } catch (error) {
        logger.error('Failed to create task', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Create a reminder
  ipcMain.handle(
    'scheduler:create-reminder',
    (
      _event,
      title: unknown,
      inMinutes: unknown,
      description?: unknown
    ): IPCResult<ScheduledTask> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }
      if (typeof inMinutes !== 'number') {
        return { success: false, error: 'InMinutes must be a number' };
      }

      try {
        const scheduler = getTaskScheduler();
        const task = scheduler.createReminder(title, inMinutes, description as string | undefined);
        return { success: true, data: task };
      } catch (error) {
        logger.error('Failed to create reminder', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get all tasks
  ipcMain.handle('scheduler:get-all-tasks', (): IPCResult<ScheduledTask[]> => {
    try {
      const scheduler = getTaskScheduler();
      return { success: true, data: scheduler.getAllTasks() };
    } catch (error) {
      logger.error('Failed to get all tasks', { error });
      return { success: false, error: 'Failed to get tasks' };
    }
  });

  // Get pending tasks
  ipcMain.handle('scheduler:get-pending-tasks', (): IPCResult<ScheduledTask[]> => {
    try {
      const scheduler = getTaskScheduler();
      return { success: true, data: scheduler.getPendingTasks() };
    } catch (error) {
      logger.error('Failed to get pending tasks', { error });
      return { success: false, error: 'Failed to get pending tasks' };
    }
  });

  // Get due tasks
  ipcMain.handle('scheduler:get-due-tasks', (): IPCResult<ScheduledTask[]> => {
    try {
      const scheduler = getTaskScheduler();
      return { success: true, data: scheduler.getDueTasks() };
    } catch (error) {
      logger.error('Failed to get due tasks', { error });
      return { success: false, error: 'Failed to get due tasks' };
    }
  });

  // Get upcoming tasks
  ipcMain.handle(
    'scheduler:get-upcoming-tasks',
    (_event, withinMs: unknown): IPCResult<ScheduledTask[]> => {
      if (typeof withinMs !== 'number') {
        return { success: false, error: 'WithinMs must be a number' };
      }

      try {
        const scheduler = getTaskScheduler();
        return { success: true, data: scheduler.getUpcomingTasks(withinMs) };
      } catch (error) {
        logger.error('Failed to get upcoming tasks', { error });
        return { success: false, error: 'Failed to get upcoming tasks' };
      }
    }
  );

  // Complete a task
  ipcMain.handle(
    'scheduler:complete-task',
    (_event, id: unknown): IPCResult<ScheduledTask | null> => {
      if (typeof id !== 'string') {
        return { success: false, error: 'ID must be a string' };
      }

      try {
        const scheduler = getTaskScheduler();
        const task = scheduler.completeTask(id);
        return { success: true, data: task };
      } catch (error) {
        logger.error('Failed to complete task', { error });
        return { success: false, error: 'Failed to complete task' };
      }
    }
  );

  // Delete a task
  ipcMain.handle('scheduler:delete-task', (_event, id: unknown): IPCResult => {
    if (typeof id !== 'string') {
      return { success: false, error: 'ID must be a string' };
    }

    try {
      const scheduler = getTaskScheduler();
      const success = scheduler.deleteTask(id);
      return { success };
    } catch (error) {
      logger.error('Failed to delete task', { error });
      return { success: false, error: 'Failed to delete task' };
    }
  });

  // Snooze a task
  ipcMain.handle(
    'scheduler:snooze-task',
    (_event, id: unknown, minutes: unknown): IPCResult<ScheduledTask | null> => {
      if (typeof id !== 'string') {
        return { success: false, error: 'ID must be a string' };
      }
      if (typeof minutes !== 'number') {
        return { success: false, error: 'Minutes must be a number' };
      }

      try {
        const scheduler = getTaskScheduler();
        const task = scheduler.snoozeTask(id, minutes);
        return { success: true, data: task };
      } catch (error) {
        logger.error('Failed to snooze task', { error });
        return { success: false, error: 'Failed to snooze task' };
      }
    }
  );

  // Get scheduler stats
  ipcMain.handle('scheduler:get-stats', (): IPCResult => {
    try {
      const scheduler = getTaskScheduler();
      return { success: true, data: scheduler.getStats() };
    } catch (error) {
      logger.error('Failed to get scheduler stats', { error });
      return { success: false, error: 'Failed to get scheduler stats' };
    }
  });

  // Clear completed tasks
  ipcMain.handle('scheduler:clear-completed', (): IPCResult<number> => {
    try {
      const scheduler = getTaskScheduler();
      const cleared = scheduler.clearCompleted();
      return { success: true, data: cleared };
    } catch (error) {
      logger.error('Failed to clear completed tasks', { error });
      return { success: false, error: 'Failed to clear completed tasks' };
    }
  });

  // =========================================================================
  // Performance Profiler Handlers
  // =========================================================================

  // Get performance data (metrics, snapshots, status)
  ipcMain.handle('atlas:get-performance-data', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      return {
        success: true,
        data: {
          metrics: profiler.getMetricsSummary(),
          snapshots: profiler.getSnapshots(60), // Last 60 snapshots
          status: profiler.getStatus(),
        },
      };
    } catch (error) {
      logger.error('Failed to get performance data', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Get performance metrics summary
  ipcMain.handle('atlas:get-performance-metrics', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      return {
        success: true,
        data: profiler.getMetricsSummary(),
      };
    } catch (error) {
      logger.error('Failed to get performance metrics', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Get metric history for a specific metric
  ipcMain.handle(
    'atlas:get-metric-history',
    (_event, metricName: unknown, limit?: unknown): IPCResult => {
      if (typeof metricName !== 'string') {
        return { success: false, error: 'Metric name must be a string' };
      }
      if (limit !== undefined && typeof limit !== 'number') {
        return { success: false, error: 'Limit must be a number' };
      }

      try {
        const { getPerformanceProfiler } = require('../performance/profiler');
        const profiler = getPerformanceProfiler();
        return {
          success: true,
          data: profiler.getMetricHistory(metricName, limit as number | undefined),
        };
      } catch (error) {
        logger.error('Failed to get metric history', { error });
        return { success: false, error: 'Performance profiler not available' };
      }
    }
  );

  // Get performance snapshots
  ipcMain.handle('atlas:get-performance-snapshots', (_event, limit?: unknown): IPCResult => {
    if (limit !== undefined && typeof limit !== 'number') {
      return { success: false, error: 'Limit must be a number' };
    }

    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      return {
        success: true,
        data: profiler.getSnapshots(limit as number | undefined),
      };
    } catch (error) {
      logger.error('Failed to get performance snapshots', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Take a performance snapshot
  ipcMain.handle('atlas:take-performance-snapshot', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      const snapshot = profiler.takeSnapshot();
      return {
        success: true,
        data: snapshot,
      };
    } catch (error) {
      logger.error('Failed to take performance snapshot', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Export performance report
  ipcMain.handle(
    'atlas:export-performance-report',
    async (_event, filename?: unknown): Promise<IPCResult> => {
      if (filename !== undefined && typeof filename !== 'string') {
        return { success: false, error: 'Filename must be a string' };
      }

      try {
        const { getPerformanceProfiler } = require('../performance/profiler');
        const profiler = getPerformanceProfiler();
        const filepath = profiler.exportReport(filename as string | undefined);
        return {
          success: true,
          data: filepath,
        };
      } catch (error) {
        logger.error('Failed to export performance report', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Generate performance report (without saving)
  ipcMain.handle('atlas:generate-performance-report', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      const report = profiler.generateReport();
      return {
        success: true,
        data: report,
      };
    } catch (error) {
      logger.error('Failed to generate performance report', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Start profiler
  ipcMain.handle('atlas:start-profiler', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      profiler.start();
      return { success: true };
    } catch (error) {
      logger.error('Failed to start profiler', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Stop profiler
  ipcMain.handle('atlas:stop-profiler', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      profiler.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop profiler', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Reset profiler metrics
  ipcMain.handle('atlas:reset-profiler', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      profiler.reset();
      return { success: true };
    } catch (error) {
      logger.error('Failed to reset profiler', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Update profiler config
  ipcMain.handle('atlas:update-profiler-config', (_event, config: unknown): IPCResult => {
    const validation = validateConfigObject(config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      profiler.updateConfig(validation.sanitized as Record<string, unknown>);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update profiler config', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Get startup timing data
  ipcMain.handle('atlas:get-startup-timing', (): IPCResult => {
    try {
      const { getStartupProfiler } = require('../performance/startup-profiler');
      const profiler = getStartupProfiler();

      const timeline = profiler.getTimeline();
      const jsonData = profiler.generateJsonTimeline();
      const report = profiler.generateReport();

      return {
        success: true,
        data: {
          timeline,
          phases: (jsonData as { phases?: unknown[] }).phases || [],
          totalDurationMs: report?.totalDurationMs || 0,
          isWarmStart: report?.isWarmStart || false,
          recommendations: report?.recommendations || [],
          memoryUsage: report?.memoryUsage,
          slowModules: report?.slowModules || [],
          phaseSummaries: report?.phases || [],
        },
      };
    } catch (error) {
      logger.error('Failed to get startup timing', { error });
      return { success: false, error: 'Startup profiler not available' };
    }
  });

  // Get profiler status
  ipcMain.handle('atlas:get-profiler-status', (): IPCResult => {
    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      return {
        success: true,
        data: profiler.getStatus(),
      };
    } catch (error) {
      logger.error('Failed to get profiler status', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Update render metrics from renderer
  ipcMain.handle('atlas:update-render-metrics', (_event, metrics: unknown): IPCResult => {
    const validation = validateConfigObject(metrics);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const { getPerformanceProfiler } = require('../performance/profiler');
      const profiler = getPerformanceProfiler();
      profiler.updateRenderMetrics(
        validation.sanitized as {
          fps: number;
          avgFps: number;
          frameTime: number;
          particleCount: number;
          drawCalls: number;
          triangles: number;
          gpuMemory?: number;
        }
      );
      return { success: true };
    } catch (error) {
      logger.error('Failed to update render metrics', { error });
      return { success: false, error: 'Performance profiler not available' };
    }
  });

  // Record voice pipeline timing
  ipcMain.handle(
    'atlas:record-voice-timing',
    (_event, stage: unknown, duration: unknown): IPCResult => {
      if (typeof stage !== 'string') {
        return { success: false, error: 'Stage must be a string' };
      }
      if (typeof duration !== 'number') {
        return { success: false, error: 'Duration must be a number' };
      }

      try {
        const { getPerformanceProfiler } = require('../performance/profiler');
        const profiler = getPerformanceProfiler();
        profiler.recordVoiceTiming(
          stage as
          | 'wakeWordDetection'
          | 'vadProcessing'
          | 'sttLatency'
          | 'llmFirstToken'
          | 'llmTotalTime'
          | 'ttsFirstAudio'
          | 'ttsTotalTime'
          | 'totalResponseTime',
          duration
        );
        return { success: true };
      } catch (error) {
        logger.error('Failed to record voice timing', { error });
        return { success: false, error: 'Performance profiler not available' };
      }
    }
  );

  // ============================================================================
  // 046-A: Secure Storage (Keychain) IPC Handlers
  // ============================================================================

  // Get an API key (returns null if not found)
  ipcMain.handle(
    'keychain:get-key',
    async (_event, keyName: unknown): Promise<IPCResult<string | null>> => {
      if (typeof keyName !== 'string' || !SUPPORTED_API_KEYS.includes(keyName as ApiKeyName)) {
        return {
          success: false,
          error: `Invalid key name. Supported keys: ${SUPPORTED_API_KEYS.join(', ')}`,
        };
      }

      try {
        const keychain = getKeychainManager();
        const value = await keychain.getKey(keyName as ApiKeyName);
        return { success: true, data: value };
      } catch (error) {
        logger.error('Failed to get API key', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Set an API key
  ipcMain.handle(
    'keychain:set-key',
    async (_event, keyName: unknown, value: unknown): Promise<IPCResult> => {
      if (typeof keyName !== 'string' || !SUPPORTED_API_KEYS.includes(keyName as ApiKeyName)) {
        return {
          success: false,
          error: `Invalid key name. Supported keys: ${SUPPORTED_API_KEYS.join(', ')}`,
        };
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return { success: false, error: 'Value must be a non-empty string' };
      }

      try {
        const keychain = getKeychainManager();
        const result = await keychain.setKey(keyName as ApiKeyName, value);
        return result;
      } catch (error) {
        logger.error('Failed to set API key', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Delete an API key
  ipcMain.handle('keychain:delete-key', async (_event, keyName: unknown): Promise<IPCResult> => {
    if (typeof keyName !== 'string' || !SUPPORTED_API_KEYS.includes(keyName as ApiKeyName)) {
      return {
        success: false,
        error: `Invalid key name. Supported keys: ${SUPPORTED_API_KEYS.join(', ')}`,
      };
    }

    try {
      const keychain = getKeychainManager();
      const result = await keychain.deleteKey(keyName as ApiKeyName);
      return result;
    } catch (error) {
      logger.error('Failed to delete API key', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Check if an API key exists
  ipcMain.handle(
    'keychain:has-key',
    async (_event, keyName: unknown): Promise<IPCResult<boolean>> => {
      if (typeof keyName !== 'string' || !SUPPORTED_API_KEYS.includes(keyName as ApiKeyName)) {
        return {
          success: false,
          error: `Invalid key name. Supported keys: ${SUPPORTED_API_KEYS.join(', ')}`,
        };
      }

      try {
        const keychain = getKeychainManager();
        const hasKey = await keychain.hasKey(keyName as ApiKeyName);
        return { success: true, data: hasKey };
      } catch (error) {
        logger.error('Failed to check API key', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // List all stored keys (names only, not values)
  ipcMain.handle(
    'keychain:list-keys',
    async (): Promise<IPCResult<Array<{ name: string; storage: string; hasValue: boolean }>>> => {
      try {
        const keychain = getKeychainManager();
        const keys = await keychain.listKeys();
        return { success: true, data: keys };
      } catch (error) {
        logger.error('Failed to list API keys', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get a masked version of a key for display
  ipcMain.handle(
    'keychain:get-masked-key',
    async (_event, keyName: unknown): Promise<IPCResult<string | null>> => {
      if (typeof keyName !== 'string' || !SUPPORTED_API_KEYS.includes(keyName as ApiKeyName)) {
        return {
          success: false,
          error: `Invalid key name. Supported keys: ${SUPPORTED_API_KEYS.join(', ')}`,
        };
      }

      try {
        const keychain = getKeychainManager();
        const masked = await keychain.getMaskedKey(keyName as ApiKeyName);
        return { success: true, data: masked };
      } catch (error) {
        logger.error('Failed to get masked API key', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Clear all API keys (for app reset)
  ipcMain.handle('keychain:clear-all', async (): Promise<IPCResult> => {
    try {
      const keychain = getKeychainManager();
      const result = await keychain.clearAllKeys();
      return result;
    } catch (error) {
      logger.error('Failed to clear all API keys', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Check keychain health
  ipcMain.handle(
    'keychain:check-health',
    async (): Promise<
      IPCResult<{ keychainAvailable: boolean; fallbackAvailable: boolean; keysStored: number }>
    > => {
      try {
        const keychain = getKeychainManager();
        const health = await keychain.checkHealth();
        return { success: true, data: health };
      } catch (error) {
        logger.error('Failed to check keychain health', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get list of supported API key names
  ipcMain.handle('keychain:get-supported-keys', (): IPCResult<string[]> => {
    return { success: true, data: [...SUPPORTED_API_KEYS] };
  });

  // =========================================================================
  // Memory Graph Handlers
  // =========================================================================

  // Get memory graph data
  ipcMain.handle('atlas:get-memory-graph', (_event, options?: unknown): IPCResult => {
    // Validate options if provided
    let validatedOptions: Record<string, unknown> | undefined;
    if (options !== undefined) {
      const validation = validateConfigObject(options);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      validatedOptions = validation.sanitized;
    }

    try {
      const { getGraphBuilder } = require('../memory/graph-builder');
      const graphBuilder = getGraphBuilder();

      // Get memory data from pipeline
      if (voicePipeline) {
        const memoryManager = voicePipeline.getMemoryManager();
        if (memoryManager) {
          const entries = memoryManager.searchEntries({ limit: 1000 });
          const sessions = memoryManager.getAllSessions();

          // Try to get summaries if available
          let summaries: unknown[] = [];
          try {
            const { getConversationSummarizer } = require('../memory/consolidation/summarizer');
            const summarizer = getConversationSummarizer();
            const summaryResult = summarizer?.searchSummaries?.({ limit: 100 });
            summaries = summaryResult?.summaries || [];
          } catch {
            // Summarizer may not be available
          }

          const graph = graphBuilder.buildGraph(entries, sessions, summaries, validatedOptions);

          return { success: true, data: graph };
        }
      }

      // Return empty graph if no data
      return {
        success: true,
        data: {
          nodes: [],
          edges: [],
          stats: {
            nodeCount: 0,
            edgeCount: 0,
            nodesByType: {},
            edgesByType: {},
            averageWeight: 0,
            averageStrength: 0,
            topConnected: [],
            dateRange: { start: Date.now(), end: Date.now() },
          },
          generatedAt: Date.now(),
        },
      };
    } catch (error) {
      logger.error('Failed to get memory graph', { error });
      return { success: false, error: 'Failed to generate memory graph' };
    }
  });

  // Get node details
  ipcMain.handle('atlas:get-graph-node', (_event, nodeId: unknown): IPCResult => {
    if (typeof nodeId !== 'string') {
      return { success: false, error: 'Node ID must be a string' };
    }

    try {
      const { getGraphBuilder } = require('../memory/graph-builder');
      const graphBuilder = getGraphBuilder();
      const node = graphBuilder.getNode(nodeId);

      if (node) {
        return { success: true, data: node };
      }
      return { success: false, error: 'Node not found' };
    } catch (error) {
      logger.error('Failed to get graph node', { error });
      return { success: false, error: 'Failed to get graph node' };
    }
  });

  // Get node neighbors
  ipcMain.handle('atlas:get-graph-neighbors', (_event, nodeId: unknown): IPCResult => {
    if (typeof nodeId !== 'string') {
      return { success: false, error: 'Node ID must be a string' };
    }

    try {
      const { getGraphBuilder } = require('../memory/graph-builder');
      const graphBuilder = getGraphBuilder();

      // Build graph to get edges
      if (voicePipeline) {
        const memoryManager = voicePipeline.getMemoryManager();
        if (memoryManager) {
          const entries = memoryManager.searchEntries({ limit: 1000 });
          const sessions = memoryManager.getAllSessions();
          const graph = graphBuilder.buildGraph(entries, sessions, []);
          const neighbors = graphBuilder.getNeighbors(nodeId, graph.edges);
          return { success: true, data: neighbors };
        }
      }

      return { success: true, data: [] };
    } catch (error) {
      logger.error('Failed to get graph neighbors', { error });
      return { success: false, error: 'Failed to get graph neighbors' };
    }
  });

  // =========================================================================
  // Calendar Integration Handlers
  // =========================================================================

  // Initialize calendar integration
  ipcMain.handle('calendar:initialize', async (): Promise<IPCResult<CalendarManagerStatus>> => {
    try {
      await initializeCalendarManager();
      const manager = getCalendarManager();
      return { success: true, data: manager.getStatus() };
    } catch (error) {
      logger.error('Failed to initialize calendar', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get calendar status
  ipcMain.handle('calendar:get-status', (): IPCResult<CalendarManagerStatus> => {
    try {
      const manager = getCalendarManager();
      return { success: true, data: manager.getStatus() };
    } catch (error) {
      logger.error('Failed to get calendar status', { error });
      return { success: false, error: 'Calendar not initialized' };
    }
  });

  // Add calendar account (Google or Microsoft)
  ipcMain.handle(
    'calendar:add-account',
    async (_event, provider: unknown): Promise<IPCResult<CalendarAccount>> => {
      if (typeof provider !== 'string' || !['google', 'microsoft'].includes(provider)) {
        return { success: false, error: 'Provider must be "google" or "microsoft"' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.addAccount(provider as CalendarProvider);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to add calendar account', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Remove calendar account
  ipcMain.handle(
    'calendar:remove-account',
    async (_event, accountId: unknown): Promise<IPCResult> => {
      if (typeof accountId !== 'string') {
        return { success: false, error: 'Account ID must be a string' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.removeAccount(accountId);
        return result;
      } catch (error) {
        logger.error('Failed to remove calendar account', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get all calendar accounts
  ipcMain.handle('calendar:get-accounts', (): IPCResult<CalendarAccount[]> => {
    try {
      const manager = getCalendarManager();
      return { success: true, data: manager.getAccounts() };
    } catch (error) {
      logger.error('Failed to get calendar accounts', { error });
      return { success: false, error: 'Calendar not initialized' };
    }
  });

  // List calendars
  ipcMain.handle(
    'calendar:list-calendars',
    async (_event, accountId?: unknown): Promise<IPCResult<Calendar[]>> => {
      if (accountId !== undefined && typeof accountId !== 'string') {
        return { success: false, error: 'Account ID must be a string' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.listCalendars(accountId as string | undefined);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to list calendars', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // List events
  ipcMain.handle(
    'calendar:list-events',
    async (_event, request: unknown): Promise<IPCResult<CalendarEvent[]>> => {
      const validation = validateConfigObject(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.listEvents(validation.sanitized as ListEventsRequest);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to list events', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Create event
  ipcMain.handle(
    'calendar:create-event',
    async (_event, request: unknown): Promise<IPCResult<CalendarEvent>> => {
      const validation = validateConfigObject(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const eventRequest = validation.sanitized as unknown as CreateEventRequest;
      if (!eventRequest.title) {
        return { success: false, error: 'Event title is required' };
      }
      if (!eventRequest.startTime || !eventRequest.endTime) {
        return { success: false, error: 'Event start and end times are required' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.createEvent(eventRequest);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to create event', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Update event
  ipcMain.handle(
    'calendar:update-event',
    async (_event, request: unknown): Promise<IPCResult<CalendarEvent>> => {
      const validation = validateConfigObject(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const eventRequest = validation.sanitized as unknown as UpdateEventRequest;
      if (!eventRequest.eventId) {
        return { success: false, error: 'Event ID is required' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.updateEvent(eventRequest);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to update event', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Delete event
  ipcMain.handle('calendar:delete-event', async (_event, request: unknown): Promise<IPCResult> => {
    const validation = validateConfigObject(request);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const eventRequest = validation.sanitized as unknown as DeleteEventRequest;
    if (!eventRequest.eventId) {
      return { success: false, error: 'Event ID is required' };
    }

    try {
      const manager = getCalendarManager();
      const result = await manager.deleteEvent(eventRequest);
      return result;
    } catch (error) {
      logger.error('Failed to delete event', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get upcoming events summary (for voice)
  ipcMain.handle(
    'calendar:get-upcoming',
    async (_event, hours?: unknown): Promise<IPCResult<EventSummary>> => {
      if (hours !== undefined && typeof hours !== 'number') {
        return { success: false, error: 'Hours must be a number' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.getUpcomingEventsSummary(hours as number | undefined);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to get upcoming events', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Check free/busy status
  ipcMain.handle(
    'calendar:get-free-busy',
    async (_event, request: unknown): Promise<IPCResult<FreeBusyResponse>> => {
      const validation = validateConfigObject(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const freeBusyRequest = validation.sanitized as unknown as FreeBusyRequest;
      if (!freeBusyRequest.timeMin || !freeBusyRequest.timeMax) {
        return { success: false, error: 'Time range (timeMin, timeMax) is required' };
      }

      try {
        const manager = getCalendarManager();
        const result = await manager.getFreeBusy(freeBusyRequest);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      } catch (error) {
        logger.error('Failed to get free/busy', { error });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Sync calendar account
  ipcMain.handle('calendar:sync', async (_event, accountId: unknown): Promise<IPCResult> => {
    if (typeof accountId !== 'string') {
      return { success: false, error: 'Account ID must be a string' };
    }

    try {
      const manager = getCalendarManager();
      const result = await manager.syncAccount(accountId);
      return result;
    } catch (error) {
      logger.error('Failed to sync calendar', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // Set online/offline status
  ipcMain.handle('calendar:set-online', (_event, isOnline: unknown): IPCResult => {
    if (typeof isOnline !== 'boolean') {
      return { success: false, error: 'Online status must be a boolean' };
    }

    try {
      const manager = getCalendarManager();
      manager.setOnlineStatus(isOnline);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set calendar online status', { error });
      return { success: false, error: (error as Error).message };
    }
  });

  // =========================================================================
  // Tools Handlers (T3-022)
  // =========================================================================

  // Get all tool definitions for LLM
  ipcMain.handle('tools:list', (): IPCResult => {
    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      return {
        success: true,
        data: registry.getToolDefinitions(),
      };
    } catch (error) {
      logger.error('Failed to list tools', { error });
      return { success: false, error: 'Tool registry not available' };
    }
  });

  // Get tool summary (categories and counts)
  ipcMain.handle('tools:get-summary', (): IPCResult => {
    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      return {
        success: true,
        data: registry.getSummary(),
      };
    } catch (error) {
      logger.error('Failed to get tool summary', { error });
      return { success: false, error: 'Tool registry not available' };
    }
  });

  // Get tools by category
  ipcMain.handle('tools:get-by-category', (_event, category: unknown): IPCResult => {
    if (typeof category !== 'string') {
      return { success: false, error: 'Category must be a string' };
    }

    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      const definitions = registry.getToolDefinitionsByCategory([category]);
      return {
        success: true,
        data: definitions,
      };
    } catch (error) {
      logger.error('Failed to get tools by category', { error });
      return { success: false, error: 'Tool registry not available' };
    }
  });

  // Execute a single tool
  ipcMain.handle(
    'tools:execute',
    async (_event, toolName: unknown, args: unknown): Promise<IPCResult> => {
      // Rate limit check
      if (!checkRateLimit('tools:execute')) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please wait before executing more tools.',
        };
      }

      if (typeof toolName !== 'string') {
        return { success: false, error: 'Tool name must be a string' };
      }

      // Validate args object
      const argsValidation = validateConfigObject(args);
      if (!argsValidation.valid) {
        return { success: false, error: argsValidation.error };
      }

      try {
        const { executeTool } = require('../agent/tool-registry');
        const result = await executeTool(toolName, argsValidation.sanitized || {});
        return {
          success: result.success,
          data: result,
          error: result.error,
        };
      } catch (error) {
        logger.error('Failed to execute tool', { toolName, error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Execute multiple tools sequentially
  ipcMain.handle('tools:execute-batch', async (_event, calls: unknown): Promise<IPCResult> => {
    // Rate limit check
    if (!checkRateLimit('tools:execute-batch')) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait before executing more tools.',
      };
    }

    if (!Array.isArray(calls)) {
      return { success: false, error: 'Calls must be an array' };
    }

    // Validate each call
    for (const call of calls) {
      if (typeof call !== 'object' || call === null) {
        return { success: false, error: 'Each call must be an object' };
      }
      if (typeof (call as { name?: unknown }).name !== 'string') {
        return { success: false, error: 'Each call must have a name string' };
      }
    }

    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      const results = await registry.executeToolCalls(
        calls.map((c: { name: string; arguments?: Record<string, unknown> }) => ({
          name: c.name,
          arguments: c.arguments || {},
        }))
      );
      return {
        success: true,
        data: results,
      };
    } catch (error) {
      logger.error('Failed to execute tool batch', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Execute multiple tools in parallel
  ipcMain.handle('tools:execute-parallel', async (_event, calls: unknown): Promise<IPCResult> => {
    // Rate limit check
    if (!checkRateLimit('tools:execute-parallel')) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait before executing more tools.',
      };
    }

    if (!Array.isArray(calls)) {
      return { success: false, error: 'Calls must be an array' };
    }

    // Validate each call
    for (const call of calls) {
      if (typeof call !== 'object' || call === null) {
        return { success: false, error: 'Each call must be an object' };
      }
      if (typeof (call as { name?: unknown }).name !== 'string') {
        return { success: false, error: 'Each call must have a name string' };
      }
    }

    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      const results = await registry.executeToolCallsParallel(
        calls.map((c: { name: string; arguments?: Record<string, unknown> }) => ({
          name: c.name,
          arguments: c.arguments || {},
        }))
      );
      return {
        success: true,
        data: results,
      };
    } catch (error) {
      logger.error('Failed to execute tools in parallel', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Check if a tool exists
  ipcMain.handle('tools:has', (_event, toolName: unknown): IPCResult => {
    if (typeof toolName !== 'string') {
      return { success: false, error: 'Tool name must be a string' };
    }

    try {
      const { hasToolByName } = require('../agent/tool-registry');
      return {
        success: true,
        data: hasToolByName(toolName),
      };
    } catch (error) {
      logger.error('Failed to check tool existence', { error });
      return { success: false, error: 'Tool registry not available' };
    }
  });

  // Get tool count
  ipcMain.handle('tools:count', (): IPCResult => {
    try {
      const { getToolRegistry } = require('../agent/tool-registry');
      const registry = getToolRegistry();
      return {
        success: true,
        data: registry.getToolCount(),
      };
    } catch (error) {
      logger.error('Failed to get tool count', { error });
      return { success: false, error: 'Tool registry not available' };
    }
  });

  // ============================================================
  // GEPA Self-Improvement Handlers (T4 Phase 8)
  // ============================================================

  // Get GEPA status
  ipcMain.handle('gepa:get-status', async (): Promise<IPCResult> => {
    try {
      const status = await getGEPAStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error('Failed to get GEPA status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get optimization history
  ipcMain.handle('gepa:get-optimization-history', async (): Promise<IPCResult> => {
    try {
      const history = await getOptimizationHistory();
      return { success: true, data: history };
    } catch (error) {
      logger.error('Failed to get optimization history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Trigger manual optimization run
  ipcMain.handle('gepa:run-optimization', async (): Promise<IPCResult> => {
    try {
      const result = await runOptimization();
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to run optimization', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get metrics summary
  ipcMain.handle('gepa:get-metrics', async (): Promise<IPCResult> => {
    try {
      const metrics = await getMetricsSummary();
      return { success: true, data: metrics };
    } catch (error) {
      logger.error('Failed to get GEPA metrics', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get A/B test results
  ipcMain.handle('gepa:get-ab-tests', async (): Promise<IPCResult> => {
    try {
      const tests = await getABTests();
      return { success: true, data: tests };
    } catch (error) {
      logger.error('Failed to get A/B tests', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Create an A/B test
  ipcMain.handle(
    'gepa:create-ab-test',
    async (
      _event,
      config: {
        name: string;
        targetMetric: string;
        variants: Array<{ name: string; config: Record<string, unknown> }>;
      }
    ): Promise<IPCResult> => {
      try {
        const test = await createABTest(config);
        return { success: true, data: test };
      } catch (error) {
        logger.error('Failed to create A/B test', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get rollback points
  ipcMain.handle('gepa:get-rollback-points', async (): Promise<IPCResult> => {
    try {
      const points = await getRollbackPoints();
      return { success: true, data: points };
    } catch (error) {
      logger.error('Failed to get rollback points', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Rollback to a specific point
  ipcMain.handle('gepa:rollback', async (_event, snapshotId: string): Promise<IPCResult> => {
    if (typeof snapshotId !== 'string') {
      return { success: false, error: 'Snapshot ID must be a string' };
    }
    try {
      await rollbackToSnapshot(snapshotId);
      return { success: true, data: { rolledBack: true } };
    } catch (error) {
      logger.error('Failed to rollback', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get change reports
  ipcMain.handle('gepa:get-change-reports', async (): Promise<IPCResult> => {
    try {
      const reports = await getChangeReports();
      return { success: true, data: reports };
    } catch (error) {
      logger.error('Failed to get change reports', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get daily digest
  ipcMain.handle('gepa:get-daily-digest', async (): Promise<IPCResult> => {
    try {
      const digest = await getDailyDigest();
      return { success: true, data: digest };
    } catch (error) {
      logger.error('Failed to get daily digest', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get pending code modifications
  ipcMain.handle('gepa:get-pending-modifications', async (): Promise<IPCResult> => {
    try {
      const modifications = await getPendingModifications();
      return { success: true, data: modifications };
    } catch (error) {
      logger.error('Failed to get pending modifications', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Approve a code modification
  ipcMain.handle(
    'gepa:approve-modification',
    async (_event, modificationId: string): Promise<IPCResult> => {
      if (typeof modificationId !== 'string') {
        return { success: false, error: 'Modification ID must be a string' };
      }
      try {
        await approveModification(modificationId);
        return { success: true, data: { approved: true } };
      } catch (error) {
        logger.error('Failed to approve modification', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Reject a code modification
  ipcMain.handle(
    'gepa:reject-modification',
    async (_event, modificationId: string, reason?: string): Promise<IPCResult> => {
      if (typeof modificationId !== 'string') {
        return { success: false, error: 'Modification ID must be a string' };
      }
      try {
        await rejectModification(modificationId, reason);
        return { success: true, data: { rejected: true } };
      } catch (error) {
        logger.error('Failed to reject modification', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Set optimization schedule
  ipcMain.handle(
    'gepa:set-schedule',
    async (
      _event,
      config: { enabled: boolean; hour?: number; minute?: number }
    ): Promise<IPCResult> => {
      try {
        await setOptimizationSchedule(config);
        return { success: true, data: { updated: true } };
      } catch (error) {
        logger.error('Failed to set optimization schedule', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // ============================================================
  // Task Framework Handlers (T2 Phase 0)
  // ============================================================

  // Create and enqueue a new task
  ipcMain.handle(
    'task:create',
    async (
      _event,
      options: {
        name: string;
        description?: string;
        priority?: string;
        steps: unknown[];
        context?: Record<string, unknown>;
        tags?: string[];
      }
    ): Promise<IPCResult> => {
      try {
        const queueManager = getTaskQueueManager();
        const task = queueManager.createTask(options);
        const queuedTask = queueManager.enqueue(task);
        return { success: true, data: queuedTask };
      } catch (error) {
        logger.error('Failed to create task', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get task by ID
  ipcMain.handle('task:get', async (_event, taskId: string): Promise<IPCResult> => {
    try {
      const task = getTaskQueueManager().getTask(taskId);
      if (!task) {
        return { success: false, error: 'Task not found' };
      }
      return { success: true, data: task };
    } catch (error) {
      logger.error('Failed to get task', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all queued tasks
  ipcMain.handle('task:get-queued', async (): Promise<IPCResult> => {
    try {
      const tasks = getTaskQueueManager().getQueuedTasks();
      return { success: true, data: tasks };
    } catch (error) {
      logger.error('Failed to get queued tasks', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all running tasks
  ipcMain.handle('task:get-running', async (): Promise<IPCResult> => {
    try {
      const tasks = getTaskQueueManager().getRunningTasks();
      return { success: true, data: tasks };
    } catch (error) {
      logger.error('Failed to get running tasks', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get recent completed tasks
  ipcMain.handle('task:get-recent', async (_event, limit?: number): Promise<IPCResult> => {
    try {
      const tasks = getTaskQueueManager().getRecentTasks(limit || 10);
      return { success: true, data: tasks };
    } catch (error) {
      logger.error('Failed to get recent tasks', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get task queue statistics
  ipcMain.handle('task:get-stats', async (): Promise<IPCResult> => {
    try {
      const stats = getTaskQueueManager().getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('Failed to get task stats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel a task
  ipcMain.handle(
    'task:cancel',
    async (_event, taskId: string, reason?: string): Promise<IPCResult> => {
      try {
        const cancelled = getTaskQueueManager().cancelTask(taskId, reason);
        return { success: true, data: { cancelled } };
      } catch (error) {
        logger.error('Failed to cancel task', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Pause a task
  ipcMain.handle('task:pause', async (_event, taskId: string): Promise<IPCResult> => {
    try {
      const paused = getTaskQueueManager().pauseTask(taskId);
      return { success: true, data: { paused } };
    } catch (error) {
      logger.error('Failed to pause task', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Resume a task
  ipcMain.handle('task:resume', async (_event, taskId: string): Promise<IPCResult> => {
    try {
      const resumed = getTaskQueueManager().resumeTask(taskId);
      return { success: true, data: { resumed } };
    } catch (error) {
      logger.error('Failed to resume task', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Clear completed tasks
  ipcMain.handle('task:clear-completed', async (): Promise<IPCResult> => {
    try {
      const count = getTaskQueueManager().clearCompleted();
      return { success: true, data: { cleared: count } };
    } catch (error) {
      logger.error('Failed to clear completed tasks', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Set up task event forwarding to renderer
  setupTaskEventForwarding();

  // =========================================================================
  // JARVIS Brain Handlers
  // =========================================================================

  // Get brain stats
  ipcMain.handle('brain:get-stats', async (): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const stats = await brain.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('Failed to get brain stats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get visualization data for brain graph
  ipcMain.handle('brain:get-visualization', async (_event, options?: {
    limit?: number;
    minConfidence?: number;
    centerNode?: string;
  }): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        // Silent failure - brain not initialized yet is expected
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const data = await brain.getVisualizationData(options);
      return { success: true, data };
    } catch (error) {
      // Don't log this error - it's expected when cognitive module isn't available
      // logger.error('Failed to get brain visualization', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Recall information from brain
  ipcMain.handle('brain:recall', async (_event, query: string): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const result = await brain.recall(query);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to recall from brain', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Learn a new fact
  ipcMain.handle('brain:learn', async (_event, fact: {
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    source?: string;
  }): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const nodeId = await brain.learn({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence ?? 0.7,
        source: fact.source ?? 'user_input',
      });
      return { success: true, data: { nodeId } };
    } catch (error) {
      logger.error('Failed to learn fact', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get entity knowledge
  ipcMain.handle('brain:get-entity', async (_event, entity: string): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const knowledge = await brain.getEntityKnowledge(entity);
      return { success: true, data: knowledge };
    } catch (error) {
      logger.error('Failed to get entity knowledge', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get user knowledge (what JARVIS knows about the user)
  ipcMain.handle('brain:get-user-knowledge', async (): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const knowledge = await brain.getUserKnowledge();
      return { success: true, data: knowledge };
    } catch (error) {
      logger.error('Failed to get user knowledge', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Ask brain a question
  ipcMain.handle('brain:ask', async (_event, question: string): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const answer = await brain.ask(question);
      return { success: true, data: answer };
    } catch (error) {
      logger.error('Failed to ask brain', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get associations for a concept
  ipcMain.handle('brain:associate', async (_event, concept: string): Promise<IPCResult> => {
    try {
      const { getJarvisBrain } = require('../cognitive');
      const brain = getJarvisBrain();
      if (!brain) {
        return { success: false, error: 'JARVIS Brain not initialized' };
      }
      const associations = await brain.associate(concept);
      return { success: true, data: associations };
    } catch (error) {
      logger.error('Failed to get associations', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Register additional module handlers
  try {
    const { registerCareerHandlers } = require('./career-handlers');
    registerCareerHandlers();
  } catch (error) {
    logger.warn('Career handlers not available', { error: (error as Error).message });
  }

  try {
    const { registerStudyHandlers } = require('./study-handlers');
    registerStudyHandlers();
  } catch (error) {
    logger.warn('Study handlers not available', { error: (error as Error).message });
  }

  try {
    const { registerTradingBotHandlers } = require('./trading-bot-handlers');
    registerTradingBotHandlers();
  } catch (error) {
    logger.warn('Trading bot handlers not available', { error: (error as Error).message });
  }

  try {
    const { registerProactiveHandlers } = require('./proactive-handlers');
    registerProactiveHandlers();
  } catch (error) {
    logger.warn('Proactive handlers not available', { error: (error as Error).message });
  }

  try {
    const { registerDiscordHandlers } = require('./discord-handlers');
    registerDiscordHandlers();
  } catch (error) {
    logger.warn('Discord handlers not available', { error: (error as Error).message });
  }

  // Register Spotify handlers
  try {
    const { registerSpotifyHandlers } = require('./spotify-handlers');
    registerSpotifyHandlers();
    logger.info('Spotify handlers registered successfully');
  } catch (error) {
    logger.warn('Spotify handlers not available', { error: (error as Error).message });
  }

  // Register Media Control handlers
  try {
    const { registerMediaControlHandlers } = require('./media-handlers');
    registerMediaControlHandlers();
    logger.info('Media control handlers registered successfully');
  } catch (error) {
    logger.warn('Media control handlers not available', { error: (error as Error).message });
  }

  // Register Atlas Core handlers (autonomous agent, screen monitoring, integrations)
  try {
    registerAtlasHandlers();
    logger.info('Atlas handlers registered successfully');
  } catch (error) {
    logger.warn('Atlas handlers not available', { error: (error as Error).message });
  }

  // Register Knowledge Management handlers
  try {
    const { registerKnowledgeHandlers } = require('./knowledge-handlers');
    registerKnowledgeHandlers();
  } catch (error) {
    logger.warn('Knowledge handlers not available', { error: (error as Error).message });
  }

  // Register Workflow handlers
  try {
    const { registerWorkflowHandlers } = require('./workflow-handlers');
    registerWorkflowHandlers();
  } catch (error) {
    logger.warn('Workflow handlers not available', { error: (error as Error).message });
  }

  // Register Automation handlers
  try {
    const { registerAutomationHandlers } = require('./automation-handlers');
    registerAutomationHandlers();
  } catch (error) {
    logger.warn('Automation handlers not available', { error: (error as Error).message });
  }

  // Register Personality handlers
  try {
    const { registerPersonalityHandlers } = require('./personality-handlers');
    registerPersonalityHandlers();
  } catch (error) {
    logger.warn('Personality handlers not available', { error: (error as Error).message });
  }

  // Register Vision handlers
  try {
    const { registerVisionHandlers } = require('./vision-handlers');
    registerVisionHandlers();
  } catch (error) {
    logger.warn('Vision handlers not available', { error: (error as Error).message });
  }

  // Register Wellness handlers
  try {
    const { registerWellnessHandlers } = require('./wellness-handlers');
    registerWellnessHandlers();
  } catch (error) {
    logger.warn('Wellness handlers not available', { error: (error as Error).message });
  }

  // Register Life Coach handlers
  try {
    const { registerLifeCoachHandlers } = require('./life-coach-handlers');
    registerLifeCoachHandlers();
  } catch (error) {
    logger.warn('Life Coach handlers not available', { error: (error as Error).message });
  }

  // Register Computer Use handlers
  try {
    const { registerComputerUseHandlers } = require('./computer-use-handlers');
    registerComputerUseHandlers();
  } catch (error) {
    logger.warn('Computer Use handlers not available', { error: (error as Error).message });
  }

  // Register Coding Agent handlers
  try {
    const { registerCodingHandlers } = require('../agent/coding/ipc-handlers');
    registerCodingHandlers();
  } catch (error) {
    logger.warn('Coding Agent handlers not available', { error: (error as Error).message });
  }

  logger.info('IPC handlers registered');
}

/**
 * Unregister all IPC handlers
 */
export function unregisterIPCHandlers(): void {
  const channels = [
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
    // Response Cache channels
    'atlas:get-cache-stats',
    'atlas:clear-cache',
    'atlas:set-cache-enabled',
    'atlas:is-cache-enabled',
    // Keyboard Shortcuts channels
    'shortcuts:get-status',
    'shortcuts:get-config',
    'shortcuts:get-bindings',
    'shortcuts:update-config',
    'shortcuts:set-binding',
    'shortcuts:reset-binding',
    'shortcuts:set-enabled',
    'shortcuts:set-global-enabled',
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
    // Performance Profiler channels
    'atlas:get-performance-data',
    'atlas:get-performance-metrics',
    'atlas:get-metric-history',
    'atlas:get-performance-snapshots',
    'atlas:take-performance-snapshot',
    'atlas:export-performance-report',
    'atlas:generate-performance-report',
    'atlas:start-profiler',
    'atlas:stop-profiler',
    'atlas:reset-profiler',
    'atlas:update-profiler-config',
    'atlas:get-profiler-status',
    'atlas:update-render-metrics',
    'atlas:record-voice-timing',
    // 046-A: Keychain channels
    'keychain:get-key',
    'keychain:set-key',
    'keychain:delete-key',
    'keychain:has-key',
    'keychain:list-keys',
    'keychain:get-masked-key',
    'keychain:clear-all',
    'keychain:check-health',
    'keychain:get-supported-keys',
    // Memory Graph channels
    'atlas:get-memory-graph',
    'atlas:get-graph-node',
    'atlas:get-graph-neighbors',
    // Tools channels (T3-022)
    'tools:list',
    'tools:get-summary',
    'tools:get-by-category',
    'tools:execute',
    'tools:execute-batch',
    'tools:execute-parallel',
    'tools:has',
    'tools:count',
    // GEPA Self-Improvement channels (T4-Phase 8)
    'gepa:get-status',
    'gepa:get-optimization-history',
    'gepa:run-optimization',
    'gepa:get-metrics',
    'gepa:get-ab-tests',
    'gepa:create-ab-test',
    'gepa:get-rollback-points',
    'gepa:rollback',
    'gepa:get-change-reports',
    'gepa:get-daily-digest',
    'gepa:get-pending-modifications',
    'gepa:approve-modification',
    'gepa:reject-modification',
    'gepa:set-schedule',
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
    // JARVIS Brain channels
    'brain:get-stats',
    'brain:get-visualization',
    'brain:recall',
    'brain:learn',
    'brain:get-entity',
    'brain:get-user-knowledge',
    'brain:ask',
    'brain:associate',
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
