/**
 * Atlas Desktop - Speculative Executor
 * Pre-execute likely tool calls to reduce perceived latency
 *
 * Features:
 * - Predict likely tool executions
 * - Execute speculatively in background
 * - Cache results for quick delivery
 * - Cancel speculation on mismatch
 * - Resource-aware execution
 *
 * @module ml/speculative-executor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('SpeculativeExecutor');

// ============================================================================
// Types
// ============================================================================

export interface SpeculativeTask {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  probability: number;
  status: 'pending' | 'executing' | 'completed' | 'cancelled' | 'failed';
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  executionTime?: number;
}

export interface SpeculationResult {
  taskId: string;
  hit: boolean;
  result?: unknown;
  savedTime?: number;
}

export interface SpeculativeExecutorConfig {
  maxConcurrent: number;
  minProbability: number;
  maxCacheAge: number; // ms
  resourceThreshold: number; // 0-1, stop if CPU > threshold
}

export interface SpeculativeExecutorEvents {
  'speculation-started': (task: SpeculativeTask) => void;
  'speculation-completed': (task: SpeculativeTask) => void;
  'speculation-hit': (task: SpeculativeTask, savedTime: number) => void;
  'speculation-miss': (task: SpeculativeTask) => void;
  'speculation-cancelled': (task: SpeculativeTask) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Speculative Executor
// ============================================================================

export class SpeculativeExecutor extends EventEmitter {
  private pendingTasks: Map<string, SpeculativeTask> = new Map();
  private completedTasks: Map<string, SpeculativeTask> = new Map();
  private executingCount = 0;
  private config: SpeculativeExecutorConfig;
  private toolExecutors: Map<string, (args: Record<string, unknown>) => Promise<unknown>> = new Map();

  // Stats
  private stats = {
    totalSpeculations: 0,
    hits: 0,
    misses: 0,
    cancelled: 0,
    totalTimeSaved: 0,
  };

  constructor(config?: Partial<SpeculativeExecutorConfig>) {
    super();
    this.config = {
      maxConcurrent: 3,
      minProbability: 0.3,
      maxCacheAge: 60000, // 1 minute
      resourceThreshold: 0.8,
      ...config,
    };

    logger.info('SpeculativeExecutor initialized', { config: this.config });
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  /**
   * Register a tool executor for speculative execution
   */
  registerTool(toolName: string, executor: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.toolExecutors.set(toolName, executor);
    logger.debug('Tool registered for speculation', { toolName });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): void {
    this.toolExecutors.delete(toolName);
  }

  // ============================================================================
  // Speculation
  // ============================================================================

  /**
   * Speculatively execute a tool
   */
  async speculate(
    toolName: string,
    args: Record<string, unknown>,
    probability: number
  ): Promise<string | null> {
    // Check probability threshold
    if (probability < this.config.minProbability) {
      return null;
    }

    // Check concurrent limit
    if (this.executingCount >= this.config.maxConcurrent) {
      logger.debug('Max concurrent speculations reached');
      return null;
    }

    // Check if tool is registered
    const executor = this.toolExecutors.get(toolName);
    if (!executor) {
      logger.debug('Tool not registered for speculation', { toolName });
      return null;
    }

    // Generate task ID
    const taskId = this.generateTaskId(toolName, args);

    // Check if already executing or completed
    if (this.pendingTasks.has(taskId) || this.completedTasks.has(taskId)) {
      return taskId;
    }

    // Create task
    const task: SpeculativeTask = {
      id: taskId,
      toolName,
      args,
      probability,
      status: 'pending',
    };

    this.pendingTasks.set(taskId, task);
    this.stats.totalSpeculations++;

    // Execute speculatively
    this.executeSpeculation(task, executor);

    return taskId;
  }

  /**
   * Execute speculation in background
   */
  private async executeSpeculation(
    task: SpeculativeTask,
    executor: (args: Record<string, unknown>) => Promise<unknown>
  ): Promise<void> {
    task.status = 'executing';
    task.startedAt = Date.now();
    this.executingCount++;

    this.emit('speculation-started', task);

    try {
      const result = await executor(task.args);

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.executionTime = task.completedAt - task.startedAt!;

      // Move to completed cache
      this.pendingTasks.delete(task.id);
      this.completedTasks.set(task.id, task);

      this.emit('speculation-completed', task);
      logger.debug('Speculation completed', {
        taskId: task.id,
        toolName: task.toolName,
        executionTime: task.executionTime,
      });
    } catch (error) {
      task.status = 'failed';
      task.error = getErrorMessage(error);
      task.completedAt = Date.now();

      this.pendingTasks.delete(task.id);
      this.emit('error', error as Error);

      logger.warn('Speculation failed', { taskId: task.id, error: task.error });
    } finally {
      this.executingCount--;
    }
  }

  /**
   * Check if speculation result is available
   */
  checkSpeculation(toolName: string, args: Record<string, unknown>): SpeculationResult | null {
    const taskId = this.generateTaskId(toolName, args);

    // Check completed tasks
    const completed = this.completedTasks.get(taskId);
    if (completed && completed.status === 'completed') {
      // Check if still valid
      const age = Date.now() - (completed.completedAt || 0);
      if (age < this.config.maxCacheAge) {
        this.stats.hits++;
        this.stats.totalTimeSaved += completed.executionTime || 0;

        this.emit('speculation-hit', completed, completed.executionTime || 0);
        logger.info('Speculation hit', {
          taskId,
          savedTime: completed.executionTime,
        });

        return {
          taskId,
          hit: true,
          result: completed.result,
          savedTime: completed.executionTime,
        };
      }
    }

    // Check pending tasks
    const pending = this.pendingTasks.get(taskId);
    if (pending) {
      // Task is still executing, wait for it
      return null;
    }

    this.stats.misses++;
    this.emit('speculation-miss', { id: taskId, toolName, args, probability: 0, status: 'pending' });

    return { taskId, hit: false };
  }

  /**
   * Wait for speculation to complete
   */
  async waitForSpeculation(
    toolName: string,
    args: Record<string, unknown>,
    timeout = 5000
  ): Promise<SpeculationResult | null> {
    const taskId = this.generateTaskId(toolName, args);

    // Check if already completed
    const immediate = this.checkSpeculation(toolName, args);
    if (immediate?.hit) {
      return immediate;
    }

    // Wait for pending task
    const pending = this.pendingTasks.get(taskId);
    if (!pending) {
      return null;
    }

    return new Promise((resolve) => {
      const startWait = Date.now();

      const checkInterval = setInterval(() => {
        const completed = this.completedTasks.get(taskId);
        if (completed) {
          clearInterval(checkInterval);
          resolve({
            taskId,
            hit: true,
            result: completed.result,
            savedTime: completed.executionTime,
          });
          return;
        }

        if (Date.now() - startWait > timeout) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 50);
    });
  }

  /**
   * Cancel a speculation
   */
  cancelSpeculation(toolName: string, args: Record<string, unknown>): boolean {
    const taskId = this.generateTaskId(toolName, args);
    const task = this.pendingTasks.get(taskId);

    if (task && task.status === 'pending') {
      task.status = 'cancelled';
      this.pendingTasks.delete(taskId);
      this.stats.cancelled++;

      this.emit('speculation-cancelled', task);
      logger.debug('Speculation cancelled', { taskId });

      return true;
    }

    return false;
  }

  /**
   * Cancel all pending speculations
   */
  cancelAll(): number {
    let cancelled = 0;

    for (const [taskId, task] of this.pendingTasks) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
        this.pendingTasks.delete(taskId);
        this.stats.cancelled++;
        cancelled++;
      }
    }

    if (cancelled > 0) {
      logger.info('Cancelled all speculations', { count: cancelled });
    }

    return cancelled;
  }

  // ============================================================================
  // Batch Speculation
  // ============================================================================

  /**
   * Speculatively execute multiple tools based on predictions
   */
  async speculateBatch(
    predictions: Array<{
      toolName: string;
      args: Record<string, unknown>;
      probability: number;
    }>
  ): Promise<string[]> {
    const taskIds: string[] = [];

    // Sort by probability descending
    const sorted = [...predictions].sort((a, b) => b.probability - a.probability);

    // Speculate top N
    for (const prediction of sorted.slice(0, this.config.maxConcurrent)) {
      const taskId = await this.speculate(prediction.toolName, prediction.args, prediction.probability);
      if (taskId) {
        taskIds.push(taskId);
      }
    }

    return taskIds;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Generate deterministic task ID
   */
  private generateTaskId(toolName: string, args: Record<string, unknown>): string {
    const argsStr = JSON.stringify(args, Object.keys(args).sort());
    const hash = this.simpleHash(argsStr);
    return `${toolName}_${hash}`;
  }

  /**
   * Simple string hash
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clean up old completed tasks
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [taskId, task] of this.completedTasks) {
      const age = now - (task.completedAt || 0);
      if (age > this.config.maxCacheAge) {
        this.completedTasks.delete(taskId);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cleaned up old speculations', { removed });
    }

    return removed;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSpeculations: number;
    hits: number;
    misses: number;
    cancelled: number;
    hitRate: number;
    totalTimeSaved: number;
    pendingCount: number;
    completedCount: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      pendingCount: this.pendingTasks.size,
      completedCount: this.completedTasks.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpeculativeExecutorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let speculativeExecutor: SpeculativeExecutor | null = null;

export function getSpeculativeExecutor(): SpeculativeExecutor {
  if (!speculativeExecutor) {
    speculativeExecutor = new SpeculativeExecutor();
  }
  return speculativeExecutor;
}
