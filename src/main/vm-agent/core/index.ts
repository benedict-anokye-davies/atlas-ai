/**
 * Atlas Desktop - VM Agent Core Module
 *
 * Exports all core infrastructure components for the VM agent.
 *
 * @module vm-agent/core
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Event types
  VMAgentEventType,
  VMAgentEvent,
  EventSubscription,
  EventFilter,

  // State types
  VMAgentState,
  StateMachineContext,
  StateTransitionResult,

  // Context types
  TaskContext,
  ActionContext,
  ErrorContext,
  RecoveryContext,
  RecoveryStrategy,

  // Checkpoint types
  Checkpoint,
  CheckpointType,
  CheckpointMetadata,
  SerializedScreenState,
  RollbackResult,

  // VLM types
  VLMAnalysisRequest,
  VLMAnalysisResult,
  VLMStructuredResponse,

  // Element types
  EnhancedUIElement,
  ElementSelector,
  ElementSignature,
  SelectorStrategy,
  SelectorMatchResult,
  ElementHealing,

  // Workflow types
  CrossAppWorkflow,
  WorkflowStep,
  ApplicationContext,
  ApplicationPlugin,
  MultiVMTask,
  VMCoordination,

  // Metrics
  AgentMetrics,

  // Config
  EnhancedVMAgentConfig,
  DEFAULT_ENHANCED_CONFIG,
} from './types';

// =============================================================================
// Event Bus
// =============================================================================

export {
  VMAgentEventBus,
  createEvent,
  getEventBus,
  resetEventBus,
} from './event-bus';

// =============================================================================
// State Machine
// =============================================================================

export {
  STATE_MACHINE_CONSTANTS,
  VMAgentStateMachine,
  getStateMachine,
  resetStateMachine,
} from './state-machine';

// =============================================================================
// Checkpoint Manager
// =============================================================================

export {
  CHECKPOINT_CONSTANTS,
  CheckpointManager,
  getCheckpointManager,
  resetCheckpointManager,
} from './checkpoint-manager';

// =============================================================================
// Error Recovery
// =============================================================================

export {
  ERROR_RECOVERY_CONSTANTS,
  ErrorType,
  ErrorClassification,
  RecoveryResult,
  ErrorRecoveryManager,
  getErrorRecoveryManager,
  resetErrorRecoveryManager,
} from './error-recovery';

// =============================================================================
// Action Executor
// =============================================================================

export {
  ACTION_EXECUTOR_CONSTANTS,
  ActionResult,
  VerificationCheck,
  ActionExecutionOptions,
  ActionProgress,
  ActionHandler,
  ActionExecutor,
  getActionExecutor,
  resetActionExecutor,
} from './action-executor';

// =============================================================================
// Initialization Helper
// =============================================================================

import { getEventBus } from './event-bus';
import { getStateMachine } from './state-machine';
import { getCheckpointManager } from './checkpoint-manager';
import { getErrorRecoveryManager } from './error-recovery';
import { getActionExecutor } from './action-executor';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('VMAgentCore');

/**
 * Initialize all core components
 *
 * This should be called once during VM agent startup.
 * It ensures all singletons are created and wired together.
 *
 * @returns Object containing all core component instances
 */
export function initializeCore(): {
  eventBus: ReturnType<typeof getEventBus>;
  stateMachine: ReturnType<typeof getStateMachine>;
  checkpointManager: ReturnType<typeof getCheckpointManager>;
  errorRecovery: ReturnType<typeof getErrorRecoveryManager>;
  actionExecutor: ReturnType<typeof getActionExecutor>;
} {
  logger.info('Initializing VM agent core components');

  const eventBus = getEventBus();
  const stateMachine = getStateMachine();
  const checkpointManager = getCheckpointManager();
  const errorRecovery = getErrorRecoveryManager();
  const actionExecutor = getActionExecutor();

  // Wire up event handlers for cross-component communication
  eventBus.subscribe('error:occurred', async (event) => {
    logger.info('Error occurred, attempting recovery', { data: event.data });
    // Error recovery will handle this
  });

  eventBus.subscribe('checkpoint:created', async (event) => {
    logger.debug('Checkpoint created', { data: event.data });
  });

  eventBus.subscribe('state:changed', async (event) => {
    logger.debug('State changed', { data: event.data });
  });

  logger.info('VM agent core components initialized');

  return {
    eventBus,
    stateMachine,
    checkpointManager,
    errorRecovery,
    actionExecutor,
  };
}

/**
 * Reset all core components (for testing)
 */
export function resetCore(): void {
  logger.info('Resetting VM agent core components');

  // Reset in reverse dependency order
  resetActionExecutor();
  resetErrorRecoveryManager();
  resetCheckpointManager();
  resetStateMachine();
  resetEventBus();

  logger.info('VM agent core components reset');
}

/**
 * Get current status of all core components
 */
export function getCoreStatus(): {
  eventBus: { handlers: number; historySize: number };
  stateMachine: { state: string; hasTask: boolean; hasAction: boolean };
  checkpointManager: { checkpointCount: number };
  errorRecovery: { isRecovering: boolean; historySize: number };
  actionExecutor: { isExecuting: boolean; historySize: number };
} {
  const eventBus = getEventBus();
  const stateMachine = getStateMachine();
  const checkpointManager = getCheckpointManager();
  const errorRecovery = getErrorRecoveryManager();
  const actionExecutor = getActionExecutor();

  const context = stateMachine.getContext();

  return {
    eventBus: {
      handlers: 0, // Would need to expose this from EventBus
      historySize: eventBus.getHistory().length,
    },
    stateMachine: {
      state: stateMachine.currentState,
      hasTask: !!context.currentTask,
      hasAction: !!context.currentAction,
    },
    checkpointManager: {
      checkpointCount: checkpointManager.getAllCheckpoints().length,
    },
    errorRecovery: {
      isRecovering: errorRecovery.isRecoveryInProgress(),
      historySize: errorRecovery.getRecoveryHistory().length,
    },
    actionExecutor: {
      isExecuting: actionExecutor.isActionExecuting(),
      historySize: actionExecutor.getHistory().length,
    },
  };
}
