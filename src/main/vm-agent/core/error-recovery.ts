/**
 * Atlas Desktop - VM Agent Error Recovery System
 *
 * Intelligent error recovery with multiple strategies.
 * Enables automatic recovery from common failures.
 *
 * @module vm-agent/core/error-recovery
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from './event-bus';
import { getStateMachine } from './state-machine';
import { getCheckpointManager } from './checkpoint-manager';
import {
  RecoveryStrategy,
  ErrorContext,
  RecoveryContext,
  VMAgentState,
} from './types';

const logger = createModuleLogger('ErrorRecovery');

// =============================================================================
// Error Recovery Constants
// =============================================================================

export const ERROR_RECOVERY_CONSTANTS = {
  /** Maximum recovery attempts per error */
  MAX_RECOVERY_ATTEMPTS: 3,
  /** Base retry delay (ms) */
  BASE_RETRY_DELAY_MS: 1000,
  /** Maximum retry delay (ms) */
  MAX_RETRY_DELAY_MS: 30000,
  /** Exponential backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
  /** Wait time before retry (ms) */
  WAIT_BEFORE_RETRY_MS: 3000,
} as const;

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Error types for classification
 */
export type ErrorType =
  | 'connection-lost'
  | 'element-not-found'
  | 'timeout'
  | 'unexpected-state'
  | 'action-failed'
  | 'screen-capture-failed'
  | 'vlm-error'
  | 'authentication-required'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'unknown';

/**
 * Error classification result
 */
export interface ErrorClassification {
  type: ErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  suggestedStrategies: RecoveryStrategy[];
  context?: Record<string, unknown>;
}

// =============================================================================
// Recovery Result
// =============================================================================

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  attempts: number;
  durationMs: number;
  error?: string;
  checkpointRestored?: string;
  newState?: VMAgentState;
}

// =============================================================================
// Recovery Strategy Implementation
// =============================================================================

interface RecoveryStrategyImpl {
  name: RecoveryStrategy;
  applicableTo: ErrorType[];
  priority: number;
  execute: (error: ErrorContext, context: RecoveryContext) => Promise<boolean>;
}

// =============================================================================
// Error Recovery Manager
// =============================================================================

/**
 * Manages error recovery for the VM agent
 *
 * Features:
 * - Automatic error classification
 * - Multiple recovery strategies
 * - Checkpoint-based rollback
 * - Exponential backoff
 *
 * @example
 * ```typescript
 * const recovery = getErrorRecoveryManager();
 *
 * // Attempt recovery
 * const result = await recovery.attemptRecovery(errorContext);
 *
 * if (result.success) {
 *   console.log('Recovered using strategy:', result.strategy);
 * }
 * ```
 */
export class ErrorRecoveryManager extends EventEmitter {
  private strategies: RecoveryStrategyImpl[] = [];
  private recoveryHistory: RecoveryResult[] = [];
  private activeRecovery: boolean = false;
  private config: {
    maxAttempts: number;
    baseRetryDelayMs: number;
    maxRetryDelayMs: number;
    backoffMultiplier: number;
    strategiesByErrorType: Record<string, RecoveryStrategy>;
  };

  constructor(
    config: Partial<{
      maxAttempts: number;
      baseRetryDelayMs: number;
      maxRetryDelayMs: number;
      backoffMultiplier: number;
      strategiesByErrorType: Record<string, RecoveryStrategy>;
    }> = {},
  ) {
    super();

    this.config = {
      maxAttempts: config.maxAttempts || ERROR_RECOVERY_CONSTANTS.MAX_RECOVERY_ATTEMPTS,
      baseRetryDelayMs: config.baseRetryDelayMs || ERROR_RECOVERY_CONSTANTS.BASE_RETRY_DELAY_MS,
      maxRetryDelayMs: config.maxRetryDelayMs || ERROR_RECOVERY_CONSTANTS.MAX_RETRY_DELAY_MS,
      backoffMultiplier: config.backoffMultiplier || ERROR_RECOVERY_CONSTANTS.BACKOFF_MULTIPLIER,
      strategiesByErrorType: config.strategiesByErrorType || {
        'element-not-found': 'alternative-path',
        timeout: 'wait-and-retry',
        'connection-lost': 'reconnect',
        'unexpected-state': 'rollback',
        'action-failed': 'retry',
        'screen-capture-failed': 'wait-and-retry',
        'vlm-error': 'retry',
        'authentication-required': 'human-intervention',
        'permission-denied': 'human-intervention',
        'resource-exhausted': 'wait-and-retry',
      },
    };

    this.initializeStrategies();
  }

