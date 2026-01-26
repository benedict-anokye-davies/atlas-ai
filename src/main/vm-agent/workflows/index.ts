/**
 * Atlas Desktop - VM Agent Workflows Module
 *
 * Exports for the advanced workflows module including:
 * - Cross-application workflow management
 * - Multi-VM orchestration
 *
 * @module vm-agent/workflows
 */

// =============================================================================
// Cross-App Workflow Exports
// =============================================================================

export {
  // Constants
  CROSS_APP_CONSTANTS,
  // Types
  WorkflowStepType,
  WorkflowDefinition,
  WorkflowStep,
  DataExtractionConfig,
  DataInputConfig,
  VerificationConfig,
  WaitConditionConfig,
  BranchConfig,
  LoopConfig,
  RetryConfig,
  WorkflowInput,
  WorkflowOutput,
  WorkflowExecution,
  // Manager
  CrossAppWorkflowManager,
  getCrossAppWorkflowManager,
  resetCrossAppWorkflowManager,
} from './cross-app';

// =============================================================================
// Multi-VM Orchestration Exports
// =============================================================================

export {
  // Constants
  MULTI_VM_CONSTANTS,
  // Types
  VMStatus,
  ManagedVM,
  VMHealthStats,
  MultiVMTask,
  VMTaskAssignment,
  SyncPoint,
  VMTaskResult,
  VMCluster,
  DataTransfer,
  // Manager
  MultiVMManager,
  getMultiVMManager,
  resetMultiVMManager,
} from './multi-vm';

// =============================================================================
// Module Initialization
// =============================================================================

import { createModuleLogger } from '../../utils/logger';
import { getCrossAppWorkflowManager } from './cross-app';
import { getMultiVMManager } from './multi-vm';

const logger = createModuleLogger('VMAgentWorkflows');

/**
 * Initialize all workflow components
 */
export async function initializeWorkflows(): Promise<void> {
  logger.info('Initializing VM Agent workflows...');

  try {
    // Initialize cross-app workflows
    const crossAppManager = getCrossAppWorkflowManager();
    await crossAppManager.initialize();

    // Initialize multi-VM manager
    const multiVMManager = getMultiVMManager();
    await multiVMManager.initialize();

    logger.info('VM Agent workflows initialized');
  } catch (error) {
    logger.error('Failed to initialize workflows', { error });
    throw error;
  }
}

/**
 * Reset all workflow components (for testing)
 */
export async function resetWorkflows(): Promise<void> {
  const { resetCrossAppWorkflowManager } = await import('./cross-app');
  const { resetMultiVMManager } = await import('./multi-vm');

  resetCrossAppWorkflowManager();
  resetMultiVMManager();

  logger.debug('Workflows reset');
}

/**
 * Get workflow status
 */
export function getWorkflowStatus(): {
  crossApp: { initialized: boolean; workflowCount: number };
  multiVM: { initialized: boolean; vmCount: number; clusterCount: number };
} {
  const crossAppManager = getCrossAppWorkflowManager();
  const multiVMManager = getMultiVMManager();

  return {
    crossApp: {
      initialized: true,
      workflowCount: crossAppManager.listWorkflows().length,
    },
    multiVM: {
      initialized: true,
      vmCount: multiVMManager.listVMs().length,
      clusterCount: multiVMManager.listClusters().length,
    },
  };
}

/**
 * Shutdown all workflow components
 */
export async function shutdownWorkflows(): Promise<void> {
  try {
    const multiVMManager = getMultiVMManager();
    await multiVMManager.shutdown();

    logger.info('Workflows shutdown');
  } catch (error) {
    logger.error('Error during workflow shutdown', { error });
  }
}
