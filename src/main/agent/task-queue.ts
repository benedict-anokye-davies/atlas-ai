/**
 * Atlas Desktop - Task Queue Manager
 * Manages task queuing, prioritization, and scheduling
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  TaskStep,
  TaskPriority,
  CreateTaskOptions,
  QueuedTask,
  TaskQueueStats,
  TaskProgressEvent,
  TaskCompletionEvent,
  StepStatus,
} from '../../shared/types/task';
import { agentLogger as logger } from '../utils/logger';
import { clamp100 } from '../../shared/utils';

/**
 * Priority weights for queue ordering
 */
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Task queue configuration
 */
export interface TaskQueueConfig {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** Maximum queue size */
  maxQueueSize: number;
  /** Default task timeout in ms */
  defaultTimeout: number;
  /** Enable auto-cleanup of completed tasks */
  autoCleanup: boolean;
  /** Cleanup interval in ms */
  cleanupInterval: number;
  /** Keep completed tasks for this long (ms) */
  retentionPeriod: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 5, // Increased from 3 for better multi-tasking (Ben's preference)
  maxQueueSize: 100,
  defaultTimeout: 300000, // 5 minutes
  autoCleanup: true,
  cleanupInterval: 60000, // 1 minute
  retentionPeriod: 3600000, // 1 hour
};

/**
 * Task Queue Manager
 * Handles task queuing, prioritization, and lifecycle management
 */
