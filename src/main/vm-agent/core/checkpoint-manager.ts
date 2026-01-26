/**
 * Atlas Desktop - VM Agent Checkpoint Manager
 *
 * Manages state checkpoints for rollback support and error recovery.
 * Enables the agent to return to known-good states after failures.
 *
 * @module vm-agent/core/checkpoint-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from './event-bus';
import { getStateMachine } from './state-machine';
import {
  Checkpoint,
  SerializedScreenState,
  TaskProgress,
  StateMachineContext,
} from './types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('CheckpointManager');

// =============================================================================
// Checkpoint Manager Constants
// =============================================================================

export const CHECKPOINT_CONSTANTS = {
  /** Maximum checkpoints to keep */
  MAX_CHECKPOINTS: 20,
  /** Checkpoint expiry time (ms) - 1 hour */
  CHECKPOINT_EXPIRY_MS: 3600000,
  /** Auto checkpoint interval (ms) - 30 seconds */
  AUTO_CHECKPOINT_INTERVAL_MS: 30000,
  /** Checkpoint file name */
  CHECKPOINT_FILE: 'checkpoints.json',
} as const;

// =============================================================================
// Checkpoint Manager Implementation
// =============================================================================

/**
 * Manages state checkpoints for the VM agent
 *
 * Features:
 * - Manual and automatic checkpoint creation
 * - Checkpoint persistence to disk
 * - Rollback to previous checkpoints
 * - Checkpoint expiry and cleanup
 *
 * @example
 * ```typescript
 * const manager = getCheckpointManager();
 *
 * // Create a checkpoint before risky operation
 * const checkpoint = await manager.createCheckpoint('pre-risky-action', 'manual', screenState);
 *
 * // If something goes wrong, rollback
 * await manager.rollbackToCheckpoint(checkpoint.id);
 * ```
 */
export class CheckpointManager extends EventEmitter {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private storageDir: string;
  private autoCheckpointTimer: ReturnType<typeof setInterval> | null = null;
  private config: {
    maxCheckpoints: number;
    checkpointExpiryMs: number;
    autoCheckpointIntervalMs: number;
    enableAutoCheckpoints: boolean;
    persistToDisk: boolean;
  };

  constructor(
    config: Partial<{
      maxCheckpoints: number;
      checkpointExpiryMs: number;
      autoCheckpointIntervalMs: number;
      enableAutoCheckpoints: boolean;
      persistToDisk: boolean;
    }> = {},
  ) {
    super();

    this.config = {
      maxCheckpoints: config.maxCheckpoints || CHECKPOINT_CONSTANTS.MAX_CHECKPOINTS,
      checkpointExpiryMs: config.checkpointExpiryMs || CHECKPOINT_CONSTANTS.CHECKPOINT_EXPIRY_MS,
      autoCheckpointIntervalMs:
        config.autoCheckpointIntervalMs || CHECKPOINT_CONSTANTS.AUTO_CHECKPOINT_INTERVAL_MS,
      enableAutoCheckpoints: config.enableAutoCheckpoints ?? true,
      persistToDisk: config.persistToDisk ?? true,
    };

    this.storageDir = path.join(app.getPath('userData'), 'vm-agent', 'checkpoints');
    this.ensureStorageDir();
  }

  /**
   * Initialize the checkpoint manager
   */
  async initialize(): Promise<void> {
    // Load persisted checkpoints
    if (this.config.persistToDisk) {
      await this.loadCheckpoints();
    }

    // Start auto checkpoint timer if enabled
    if (this.config.enableAutoCheckpoints) {
      this.startAutoCheckpoints();
    }

    // Clean up expired checkpoints
    this.cleanupExpiredCheckpoints();

    logger.info('Checkpoint manager initialized', {
      checkpoints: this.checkpoints.size,
      autoCheckpoints: this.config.enableAutoCheckpoints,
    });
  }

