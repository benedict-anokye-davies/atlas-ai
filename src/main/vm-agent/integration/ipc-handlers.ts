/**
 * Atlas Desktop - VM Agent IPC Handlers
 *
 * Exposes VM Agent functionality to the renderer process via IPC.
 * Provides comprehensive API for VM control, vision, learning, and workflows.
 *
 * @module vm-agent/integration/ipc-handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('VMAgentIPC');

// =============================================================================
// Constants
// =============================================================================

export const IPC_CHANNELS = {
  // Connection management
  CONNECT: 'vm-agent:connect',
  DISCONNECT: 'vm-agent:disconnect',
  GET_STATUS: 'vm-agent:get-status',
  LIST_VMS: 'vm-agent:list-vms',

  // Screen operations
  SCREENSHOT: 'vm-agent:screenshot',
  ANALYZE_SCREEN: 'vm-agent:analyze-screen',
  DESCRIBE_SCREEN: 'vm-agent:describe-screen',
  FIND_ELEMENT: 'vm-agent:find-element',

  // Input actions
  CLICK: 'vm-agent:click',
  DOUBLE_CLICK: 'vm-agent:double-click',
  RIGHT_CLICK: 'vm-agent:right-click',
  TYPE: 'vm-agent:type',
  PRESS_KEY: 'vm-agent:press-key',
  HOTKEY: 'vm-agent:hotkey',
  SCROLL: 'vm-agent:scroll',
  DRAG: 'vm-agent:drag',

  // Task execution
  EXECUTE_TASK: 'vm-agent:execute-task',
  GET_TASK_STATUS: 'vm-agent:get-task-status',
  CANCEL_TASK: 'vm-agent:cancel-task',
  PAUSE_TASK: 'vm-agent:pause-task',
  RESUME_TASK: 'vm-agent:resume-task',

  // Learning & Recording
  START_RECORDING: 'vm-agent:start-recording',
  STOP_RECORDING: 'vm-agent:stop-recording',
  LIST_RECORDINGS: 'vm-agent:list-recordings',
  REPLAY_RECORDING: 'vm-agent:replay-recording',
  DELETE_RECORDING: 'vm-agent:delete-recording',

  // Checkpoints
  CREATE_CHECKPOINT: 'vm-agent:create-checkpoint',
  LIST_CHECKPOINTS: 'vm-agent:list-checkpoints',
  RESTORE_CHECKPOINT: 'vm-agent:restore-checkpoint',
  DELETE_CHECKPOINT: 'vm-agent:delete-checkpoint',

  // Workflows
  CREATE_WORKFLOW: 'vm-agent:create-workflow',
  EXECUTE_WORKFLOW: 'vm-agent:execute-workflow',
  LIST_WORKFLOWS: 'vm-agent:list-workflows',
  GET_WORKFLOW: 'vm-agent:get-workflow',
  DELETE_WORKFLOW: 'vm-agent:delete-workflow',

  // Multi-VM
  ADD_VM: 'vm-agent:multi:add-vm',
  REMOVE_VM: 'vm-agent:multi:remove-vm',
  CREATE_CLUSTER: 'vm-agent:multi:create-cluster',
  EXECUTE_ON_VM: 'vm-agent:multi:execute-on-vm',

  // Plugins
  LIST_PLUGINS: 'vm-agent:plugins:list',
  ENABLE_PLUGIN: 'vm-agent:plugins:enable',
  DISABLE_PLUGIN: 'vm-agent:plugins:disable',
  GET_PLUGIN_ACTIONS: 'vm-agent:plugins:get-actions',
  EXECUTE_PLUGIN_ACTION: 'vm-agent:plugins:execute-action',

  // Vision Memory
  GET_VISUAL_MEMORY: 'vm-agent:vision:get-memory',
  CLEAR_VISUAL_MEMORY: 'vm-agent:vision:clear-memory',

  // Predictions
  GET_PREDICTIONS: 'vm-agent:predictions:get',
  PROVIDE_FEEDBACK: 'vm-agent:predictions:feedback',

  // Settings
  GET_SETTINGS: 'vm-agent:settings:get',
  UPDATE_SETTINGS: 'vm-agent:settings:update',
} as const;

// =============================================================================
// Types
// =============================================================================

/** IPC Response wrapper */
interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Connection config for IPC */
interface ConnectionConfig {
  type: 'vnc' | 'hyperv' | 'virtualbox' | 'vmware';
  host?: string;
  port?: number;
  vmName?: string;
  username?: string;
  password?: string;
}

