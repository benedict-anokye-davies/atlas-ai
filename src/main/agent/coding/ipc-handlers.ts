/**
 * @file Coding Agent IPC Handlers
 * @description Wire up coding agent to renderer via IPC
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import { getCodingAgent } from './coding-agent';
import { getVoiceCommandHandler } from './voice-commands';
import { getContextBuilder } from './context-builder';
import { getEditEngine } from './edit-engine';
import type {
  CodingRequest,
  CodingResponse,
  CodingResponseChunk,
  CodingSession,
  VoiceCommand,
  CodingAgentConfig,
} from './types';

const logger = createModuleLogger('CodingIPC');

/**
 * Register all coding agent IPC handlers
 */
export function registerCodingAgentHandlers(): void {
  logger.info('Registering coding agent IPC handlers');

  // Execute a coding task
  ipcMain.handle('coding:execute', async (_event, request: CodingRequest) => {
    logger.info('Executing coding task', { prompt: request.prompt.substring(0, 100) });

    try {
      const agent = getCodingAgent();
      const response = await agent.execute(request);
      return { success: true, data: response };
    } catch (error) {
      logger.error('Coding task failed', { error: getErrorMessage(error) });
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Execute with streaming
  ipcMain.handle('coding:execute-stream', async (event, request: CodingRequest) => {
    logger.info('Starting streaming coding task', { prompt: request.prompt.substring(0, 100) });

    try {
      const agent = getCodingAgent();
      const sender = event.sender;

      // Stream chunks to renderer
      for await (const chunk of agent.executeStream(request)) {
        sender.send('coding:stream-chunk', chunk);
      }

      return { success: true };
    } catch (error) {
      logger.error('Streaming coding task failed', { error: getErrorMessage(error) });
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Process voice command
  ipcMain.handle('coding:voice-command', async (_event, text: string) => {
    logger.debug('Processing voice command', { text });

    try {
      const handler = getVoiceCommandHandler();
      const result = handler.processTranscription(text);

      if (!result) {
        return { success: false, error: 'Could not parse voice command' };
      }

      // Execute the generated prompt
      const agent = getCodingAgent();
      const response = await agent.execute({ prompt: result.prompt });

      return {
        success: true,
        data: {
          command: result.command,
          response,
        },
      };
    } catch (error) {
      logger.error('Voice command failed', { error: getErrorMessage(error) });
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Parse voice command without executing
  ipcMain.handle('coding:parse-voice', async (_event, text: string) => {
    try {
      const handler = getVoiceCommandHandler();
      const result = handler.processTranscription(text);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get current session
  ipcMain.handle('coding:get-session', async () => {
    try {
      const agent = getCodingAgent();
      const session = agent.getCurrentSession();
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Abort current task
  ipcMain.handle('coding:abort', async () => {
    try {
      const agent = getCodingAgent();
      agent.abort();
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Update configuration
  ipcMain.handle('coding:update-config', async (_event, config: Partial<CodingAgentConfig>) => {
    try {
      const agent = getCodingAgent();
      agent.updateConfig(config);
      return { success: true, data: agent.getConfig() };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get configuration
  ipcMain.handle('coding:get-config', async () => {
    try {
      const agent = getCodingAgent();
      return { success: true, data: agent.getConfig() };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get project context
  ipcMain.handle('coding:get-context', async (_event, request?: { files?: string[] }) => {
    try {
      const contextBuilder = getContextBuilder();
      const context = await contextBuilder.buildContext({
        userRequest: '',
        files: request?.files,
        includeErrors: true,
        includeGit: true,
      });
      return { success: true, data: context };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get edit history
  ipcMain.handle('coding:get-edit-history', async () => {
    try {
      const editEngine = getEditEngine();
      return { success: true, data: editEngine.getEditHistory() };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Rollback last edit
  ipcMain.handle('coding:rollback', async (_event, count?: number) => {
    try {
      const editEngine = getEditEngine();
      const rolledBack = await editEngine.rollbackLast(count || 1);
      return { success: true, data: { rolledBack } };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Set up agent event forwarding
  setupAgentEventForwarding();

  logger.info('Coding agent IPC handlers registered');
}

/**
 * Forward agent events to renderer
 */
function setupAgentEventForwarding(): void {
  const agent = getCodingAgent();

  agent.on('session-start', (session: CodingSession) => {
    broadcastToRenderers('coding:session-start', session);
  });

  agent.on('session-end', (session: CodingSession) => {
    broadcastToRenderers('coding:session-end', session);
  });

  agent.on('state-change', (state, session) => {
    broadcastToRenderers('coding:state-change', { state, sessionId: session.id });
  });

  agent.on('tool-call', (toolCall) => {
    broadcastToRenderers('coding:tool-call', toolCall);
  });

  agent.on('tool-result', (result) => {
    broadcastToRenderers('coding:tool-result', result);
  });

  agent.on('file-change', (edit) => {
    broadcastToRenderers('coding:file-change', edit);
  });

  agent.on('progress', (progress, message) => {
    broadcastToRenderers('coding:progress', { progress, message });
  });

  agent.on('thinking', (thought) => {
    broadcastToRenderers('coding:thinking', thought);
  });

  agent.on('error', (error, session) => {
    broadcastToRenderers('coding:error', {
      error: getErrorMessage(error),
      sessionId: session.id,
    });
  });
}

/**
 * Broadcast an event to all renderer windows
 */
function broadcastToRenderers(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  }
}

/**
 * Unregister coding agent handlers
 */
export function unregisterCodingAgentHandlers(): void {
  const channels = [
    'coding:execute',
    'coding:execute-stream',
    'coding:voice-command',
    'coding:parse-voice',
    'coding:get-session',
    'coding:abort',
    'coding:update-config',
    'coding:get-config',
    'coding:get-context',
    'coding:get-edit-history',
    'coding:rollback',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('Coding agent IPC handlers unregistered');
}

export default registerCodingAgentHandlers;
