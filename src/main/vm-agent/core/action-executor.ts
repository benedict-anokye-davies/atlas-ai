/**
 * Atlas Desktop - VM Agent Action Executor
 *
 * Executes VM actions with retries, timing, and verification.
 * Provides robust action execution with feedback loops.
 *
 * @module vm-agent/core/action-executor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from './event-bus';
import { getStateMachine } from './state-machine';
import { getCheckpointManager } from './checkpoint-manager';
import { getErrorRecoveryManager } from './error-recovery';
import { VMAction, ScreenState } from '../types';
import { ActionContext, EnhancedVMAgentConfig, DEFAULT_ENHANCED_CONFIG } from './types';

const logger = createModuleLogger('ActionExecutor');

// =============================================================================
// Action Executor Constants
// =============================================================================

export const ACTION_EXECUTOR_CONSTANTS = {
  /** Default action timeout (ms) */
  DEFAULT_TIMEOUT_MS: 30000,
  /** Default retry count */
  DEFAULT_RETRY_COUNT: 2,
  /** Delay between retries (ms) */
  RETRY_DELAY_MS: 500,
  /** Post-action verification delay (ms) */
  VERIFICATION_DELAY_MS: 200,
  /** Human-like action delay range (ms) */
  HUMAN_DELAY_MIN_MS: 50,
  HUMAN_DELAY_MAX_MS: 200,
  /** Typing delay per character (ms) */
  TYPING_DELAY_MS: 30,
} as const;

// =============================================================================
// Action Result Types
// =============================================================================

export interface ActionResult {
  success: boolean;
  action: VMAction;
  startTime: number;
  endTime: number;
  durationMs: number;
  attempts: number;
  error?: string;
  beforeState?: ScreenState;
  afterState?: ScreenState;
  stateChanged: boolean;
  verification?: {
    passed: boolean;
    checks: VerificationCheck[];
  };
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}

export interface ActionExecutionOptions {
  timeout?: number;
  retries?: number;
  humanLike?: boolean;
  captureScreenBefore?: boolean;
  captureScreenAfter?: boolean;
  verifyStateChange?: boolean;
  createCheckpoint?: boolean;
  onProgress?: (progress: ActionProgress) => void;
}

export interface ActionProgress {
  phase: 'preparing' | 'executing' | 'verifying' | 'completed' | 'failed';
  attempt: number;
  maxAttempts: number;
  message?: string;
}

// =============================================================================
// Action Handler Interface
// =============================================================================

/**
 * Interface for action handlers that execute specific action types
 */
export interface ActionHandler {
  actionType: VMAction['type'];
  execute: (
    action: VMAction,
    options: ActionExecutionOptions,
  ) => Promise<{ success: boolean; error?: string }>;
  estimateDuration?: (action: VMAction) => number;
}

// =============================================================================
// Action Executor Class
// =============================================================================

/**
 * Executes VM actions with retries, timing, and verification
 *
 * @example
 * ```typescript
 * const executor = getActionExecutor();
 *
 * // Execute a click action
 * const result = await executor.execute(
 *   { type: 'click', x: 100, y: 200 },
 *   { humanLike: true, verifyStateChange: true }
 * );
 *
 * if (result.success) {
 *   console.log('Click executed in', result.durationMs, 'ms');
 * }
 * ```
 */
export class ActionExecutor extends EventEmitter {
  private handlers: Map<string, ActionHandler> = new Map();
  private executionHistory: ActionResult[] = [];
  private isExecuting: boolean = false;
  private currentAction: VMAction | null = null;
  private config: EnhancedVMAgentConfig;
  private screenCaptureCallback?: () => Promise<ScreenState>;

  constructor(config?: Partial<EnhancedVMAgentConfig>) {
    super();
    this.config = { ...DEFAULT_ENHANCED_CONFIG, ...config };
    this.registerDefaultHandlers();
  }

  /**
   * Set the screen capture callback for verification
   */
  setScreenCaptureCallback(callback: () => Promise<ScreenState>): void {
    this.screenCaptureCallback = callback;
  }

  /**
   * Register a custom action handler
   */
  registerHandler(handler: ActionHandler): void {
    this.handlers.set(handler.actionType, handler);
    logger.debug('Registered action handler', { actionType: handler.actionType });
  }

