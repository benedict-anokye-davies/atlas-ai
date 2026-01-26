/**
 * Workflow IPC Handlers
 * IPC handlers for workflow execution system
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getWorkflowExecutor,
  initializeWorkflows,
  WorkflowDefinition,
  WorkflowExecutionOptions
} from '../agent/workflow';

const logger = createModuleLogger('WorkflowIPC');

/**
 * Register all workflow IPC handlers
 */
export function registerWorkflowHandlers(): void {
  logger.info('Registering workflow IPC handlers');

  // Initialize workflow system
  ipcMain.handle('workflow:initialize', async () => {
    try {
      await initializeWorkflows();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize workflows', error);
      return { success: false, error: String(error) };
    }
  });

  // Execute a workflow
  ipcMain.handle('workflow:execute', async (
    _event: IpcMainInvokeEvent,
    definition: WorkflowDefinition,
    options?: WorkflowExecutionOptions
  ) => {
    try {
      const executor = getWorkflowExecutor();
      const result = await executor.execute(definition, options);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Cancel a running workflow
  ipcMain.handle('workflow:cancel', async (
    _event: IpcMainInvokeEvent,
    executionId: string
  ) => {
    try {
      const executor = getWorkflowExecutor();
      await executor.cancel(executionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get workflow status
  ipcMain.handle('workflow:getStatus', async (
    _event: IpcMainInvokeEvent,
    executionId: string
  ) => {
    try {
      const executor = getWorkflowExecutor();
      const status = executor.getStatus(executionId);
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get all active workflows
  ipcMain.handle('workflow:getActive', async () => {
    try {
      const executor = getWorkflowExecutor();
      const active = executor.getActiveWorkflows();
      return { success: true, data: active };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get workflow history
  ipcMain.handle('workflow:getHistory', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const executor = getWorkflowExecutor();
      const history = executor.getHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Clear workflow history
  ipcMain.handle('workflow:clearHistory', async () => {
    try {
      const executor = getWorkflowExecutor();
      executor.clearHistory();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Workflow IPC handlers registered');
}
