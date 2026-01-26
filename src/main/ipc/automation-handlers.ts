/**
 * Automation IPC Handlers
 * IPC handlers for contextual automation system
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getTriggerEngine,
  getContextMonitor,
  initializeAutomation
} from '../automation';
import { AutomationTrigger } from '../automation/types';

const logger = createModuleLogger('AutomationIPC');

/**
 * Register all automation IPC handlers
 */
export function registerAutomationHandlers(): void {
  logger.info('Registering automation IPC handlers');

  // Initialize automation system
  ipcMain.handle('automation:initialize', async () => {
    try {
      await initializeAutomation();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize automation', error);
      return { success: false, error: String(error) };
    }
  });

  // Get automation status
  ipcMain.handle('automation:getStatus', async () => {
    try {
      const engine = getTriggerEngine();
      const monitor = getContextMonitor();
      return {
        success: true,
        data: {
          engine: engine.getStatus(),
          context: monitor.getStatus()
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Register a new trigger
  ipcMain.handle('automation:registerTrigger', async (
    _event: IpcMainInvokeEvent,
    trigger: AutomationTrigger
  ) => {
    try {
      const engine = getTriggerEngine();
      engine.registerTrigger(trigger);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unregister a trigger
  ipcMain.handle('automation:unregisterTrigger', async (
    _event: IpcMainInvokeEvent,
    triggerId: string
  ) => {
    try {
      const engine = getTriggerEngine();
      engine.unregisterTrigger(triggerId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get all triggers
  ipcMain.handle('automation:getTriggers', async () => {
    try {
      const engine = getTriggerEngine();
      const triggers = engine.getTriggers();
      return { success: true, data: triggers };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Enable/disable a trigger
  ipcMain.handle('automation:toggleTrigger', async (
    _event: IpcMainInvokeEvent,
    triggerId: string,
    enabled: boolean
  ) => {
    try {
      const engine = getTriggerEngine();
      engine.setTriggerEnabled(triggerId, enabled);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get current context
  ipcMain.handle('automation:getContext', async () => {
    try {
      const monitor = getContextMonitor();
      const context = monitor.getCurrentContext();
      return { success: true, data: context };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start context monitoring
  ipcMain.handle('automation:startMonitoring', async () => {
    try {
      const monitor = getContextMonitor();
      monitor.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop context monitoring
  ipcMain.handle('automation:stopMonitoring', async () => {
    try {
      const monitor = getContextMonitor();
      monitor.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Fire a trigger manually
  ipcMain.handle('automation:fireTrigger', async (
    _event: IpcMainInvokeEvent,
    triggerId: string,
    data?: Record<string, unknown>
  ) => {
    try {
      const engine = getTriggerEngine();
      await engine.fireTrigger(triggerId, data);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get execution history
  ipcMain.handle('automation:getHistory', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const engine = getTriggerEngine();
      const history = engine.getExecutionHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Automation IPC handlers registered');
}
