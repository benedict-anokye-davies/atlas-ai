/**
 * Atlas Desktop - VM Agent State Machine
 *
 * Manages the VM agent's state transitions with validation,
 * history tracking, and timeout management.
 *
 * @module vm-agent/core/state-machine
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from './event-bus';
import {
  VMAgentState,
  StateMachineContext,
  StateTransition,
  TaskContext,
  ActionContext,
  ErrorContext,
  RecoveryContext,
  RecoveryStrategy,
} from './types';

const logger = createModuleLogger('VMStateMachine');

// =============================================================================
// State Machine Constants
// =============================================================================

export const STATE_MACHINE_CONSTANTS = {
  /** Maximum state history entries */
  MAX_HISTORY_SIZE: 100,
  /** Default state timeout (ms) */
  DEFAULT_TIMEOUT_MS: 60000,
} as const;

// =============================================================================
// Valid State Transitions
// =============================================================================

/**
 * Map of valid state transitions
 * Key: from state, Value: array of valid to states
 */
const VALID_TRANSITIONS: Record<VMAgentState, VMAgentState[]> = {
  idle: ['connecting', 'learning', 'error'],
  connecting: ['connected', 'error', 'idle'],
  connected: ['capturing', 'idle', 'planning', 'learning', 'error', 'disconnected'],
  capturing: ['analyzing', 'connected', 'error'],
  analyzing: ['planning', 'connected', 'waiting', 'error'],
  planning: ['executing', 'connected', 'error', 'paused'],
  executing: ['waiting', 'connected', 'error', 'paused', 'recovering'],
  waiting: ['capturing', 'executing', 'connected', 'error', 'paused'],
  learning: ['idle', 'connected', 'error'],
  recovering: ['connected', 'executing', 'idle', 'error'],
  paused: ['executing', 'planning', 'connected', 'idle', 'error'],
  error: ['idle', 'recovering', 'disconnected'],
  disconnected: ['connecting', 'idle'],
};

// =============================================================================
// State Machine Error
// =============================================================================

export class StateMachineError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_TRANSITION' | 'TIMEOUT' | 'CONTEXT_ERROR',
    public readonly fromState: VMAgentState,
    public readonly toState: VMAgentState,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'StateMachineError';
  }
}

// =============================================================================
// State Machine Implementation
// =============================================================================

/**
 * VM Agent State Machine
 *
 * Manages the agent's state with:
 * - Validated state transitions
 * - Context tracking
 * - Timeout management
 * - History logging
 *
 * @example
 * ```typescript
 * const sm = getStateMachine();
 *
 * // Transition state
 * await sm.transition('connecting', { event: 'connect-requested' });
 *
 * // Check current state
 * if (sm.isState('connected')) {
 *   // ...
 * }
 *
 * // Set task context
 * sm.setTaskContext({ taskId: '123', goal: 'Open notepad' });
 * ```
 */
export class VMAgentStateMachine extends EventEmitter {
  private context: StateMachineContext;
  private stateTimeouts: Map<VMAgentState, number> = new Map();
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private config: {
    maxHistorySize: number;
    stateTimeouts: Partial<Record<VMAgentState, number>>;
  };

  constructor(
    config: Partial<{
      maxHistorySize: number;
      stateTimeouts: Partial<Record<VMAgentState, number>>;
    }> = {},
  ) {
    super();

    this.config = {
      maxHistorySize: config.maxHistorySize || STATE_MACHINE_CONSTANTS.MAX_HISTORY_SIZE,
      stateTimeouts: config.stateTimeouts || {},
    };

    // Initialize context
    this.context = {
      currentState: 'idle',
      history: [],
      stateEnteredAt: Date.now(),
      timeInState: 0,
    };

    // Set up default timeouts
    this.stateTimeouts.set('executing', this.config.stateTimeouts.executing || 60000);
    this.stateTimeouts.set('waiting', this.config.stateTimeouts.waiting || 30000);
    this.stateTimeouts.set('recovering', this.config.stateTimeouts.recovering || 120000);
    this.stateTimeouts.set('connecting', this.config.stateTimeouts.connecting || 30000);
    this.stateTimeouts.set('analyzing', this.config.stateTimeouts.analyzing || 45000);
  }

  /**
   * Get current state
   */
  get currentState(): VMAgentState {
    return this.context.currentState;
  }

  /**
   * Get previous state
   */
  get previousState(): VMAgentState | undefined {
    return this.context.previousState;
  }

