/**
 * IPC Handlers - Media Control
 *
 * Provides IPC interface for media playback control
 */

import { ipcMain } from 'electron';
import { executeMediaControl, mediaControls } from '../agent/tools/media-control';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('MediaControlIPC');

export function registerMediaControlHandlers(): void {
  logger.info('Registering media control handlers');

  // Generic media control
  ipcMain.handle('media:control', async (_, action: string, amount?: number) => {
    try {
      const result = await executeMediaControl({ action: action as any, amount });
      return { success: result.success, data: result.data, error: result.error };
    } catch (error) {
      logger.error('Media control failed', { action, error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Convenience shortcuts
  ipcMain.handle('media:play', async () => {
    const result = await mediaControls.play();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:pause', async () => {
    const result = await mediaControls.pause();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:playPause', async () => {
    const result = await mediaControls.playPause();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:next', async () => {
    const result = await mediaControls.next();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:previous', async () => {
    const result = await mediaControls.previous();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:volumeUp', async (_, amount?: number) => {
    const result = await mediaControls.volumeUp(amount);
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:volumeDown', async (_, amount?: number) => {
    const result = await mediaControls.volumeDown(amount);
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:mute', async () => {
    const result = await mediaControls.mute();
    return { success: result.success, data: result.data };
  });

  ipcMain.handle('media:stop', async () => {
    const result = await mediaControls.stop();
    return { success: result.success, data: result.data };
  });

  logger.info('Media control handlers registered');
}
