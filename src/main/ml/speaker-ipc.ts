/**
 * Speaker ID IPC Handlers
 * T5-205: Voice enrollment flow via IPC
 *
 * Provides IPC handlers for:
 * - Speaker identification
 * - Speaker enrollment
 * - Speaker management (list, delete, update)
 * - Diarization
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getErrorMessage } from '../../shared/utils';
import { createModuleLogger } from '../utils/logger';
import {
  getPyannoteBridge,
  type SpeakerResult,
  type DiarizationSegment,
  type EnrolledSpeaker,
} from '../ml/speaker-id';

const logger = createModuleLogger('Speaker-IPC');

// Main window reference for event forwarding
let mainWindow: BrowserWindow | null = null;

// Temp directory for audio samples
const getTempDir = (): string => {
  const tempDir = path.join(app?.getPath?.('userData') || process.cwd(), 'temp', 'speaker-samples');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
};

/**
 * Set main window for event forwarding
 */
export function setMainWindowForSpeaker(window: BrowserWindow | null): void {
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
 * Register speaker IPC handlers
 */
export function registerSpeakerHandlers(): void {
  const bridge = getPyannoteBridge();

  // Forward bridge events to renderer
  bridge.on('speaker:identified', (result: SpeakerResult) => {
    sendToRenderer('speaker:identified', result);
  });

  bridge.on('speaker:enrolled', (speaker: EnrolledSpeaker) => {
    sendToRenderer('speaker:enrolled', speaker);
  });

  bridge.on('diarization:complete', (segments: DiarizationSegment[]) => {
    sendToRenderer('speaker:diarization-complete', segments);
  });

  bridge.on('error', (error: Error) => {
    sendToRenderer('speaker:error', { message: error.message });
  });

  // ============================================================================
  // Speaker Identification
  // ============================================================================

  /**
   * Identify speaker from audio buffer
   */
  ipcMain.handle(
    'speaker:identify',
    async (_, audioBuffer: ArrayBuffer, threshold?: number): Promise<IPCResult<SpeakerResult>> => {
      try {
        const tempPath = await saveAudioToTemp(audioBuffer, 'identify');

        try {
          const result = await bridge.identifySpeaker(tempPath, threshold);
          logger.info('Speaker identified', {
            isKnown: result.isKnown,
            confidence: result.confidence,
            name: result.name,
          });

          return { success: true, data: result };
        } finally {
          await cleanupTempFile(tempPath);
        }
      } catch (error) {
        logger.error('Speaker identification failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Identification failed'),
        };
      }
    }
  );

  /**
   * Identify speaker from audio file path
   */
  ipcMain.handle(
    'speaker:identify-file',
    async (_, audioPath: string, threshold?: number): Promise<IPCResult<SpeakerResult>> => {
      try {
        if (!fs.existsSync(audioPath)) {
          return { success: false, error: 'Audio file not found' };
        }

        const result = await bridge.identifySpeaker(audioPath, threshold);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Speaker identification from file failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Identification failed'),
        };
      }
    }
  );

  // ============================================================================
  // Speaker Enrollment
  // ============================================================================

  /**
   * Enroll a new speaker with audio samples
   */
  ipcMain.handle(
    'speaker:enroll',
    async (_, name: string, audioSamples: ArrayBuffer[]): Promise<IPCResult<EnrolledSpeaker>> => {
      try {
        if (!name || name.trim().length === 0) {
          return { success: false, error: 'Speaker name is required' };
        }

        if (!audioSamples || audioSamples.length === 0) {
          return { success: false, error: 'At least one audio sample is required' };
        }

        // Save audio samples to temp files
        const tempPaths: string[] = [];
        for (let i = 0; i < audioSamples.length; i++) {
          const tempPath = await saveAudioToTemp(audioSamples[i], `enroll_${i}`);
          tempPaths.push(tempPath);
        }

        try {
          const speaker = await bridge.enrollSpeaker(name.trim(), tempPaths);
          logger.info('Speaker enrolled', { id: speaker.id, name: speaker.name });

          return { success: true, data: speaker };
        } finally {
          // Clean up temp files
          for (const tempPath of tempPaths) {
            await cleanupTempFile(tempPath);
          }
        }
      } catch (error) {
        logger.error('Speaker enrollment failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Enrollment failed'),
        };
      }
    }
  );

  /**
   * Enroll speaker from audio file paths
   */
  ipcMain.handle(
    'speaker:enroll-files',
    async (_, name: string, audioPaths: string[]): Promise<IPCResult<EnrolledSpeaker>> => {
      try {
        if (!name || name.trim().length === 0) {
          return { success: false, error: 'Speaker name is required' };
        }

        if (!audioPaths || audioPaths.length === 0) {
          return { success: false, error: 'At least one audio file is required' };
        }

        // Verify all files exist
        for (const audioPath of audioPaths) {
          if (!fs.existsSync(audioPath)) {
            return { success: false, error: `Audio file not found: ${audioPath}` };
          }
        }

        const speaker = await bridge.enrollSpeaker(name.trim(), audioPaths);
        return { success: true, data: speaker };
      } catch (error) {
        logger.error('Speaker enrollment from files failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Enrollment failed'),
        };
      }
    }
  );

  /**
   * Update speaker with additional samples
   */
  ipcMain.handle(
    'speaker:update',
    async (
      _,
      speakerId: string,
      audioSamples: ArrayBuffer[]
    ): Promise<IPCResult<EnrolledSpeaker>> => {
      try {
        if (!speakerId) {
          return { success: false, error: 'Speaker ID is required' };
        }

        if (!audioSamples || audioSamples.length === 0) {
          return { success: false, error: 'At least one audio sample is required' };
        }

        // Save audio samples to temp files
        const tempPaths: string[] = [];
        for (let i = 0; i < audioSamples.length; i++) {
          const tempPath = await saveAudioToTemp(audioSamples[i], `update_${i}`);
          tempPaths.push(tempPath);
        }

        try {
          const speaker = await bridge.updateSpeaker(speakerId, tempPaths);
          logger.info('Speaker updated', { id: speaker.id, newSamples: tempPaths.length });

          return { success: true, data: speaker };
        } finally {
          // Clean up temp files
          for (const tempPath of tempPaths) {
            await cleanupTempFile(tempPath);
          }
        }
      } catch (error) {
        logger.error('Speaker update failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Update failed'),
        };
      }
    }
  );

  // ============================================================================
  // Speaker Management
  // ============================================================================

  /**
   * Get all enrolled speakers
   */
  ipcMain.handle('speaker:list', async (): Promise<IPCResult<EnrolledSpeaker[]>> => {
    try {
      const speakers = bridge.getSpeakers();
      return { success: true, data: speakers };
    } catch (error) {
      logger.error('Failed to list speakers', { error });
      return {
        success: false,
        error: getErrorMessage(error, 'Failed to list speakers'),
      };
    }
  });

  /**
   * Get speaker by ID
   */
  ipcMain.handle(
    'speaker:get',
    async (_, speakerId: string): Promise<IPCResult<EnrolledSpeaker | null>> => {
      try {
        const speaker = bridge.getSpeaker(speakerId);
        return { success: true, data: speaker || null };
      } catch (error) {
        logger.error('Failed to get speaker', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get speaker'),
        };
      }
    }
  );

  /**
   * Get speaker by name
   */
  ipcMain.handle(
    'speaker:get-by-name',
    async (_, name: string): Promise<IPCResult<EnrolledSpeaker | null>> => {
      try {
        const speaker = bridge.getSpeakerByName(name);
        return { success: true, data: speaker || null };
      } catch (error) {
        logger.error('Failed to get speaker by name', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to get speaker'),
        };
      }
    }
  );

  /**
   * Delete a speaker
   */
  ipcMain.handle('speaker:delete', async (_, speakerId: string): Promise<IPCResult<boolean>> => {
    try {
      const deleted = bridge.deleteSpeaker(speakerId);
      if (deleted) {
        logger.info('Speaker deleted', { id: speakerId });
      }
      return { success: true, data: deleted };
    } catch (error) {
      logger.error('Failed to delete speaker', { error });
      return {
        success: false,
        error: getErrorMessage(error, 'Failed to delete speaker'),
      };
    }
  });

  // ============================================================================
  // Diarization
  // ============================================================================

  /**
   * Perform speaker diarization on audio
   */
  ipcMain.handle(
    'speaker:diarize',
    async (
      _,
      audioBuffer: ArrayBuffer,
      numSpeakers?: number
    ): Promise<IPCResult<DiarizationSegment[]>> => {
      try {
        const tempPath = await saveAudioToTemp(audioBuffer, 'diarize');

        try {
          const segments = await bridge.diarize(tempPath, numSpeakers);
          logger.info('Diarization complete', { segments: segments.length });

          return { success: true, data: segments };
        } finally {
          await cleanupTempFile(tempPath);
        }
      } catch (error) {
        logger.error('Diarization failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Diarization failed'),
        };
      }
    }
  );

  /**
   * Perform speaker diarization on audio file
   */
  ipcMain.handle(
    'speaker:diarize-file',
    async (
      _,
      audioPath: string,
      numSpeakers?: number
    ): Promise<IPCResult<DiarizationSegment[]>> => {
      try {
        if (!fs.existsSync(audioPath)) {
          return { success: false, error: 'Audio file not found' };
        }

        const segments = await bridge.diarize(audioPath, numSpeakers);
        return { success: true, data: segments };
      } catch (error) {
        logger.error('Diarization from file failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Diarization failed'),
        };
      }
    }
  );

  // ============================================================================
  // Embedding Operations
  // ============================================================================

  /**
   * Extract voice embedding from audio
   */
  ipcMain.handle(
    'speaker:extract-embedding',
    async (_, audioBuffer: ArrayBuffer): Promise<IPCResult<number[]>> => {
      try {
        const tempPath = await saveAudioToTemp(audioBuffer, 'embedding');

        try {
          const embedding = await bridge.extractEmbedding(tempPath);
          return { success: true, data: embedding };
        } finally {
          await cleanupTempFile(tempPath);
        }
      } catch (error) {
        logger.error('Embedding extraction failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Embedding extraction failed'),
        };
      }
    }
  );

  /**
   * Compare two embeddings
   */
  ipcMain.handle(
    'speaker:compare-embeddings',
    async (_, emb1: number[], emb2: number[]): Promise<IPCResult<number>> => {
      try {
        const similarity = await bridge.compareEmbeddings(emb1, emb2);
        return { success: true, data: similarity };
      } catch (error) {
        logger.error('Embedding comparison failed', { error });
        return {
          success: false,
          error: getErrorMessage(error, 'Comparison failed'),
        };
      }
    }
  );

  // ============================================================================
  // Status & Configuration
  // ============================================================================

  /**
   * Check if Pyannote is configured (has HuggingFace token)
   */
  ipcMain.handle('speaker:is-configured', async (): Promise<IPCResult<boolean>> => {
    try {
      const configured = bridge.isConfigured();
      return { success: true, data: configured };
    } catch (error) {
      return { success: false, error: 'Failed to check configuration' };
    }
  });

  /**
   * Initialize Pyannote bridge
   */
  ipcMain.handle('speaker:initialize', async (): Promise<IPCResult<void>> => {
    try {
      await bridge.initialize();
      return { success: true };
    } catch (error) {
      logger.error('Pyannote initialization failed', { error });
      return {
        success: false,
        error: getErrorMessage(error, 'Initialization failed'),
      };
    }
  });

  /**
   * Set Python path for Pyannote
   */
  ipcMain.handle(
    'speaker:set-python-path',
    async (_, pythonPath: string): Promise<IPCResult<void>> => {
      try {
        bridge.setPythonPath(pythonPath);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error, 'Failed to set Python path'),
        };
      }
    }
  );

  /**
   * Get speaker count
   */
  ipcMain.handle('speaker:count', async (): Promise<IPCResult<number>> => {
    try {
      const count = bridge.getSpeakers().length;
      return { success: true, data: count };
    } catch (error) {
      return { success: false, error: 'Failed to get speaker count' };
    }
  });

  logger.info('Speaker IPC handlers registered');
}

/**
 * Cleanup function
 */
export function cleanupSpeakerHandlers(): void {
  // Remove all speaker: handlers
  const handlers = [
    'speaker:identify',
    'speaker:identify-file',
    'speaker:enroll',
    'speaker:enroll-files',
    'speaker:update',
    'speaker:list',
    'speaker:get',
    'speaker:get-by-name',
    'speaker:delete',
    'speaker:diarize',
    'speaker:diarize-file',
    'speaker:extract-embedding',
    'speaker:compare-embeddings',
    'speaker:is-configured',
    'speaker:initialize',
    'speaker:set-python-path',
    'speaker:count',
  ];

  for (const handler of handlers) {
    ipcMain.removeHandler(handler);
  }

  logger.info('Speaker IPC handlers cleaned up');
}
