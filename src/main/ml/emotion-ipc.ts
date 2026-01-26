/**
 * Emotion Detection IPC Handlers
 * T5-207, T5-208: Emotion detection and response adjustment
 *
 * Provides IPC handlers for:
 * - Emotion detection from audio
 * - Emotion history retrieval
 * - Response adjustment recommendations
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getErrorMessage } from '../../shared/utils';
import { createModuleLogger } from '../utils/logger';
import {
  getEmotionDetector,
  getEmotionResponseAdjustment,
  type EmotionResult,
  type EmotionCategory,
  type EmotionResponseAdjustment,
} from './emotion';

const logger = createModuleLogger('Emotion-IPC');

// Main window reference for event forwarding
let mainWindow: BrowserWindow | null = null;

// Temp directory for audio samples
const getTempDir = (): string => {
  const tempDir = path.join(app?.getPath?.('userData') || process.cwd(), 'temp', 'emotion-samples');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
};

/**
 * Set main window for event forwarding
 */
export function setMainWindowForEmotion(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Send event to renderer
 */
function sendToRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * IPC Result type
 */
interface IPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Save audio buffer to temp file for processing
 */
async function saveAudioToTemp(audioBuffer: ArrayBuffer, prefix: string): Promise<string> {
  const tempDir = getTempDir();
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.wav`;
  const filepath = path.join(tempDir, filename);

  await fs.promises.writeFile(filepath, Buffer.from(audioBuffer));
  return filepath;
}

/**
 * Clean up temp audio file
 */
async function cleanupTempFile(filepath: string): Promise<void> {
  try {
    if (fs.existsSync(filepath)) {
      await fs.promises.unlink(filepath);
    }
  } catch (error) {
    logger.warn('Failed to cleanup temp file', { filepath, error });
  }
}

/**
 * Register emotion detection IPC handlers
 */
export function registerEmotionHandlers(): void {
  const detector = getEmotionDetector();

  // Forward detector events to renderer
  detector.on('emotion:detected', (result: EmotionResult) => {
    sendToRenderer('emotion:detected', result);
  });

  detector.on(
    'emotion:changed',
    (from: EmotionCategory, to: EmotionCategory, speakerId?: string) => {
      sendToRenderer('emotion:changed', { from, to, speakerId });
    }
  );

  detector.on('error', (error: Error) => {
    sendToRenderer('emotion:error', { message: error.message });
  });

  // ============================================================================
  // Emotion Detection
  // ============================================================================

  /**
   * Detect emotion from audio buffer
   */
  ipcMain.handle(
    'emotion:detect',
    async (_, audioBuffer: ArrayBuffer, speakerId?: string): Promise<IPCResult<EmotionResult>> => {
      try {
        const tempPath = await saveAudioToTemp(audioBuffer, 'detect');

        try {
          const result = await detector.detect(tempPath, speakerId);
          logger.info('Emotion detected via IPC', {
            emotion: result.emotion,
            confidence: result.confidence,
            speakerId,
          });

          return { success: true, data: result };
        } finally {
          await cleanupTempFile(tempPath);
        }
      } catch (error) {
        logger.error('Emotion detection failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Detection failed'),
        };
      }
    }
  );

  /**
   * Detect emotion from audio file path
   */
  ipcMain.handle(
    'emotion:detect-file',
    async (_, audioPath: string, speakerId?: string): Promise<IPCResult<EmotionResult>> => {
      try {
        if (!fs.existsSync(audioPath)) {
          return { success: false, error: 'Audio file not found' };
        }

        const result = await detector.detect(audioPath, speakerId);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Emotion detection from file failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Detection failed'),
        };
      }
    }
  );

  // ============================================================================
  // History & Analysis
  // ============================================================================

  /**
   * Get emotion history for a speaker
   */
  ipcMain.handle(
    'emotion:get-history',
    async (_, speakerId: string, count?: number): Promise<IPCResult<EmotionResult[]>> => {
      try {
        const history = detector.getEmotionHistory(speakerId, count);
        return { success: true, data: history };
      } catch (error) {
        logger.error('Failed to get emotion history', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get history'),
        };
      }
    }
  );

  /**
   * Get dominant emotion for a speaker
   */
  ipcMain.handle(
    'emotion:get-dominant',
    async (_, speakerId: string): Promise<IPCResult<EmotionCategory | null>> => {
      try {
        const dominant = detector.getDominantEmotion(speakerId);
        return { success: true, data: dominant };
      } catch (error) {
        logger.error('Failed to get dominant emotion', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get dominant emotion'),
        };
      }
    }
  );

  /**
   * Get average arousal/valence for a speaker
   */
  ipcMain.handle(
    'emotion:get-affect',
    async (
      _,
      speakerId: string
    ): Promise<IPCResult<{ arousal: number; valence: number } | null>> => {
      try {
        const affect = detector.getAverageAffect(speakerId);
        return { success: true, data: affect };
      } catch (error) {
        logger.error('Failed to get average affect', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get affect'),
        };
      }
    }
  );

  /**
   * Get last detected emotion for a speaker
   */
  ipcMain.handle(
    'emotion:get-last',
    async (_, speakerId: string): Promise<IPCResult<EmotionCategory | undefined>> => {
      try {
        const lastEmotion = detector.getLastEmotion(speakerId);
        return { success: true, data: lastEmotion };
      } catch (error) {
        logger.error('Failed to get last emotion', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get last emotion'),
        };
      }
    }
  );

  /**
   * Get emotion trend for a speaker
   */
  ipcMain.handle(
    'emotion:get-trend',
    async (
      _,
      speakerId: string,
      windowSize?: number
    ): Promise<IPCResult<'improving' | 'worsening' | 'stable'>> => {
      try {
        const trend = detector.getEmotionTrend(speakerId, windowSize);
        return { success: true, data: trend };
      } catch (error) {
        logger.error('Failed to get emotion trend', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get trend'),
        };
      }
    }
  );

  // ============================================================================
  // Response Adjustment
  // ============================================================================

  /**
   * Get response adjustment for a speaker's current emotion
   */
  ipcMain.handle(
    'emotion:get-response-adjustment',
    async (_, speakerId?: string): Promise<IPCResult<EmotionResponseAdjustment>> => {
      try {
        const adjustment = detector.getResponseAdjustment(speakerId);
        return { success: true, data: adjustment };
      } catch (error) {
        logger.error('Failed to get response adjustment', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get adjustment'),
        };
      }
    }
  );

  /**
   * Get response adjustment for a specific emotion
   */
  ipcMain.handle(
    'emotion:get-adjustment-for-emotion',
    async (_, emotion: EmotionCategory): Promise<IPCResult<EmotionResponseAdjustment>> => {
      try {
        const adjustment = getEmotionResponseAdjustment(emotion);
        return { success: true, data: adjustment };
      } catch (error) {
        logger.error('Failed to get adjustment for emotion', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get adjustment'),
        };
      }
    }
  );

  // ============================================================================
  // Management
  // ============================================================================

  /**
   * Clear emotion history for a speaker
   */
  ipcMain.handle(
    'emotion:clear-history',
    async (_, speakerId: string): Promise<IPCResult<void>> => {
      try {
        detector.clearHistory(speakerId);
        logger.info('Emotion history cleared', { speakerId });
        return { success: true };
      } catch (error) {
        logger.error('Failed to clear emotion history', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to clear history'),
        };
      }
    }
  );

  /**
   * Clear all emotion history
   */
  ipcMain.handle('emotion:clear-all-history', async (): Promise<IPCResult<void>> => {
    try {
      detector.clearAllHistory();
      logger.info('All emotion history cleared');
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear all emotion history', { error });
      return {
        success: false,
        error: getErrorMessage(error, 'Failed to clear all history'),
      };
    }
  });

  /**
   * Initialize emotion detector
   */
  ipcMain.handle('emotion:initialize', async (): Promise<IPCResult<void>> => {
    try {
      await detector.initialize();
      return { success: true };
    } catch (error) {
      logger.error('Emotion detector initialization failed', { error });
      return {
        success: false,
        error: getErrorMessage(error, 'Initialization failed'),
      };
    }
  });

  /**
   * Check if emotion detector is configured
   */
  ipcMain.handle('emotion:is-configured', async (): Promise<IPCResult<boolean>> => {
    try {
      const configured = detector.isConfigured();
      return { success: true, data: configured };
    } catch (error) {
      return { success: false, error: 'Failed to check configuration' };
    }
  });

  /**
   * Set Python path for emotion detector
   */
  ipcMain.handle(
    'emotion:set-python-path',
    async (_, pythonPath: string): Promise<IPCResult<void>> => {
      try {
        detector.setPythonPath(pythonPath);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to set Python path'),
        };
      }
    }
  );

  logger.info('Emotion IPC handlers registered');
}

/**
 * Cleanup function
 */
export function cleanupEmotionHandlers(): void {
  // Remove all emotion: handlers
  const handlers = [
    'emotion:detect',
    'emotion:detect-file',
    'emotion:get-history',
    'emotion:get-dominant',
    'emotion:get-affect',
    'emotion:get-last',
    'emotion:get-trend',
    'emotion:get-response-adjustment',
    'emotion:get-adjustment-for-emotion',
    'emotion:clear-history',
    'emotion:clear-all-history',
    'emotion:initialize',
    'emotion:is-configured',
    'emotion:set-python-path',
  ];

  for (const handler of handlers) {
    ipcMain.removeHandler(handler);
  }

  logger.info('Emotion IPC handlers cleaned up');
}