  /**
   * Get full context
   */
  getContext(): Readonly<StateMachineContext> {
    // Update time in state
    this.context.timeInState = Date.now() - this.context.stateEnteredAt;
    return { ...this.context };
  }

  /**
   * Check if in a specific state
   */
  isState(state: VMAgentState): boolean {
    return this.context.currentState === state;
  }

  /**
   * Check if in any of the given states
   */
  isAnyState(...states: VMAgentState[]): boolean {
    return states.includes(this.context.currentState);
  }

  /**
   * Check if transition is valid
   */
  canTransition(toState: VMAgentState): boolean {
    return VALID_TRANSITIONS[this.context.currentState]?.includes(toState) || false;
  }

  /**
   * Get valid transitions from current state
   */
  getValidTransitions(): VMAgentState[] {
    return VALID_TRANSITIONS[this.context.currentState] || [];
  }

  /**
   * Transition to a new state
   */
  async transition(
    toState: VMAgentState,
    options: {
      event?: string;
      context?: Record<string, unknown>;
      force?: boolean;
    } = {},
  ): Promise<void> {
    const fromState = this.context.currentState;

    // Validate transition
    if (!options.force && !this.canTransition(toState)) {
      throw new StateMachineError(
        `Invalid transition from ${fromState} to ${toState}`,
        'INVALID_TRANSITION',
        fromState,
        toState,
      );
    }

    // Clear any pending timeout
    this.clearTimeout();

    // Create transition record
    const transition: StateTransition = {
      from: fromState,
      to: toState,
      event: options.event || 'transition',
      timestamp: Date.now(),
      context: options.context,
    };

    // Update context
    this.context.previousState = fromState;
    this.context.currentState = toState;
    this.context.stateEnteredAt = Date.now();
    this.context.timeInState = 0;

    // Add to history
    this.context.history.push(transition);
    if (this.context.history.length > this.config.maxHistorySize) {
      this.context.history = this.context.history.slice(-this.config.maxHistorySize);
    }

    // Set up timeout for new state if applicable
    this.setupTimeout(toState);

    // Emit events
    this.emit('transition', transition);
    this.emit(`state:${toState}`, transition);

    // Emit to event bus
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'state:changed',
        { from: fromState, to: toState, transition },
        'state-machine',
        { priority: 'high' },
      ),
    );

    logger.info('State transition', {
      from: fromState,
      to: toState,
      event: options.event,
    });
  }

  /**
   * Set task context
   */
  setTaskContext(taskContext: TaskContext | undefined): void {
    this.context.currentTask = taskContext;
    this.emit('task-context-changed', taskContext);
  }

  /**
   * Set action context
   */
  setActionContext(actionContext: ActionContext | undefined): void {
    this.context.currentAction = actionContext;
    this.emit('action-context-changed', actionContext);
  }

  /**
   * Set error context
   */
  setErrorContext(errorContext: ErrorContext | undefined): void {
    this.context.errorContext = errorContext;
    if (errorContext) {
      this.emit('error-context-set', errorContext);
    }
  }

  /**
   * Set recovery context
   */
  setRecoveryContext(recoveryContext: RecoveryContext | undefined): void {
    this.context.recoveryContext = recoveryContext;
    if (recoveryContext) {
      this.emit('recovery-started', recoveryContext);
    }
  }

  /**
   * Set last checkpoint ID
   */
  setLastCheckpointId(checkpointId: string | undefined): void {
    this.context.lastCheckpointId = checkpointId;
  }

  /**
   * Enter error state
   */
  async enterErrorState(error: Error, recoverable: boolean = true): Promise<void> {
    const errorContext: ErrorContext = {
      code: 'error',
      message: error.message,
      stack: error.stack,
      recoverable,
      recoveryAttempts: 0,
      originalError: error,
      stateWhenOccurred: this.context.currentState,
      timestamp: Date.now(),
    };

    this.setErrorContext(errorContext);
    await this.transition('error', {
      event: 'error-occurred',
      context: { error: error.message, recoverable },
    });

    // Emit to event bus
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        recoverable ? 'error:recoverable' : 'error:fatal',
        errorContext,
        'state-machine',
        { priority: 'critical' },
      ),
    );
  }

  /**
   * Start recovery
   */
  async startRecovery(strategy: RecoveryStrategy, checkpointId?: string): Promise<void> {
    const recoveryContext: RecoveryContext = {
      strategy,
      stepsTaken: 0,
      totalSteps: this.getRecoverySteps(strategy),
      startedAt: Date.now(),
      checkpointId,
      progress: 0,
    };

    this.setRecoveryContext(recoveryContext);
    await this.transition('recovering', {
      event: 'recovery-started',
      context: { strategy, checkpointId },
    });

    // Emit to event bus
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('error:recovery-started', recoveryContext, 'state-machine', {
        priority: 'high',
      }),
    );
  }

  /**
   * Update recovery progress
   */
  updateRecoveryProgress(stepsTaken: number): void {
    if (this.context.recoveryContext) {
      this.context.recoveryContext.stepsTaken = stepsTaken;
      this.context.recoveryContext.progress =
        stepsTaken / this.context.recoveryContext.totalSteps;
      this.emit('recovery-progress', this.context.recoveryContext);
    }
  }

  /**
   * Complete recovery
   */
  async completeRecovery(success: boolean): Promise<void> {
    if (this.context.recoveryContext) {
      const recoveryContext = this.context.recoveryContext;

      // Emit to event bus
      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent(
          'error:recovery-completed',
          { ...recoveryContext, success },
          'state-machine',
          { priority: 'high' },
        ),
      );

      this.setRecoveryContext(undefined);

      if (success) {
        this.setErrorContext(undefined);
        await this.transition('connected', { event: 'recovery-succeeded' });
      } else {
        if (this.context.errorContext) {
          this.context.errorContext.recoveryAttempts++;
        }
        await this.transition('error', { event: 'recovery-failed' });
      }
    }
  }

  /**
   * Reset to idle state
   */
  async reset(): Promise<void> {
    this.clearTimeout();
    this.context = {
      currentState: 'idle',
      history: [],
      stateEnteredAt: Date.now(),
      timeInState: 0,
    };
    this.emit('reset');
    logger.info('State machine reset');
  }

  /**
   * Get state history
   */
  getHistory(limit?: number): StateTransition[] {
    if (limit) {
      return this.context.history.slice(-limit);
    }
    return [...this.context.history];
  }

  /**
   * Get time spent in states
   */
  getStateTimeStats(): Record<VMAgentState, number> {
    const stats: Record<string, number> = {};

    for (let i = 0; i < this.context.history.length; i++) {
      const transition = this.context.history[i];
      const nextTransition = this.context.history[i + 1];

      const duration = nextTransition
        ? nextTransition.timestamp - transition.timestamp
        : Date.now() - transition.timestamp;

      stats[transition.to] = (stats[transition.to] || 0) + duration;
    }

    return stats as Record<VMAgentState, number>;
  }

  /**
   * Dispose of the state machine
   */
  dispose(): void {
    this.clearTimeout();
    this.removeAllListeners();
    logger.info('State machine disposed');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private setupTimeout(state: VMAgentState): void {
    const timeout = this.stateTimeouts.get(state);
    if (timeout) {
      this.timeoutHandle = setTimeout(() => {
        this.handleTimeout(state, timeout);
      }, timeout);
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private handleTimeout(state: VMAgentState, timeout: number): void {
    if (this.context.currentState === state) {
      logger.warn('State timeout', { state, timeout });
      this.emit('timeout', { state, timeout });

      // Emit to event bus
      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent(
          'error:recoverable',
          { code: 'TIMEOUT', state, timeout },
          'state-machine',
          { priority: 'high' },
        ),
      );
    }
  }

  private getRecoverySteps(strategy: RecoveryStrategy): number {
    switch (strategy) {
      case 'retry':
        return 1;
      case 'wait-and-retry':
        return 2;
      case 'alternative-path':
        return 3;
      case 'rollback':
        return 2;
      case 'checkpoint-restore':
        return 3;
      case 'reconnect':
        return 2;
      case 'restart-task':
        return 4;
      case 'human-intervention':
        return 1;
      default:
        return 1;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let stateMachineInstance: VMAgentStateMachine | null = null;

/**
 * Get the singleton state machine instance
 */
export function getStateMachine(): VMAgentStateMachine {
  if (!stateMachineInstance) {
    stateMachineInstance = new VMAgentStateMachine();
  }
  return stateMachineInstance;
}

/**
 * Reset the state machine (for testing)
 */
export function resetStateMachine(): void {
  if (stateMachineInstance) {
    stateMachineInstance.dispose();
    stateMachineInstance = null;
  }
}