  /**
   * Classify an error
   */
  classifyError(error: Error | ErrorContext): ErrorClassification {
    const message = error instanceof Error ? error.message : error.message;
    const messageLower = message.toLowerCase();

    // Connection errors
    if (
      messageLower.includes('connection') ||
      messageLower.includes('disconnect') ||
      messageLower.includes('socket')
    ) {
      return {
        type: 'connection-lost',
        severity: 'high',
        recoverable: true,
        suggestedStrategies: ['reconnect', 'wait-and-retry'],
      };
    }

    // Element not found
    if (
      messageLower.includes('element not found') ||
      messageLower.includes('no element') ||
      messageLower.includes('selector')
    ) {
      return {
        type: 'element-not-found',
        severity: 'medium',
        recoverable: true,
        suggestedStrategies: ['alternative-path', 'retry', 'rollback'],
      };
    }

    // Timeout
    if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
      return {
        type: 'timeout',
        severity: 'medium',
        recoverable: true,
        suggestedStrategies: ['wait-and-retry', 'retry'],
      };
    }

    // Unexpected state
    if (
      messageLower.includes('unexpected') ||
      messageLower.includes('invalid state') ||
      messageLower.includes('wrong screen')
    ) {
      return {
        type: 'unexpected-state',
        severity: 'medium',
        recoverable: true,
        suggestedStrategies: ['rollback', 'checkpoint-restore', 'restart-task'],
      };
    }

    // Authentication
    if (messageLower.includes('auth') || messageLower.includes('login') || messageLower.includes('credential')) {
      return {
        type: 'authentication-required',
        severity: 'high',
        recoverable: false,
        suggestedStrategies: ['human-intervention'],
      };
    }

    // Permission
    if (messageLower.includes('permission') || messageLower.includes('access denied')) {
      return {
        type: 'permission-denied',
        severity: 'high',
        recoverable: false,
        suggestedStrategies: ['human-intervention'],
      };
    }

    // VLM errors
    if (messageLower.includes('vlm') || messageLower.includes('vision') || messageLower.includes('model')) {
      return {
        type: 'vlm-error',
        severity: 'medium',
        recoverable: true,
        suggestedStrategies: ['retry', 'wait-and-retry'],
      };
    }

    // Screen capture
    if (messageLower.includes('screen') || messageLower.includes('capture') || messageLower.includes('screenshot')) {
      return {
        type: 'screen-capture-failed',
        severity: 'medium',
        recoverable: true,
        suggestedStrategies: ['wait-and-retry', 'reconnect'],
      };
    }

    // Resource exhausted
    if (
      messageLower.includes('memory') ||
      messageLower.includes('resource') ||
      messageLower.includes('quota')
    ) {
      return {
        type: 'resource-exhausted',
        severity: 'high',
        recoverable: true,
        suggestedStrategies: ['wait-and-retry'],
      };
    }