  /**
   * Create a new checkpoint
   */
  async createCheckpoint(
    name: string,
    type: Checkpoint['type'],
    screenState?: SerializedScreenState,
    taskProgress?: TaskProgress,
  ): Promise<Checkpoint> {
    const id = crypto.randomUUID();
    const stateMachine = getStateMachine();

    const checkpoint: Checkpoint = {
      id,
      name,
      type,
      stateMachineContext: { ...stateMachine.getContext() },
      screenState: screenState || this.createMinimalScreenState(),
      taskProgress,
      createdAt: Date.now(),
      valid: true,
      expiresAt: Date.now() + this.config.checkpointExpiryMs,
    };

    // Store checkpoint
    this.checkpoints.set(id, checkpoint);

    // Update state machine
    stateMachine.setLastCheckpointId(id);

    // Enforce max checkpoints
    await this.enforceMaxCheckpoints();

    // Persist to disk
    if (this.config.persistToDisk) {
      await this.persistCheckpoints();
    }

    // Emit events
    this.emit('checkpoint-created', checkpoint);
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('state:checkpoint-created', checkpoint, 'checkpoint-manager'),
    );

    logger.info('Checkpoint created', {
      id: checkpoint.id,
      name: checkpoint.name,
      type: checkpoint.type,
    });

