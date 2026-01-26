/**
 * IPC Handlers - Proactive Engine
 *
 * Bridges the Proactive Engine with the renderer process
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getProactiveEngine, ProactiveTrigger } from '../proactive/proactive-engine';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ProactiveIPC');

export function registerProactiveHandlers(): void {
  const engine = getProactiveEngine();

  // Forward engine events to renderer
  engine.on('speak', (data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('proactive:speak', data);
    });
  });

  engine.on('notify', (data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('proactive:notify', data);
    });
  });

  engine.on('suggest', (data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('proactive:suggest', data);
    });
  });

  engine.on('alert', (data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('proactive:alert', data);
    });
  });

  // Engine Control
  ipcMain.handle('proactive:start', async () => {
    try {
      engine.start();
      return { success: true };
    } catch (error) {
      logger.error('Failed to start proactive engine', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:stop', async () => {
    try {
      engine.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop proactive engine', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:setEnabled', async (_, enabled: boolean) => {
    try {
      engine.setEnabled(enabled);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set enabled state', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Trigger Management
  ipcMain.handle('proactive:getTriggers', async () => {
    try {
      return { success: true, data: engine.getTriggers() };
    } catch (error) {
      logger.error('Failed to get triggers', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:addTrigger', async (_, trigger: Omit<ProactiveTrigger, 'id'>) => {
    try {
      return { success: true, data: engine.addTrigger(trigger) };
    } catch (error) {
      logger.error('Failed to add trigger', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:removeTrigger', async (_, triggerId: string) => {
    try {
      engine.removeTrigger(triggerId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to remove trigger', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:enableTrigger', async (_, triggerId: string, enabled: boolean) => {
    try {
      engine.enableTrigger(triggerId, enabled);
      return { success: true };
    } catch (error) {
      logger.error('Failed to enable trigger', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Context
  ipcMain.handle('proactive:getContext', async () => {
    try {
      return { success: true, data: engine.getContext() };
    } catch (error) {
      logger.error('Failed to get context', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:setContextVariable', async (_, key: string, value: unknown) => {
    try {
      engine.setContextVariable(key, value);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set context variable', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('proactive:recordInteraction', async () => {
    try {
      engine.recordInteraction();
      return { success: true };
    } catch (error) {
      logger.error('Failed to record interaction', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Briefing
  ipcMain.handle('proactive:generateBriefing', async (_, type: 'morning' | 'evening') => {
    try {
      return { success: true, data: await engine.generateBriefing(type) };
    } catch (error) {
      logger.error('Failed to generate briefing', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Event emission (for external triggers)
  ipcMain.handle('proactive:emitEvent', async (_, eventName: string, data?: unknown) => {
    try {
      engine.emitEvent(eventName, data);
      return { success: true };
    } catch (error) {
      logger.error('Failed to emit event', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Proactive IPC handlers registered');
}