    // Unknown
    return {
      type: 'unknown',
      severity: 'medium',
      recoverable: true,
      suggestedStrategies: ['retry', 'rollback'],
    };
  }

  /**
   * Attempt automatic recovery
   */
  async attemptRecovery(
    errorContext: ErrorContext,
    preferredStrategy?: RecoveryStrategy,
  ): Promise<RecoveryResult> {
    if (this.activeRecovery) {
      return {
        success: false,
        strategy: 'retry',
        attempts: 0,
        durationMs: 0,
        error: 'Recovery already in progress',
      };
    }

    this.activeRecovery = true;
    const startTime = Date.now();

    try {
      const stateMachine = getStateMachine();
      const classification = this.classifyError(errorContext);

      logger.info('Starting error recovery', {
        errorType: classification.type,
        severity: classification.severity,
        recoverable: classification.recoverable,
      });

      // Emit recovery started
      this.emit('recovery-started', { errorContext, classification });
      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent(
          'error:recovery-started',
          { errorContext, classification },
          'error-recovery',
          { priority: 'high' },
        ),
      );

      // Enter recovery state
      await stateMachine.startRecovery(
        preferredStrategy || classification.suggestedStrategies[0],
        stateMachine.getContext().lastCheckpointId,
      );

      // Get strategy to use
      const strategy = preferredStrategy || this.getStrategyForError(classification.type);
      let attempts = 0;
      let success = false;
      let lastError: string | undefined;

      while (attempts < this.config.maxAttempts && !success) {
        attempts++;

        try {
          logger.info('Recovery attempt', { attempt: attempts, strategy });

          success = await this.executeStrategy(strategy, errorContext);

          if (success) {
            logger.info('Recovery successful', { strategy, attempts });
          } else {
            // Apply exponential backoff
            const delay = Math.min(
              this.config.baseRetryDelayMs * Math.pow(this.config.backoffMultiplier, attempts - 1),
              this.config.maxRetryDelayMs,
            );
            logger.info('Recovery attempt failed, waiting', { delay });
            await this.sleep(delay);
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.warn('Recovery attempt error', { attempt: attempts, error: lastError });
        }

        stateMachine.updateRecoveryProgress(attempts);
      }

      // Complete recovery
      await stateMachine.completeRecovery(success);

      const result: RecoveryResult = {
        success,
        strategy,
        attempts,
        durationMs: Date.now() - startTime,
        error: success ? undefined : lastError || 'Max attempts exceeded',
        newState: stateMachine.currentState,
      };

      this.recoveryHistory.push(result);
      this.emit('recovery-completed', result);
      eventBus.emitSync(
        createEvent('error:recovery-completed', result, 'error-recovery', {
          priority: 'high',
        }),
      );

      return result;
    } finally {
      this.activeRecovery = false;
    }
  }

  /**
   * Execute a specific recovery strategy
   */
  async executeStrategy(strategy: RecoveryStrategy, errorContext: ErrorContext): Promise<boolean> {
    const impl = this.strategies.find((s) => s.name === strategy);
    if (!impl) {
      logger.warn('Unknown recovery strategy', { strategy });
      return false;
    }

    const stateMachine = getStateMachine();
    const recoveryContext = stateMachine.getContext().recoveryContext;

    if (!recoveryContext) {
      return false;
    }

    return impl.execute(errorContext, recoveryContext);
  }

  /**
   * Get best strategy for error type
   */
  getStrategyForError(errorType: ErrorType): RecoveryStrategy {
    return (
      (this.config.strategiesByErrorType[errorType] as RecoveryStrategy) || 'retry'
    );
  }

  /**
   * Check if recovery is in progress
   */
  isRecoveryInProgress(): boolean {
    return this.activeRecovery;
  }

  /**
   * Get recovery history
   */
  getRecoveryHistory(limit?: number): RecoveryResult[] {
    if (limit) {
      return this.recoveryHistory.slice(-limit);
    }
    return [...this.recoveryHistory];
  }

  /**
   * Get recovery statistics
   */
  getStats(): {
    totalRecoveries: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    successRate: number;
    byStrategy: Record<RecoveryStrategy, { total: number; successful: number }>;
    avgDurationMs: number;
  } {
    const byStrategy: Record<string, { total: number; successful: number }> = {};
    let totalDuration = 0;

    for (const result of this.recoveryHistory) {
      if (!byStrategy[result.strategy]) {
        byStrategy[result.strategy] = { total: 0, successful: 0 };
      }
      byStrategy[result.strategy].total++;
      if (result.success) {
        byStrategy[result.strategy].successful++;
      }
      totalDuration += result.durationMs;
    }

    const successful = this.recoveryHistory.filter((r) => r.success).length;

    return {
      totalRecoveries: this.recoveryHistory.length,
      successfulRecoveries: successful,
      failedRecoveries: this.recoveryHistory.length - successful,
      successRate: this.recoveryHistory.length > 0 ? successful / this.recoveryHistory.length : 0,
      byStrategy: byStrategy as Record<RecoveryStrategy, { total: number; successful: number }>,
      avgDurationMs:
        this.recoveryHistory.length > 0 ? totalDuration / this.recoveryHistory.length : 0,
    };
  }

  /**
   * Clear recovery history
   */
  clearHistory(): void {
    this.recoveryHistory = [];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private initializeStrategies(): void {
    // Retry strategy
    this.strategies.push({
      name: 'retry',
      applicableTo: ['action-failed', 'vlm-error', 'unknown'],
      priority: 1,
      execute: async () => {
        // Simple retry just returns true to allow the operation to be retried
        logger.info('Executing retry strategy');
        return true;
      },
    });

    // Wait and retry strategy
    this.strategies.push({
      name: 'wait-and-retry',
      applicableTo: ['timeout', 'screen-capture-failed', 'resource-exhausted'],
      priority: 2,
      execute: async () => {
        logger.info('Executing wait-and-retry strategy');
        await this.sleep(ERROR_RECOVERY_CONSTANTS.WAIT_BEFORE_RETRY_MS);
        return true;
      },
    });

    // Reconnect strategy
    this.strategies.push({
      name: 'reconnect',
      applicableTo: ['connection-lost'],
      priority: 3,
      execute: async () => {
        logger.info('Executing reconnect strategy');
        // This would trigger reconnection through the connector
        // For now, we'll signal success to allow retry
        return true;
      },
    });

    // Rollback strategy
    this.strategies.push({
      name: 'rollback',
      applicableTo: ['unexpected-state'],
      priority: 4,
      execute: async () => {
        logger.info('Executing rollback strategy');
        const checkpointManager = getCheckpointManager();
        const result = await checkpointManager.rollbackToLatest();
        return result.success;
      },
    });

    // Checkpoint restore strategy
    this.strategies.push({
      name: 'checkpoint-restore',
      applicableTo: ['unexpected-state', 'action-failed'],
      priority: 5,
      execute: async (error, context) => {
        logger.info('Executing checkpoint-restore strategy');
        if (context.checkpointId) {
          const checkpointManager = getCheckpointManager();
          const result = await checkpointManager.rollbackToCheckpoint(context.checkpointId);
          return result.success;
        }
        return false;
      },
    });

    // Alternative path strategy
    this.strategies.push({
      name: 'alternative-path',
      applicableTo: ['element-not-found'],
      priority: 3,
      execute: async () => {
        logger.info('Executing alternative-path strategy');
        // This would trigger re-planning with alternative approach
        // Signals success to allow re-planning
        return true;
      },
    });

    // Restart task strategy
    this.strategies.push({
      name: 'restart-task',
      applicableTo: ['unexpected-state'],
      priority: 6,
      execute: async () => {
        logger.info('Executing restart-task strategy');
        const stateMachine = getStateMachine();
        const taskContext = stateMachine.getContext().currentTask;

        if (taskContext) {
          // Reset task progress but keep the task
          stateMachine.setTaskContext({
            ...taskContext,
            currentStep: 0,
            stepsCompleted: 0,
            stepsFailed: 0,
            startedAt: Date.now(),
          });
          return true;
        }
        return false;
      },
    });

    // Human intervention strategy (always succeeds to signal pause)
    this.strategies.push({
      name: 'human-intervention',
      applicableTo: ['authentication-required', 'permission-denied'],
      priority: 10,
      execute: async () => {
        logger.info('Executing human-intervention strategy - pausing for user');
        const stateMachine = getStateMachine();
        await stateMachine.transition('paused', {
          event: 'awaiting-human-intervention',
          force: true,
        });
        return false; // Return false since automation can't continue
      },
    });

    // Sort by priority
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let errorRecoveryInstance: ErrorRecoveryManager | null = null;

/**
 * Get the singleton error recovery manager instance
 */
export function getErrorRecoveryManager(): ErrorRecoveryManager {
  if (!errorRecoveryInstance) {
    errorRecoveryInstance = new ErrorRecoveryManager();
  }
  return errorRecoveryInstance;
}

/**
 * Reset the error recovery manager (for testing)
 */
export function resetErrorRecoveryManager(): void {
  if (errorRecoveryInstance) {
    errorRecoveryInstance = null;
  }
}