export class TaskQueueManager extends EventEmitter {
  private queue: Task[] = [];
  private running: Map<string, Task> = new Map();
  private completed: Map<string, Task> = new Map();
  private config: TaskQueueConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config: Partial<TaskQueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoCleanup) {
      this.startCleanupTimer();
    }

    logger.info('[TaskQueue] Manager initialized', {
      maxConcurrent: this.config.maxConcurrent,
      maxQueueSize: this.config.maxQueueSize,
    });
  }

  /**
   * Create and enqueue a new task
   */
  createTask(options: CreateTaskOptions): Task {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max ${this.config.maxQueueSize} tasks)`);
    }

    const taskId = uuidv4();
    const now = Date.now();

    // Create steps with IDs and initial status
    const steps: TaskStep[] = options.steps.map((step, index) => ({
      ...step,
      id: `${taskId}-step-${index}`,
      status: 'pending' as StepStatus,
      errorStrategy: step.errorStrategy || 'fail',
    }));

    const task: Task = {
      id: taskId,
      name: options.name,
      description: options.description,
      priority: options.priority || 'normal',
      status: 'pending',
      steps,
      initialContext: options.context,
      progress: 0,
      createdAt: now,
      tags: options.tags,
      source: options.source || 'internal',
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
    };

    logger.info('[TaskQueue] Task created', {
      taskId: task.id,
      name: task.name,
      priority: task.priority,
      steps: task.steps.length,
    });

    return task;
  }

  /**
   * Add a task to the queue
   */
  enqueue(task: Task): QueuedTask {
    if (this.isShuttingDown) {
      throw new Error('Task queue is shutting down');
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max ${this.config.maxQueueSize} tasks)`);
    }

    task.status = 'queued';

    // Insert based on priority (higher priority first)
    const insertIndex = this.findInsertIndex(task.priority);
    this.queue.splice(insertIndex, 0, task);

    const position = this.queue.indexOf(task);
    const estimatedWaitMs = this.estimateWaitTime(position);

    const queuedTask: QueuedTask = {
      task,
      position,
      estimatedWaitMs,
      queuedAt: Date.now(),
    };

    this.emit('task:queued', task);

    logger.info('[TaskQueue] Task enqueued', {
      taskId: task.id,
      position,
      queueSize: this.queue.length,
    });

    // Try to process queue
    this.processQueue();

    return queuedTask;
  }

  /**
   * Find the correct index to insert a task based on priority
   */
  private findInsertIndex(priority: TaskPriority): number {
    const weight = PRIORITY_WEIGHTS[priority];

    for (let i = 0; i < this.queue.length; i++) {
      const taskWeight = PRIORITY_WEIGHTS[this.queue[i].priority];
      if (weight > taskWeight) {
        return i;
      }
    }

    return this.queue.length;
  }

  /**
   * Estimate wait time for a position in queue
   */
  private estimateWaitTime(position: number): number {
    // Simple estimation: average task time * position / concurrent slots
    const avgTime = this.getAverageExecutionTime();
    return Math.ceil((position * avgTime) / this.config.maxConcurrent);
  }

  /**
   * Get average execution time from completed tasks
   */
  private getAverageExecutionTime(): number {
    if (this.completed.size === 0) {
      return 30000; // Default estimate: 30 seconds
    }

    let totalTime = 0;
    let count = 0;

    for (const task of this.completed.values()) {
      if (task.result?.duration) {
        totalTime += task.result.duration;
        count++;
      }
    }

    return count > 0 ? totalTime / count : 30000;
  }

  /**
   * Process the queue - start tasks if slots available
   */
  processQueue(): void {
    while (
      this.running.size < this.config.maxConcurrent &&
      this.queue.length > 0 &&
      !this.isShuttingDown
    ) {
      const task = this.queue.shift();
      if (task) {
        this.startTask(task);
      }
    }
  }

  /**
   * Start a task (emit event for executor to handle)
   */
  private startTask(task: Task): void {
    task.status = 'running';
    task.startedAt = Date.now();
    task.context = {
      variables: { ...task.initialContext },
      stepResults: {},
      sessionId: uuidv4(),
      startedAt: task.startedAt,
    };

    this.running.set(task.id, task);

    logger.info('[TaskQueue] Task started', {
      taskId: task.id,
      name: task.name,
      runningCount: this.running.size,
    });

    this.emit('task:started', task);
  }

  /**
   * Update task progress
   */
  updateProgress(taskId: string, progress: number, stepId?: string, message?: string): void {
    const task = this.running.get(taskId);
    if (!task) {
      logger.warn('[TaskQueue] Cannot update progress - task not found', { taskId });
      return;
    }

    task.progress = clamp100(progress);
    if (stepId) {
      task.currentStepId = stepId;
    }

    const completedSteps = task.steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    ).length;

    const event: TaskProgressEvent = {
      taskId,
      stepId,
      progress: task.progress,
      currentStep: stepId ? task.steps.find((s) => s.id === stepId)?.name : undefined,
      message,
      status: task.status,
      completedSteps,
      totalSteps: task.steps.length,
    };

    this.emit('task:progress', event);
  }

  /**
   * Update step status
   */
  updateStepStatus(taskId: string, stepId: string, status: StepStatus): void {
    const task = this.running.get(taskId);
    if (!task) {
      logger.warn('[TaskQueue] Cannot update step - task not found', { taskId });
      return;
    }

    const step = task.steps.find((s) => s.id === stepId);
    if (!step) {
      logger.warn('[TaskQueue] Step not found', { taskId, stepId });
      return;
    }

    step.status = status;

    if (status === 'running') {
      this.emit('task:step-started', taskId, step);
    } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
      this.emit('task:step-completed', taskId, step, step.result);
    }
  }

  /**
   * Complete a task
   */
  completeTask(
    taskId: string,
    status: 'completed' | 'failed',
    result?: unknown,
    error?: string
  ): void {
    const task = this.running.get(taskId);
    if (!task) {
      logger.warn('[TaskQueue] Cannot complete - task not found', { taskId });
      return;
    }

    task.status = status;
    task.completedAt = Date.now();
    task.progress = status === 'completed' ? 100 : task.progress;

    if (error) {
      task.error = error;
    }

    const duration = task.completedAt - (task.startedAt || task.createdAt);
    const completedSteps = task.steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    ).length;

    task.result = {
      taskId,
      status,
      data: result,
      error,
      duration,
      completedSteps,
      totalSteps: task.steps.length,
      stepResults: task.steps.filter((s) => s.result).map((s) => s.result!),
      context: task.context!,
      completedAt: task.completedAt,
    };

    // Move to completed
    this.running.delete(taskId);
    this.completed.set(taskId, task);

    const event: TaskCompletionEvent = {
      taskId,
      status,
      result: task.result,
      error,
      duration,
    };

    logger.info('[TaskQueue] Task completed', {
      taskId,
      status,
      duration,
      completedSteps,
      totalSteps: task.steps.length,
    });

    this.emit('task:completed', event);

    // Process next tasks
    this.processQueue();
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string, reason?: string): boolean {
    // Check queue first
    const queueIndex = this.queue.findIndex((t) => t.id === taskId);
    if (queueIndex !== -1) {
      const task = this.queue.splice(queueIndex, 1)[0];
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.completed.set(taskId, task);
      this.emit('task:cancelled', taskId, reason);
      logger.info('[TaskQueue] Queued task cancelled', { taskId, reason });
      return true;
    }

    // Check running
    const runningTask = this.running.get(taskId);
    if (runningTask) {
      runningTask.status = 'cancelled';
      runningTask.completedAt = Date.now();
      this.running.delete(taskId);
      this.completed.set(taskId, runningTask);
      this.emit('task:cancelled', taskId, reason);
      logger.info('[TaskQueue] Running task cancelled', { taskId, reason });
      this.processQueue();
      return true;
    }

    logger.warn('[TaskQueue] Task not found for cancellation', { taskId });
    return false;
  }

  /**
   * Pause a running task
   */
  pauseTask(taskId: string): boolean {
    const task = this.running.get(taskId);
    if (!task) {
      return false;
    }

    task.status = 'paused';
    this.emit('task:paused', taskId);
    logger.info('[TaskQueue] Task paused', { taskId });
    return true;
  }

  /**
   * Resume a paused task
   */
  resumeTask(taskId: string): boolean {
    const task = this.running.get(taskId);
    if (!task || task.status !== 'paused') {
      return false;
    }

    task.status = 'running';
    this.emit('task:resumed', taskId);
    logger.info('[TaskQueue] Task resumed', { taskId });
    return true;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return (
      this.running.get(taskId) ||
      this.completed.get(taskId) ||
      this.queue.find((t) => t.id === taskId)
    );
  }

  /**
   * Get queue statistics
   */
  getStats(): TaskQueueStats {
    let totalTime = 0;
    let count = 0;

    for (const task of this.completed.values()) {
      if (task.result?.duration) {
        totalTime += task.result.duration;
        count++;
      }
    }

    const failedCount = Array.from(this.completed.values()).filter(
      (t) => t.status === 'failed'
    ).length;

    return {
      pending: this.queue.length,
      running: this.running.size,
      completed: this.completed.size - failedCount,
      failed: failedCount,
      avgExecutionTime: count > 0 ? totalTime / count : 0,
      totalProcessed: this.completed.size,
      utilization: this.running.size / this.config.maxConcurrent,
    };
  }

  /**
   * Get all running tasks
   */
  getRunningTasks(): Task[] {
    return Array.from(this.running.values());
  }

  /**
   * Get all queued tasks
   */
  getQueuedTasks(): Task[] {
    return [...this.queue];
  }

  /**
   * Get recent completed tasks
   */
  getRecentTasks(limit = 10): Task[] {
    return Array.from(this.completed.values())
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, limit);
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): number {
    const count = this.completed.size;
    this.completed.clear();
    logger.info('[TaskQueue] Cleared completed tasks', { count });
    return count;
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Cleanup old completed tasks
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.retentionPeriod;
    let cleaned = 0;

    for (const [taskId, task] of this.completed) {
      if (task.completedAt && task.completedAt < cutoff) {
        this.completed.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('[TaskQueue] Cleaned up old tasks', { count: cleaned });
    }
  }

  /**
   * Shutdown the queue manager
   */
  async shutdown(): Promise<void> {
    logger.info('[TaskQueue] Shutting down...');
    this.isShuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cancel all queued tasks
    for (const task of this.queue) {
      task.status = 'cancelled';
      this.emit('task:cancelled', task.id, 'Queue shutdown');
    }
    this.queue = [];

    // Wait for running tasks to complete (with timeout)
    if (this.running.size > 0) {
      logger.info('[TaskQueue] Waiting for running tasks...', {
        count: this.running.size,
      });

      // Give tasks 10 seconds to complete
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force cancel remaining tasks
          for (const [taskId] of this.running) {
            this.cancelTask(taskId, 'Forced shutdown');
          }
          resolve();
        }, 10000);

        const checkComplete = setInterval(() => {
          if (this.running.size === 0) {
            clearTimeout(timeout);
            clearInterval(checkComplete);
            resolve();
          }
        }, 100);
      });
    }

    logger.info('[TaskQueue] Shutdown complete');
  }
}

// Singleton instance
let taskQueueManager: TaskQueueManager | null = null;

/**
 * Get the task queue manager instance
 */
export function getTaskQueueManager(): TaskQueueManager {
  if (!taskQueueManager) {
    taskQueueManager = new TaskQueueManager();
  }
  return taskQueueManager;
}

/**
 * Initialize the task queue manager with custom config
 */
export function initializeTaskQueue(config?: Partial<TaskQueueConfig>): TaskQueueManager {
  if (taskQueueManager) {
    logger.warn('[TaskQueue] Manager already initialized, returning existing instance');
    return taskQueueManager;
  }
  taskQueueManager = new TaskQueueManager(config);
  return taskQueueManager;
}

/**
 * Shutdown the task queue manager
 */
export async function shutdownTaskQueue(): Promise<void> {
  if (taskQueueManager) {
    await taskQueueManager.shutdown();
    taskQueueManager = null;
  }
}
