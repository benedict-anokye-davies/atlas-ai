/**
 * Wellness IPC Handlers
 * IPC handlers for health and wellness monitoring
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getActivityTracker,
  getBreakReminder,
  initializeWellness
} from '../wellness';

const logger = createModuleLogger('WellnessIPC');

/**
 * Register all wellness IPC handlers
 */
export function registerWellnessHandlers(): void {
  logger.info('Registering wellness IPC handlers');

  // Initialize wellness system
  ipcMain.handle('wellness:initialize', async () => {
    try {
      await initializeWellness();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize wellness', error);
      return { success: false, error: String(error) };
    }
  });

  // Get system status
  ipcMain.handle('wellness:getStatus', async () => {
    try {
      const tracker = getActivityTracker();
      const reminder = getBreakReminder();
      
      return {
        success: true,
        data: {
          tracker: tracker.getStatus(),
          reminder: reminder.getStatus()
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get activity stats
  ipcMain.handle('wellness:getStats', async () => {
    try {
      const tracker = getActivityTracker();
      const stats = tracker.getStats();
      return { success: true, data: stats };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get daily summary
  ipcMain.handle('wellness:getDailySummary', async () => {
    try {
      const tracker = getActivityTracker();
      const summary = tracker.getDailySummary();
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start activity tracking
  ipcMain.handle('wellness:startTracking', async () => {
    try {
      const tracker = getActivityTracker();
      tracker.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop activity tracking
  ipcMain.handle('wellness:stopTracking', async () => {
    try {
      const tracker = getActivityTracker();
      tracker.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get break reminder status
  ipcMain.handle('wellness:getBreakStatus', async () => {
    try {
      const reminder = getBreakReminder();
      const status = reminder.getStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start break reminder
  ipcMain.handle('wellness:startBreakReminder', async () => {
    try {
      const reminder = getBreakReminder();
      reminder.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop break reminder
  ipcMain.handle('wellness:stopBreakReminder', async () => {
    try {
      const reminder = getBreakReminder();
      reminder.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Mark break as taken
  ipcMain.handle('wellness:takeBreak', async () => {
    try {
      const reminder = getBreakReminder();
      reminder.takeBreak();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Skip current break
  ipcMain.handle('wellness:skipBreak', async () => {
    try {
      const reminder = getBreakReminder();
      reminder.skipBreak();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Snooze break reminder
  ipcMain.handle('wellness:snoozeBreak', async (
    _event: IpcMainInvokeEvent,
    minutes: number
  ) => {
    try {
      const reminder = getBreakReminder();
      reminder.snooze(minutes);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Configure break reminder
  ipcMain.handle('wellness:configureBreakReminder', async (
    _event: IpcMainInvokeEvent,
    config: {
      breakInterval?: number;
      breakDuration?: number;
      eyeRestEnabled?: boolean;
      stretchEnabled?: boolean;
      walkEnabled?: boolean;
    }
  ) => {
    try {
      const reminder = getBreakReminder();
      reminder.configure(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get break history
  ipcMain.handle('wellness:getBreakHistory', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const reminder = getBreakReminder();
      const history = reminder.getHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get weekly report
  ipcMain.handle('wellness:getWeeklyReport', async () => {
    try {
      const tracker = getActivityTracker();
      const report = tracker.getWeeklyReport();
      return { success: true, data: report };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Wellness IPC handlers registered');
}
