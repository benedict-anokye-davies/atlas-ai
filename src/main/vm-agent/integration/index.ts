/**
 * Atlas Desktop - VM Agent Integration Module
 *
 * Exports for integrating VM Agent with the rest of Atlas:
 * - Voice command integration
 * - IPC handlers for renderer
 *
 * @module vm-agent/integration
 */

// =============================================================================
// Voice Integration Exports
// =============================================================================

export {
  // Constants
  VOICE_INTEGRATION_CONSTANTS,
  // Types
  VoiceCommandIntent,
  VoiceCommand,
  VoiceCommandResult,
  // Manager
  VoiceIntegrationManager,
  getVoiceIntegrationManager,
  resetVoiceIntegrationManager,
  connectToVoicePipeline,
} from './voice-integration';

// =============================================================================
// IPC Handler Exports
// =============================================================================

export {
  // Constants
  IPC_CHANNELS,
  // Registration functions
  registerVMAgentIPCHandlers,
  unregisterVMAgentIPCHandlers,
} from './ipc-handlers';

// =============================================================================
// Module Initialization
// =============================================================================

import { createModuleLogger } from '../../utils/logger';
import { getVoiceIntegrationManager } from './voice-integration';
import { registerVMAgentIPCHandlers } from './ipc-handlers';

const logger = createModuleLogger('VMAgentIntegration');

/**
 * Initialize all integration components
 */
export async function initializeIntegration(): Promise<void> {
  logger.info('Initializing VM Agent integration...');

  try {
    // Initialize voice integration
    getVoiceIntegrationManager();

    // Register IPC handlers
    registerVMAgentIPCHandlers();

    logger.info('VM Agent integration initialized');
  } catch (error) {
    logger.error('Failed to initialize integration', { error });
    throw error;
  }
}

/**
 * Reset all integration components (for testing)
 */
export async function resetIntegration(): Promise<void> {
  const { resetVoiceIntegrationManager } = await import('./voice-integration');
  const { unregisterVMAgentIPCHandlers } = await import('./ipc-handlers');

  resetVoiceIntegrationManager();
  unregisterVMAgentIPCHandlers();

  logger.debug('Integration reset');
}

/**
 * Get integration status
 */
export function getIntegrationStatus(): {
  voiceEnabled: boolean;
  ipcRegistered: boolean;
  vmConnected: boolean;
} {
  const voiceManager = getVoiceIntegrationManager();
  const state = voiceManager.getState();

  return {
    voiceEnabled: state.enabled,
    ipcRegistered: true, // Handlers are registered at startup
    vmConnected: state.vmConnected,
  };
}