    return checkpoint;
  }

  /**
   * Create an auto checkpoint
   */
  async createAutoCheckpoint(screenState?: SerializedScreenState): Promise<Checkpoint | null> {
    const stateMachine = getStateMachine();

    // Don't create auto checkpoints in certain states
    if (stateMachine.isAnyState('error', 'recovering', 'disconnected')) {
      return null;
    }

    const name = `auto-${stateMachine.currentState}-${Date.now()}`;
    return this.createCheckpoint(name, 'auto', screenState);
  }

  /**
   * Create a pre-action checkpoint
   */
  async createPreActionCheckpoint(
    actionDescription: string,
    screenState: SerializedScreenState,
  ): Promise<Checkpoint> {
    const name = `pre-action: ${actionDescription}`;
    return this.createCheckpoint(name, 'pre-action', screenState);
  }

  /**
   * Create a post-step checkpoint
   */
  async createPostStepCheckpoint(
    stepDescription: string,
    screenState: SerializedScreenState,
    taskProgress: TaskProgress,
  ): Promise<Checkpoint> {
    const name = `post-step: ${stepDescription}`;
    return this.createCheckpoint(name, 'post-step', screenState, taskProgress);
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    const checkpoint = this.checkpoints.get(id);
    if (checkpoint && this.isCheckpointValid(checkpoint)) {
      return checkpoint;
    }
    return undefined;
  }

  /**
   * Get the most recent valid checkpoint
   */
  getLatestCheckpoint(type?: Checkpoint['type']): Checkpoint | undefined {
    let latest: Checkpoint | undefined;

    for (const checkpoint of this.checkpoints.values()) {
      if (!this.isCheckpointValid(checkpoint)) continue;
      if (type && checkpoint.type !== type) continue;

      if (!latest || checkpoint.createdAt > latest.createdAt) {
        latest = checkpoint;
      }
    }

    return latest;
  }

  /**
   * Get all valid checkpoints
   */
  getAllCheckpoints(options: { type?: Checkpoint['type']; valid?: boolean } = {}): Checkpoint[] {
    const checkpoints: Checkpoint[] = [];

    for (const checkpoint of this.checkpoints.values()) {
      if (options.valid !== false && !this.isCheckpointValid(checkpoint)) continue;
      if (options.type && checkpoint.type !== options.type) continue;

      checkpoints.push(checkpoint);
    }

    return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Rollback to a checkpoint
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<{
    success: boolean;
    checkpoint?: Checkpoint;
    error?: string;
  }> {
    const checkpoint = this.getCheckpoint(checkpointId);

    if (!checkpoint) {
      return { success: false, error: 'Checkpoint not found or invalid' };
    }

    try {
      const stateMachine = getStateMachine();

      // Emit rollback started
      this.emit('rollback-started', checkpoint);
      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent('state:rollback', { checkpoint, action: 'started' }, 'checkpoint-manager'),
      );

      // Restore state machine context
      const context = checkpoint.stateMachineContext;

      // Transition to the checkpoint state
      await stateMachine.transition(context.currentState, {
        event: 'checkpoint-rollback',
        context: { checkpointId },
        force: true, // Force transition since we're rolling back
      });

      // Restore task context if any
      if (context.currentTask) {
        stateMachine.setTaskContext(context.currentTask);
      }

      // Restore action context if any
      if (context.currentAction) {
        stateMachine.setActionContext(context.currentAction);
      }

      // Clear error context
      stateMachine.setErrorContext(undefined);

      // Invalidate checkpoints created after this one
      this.invalidateCheckpointsAfter(checkpoint.createdAt);

      // Emit rollback completed
      this.emit('rollback-completed', checkpoint);
      eventBus.emitSync(
        createEvent('state:rollback', { checkpoint, action: 'completed' }, 'checkpoint-manager'),
      );

      logger.info('Rolled back to checkpoint', {
        id: checkpoint.id,
        name: checkpoint.name,
        state: context.currentState,
      });

      return { success: true, checkpoint };
    } catch (error) {
      logger.error('Rollback failed', {
        checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.emit('rollback-failed', checkpoint, error);

      return {
        success: false,
        checkpoint,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Rollback to the latest valid checkpoint
   */
  async rollbackToLatest(type?: Checkpoint['type']): Promise<{
    success: boolean;
    checkpoint?: Checkpoint;
    error?: string;
  }> {
    const checkpoint = this.getLatestCheckpoint(type);

    if (!checkpoint) {
      return { success: false, error: 'No valid checkpoint available' };
    }

    return this.rollbackToCheckpoint(checkpoint.id);
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(id: string): Promise<boolean> {
    const deleted = this.checkpoints.delete(id);

    if (deleted && this.config.persistToDisk) {
      await this.persistCheckpoints();
    }

    return deleted;
  }

  /**
   * Invalidate a checkpoint
   */
  invalidateCheckpoint(id: string): boolean {
    const checkpoint = this.checkpoints.get(id);
    if (checkpoint) {
      checkpoint.valid = false;
      return true;
    }
    return false;
  }

  /**
   * Clear all checkpoints
   */
  async clearAllCheckpoints(): Promise<void> {
    this.checkpoints.clear();

    if (this.config.persistToDisk) {
      await this.persistCheckpoints();
    }

    logger.info('All checkpoints cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    valid: number;
    byType: Record<Checkpoint['type'], number>;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    let valid = 0;
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    const byType: Record<string, number> = {
      auto: 0,
      manual: 0,
      'pre-action': 0,
      'post-step': 0,
      'error-recovery': 0,
    };

    for (const checkpoint of this.checkpoints.values()) {
      if (this.isCheckpointValid(checkpoint)) {
        valid++;
      }

      byType[checkpoint.type] = (byType[checkpoint.type] || 0) + 1;

      if (!oldestTimestamp || checkpoint.createdAt < oldestTimestamp) {
        oldestTimestamp = checkpoint.createdAt;
      }
      if (!newestTimestamp || checkpoint.createdAt > newestTimestamp) {
        newestTimestamp = checkpoint.createdAt;
      }
    }

    return {
      total: this.checkpoints.size,
      valid,
      byType: byType as Record<Checkpoint['type'], number>,
      oldestTimestamp,
      newestTimestamp,
    };
  }

  /**
   * Start auto checkpoints
   */
  startAutoCheckpoints(): void {
    if (this.autoCheckpointTimer) {
      return;
    }

    this.autoCheckpointTimer = setInterval(async () => {
      await this.createAutoCheckpoint();
    }, this.config.autoCheckpointIntervalMs);

    logger.info('Auto checkpoints started', {
      intervalMs: this.config.autoCheckpointIntervalMs,
    });
  }

  /**
   * Stop auto checkpoints
   */
  stopAutoCheckpoints(): void {
    if (this.autoCheckpointTimer) {
      clearInterval(this.autoCheckpointTimer);
      this.autoCheckpointTimer = null;
      logger.info('Auto checkpoints stopped');
    }
  }

  /**
   * Dispose of the checkpoint manager
   */
  async dispose(): Promise<void> {
    this.stopAutoCheckpoints();

    if (this.config.persistToDisk) {
      await this.persistCheckpoints();
    }

    this.removeAllListeners();
    logger.info('Checkpoint manager disposed');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private isCheckpointValid(checkpoint: Checkpoint): boolean {
    if (!checkpoint.valid) return false;
    if (checkpoint.expiresAt && checkpoint.expiresAt < Date.now()) return false;
    return true;
  }

  private createMinimalScreenState(): SerializedScreenState {
    return {
      screenshot: '',
      hash: '',
      elementsSummary: { total: 0, interactive: 0, buttons: 0, inputs: 0 },
      timestamp: Date.now(),
    };
  }

  private async enforceMaxCheckpoints(): Promise<void> {
    const validCheckpoints = this.getAllCheckpoints({ valid: true });

    if (validCheckpoints.length > this.config.maxCheckpoints) {
      // Sort by creation time, oldest first
      const sorted = validCheckpoints.sort((a, b) => a.createdAt - b.createdAt);

      // Delete oldest checkpoints
      const toDelete = sorted.slice(0, validCheckpoints.length - this.config.maxCheckpoints);

      for (const checkpoint of toDelete) {
        this.checkpoints.delete(checkpoint.id);
      }

      logger.debug('Enforced max checkpoints', {
        deleted: toDelete.length,
        remaining: this.checkpoints.size,
      });
    }
  }

  private invalidateCheckpointsAfter(timestamp: number): void {
    for (const checkpoint of this.checkpoints.values()) {
      if (checkpoint.createdAt > timestamp) {
        checkpoint.valid = false;
      }
    }
  }

  private cleanupExpiredCheckpoints(): void {
    const now = Date.now();
    let deleted = 0;

    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
        this.checkpoints.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug('Cleaned up expired checkpoints', { deleted });
    }
  }

  private async loadCheckpoints(): Promise<void> {
    const filePath = path.join(this.storageDir, CHECKPOINT_CONSTANTS.CHECKPOINT_FILE);

    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);

        if (Array.isArray(parsed)) {
          for (const checkpoint of parsed) {
            this.checkpoints.set(checkpoint.id, checkpoint);
          }
        }

        logger.debug('Loaded checkpoints from disk', { count: this.checkpoints.size });
      }
    } catch (error) {
      logger.warn('Failed to load checkpoints', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistCheckpoints(): Promise<void> {
    const filePath = path.join(this.storageDir, CHECKPOINT_CONSTANTS.CHECKPOINT_FILE);

    try {
      const checkpoints = Array.from(this.checkpoints.values());

      // Don't persist screenshots to save space (they can be large)
      const checkpointsToSave = checkpoints.map((cp) => ({
        ...cp,
        screenState: {
          ...cp.screenState,
          screenshot: '', // Clear screenshot
        },
      }));

      fs.writeFileSync(filePath, JSON.stringify(checkpointsToSave, null, 2));

      logger.debug('Persisted checkpoints to disk', { count: checkpoints.length });
    } catch (error) {
      logger.warn('Failed to persist checkpoints', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let checkpointManagerInstance: CheckpointManager | null = null;

/**
 * Get the singleton checkpoint manager instance
 */
export function getCheckpointManager(): CheckpointManager {
  if (!checkpointManagerInstance) {
    checkpointManagerInstance = new CheckpointManager();
  }
  return checkpointManagerInstance;
}

/**
 * Reset the checkpoint manager (for testing)
 */
export function resetCheckpointManager(): void {
  if (checkpointManagerInstance) {
    checkpointManagerInstance.dispose();
    checkpointManagerInstance = null;
  }
}