/** Task config for IPC */
interface TaskConfig {
  objective: string;
  maxSteps?: number;
  timeout?: number;
  useVision?: boolean;
  useLearning?: boolean;
}

/** Recording config for IPC */
interface RecordingConfig {
  name: string;
  description?: string;
  category?: string;
}

/** Workflow config for IPC */
interface WorkflowConfig {
  name: string;
  description?: string;
  steps: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
}

// =============================================================================
// Handler Registration
// =============================================================================

/**
 * Register all VM Agent IPC handlers
 */
export function registerVMAgentIPCHandlers(): void {
  logger.info('Registering VM Agent IPC handlers...');

  // =========================================================================
  // Connection Management
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.CONNECT, async (_event: IpcMainInvokeEvent, config: ConnectionConfig): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: connect', { type: config.type });
      
      // Lazy import to avoid circular dependencies
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.connect({
        type: config.type,
        host: config.host || 'localhost',
        port: config.port,
        vmName: config.vmName,
        username: config.username,
        password: config.password,
      });
      
      return { success: true, data: { connected: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      logger.error('IPC: connect failed', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DISCONNECT, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: disconnect');
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.disconnect();
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_STATUS, async (): Promise<IPCResponse> => {
    try {
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const status = agent.getStatus();
      
      return { success: true, data: status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get status';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Screen Operations
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: screenshot');
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const screenshot = await agent.screenshot();
      
      // Convert buffer to base64 for IPC transfer
      return { 
        success: true, 
        data: { 
          screenshot: screenshot.toString('base64'),
          timestamp: Date.now(),
        } 
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screenshot failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ANALYZE_SCREEN, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: analyze screen');
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const analysis = await agent.analyzeScreen();
      
      return { success: true, data: analysis };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DESCRIBE_SCREEN, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: describe screen');
      
      const { getVLMAnalyzer } = await import('../vision/vlm-analyzer');
      const { getVMAgent } = await import('../index');
      
      const agent = getVMAgent();
      const screenshot = await agent.screenshot();
      
      const vlm = getVLMAnalyzer();
      const description = await vlm.analyzeScreen(screenshot, {
        detailed: true,
        includeText: true,
        includeUIElements: true,
      });
      
      return { success: true, data: description };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Description failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FIND_ELEMENT, async (_event: IpcMainInvokeEvent, query: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: find element', { query });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const element = await agent.findElement(query);
      
      return { success: true, data: element };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Element not found';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Input Actions
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.CLICK, async (_event: IpcMainInvokeEvent, params: { x: number; y: number; button?: 'left' | 'right' | 'middle' }): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: click', params);
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.click(params.x, params.y, params.button);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Click failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOUBLE_CLICK, async (_event: IpcMainInvokeEvent, params: { x: number; y: number }): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: double click', params);
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.doubleClick(params.x, params.y);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Double click failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TYPE, async (_event: IpcMainInvokeEvent, text: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: type', { textLength: text.length });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.type(text);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Type failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRESS_KEY, async (_event: IpcMainInvokeEvent, key: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: press key', { key });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.pressKey(key);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Key press failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.HOTKEY, async (_event: IpcMainInvokeEvent, keys: string[]): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: hotkey', { keys });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.hotkey(keys);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hotkey failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCROLL, async (_event: IpcMainInvokeEvent, params: { x: number; y: number; deltaX: number; deltaY: number }): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: scroll', params);
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.scroll(params.x, params.y, params.deltaX, params.deltaY);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scroll failed';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Task Execution
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.EXECUTE_TASK, async (_event: IpcMainInvokeEvent, config: TaskConfig): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: execute task', { objective: config.objective });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const result = await agent.executeTask({
        objective: config.objective,
        maxSteps: config.maxSteps || 50,
        timeout: config.timeout || 300000,
      });
      
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task execution failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_TASK_STATUS, async (_event: IpcMainInvokeEvent, taskId: string): Promise<IPCResponse> => {
    try {
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const status = agent.getTaskStatus(taskId);
      
      return { success: true, data: status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get task status';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_TASK, async (_event: IpcMainInvokeEvent, taskId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: cancel task', { taskId });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.cancelTask(taskId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel task';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAUSE_TASK, async (_event: IpcMainInvokeEvent, taskId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: pause task', { taskId });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.pauseTask(taskId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause task';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESUME_TASK, async (_event: IpcMainInvokeEvent, taskId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: resume task', { taskId });
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      await agent.resumeTask(taskId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume task';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Learning & Recording
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.START_RECORDING, async (_event: IpcMainInvokeEvent, config: RecordingConfig): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: start recording', { name: config.name });
      
      const { getFewShotLearner } = await import('../learning/few-shot-learner');
      const learner = getFewShotLearner();
      
      const recordingId = await learner.startRecording(config.name, config.description, config.category);
      
      return { success: true, data: { recordingId } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start recording';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STOP_RECORDING, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: stop recording');
      
      const { getFewShotLearner } = await import('../learning/few-shot-learner');
      const learner = getFewShotLearner();
      
      const demonstration = await learner.stopRecording();
      
      return { success: true, data: demonstration };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIST_RECORDINGS, async (): Promise<IPCResponse> => {
    try {
      const { getFewShotLearner } = await import('../learning/few-shot-learner');
      const learner = getFewShotLearner();
      
      const recordings = learner.listDemonstrations();
      
      return { success: true, data: recordings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list recordings';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REPLAY_RECORDING, async (_event: IpcMainInvokeEvent, recordingId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: replay recording', { recordingId });
      
      const { getFewShotLearner } = await import('../learning/few-shot-learner');
      const learner = getFewShotLearner();
      
      await learner.replay(recordingId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to replay recording';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Checkpoints
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.CREATE_CHECKPOINT, async (_event: IpcMainInvokeEvent, description?: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: create checkpoint');
      
      const { getCheckpointManager } = await import('../core/checkpoint-manager');
      const manager = getCheckpointManager();
      
      const checkpoint = await manager.createCheckpoint('manual', { description });
      
      return { success: true, data: checkpoint };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create checkpoint';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIST_CHECKPOINTS, async (): Promise<IPCResponse> => {
    try {
      const { getCheckpointManager } = await import('../core/checkpoint-manager');
      const manager = getCheckpointManager();
      
      const checkpoints = manager.listCheckpoints();
      
      return { success: true, data: checkpoints };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list checkpoints';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESTORE_CHECKPOINT, async (_event: IpcMainInvokeEvent, checkpointId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: restore checkpoint', { checkpointId });
      
      const { getCheckpointManager } = await import('../core/checkpoint-manager');
      const manager = getCheckpointManager();
      
      const checkpoint = await manager.restoreCheckpoint(checkpointId);
      
      return { success: true, data: checkpoint };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore checkpoint';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Workflows
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.CREATE_WORKFLOW, async (_event: IpcMainInvokeEvent, config: WorkflowConfig): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: create workflow', { name: config.name });
      
      const { getCrossAppWorkflowManager } = await import('../workflows/cross-app');
      const manager = getCrossAppWorkflowManager();
      
      const workflow = await manager.createWorkflow({
        id: `workflow_${Date.now()}`,
        name: config.name,
        description: config.description,
        steps: config.steps.map((s, i) => ({
          id: `step_${i}`,
          type: s.type as 'switch_app' | 'extract_data' | 'input_data' | 'execute_action' | 'verify_state',
          name: `Step ${i + 1}`,
          ...s.config,
        })),
      });
      
      return { success: true, data: workflow };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create workflow';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXECUTE_WORKFLOW, async (_event: IpcMainInvokeEvent, workflowId: string, inputs?: Record<string, unknown>): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: execute workflow', { workflowId });
      
      const { getCrossAppWorkflowManager } = await import('../workflows/cross-app');
      const manager = getCrossAppWorkflowManager();
      
      const result = await manager.executeWorkflow(workflowId, { variables: inputs || {} });
      
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute workflow';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIST_WORKFLOWS, async (): Promise<IPCResponse> => {
    try {
      const { getCrossAppWorkflowManager } = await import('../workflows/cross-app');
      const manager = getCrossAppWorkflowManager();
      
      const workflows = manager.listWorkflows();
      
      return { success: true, data: workflows };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list workflows';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Multi-VM
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.ADD_VM, async (_event: IpcMainInvokeEvent, config: { id: string; name: string; connection: ConnectionConfig }): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: add VM', { id: config.id });
      
      const { getMultiVMManager } = await import('../workflows/multi-vm');
      const manager = getMultiVMManager();
      
      await manager.addVM(config.id, config.name, config.connection);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add VM';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_VM, async (_event: IpcMainInvokeEvent, vmId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: remove VM', { vmId });
      
      const { getMultiVMManager } = await import('../workflows/multi-vm');
      const manager = getMultiVMManager();
      
      await manager.removeVM(vmId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove VM';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Plugins
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.LIST_PLUGINS, async (): Promise<IPCResponse> => {
    try {
      const { getPluginRegistry } = await import('../plugins/plugin-registry');
      const registry = getPluginRegistry();
      
      const plugins = registry.listPlugins();
      
      return { success: true, data: plugins };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list plugins';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ENABLE_PLUGIN, async (_event: IpcMainInvokeEvent, pluginId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: enable plugin', { pluginId });
      
      const { getPluginRegistry } = await import('../plugins/plugin-registry');
      const registry = getPluginRegistry();
      
      registry.enablePlugin(pluginId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable plugin';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DISABLE_PLUGIN, async (_event: IpcMainInvokeEvent, pluginId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: disable plugin', { pluginId });
      
      const { getPluginRegistry } = await import('../plugins/plugin-registry');
      const registry = getPluginRegistry();
      
      registry.disablePlugin(pluginId);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable plugin';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXECUTE_PLUGIN_ACTION, async (_event: IpcMainInvokeEvent, pluginId: string, actionId: string, params?: Record<string, unknown>): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: execute plugin action', { pluginId, actionId });
      
      const { getPluginRegistry } = await import('../plugins/plugin-registry');
      const registry = getPluginRegistry();
      
      const result = await registry.executeIntent(actionId, params);
      
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute plugin action';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Vision Memory
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.GET_VISUAL_MEMORY, async (): Promise<IPCResponse> => {
    try {
      const { getVisualMemory } = await import('../vision/visual-memory');
      const memory = getVisualMemory();
      
      const snapshots = memory.listSnapshots();
      const patterns = memory.getLearnedPatterns();
      
      return { success: true, data: { snapshots, patterns } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get visual memory';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_VISUAL_MEMORY, async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: clear visual memory');
      
      const { getVisualMemory } = await import('../vision/visual-memory');
      const memory = getVisualMemory();
      
      memory.clear();
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear visual memory';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Predictions
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.GET_PREDICTIONS, async (): Promise<IPCResponse> => {
    try {
      const { getPredictiveEngine } = await import('../learning/predictive-engine');
      const engine = getPredictiveEngine();
      
      const predictions = engine.getCurrentPredictions();
      
      return { success: true, data: predictions };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get predictions';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDE_FEEDBACK, async (_event: IpcMainInvokeEvent, predictionId: string, correct: boolean): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: provide feedback', { predictionId, correct });
      
      const { getActiveLearner } = await import('../learning/active-learning');
      const learner = getActiveLearner();
      
      learner.recordFeedback(predictionId, correct ? 'helpful' : 'not_helpful');
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to provide feedback';
      return { success: false, error: message };
    }
  });

  // =========================================================================
  // Settings
  // =========================================================================

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async (): Promise<IPCResponse> => {
    try {
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      const settings = agent.getSettings();
      
      return { success: true, data: settings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get settings';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (_event: IpcMainInvokeEvent, settings: Record<string, unknown>): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: update settings');
      
      const { getVMAgent } = await import('../index');
      const agent = getVMAgent();
      
      agent.updateSettings(settings);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      return { success: false, error: message };
    }
  });

  logger.info('VM Agent IPC handlers registered', { channelCount: Object.keys(IPC_CHANNELS).length });
}

/**
 * Unregister all VM Agent IPC handlers
 */
export function unregisterVMAgentIPCHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
  logger.info('VM Agent IPC handlers unregistered');
}
