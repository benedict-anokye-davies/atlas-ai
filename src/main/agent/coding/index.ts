/**
 * @file Coding Agent Module Index
 * @description Exports for Atlas's autonomous coding capabilities
 */

// Types
export * from './types';

// Core components
export { CodingAgent, getCodingAgent } from './coding-agent';
export { ContextBuilder, getContextBuilder } from './context-builder';
export { EditEngine, getEditEngine } from './edit-engine';

// Tools
export {
  CODING_TOOLS,
  getToolByName,
  getToolDefinitions,
  readFileTool,
  createFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  grepSearchTool,
  findSymbolTool,
  getErrorsTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
} from './code-tools';

// Voice commands
export {
  VoiceCommandHandler,
  getVoiceCommandHandler,
  parseVoiceCommand,
  commandToPrompt,
  matchQuickCommand,
  QUICK_COMMANDS,
} from './voice-commands';

// IPC handlers
export {
  registerCodingAgentHandlers,
  unregisterCodingAgentHandlers,
} from './ipc-handlers';