  /**
   * Execute an action with options
   */
  async execute(
    action: VMAction,
    options: ActionExecutionOptions = {},
  ): Promise<ActionResult> {
    const startTime = Date.now();
    const opts: Required<ActionExecutionOptions> = {
      timeout: options.timeout ?? ACTION_EXECUTOR_CONSTANTS.DEFAULT_TIMEOUT_MS,
      retries: options.retries ?? ACTION_EXECUTOR_CONSTANTS.DEFAULT_RETRY_COUNT,
      humanLike: options.humanLike ?? this.config.execution.humanLikeActions,
      captureScreenBefore: options.captureScreenBefore ?? true,
      captureScreenAfter: options.captureScreenAfter ?? true,
      verifyStateChange: options.verifyStateChange ?? true,
      createCheckpoint: options.createCheckpoint ?? false,
      onProgress: options.onProgress ?? (() => {}),
    };

    const stateMachine = getStateMachine();
    const eventBus = getEventBus();
    const checkpointManager = getCheckpointManager();

    this.isExecuting = true;
    this.currentAction = action;

    // Create action context
    const actionContext: ActionContext = {
      action,
      startedAt: startTime,
      attempt: 0,
      maxAttempts: opts.retries + 1,
      timeout: opts.timeout,
    };

    // Update state machine
    stateMachine.setActionContext(actionContext);

    // Emit action started
    eventBus.emitSync(
      createEvent('action:started', { action, options: opts }, 'action-executor', {
        priority: 'normal',
      }),
    );

    let beforeState: ScreenState | undefined;
    let afterState: ScreenState | undefined;
    let result: ActionResult;

    try {
      // Create checkpoint if requested
      if (opts.createCheckpoint) {
        await checkpointManager.createCheckpoint('pre-action', 'Before action execution');
      }

      // Capture before state
      if (opts.captureScreenBefore && this.screenCaptureCallback) {
        opts.onProgress({
          phase: 'preparing',
          attempt: 0,
          maxAttempts: opts.retries + 1,
          message: 'Capturing screen state',
        });
        try {
          beforeState = await this.screenCaptureCallback();
        } catch (error) {
          logger.warn('Failed to capture before state', { error });
        }
      }

      // Execute with retries
      let success = false;
      let lastError: string | undefined;
      let attempts = 0;

      while (attempts <= opts.retries && !success) {
        attempts++;
        actionContext.attempt = attempts;
        stateMachine.setActionContext(actionContext);

        opts.onProgress({
          phase: 'executing',
          attempt: attempts,
          maxAttempts: opts.retries + 1,
          message: `Attempt ${attempts} of ${opts.retries + 1}`,
        });

        try {
          // Add human-like delay if enabled
          if (opts.humanLike && attempts === 1) {
            await this.humanDelay();
          }

          // Execute with timeout
          const execResult = await this.executeWithTimeout(action, opts);
          success = execResult.success;
          lastError = execResult.error;

          if (!success && attempts <= opts.retries) {
            // Wait before retry
            await this.sleep(ACTION_EXECUTOR_CONSTANTS.RETRY_DELAY_MS);
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.warn('Action execution error', { attempt: attempts, error: lastError });
        }
      }

      // Capture after state
      if (opts.captureScreenAfter && this.screenCaptureCallback) {
        opts.onProgress({
          phase: 'verifying',
          attempt: attempts,
          maxAttempts: opts.retries + 1,
          message: 'Verifying action result',
        });

        // Small delay before capturing
        await this.sleep(ACTION_EXECUTOR_CONSTANTS.VERIFICATION_DELAY_MS);

        try {
          afterState = await this.screenCaptureCallback();
        } catch (error) {
          logger.warn('Failed to capture after state', { error });
        }
      }

      // Determine if state changed
      const stateChanged = this.detectStateChange(beforeState, afterState);

      // Build verification result
      let verification: ActionResult['verification'];
      if (opts.verifyStateChange && beforeState && afterState) {
        const checks = this.performVerificationChecks(action, beforeState, afterState);
        verification = {
          passed: checks.every((c) => c.passed) || stateChanged,
          checks,
        };
      }

      const endTime = Date.now();

      result = {
        success,
        action,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        attempts,
        error: success ? undefined : lastError,
        beforeState,
        afterState,
        stateChanged,
        verification,
      };

      // Emit events
      if (success) {
        eventBus.emitSync(
          createEvent('action:completed', result, 'action-executor', { priority: 'normal' }),
        );
        opts.onProgress({
          phase: 'completed',
          attempt: attempts,
          maxAttempts: opts.retries + 1,
        });
      } else {
        eventBus.emitSync(
          createEvent('action:failed', result, 'action-executor', { priority: 'high' }),
        );
        opts.onProgress({
          phase: 'failed',
          attempt: attempts,
          maxAttempts: opts.retries + 1,
          message: lastError,
        });
      }
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);

      result = {
        success: false,
        action,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        attempts: 1,
        error: errorMessage,
        beforeState,
        afterState,
        stateChanged: false,
      };

      eventBus.emitSync(
        createEvent('action:failed', result, 'action-executor', { priority: 'high' }),
      );
    } finally {
      this.isExecuting = false;
      this.currentAction = null;
      stateMachine.clearActionContext();
    }

    this.executionHistory.push(result);
    this.emit('action-executed', result);

    return result;
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeSequence(
    actions: VMAction[],
    options: ActionExecutionOptions = {},
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (let i = 0; i < actions.length; i++) {
      const result = await this.execute(actions[i], {
        ...options,
        onProgress: (progress) => {
          options.onProgress?.({
            ...progress,
            message: `Action ${i + 1}/${actions.length}: ${progress.message || ''}`,
          });
        },
      });

      results.push(result);

      // Stop on failure unless configured otherwise
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Cancel current action execution
   */
  cancel(): void {
    if (this.isExecuting) {
      this.isExecuting = false;
      this.currentAction = null;
      logger.info('Action execution cancelled');
    }
  }

  /**
   * Get execution history
   */
  getHistory(limit?: number): ActionResult[] {
    if (limit) {
      return this.executionHistory.slice(-limit);
    }
    return [...this.executionHistory];
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    avgDurationMs: number;
    avgAttempts: number;
    byActionType: Record<string, { total: number; successful: number; avgDurationMs: number }>;
  } {
    const byType: Record<string, { total: number; successful: number; totalDuration: number }> = {};
    let totalDuration = 0;
    let totalAttempts = 0;

    for (const result of this.executionHistory) {
      const type = result.action.type;
      if (!byType[type]) {
        byType[type] = { total: 0, successful: 0, totalDuration: 0 };
      }
      byType[type].total++;
      byType[type].totalDuration += result.durationMs;
      if (result.success) {
        byType[type].successful++;
      }
      totalDuration += result.durationMs;
      totalAttempts += result.attempts;
    }

    const successful = this.executionHistory.filter((r) => r.success).length;

    // Transform byType to include avgDurationMs
    const byActionType: Record<string, { total: number; successful: number; avgDurationMs: number }> = {};
    for (const [type, stats] of Object.entries(byType)) {
      byActionType[type] = {
        total: stats.total,
        successful: stats.successful,
        avgDurationMs: stats.total > 0 ? stats.totalDuration / stats.total : 0,
      };
    }

    return {
      totalExecutions: this.executionHistory.length,
      successfulExecutions: successful,
      failedExecutions: this.executionHistory.length - successful,
      successRate:
        this.executionHistory.length > 0 ? successful / this.executionHistory.length : 0,
      avgDurationMs:
        this.executionHistory.length > 0 ? totalDuration / this.executionHistory.length : 0,
      avgAttempts:
        this.executionHistory.length > 0 ? totalAttempts / this.executionHistory.length : 0,
      byActionType,
    };
  }

  /**
   * Check if an action is currently executing
   */
  isActionExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Get current action being executed
   */
  getCurrentAction(): VMAction | null {
    return this.currentAction;
  }

  /**
   * Clear execution history
   */
  clearHistory(): void {
    this.executionHistory = [];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private registerDefaultHandlers(): void {
    // Click handler
    this.registerHandler({
      actionType: 'click',
      execute: async (action) => {
        // Placeholder - actual execution goes through VM connector
        logger.debug('Click handler invoked', { x: (action as { x: number }).x, y: (action as { y: number }).y });
        return { success: true };
      },
      estimateDuration: () => 100,
    });

    // Double-click handler
    this.registerHandler({
      actionType: 'doubleClick',
      execute: async (action) => {
        logger.debug('Double-click handler invoked', { x: (action as { x: number }).x, y: (action as { y: number }).y });
        return { success: true };
      },
      estimateDuration: () => 200,
    });

    // Type handler
    this.registerHandler({
      actionType: 'type',
      execute: async (action) => {
        const text = (action as { text: string }).text;
        logger.debug('Type handler invoked', { textLength: text.length });
        return { success: true };
      },
      estimateDuration: (action) => {
        const text = (action as { text: string }).text;
        return text.length * ACTION_EXECUTOR_CONSTANTS.TYPING_DELAY_MS;
      },
    });

    // Key press handler
    this.registerHandler({
      actionType: 'keyPress',
      execute: async (action) => {
        logger.debug('Key press handler invoked', { key: (action as { key: string }).key });
        return { success: true };
      },
      estimateDuration: () => 50,
    });

    // Hotkey handler
    this.registerHandler({
      actionType: 'hotkey',
      execute: async (action) => {
        logger.debug('Hotkey handler invoked', { keys: (action as { keys: string[] }).keys });
        return { success: true };
      },
      estimateDuration: () => 100,
    });

    // Scroll handler
    this.registerHandler({
      actionType: 'scroll',
      execute: async (action) => {
        logger.debug('Scroll handler invoked', action);
        return { success: true };
      },
      estimateDuration: () => 200,
    });

    // Drag handler
    this.registerHandler({
      actionType: 'drag',
      execute: async (action) => {
        logger.debug('Drag handler invoked', action);
        return { success: true };
      },
      estimateDuration: () => 300,
    });

    // Wait handler
    this.registerHandler({
      actionType: 'wait',
      execute: async (action) => {
        const ms = (action as { ms: number }).ms;
        logger.debug('Wait handler invoked', { ms });
        await this.sleep(ms);
        return { success: true };
      },
      estimateDuration: (action) => (action as { ms: number }).ms,
    });
  }

  private async executeWithTimeout(
    action: VMAction,
    options: Required<ActionExecutionOptions>,
  ): Promise<{ success: boolean; error?: string }> {
    const handler = this.handlers.get(action.type);
    if (!handler) {
      return { success: false, error: `No handler for action type: ${action.type}` };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Action timed out' });
      }, options.timeout);

      handler
        .execute(action, options)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }

  private detectStateChange(before?: ScreenState, after?: ScreenState): boolean {
    if (!before || !after) {
      return false;
    }

    // Compare URLs/titles if available
    if (before.url !== after.url) {
      return true;
    }

    // Compare element counts
    if (before.elements.length !== after.elements.length) {
      return true;
    }

    // Compare text content (simplified)
    const beforeText = before.text.slice(0, 1000);
    const afterText = after.text.slice(0, 1000);
    if (beforeText !== afterText) {
      return true;
    }

    return false;
  }

  private performVerificationChecks(
    action: VMAction,
    before: ScreenState,
    after: ScreenState,
  ): VerificationCheck[] {
    const checks: VerificationCheck[] = [];

    // Screen capture check
    checks.push({
      name: 'screen-captured',
      passed: !!after.screenshot,
      message: after.screenshot ? 'Screen captured successfully' : 'No screen capture',
    });

    // State change check for actions that should cause change
    const shouldCauseChange = ['click', 'type', 'scroll', 'drag'].includes(action.type);
    if (shouldCauseChange) {
      const changed = this.detectStateChange(before, after);
      checks.push({
        name: 'state-changed',
        passed: changed,
        message: changed ? 'Screen state changed' : 'No state change detected',
      });
    }

    // Element count check
    checks.push({
      name: 'elements-detected',
      passed: after.elements.length > 0,
      expected: '>0',
      actual: after.elements.length,
      message: `Detected ${after.elements.length} elements`,
    });

    return checks;
  }

  private async humanDelay(): Promise<void> {
    const delay =
      ACTION_EXECUTOR_CONSTANTS.HUMAN_DELAY_MIN_MS +
      Math.random() *
        (ACTION_EXECUTOR_CONSTANTS.HUMAN_DELAY_MAX_MS -
          ACTION_EXECUTOR_CONSTANTS.HUMAN_DELAY_MIN_MS);
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let actionExecutorInstance: ActionExecutor | null = null;

/**
 * Get the singleton action executor instance
 */
export function getActionExecutor(): ActionExecutor {
  if (!actionExecutorInstance) {
    actionExecutorInstance = new ActionExecutor();
  }
  return actionExecutorInstance;
}

/**
 * Reset the action executor (for testing)
 */
export function resetActionExecutor(): void {
  if (actionExecutorInstance) {
    actionExecutorInstance.cancel();
    actionExecutorInstance = null;
  }
}
