/**
 * Atlas Desktop - Shortcut Action Handlers
 * Implements the actual actions triggered by keyboard shortcuts
 */

import { BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getVoicePipeline, VoicePipeline } from '../voice/voice-pipeline';

const logger = createModuleLogger('Shortcuts:Handlers');

// Track voice pipeline instance
let voicePipeline: VoicePipeline | null = null;

// Push-to-talk state
let isPushToTalkActive = false;

/**
 * Get or initialize voice pipeline
 */
function getOrInitPipeline(): VoicePipeline | null {
  try {
    if (!voicePipeline) {
      voicePipeline = getVoicePipeline();
    }
    return voicePipeline;
  } catch (error) {
    logger.error('Failed to get voice pipeline', { error: (error as Error).message });
    return null;
  }
}

/**
 * Handler: Push-to-talk start (key down)
 * Triggers wake and starts listening while key is held
 */
export async function handlePushToTalkStart(): Promise<boolean> {
  if (isPushToTalkActive) {
    return true; // Already active
  }

  logger.debug('Push-to-talk started');
  const pipeline = getOrInitPipeline();

  if (!pipeline) {
    logger.warn('Cannot start push-to-talk: pipeline not available');
    return false;
  }

  try {
    isPushToTalkActive = true;

    // Ensure pipeline is running
    const status = pipeline.getStatus();
    if (status.state === 'idle') {
      await pipeline.start();
    }

    // Trigger wake to start listening
    pipeline.triggerWake();

    logger.info('Push-to-talk activated');
    return true;
  } catch (error) {
    isPushToTalkActive = false;
    logger.error('Push-to-talk start failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Push-to-talk end (key up)
 * Ends the listening session and processes speech
 */
export function handlePushToTalkEnd(): boolean {
  if (!isPushToTalkActive) {
    return true; // Already inactive
  }

  logger.debug('Push-to-talk ended');
  isPushToTalkActive = false;

  // The pipeline will naturally transition when speech stops
  // No explicit action needed - VAD handles speech end detection

  logger.info('Push-to-talk deactivated');
  return true;
}

/**
 * Check if push-to-talk is currently active
 */
export function isPushToTalkEngaged(): boolean {
  return isPushToTalkActive;
}

/**
 * Handler: Toggle Atlas window visibility
 */
export function handleToggleWindow(mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.warn('Cannot toggle window: no main window');
    return false;
  }

  try {
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.focus();
      } else {
        mainWindow.hide();
      }
      logger.debug('Window hidden');
    } else {
      mainWindow.show();
      mainWindow.focus();
      logger.debug('Window shown');
    }
    return true;
  } catch (error) {
    logger.error('Toggle window failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Toggle microphone mute
 */
export async function handleToggleMute(): Promise<boolean> {
  const pipeline = getOrInitPipeline();

  if (!pipeline) {
    logger.warn('Cannot toggle mute: pipeline not available');
    return false;
  }

  try {
    const status = pipeline.getStatus();

    if (status.isListening) {
      // Currently listening - pause/mute
      await pipeline.stop();
      logger.info('Microphone muted');
    } else {
      // Currently muted - unmute and start
      await pipeline.start();
      logger.info('Microphone unmuted');
    }

    return true;
  } catch (error) {
    logger.error('Toggle mute failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Open settings
 */
export function handleOpenSettings(mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.warn('Cannot open settings: no main window');
    return false;
  }

  try {
    // Show window if hidden
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();

    // Send event to renderer to open settings panel
    mainWindow.webContents.send('atlas:open-settings');
    logger.debug('Settings open requested');
    return true;
  } catch (error) {
    logger.error('Open settings failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Cancel current action
 */
export function handleCancelAction(): boolean {
  const pipeline = getOrInitPipeline();

  if (!pipeline) {
    logger.debug('No pipeline to cancel');
    return true;
  }

  try {
    const status = pipeline.getStatus();

    // Only cancel if there's something active
    if (status.state !== 'idle') {
      // Cancel by clearing current operation
      pipeline.triggerWake(); // Reset state
      logger.info('Current action cancelled');
    }

    // Also clear push-to-talk state if active
    if (isPushToTalkActive) {
      isPushToTalkActive = false;
    }

    return true;
  } catch (error) {
    logger.error('Cancel action failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Open command palette
 */
export function handleCommandPalette(mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.warn('Cannot open command palette: no main window');
    return false;
  }

  try {
    // Show window if hidden
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();

    // Send event to renderer to open command palette
    mainWindow.webContents.send('atlas:open-command-palette');
    logger.debug('Command palette open requested');
    return true;
  } catch (error) {
    logger.error('Open command palette failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Focus text input
 */
export function handleFocusInput(mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.warn('Cannot focus input: no main window');
    return false;
  }

  try {
    // Show window if hidden
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();

    // Send event to renderer to focus text input
    mainWindow.webContents.send('atlas:focus-input');
    logger.debug('Focus input requested');
    return true;
  } catch (error) {
    logger.error('Focus input failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Handler: Clear conversation
 */
export async function handleClearConversation(): Promise<boolean> {
  const pipeline = getOrInitPipeline();

  if (!pipeline) {
    logger.warn('Cannot clear conversation: pipeline not available');
    return false;
  }

  try {
    await pipeline.clearHistory();
    logger.info('Conversation cleared');
    return true;
  } catch (error) {
    logger.error('Clear conversation failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * Reset handler state (for cleanup)
 */
export function resetHandlerState(): void {
  isPushToTalkActive = false;
  voicePipeline = null;
  logger.debug('Handler state reset');
}
