/**
 * IPC Handlers for Computer Use Agent
 * Autonomous screen control and task execution
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getComputerUseAgent, ComputerTask } from '../agent/computer-use';

const logger = createModuleLogger('ComputerUseIPC');

/**
 * Register computer use IPC handlers
 */
export function registerComputerUseHandlers(): void {
  logger.info('Registering computer use IPC handlers');

  // Capture and analyze screen
  ipcMain.handle('computer-use:capture-screen', async () => {
    try {
      const agent = getComputerUseAgent();
      const screenState = await agent.captureScreen();
      return {
        success: true,
        data: {
          width: screenState.width,
          height: screenState.height,
          elements: screenState.elements,
          activeWindow: screenState.activeWindow,
          timestamp: screenState.timestamp,
          // Don't send the full screenshot buffer over IPC
          hasScreenshot: true,
        },
      };
    } catch (error) {
      logger.error('Failed to capture screen', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Plan a task
  ipcMain.handle('computer-use:plan-task', async (
    _event: IpcMainInvokeEvent,
    goal: string
  ) => {
    try {
      const agent = getComputerUseAgent();
      const task = await agent.planTask(goal);
      return { success: true, data: task };
    } catch (error) {
      logger.error('Failed to plan task', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Execute a planned task
  ipcMain.handle('computer-use:execute-task', async (
    _event: IpcMainInvokeEvent,
    task: ComputerTask
  ) => {
    try {
      const agent = getComputerUseAgent();
      await agent.executeTask(task);
      return { success: true };
    } catch (error) {
      logger.error('Failed to execute task', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get current status
  ipcMain.handle('computer-use:get-status', async () => {
    try {
      const agent = getComputerUseAgent();
      const status = agent.getStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error('Failed to get status', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Abort current task
  ipcMain.handle('computer-use:abort', async () => {
    try {
      const agent = getComputerUseAgent();
      agent.abort();
      return { success: true };
    } catch (error) {
      logger.error('Failed to abort task', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Pause current task
  ipcMain.handle('computer-use:pause', async () => {
    try {
      const agent = getComputerUseAgent();
      agent.pause();
      return { success: true };
    } catch (error) {
      logger.error('Failed to pause task', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Resume paused task
  ipcMain.handle('computer-use:resume', async () => {
    try {
      const agent = getComputerUseAgent();
      await agent.resume();
      return { success: true };
    } catch (error) {
      logger.error('Failed to resume task', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Configure safety settings
  ipcMain.handle('computer-use:configure', async (
    _event: IpcMainInvokeEvent,
    settings: {
      safetyEnabled?: boolean;
      maxActionsPerTask?: number;
      actionDelayMs?: number;
      requireConfirmation?: boolean;
    }
  ) => {
    try {
      const agent = getComputerUseAgent();
      agent.configure(settings);
      return { success: true };
    } catch (error) {
      logger.error('Failed to configure computer use', error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Computer use IPC handlers registered');
}
