/**
 * Atlas Desktop - Worker Pool Manager
 * Manages a pool of worker threads for CPU-intensive tasks
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  WorkerPoolConfig,
  WorkerPoolStats,
  WorkerPoolEvents,
  WorkerStatus,
  WorkerType,
  WorkerMessage,
  WorkerResponse,
  DEFAULT_WORKER_POOL_CONFIG,
  generateMessageId,
} from '../../shared/types/workers';

const logger = createModuleLogger('WorkerPool');

/**
 * Internal worker wrapper with metadata
 */
interface ManagedWorker {
  /** Worker instance */
  worker: Worker;
  /** Unique worker ID */
  id: string;
  /** Worker type */
  type: WorkerType;
  /** Is worker currently processing a task */
  isBusy: boolean;
  /** Current task ID (if busy) */
  currentTaskId: string | null;
  /** Task start time (if busy) */
  taskStartTime: number | null;
  /** Number of tasks processed */
  tasksProcessed: number;
  /** Total processing time in ms */
  totalProcessingTime: number;
  /** Number of errors */
  errorCount: number;
  /** Last error message */
  lastError: string | null;
  /** Worker start time */
  startTime: number;
  /** Restart attempts */
  restartAttempts: number;
  /** Is worker terminating */
  isTerminating: boolean;
}

/**
 * Pending task in the queue
 */
interface PendingTask<T = unknown, R = unknown> {
  /** Task ID */
  id: string;
  /** Task message */
  message: WorkerMessage<T>;
  /** Resolve callback */
  resolve: (result: R) => void;
  /** Reject callback */
  reject: (error: Error) => void;
  /** Task creation time */
  createdAt: number;
  /** Timeout handle */
  timeoutHandle: NodeJS.Timeout | null;
}

/**
 * Worker Pool Manager
 * Manages multiple worker threads for parallel CPU-intensive processing
 */
export class WorkerPool extends EventEmitter {
  private config: WorkerPoolConfig;
  private workers: Map<string, ManagedWorker> = new Map();
  private taskQueues: Map<WorkerType, PendingTask[]> = new Map();
  private pendingTasks: Map<string, PendingTask> = new Map();
  private isInitialized = false;
  private isShuttingDown = false;
  private startTime: number = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;

  // Performance tracking
  private totalTasksProcessed = 0;
  private totalErrors = 0;
  private taskTimesByType: Map<WorkerType, number[]> = new Map();

  constructor(config?: Partial<WorkerPoolConfig>) {
    super();
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };

    // Initialize queues and time tracking for each worker type
    this.taskQueues.set('audio', []);
    this.taskQueues.set('embedding', []);
    this.taskTimesByType.set('audio', []);
    this.taskTimesByType.set('embedding', []);

    logger.info('WorkerPool created', {
      audioWorkers: this.config.audioWorkers,
      embeddingWorkers: this.config.embeddingWorkers,
    });
  }

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('WorkerPool already initialized');
      return;
    }

    this.startTime = Date.now();
    logger.info('Initializing worker pool...');

    try {
      // Create audio workers
      for (let i = 0; i < this.config.audioWorkers; i++) {
        await this.createWorker('audio');
      }

      // Create embedding workers
      for (let i = 0; i < this.config.embeddingWorkers; i++) {
        await this.createWorker('embedding');
      }

      // Start monitoring if enabled
      if (this.config.enableMonitoring) {
        this.startMonitoring();
      }

      this.isInitialized = true;
      logger.info('WorkerPool initialized', {
        totalWorkers: this.workers.size,
        audioWorkers: this.config.audioWorkers,
        embeddingWorkers: this.config.embeddingWorkers,
      });
    } catch (error) {
      logger.error('Failed to initialize worker pool', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create a new worker of the specified type
   */
  private async createWorker(type: WorkerType): Promise<ManagedWorker> {
    const workerId = `${type}-${generateMessageId()}`;
    const workerPath = this.getWorkerPath(type);

    logger.debug('Creating worker', { workerId, type, path: workerPath });

    const worker = new Worker(workerPath, {
      workerData: {
        workerId,
        workerType: type,
      },
    });

    const managedWorker: ManagedWorker = {
      worker,
      id: workerId,
      type,
      isBusy: false,
      currentTaskId: null,
      taskStartTime: null,
      tasksProcessed: 0,
      totalProcessingTime: 0,
      errorCount: 0,
      lastError: null,
      startTime: Date.now(),
      restartAttempts: 0,
      isTerminating: false,
    };

    // Set up worker event handlers
    this.setupWorkerHandlers(managedWorker);

    this.workers.set(workerId, managedWorker);
    this.emit('worker-started', workerId, type);
    logger.info('Worker created', { workerId, type });

    return managedWorker;
  }

  /**
   * Get the path to the worker script
   */
  private getWorkerPath(type: WorkerType): string {
    // Workers are always compiled to dist/main/workers/*.js by Vite
    // We need to resolve relative to the app's actual location
    const isDev = !app.isPackaged;
    
    // Get the base path - in dev it's the dist folder, in prod it's inside the asar
    let basePath: string;
    if (isDev) {
      // In development, workers are in dist/main/workers/
      basePath = path.join(app.getAppPath(), 'dist', 'main', 'workers');
    } else {
      // In production, workers are in resources/app/dist/main/workers/
      basePath = path.join(process.resourcesPath!, 'app', 'dist', 'main', 'workers');
    }

    switch (type) {
      case 'audio':
        return path.join(basePath, 'audio-worker.js');
      case 'embedding':
        return path.join(basePath, 'embedding-worker.js');
      default:
        throw new Error(`Unknown worker type: ${type}`);
    }
  }

  /**
   * Set up event handlers for a worker
   */
  private setupWorkerHandlers(managedWorker: ManagedWorker): void {
    const { worker, id: workerId, type } = managedWorker;

    // Handle messages from worker
    worker.on('message', (response: WorkerResponse) => {
      this.handleWorkerResponse(managedWorker, response);
    });

    // Handle worker errors
    worker.on('error', (error: Error) => {
      logger.error('Worker error', { workerId, type, error: error.message });
      managedWorker.errorCount++;
      managedWorker.lastError = error.message;
      this.totalErrors++;

      // Emit error event
      this.emit('error', error);

      // Reject current task if any
      if (managedWorker.currentTaskId) {
        const task = this.pendingTasks.get(managedWorker.currentTaskId);
        if (task) {
          this.rejectTask(task, new Error(`Worker error: ${error.message}`));
        }
      }
    });

    // Handle worker exit
    worker.on('exit', (code: number) => {
      logger.info('Worker exited', { workerId, type, code });

      // Clean up current task
      if (managedWorker.currentTaskId && !managedWorker.isTerminating) {
        const task = this.pendingTasks.get(managedWorker.currentTaskId);
        if (task) {
          this.rejectTask(task, new Error(`Worker exited unexpectedly with code ${code}`));
        }
      }

      // Remove worker from pool
      this.workers.delete(workerId);
      this.emit('worker-stopped', workerId, type);

      // Restart worker if needed
      if (
        !this.isShuttingDown &&
        !managedWorker.isTerminating &&
        this.config.autoRestart &&
        managedWorker.restartAttempts < this.config.maxRestartAttempts
      ) {
        this.emit('worker-crashed', workerId, type, new Error(`Exit code: ${code}`));
        setTimeout(() => {
          this.restartWorker(type, managedWorker.restartAttempts + 1);
        }, this.config.restartCooldown);
      }
    });

    // Handle online status
    worker.on('online', () => {
      logger.debug('Worker online', { workerId, type });
    });
  }

  /**
   * Handle response from a worker
   */
  private handleWorkerResponse(managedWorker: ManagedWorker, response: WorkerResponse): void {
    const task = this.pendingTasks.get(response.id);
    if (!task) {
      logger.warn('Received response for unknown task', { taskId: response.id });
      return;
    }

    // Clear timeout
    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
    }

    // Update worker stats
    managedWorker.isBusy = false;
    managedWorker.currentTaskId = null;
    managedWorker.tasksProcessed++;
    managedWorker.totalProcessingTime += response.processingTime;

    if (managedWorker.taskStartTime) {
      const taskDuration = Date.now() - managedWorker.taskStartTime;
      this.recordTaskTime(managedWorker.type, taskDuration);
      managedWorker.taskStartTime = null;
    }

    // Remove from pending
    this.pendingTasks.delete(response.id);
    this.totalTasksProcessed++;

    // Resolve or reject the task
    if (response.success) {
      this.emit(
        'task-completed',
        managedWorker.id,
        managedWorker.type,
        response.id,
        response.processingTime
      );
      task.resolve(response.result);
    } else {
      managedWorker.errorCount++;
      managedWorker.lastError = response.error || 'Unknown error';
      this.totalErrors++;
      this.emit(
        'task-failed',
        managedWorker.id,
        managedWorker.type,
        response.id,
        response.error || 'Unknown error'
      );
      task.reject(new Error(response.error || 'Worker task failed'));
    }

    // Process next task in queue
    this.processNextTask(managedWorker.type);
  }

  /**
   * Record task time for statistics
   */
  private recordTaskTime(type: WorkerType, duration: number): void {
    const times = this.taskTimesByType.get(type)!;
    times.push(duration);
    // Keep only last 100 times
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Restart a worker of the specified type
   */
  private async restartWorker(type: WorkerType, restartAttempts: number): Promise<void> {
    try {
      const newWorker = await this.createWorker(type);
      newWorker.restartAttempts = restartAttempts;
      this.emit('worker-restarted', newWorker.id, type);
      logger.info('Worker restarted', { workerId: newWorker.id, type, attempt: restartAttempts });
    } catch (error) {
      logger.error('Failed to restart worker', {
        type,
        attempt: restartAttempts,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Submit a task to a worker
   */
  async submitTask<T, R>(type: WorkerType, message: WorkerMessage<T>): Promise<R> {
    if (!this.isInitialized) {
      throw new Error('Worker pool not initialized');
    }

    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    // Check queue size
    const queue = this.taskQueues.get(type)!;
    if (queue.length >= this.config.maxQueueSize) {
      this.emit('queue-full', type, message.id);
      throw new Error(`Task queue full for worker type: ${type}`);
    }

    return new Promise<R>((resolve, reject) => {
      const task: PendingTask<T, R> = {
        id: message.id,
        message,
        resolve: resolve as (result: unknown) => void,
        reject,
        createdAt: Date.now(),
        timeoutHandle: null,
      };

      // Add to pending tasks
      this.pendingTasks.set(message.id, task as PendingTask);

      // Try to find an available worker
      const availableWorker = this.findAvailableWorker(type);
      if (availableWorker) {
        this.executeTask(availableWorker, task as PendingTask);
      } else {
        // Add to queue
        queue.push(task as PendingTask);
        logger.debug('Task queued', { taskId: message.id, type, queueSize: queue.length });
      }
    });
  }

  /**
   * Find an available worker of the specified type
   */
  private findAvailableWorker(type: WorkerType): ManagedWorker | null {
    for (const worker of this.workers.values()) {
      if (worker.type === type && !worker.isBusy && !worker.isTerminating) {
        return worker;
      }
    }
    return null;
  }

  /**
   * Execute a task on a worker
   */
  private executeTask(worker: ManagedWorker, task: PendingTask): void {
    // Set up timeout
    task.timeoutHandle = setTimeout(() => {
      this.handleTaskTimeout(worker, task);
    }, this.config.taskTimeout);

    // Mark worker as busy
    worker.isBusy = true;
    worker.currentTaskId = task.id;
    worker.taskStartTime = Date.now();

    // Send message to worker
    worker.worker.postMessage(task.message);

    logger.debug('Task sent to worker', {
      taskId: task.id,
      workerId: worker.id,
      type: worker.type,
    });
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout(worker: ManagedWorker, task: PendingTask): void {
    logger.warn('Task timeout', {
      taskId: task.id,
      workerId: worker.id,
      type: worker.type,
      queuedFor: Date.now() - task.createdAt,
    });

    // Emit timeout event
    this.emit('task-timeout', worker.id, worker.type, task.id);

    // Reject the task
    this.rejectTask(task, new Error('Task timeout'));

    // Reset worker state (it may still be processing, but we consider it timed out)
    worker.isBusy = false;
    worker.currentTaskId = null;
    worker.taskStartTime = null;
    worker.errorCount++;
    worker.lastError = 'Task timeout';
    this.totalErrors++;

    // Process next task
    this.processNextTask(worker.type);
  }

  /**
   * Reject a task with an error
   */
  private rejectTask(task: PendingTask, error: Error): void {
    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
    }
    this.pendingTasks.delete(task.id);
    task.reject(error);
  }

  /**
   * Process the next task in the queue for a worker type
   */
  private processNextTask(type: WorkerType): void {
    const queue = this.taskQueues.get(type)!;
    if (queue.length === 0) return;

    const availableWorker = this.findAvailableWorker(type);
    if (!availableWorker) return;

    const task = queue.shift()!;
    this.executeTask(availableWorker, task);
  }

  /**
   * Start performance monitoring
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) return;

    this.monitoringInterval = setInterval(() => {
      const stats = this.getStats();
      this.emit('stats-updated', stats);
      logger.debug('Worker pool stats', {
        totalTasks: stats.totalTasksProcessed,
        totalErrors: stats.totalErrors,
        queueSizes: stats.queueSizes,
      });
    }, this.config.monitoringInterval);
  }

  /**
   * Stop performance monitoring
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Get worker pool statistics
   */
  getStats(): WorkerPoolStats {
    const workerStatuses: WorkerStatus[] = [];
    const queueSizes: Record<WorkerType, number> = {
      audio: this.taskQueues.get('audio')!.length,
      embedding: this.taskQueues.get('embedding')!.length,
    };

    for (const worker of this.workers.values()) {
      const avgTime =
        worker.tasksProcessed > 0 ? worker.totalProcessingTime / worker.tasksProcessed : 0;

      workerStatuses.push({
        id: worker.id,
        type: worker.type,
        isBusy: worker.isBusy,
        tasksProcessed: worker.tasksProcessed,
        totalProcessingTime: worker.totalProcessingTime,
        averageProcessingTime: avgTime,
        errorCount: worker.errorCount,
        lastError: worker.lastError || undefined,
        uptime: Date.now() - worker.startTime,
        memoryUsage: 0, // Would require additional tracking
      });
    }

    // Calculate average task times and tasks per second by type
    const averageTaskTime: Record<WorkerType, number> = {
      audio: this.calculateAverageTaskTime('audio'),
      embedding: this.calculateAverageTaskTime('embedding'),
    };

    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = uptime / 1000;

    // Calculate tasks per second for each type
    const audioTasks = workerStatuses
      .filter((w) => w.type === 'audio')
      .reduce((sum, w) => sum + w.tasksProcessed, 0);
    const embeddingTasks = workerStatuses
      .filter((w) => w.type === 'embedding')
      .reduce((sum, w) => sum + w.tasksProcessed, 0);

    const tasksPerSecond: Record<WorkerType, number> = {
      audio: uptimeSeconds > 0 ? audioTasks / uptimeSeconds : 0,
      embedding: uptimeSeconds > 0 ? embeddingTasks / uptimeSeconds : 0,
    };

    return {
      uptime,
      totalTasksProcessed: this.totalTasksProcessed,
      totalErrors: this.totalErrors,
      queueSizes,
      workers: workerStatuses,
      averageTaskTime,
      tasksPerSecond,
    };
  }

  /**
   * Calculate average task time for a worker type
   */
  private calculateAverageTaskTime(type: WorkerType): number {
    const times = this.taskTimesByType.get(type)!;
    if (times.length === 0) return 0;
    return times.reduce((sum, t) => sum + t, 0) / times.length;
  }

  /**
   * Get the number of workers for a type
   */
  getWorkerCount(type: WorkerType): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.type === type) count++;
    }
    return count;
  }

  /**
   * Get queue size for a worker type
   */
  getQueueSize(type: WorkerType): number {
    return this.taskQueues.get(type)?.length || 0;
  }

  /**
   * Check if pool is ready
   */
  isReady(): boolean {
    return this.isInitialized && !this.isShuttingDown;
  }

  /**
   * Shutdown the worker pool gracefully
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Worker pool already shutting down');
      return;
    }

    this.isShuttingDown = true;
    logger.info('Shutting down worker pool...');

    // Stop monitoring
    this.stopMonitoring();

    // Cancel all pending tasks
    for (const task of this.pendingTasks.values()) {
      this.rejectTask(task, new Error('Worker pool shutting down'));
    }

    // Clear queues
    this.taskQueues.get('audio')!.length = 0;
    this.taskQueues.get('embedding')!.length = 0;

    // Terminate all workers
    const terminationPromises: Promise<number>[] = [];
    for (const managedWorker of this.workers.values()) {
      managedWorker.isTerminating = true;
      terminationPromises.push(managedWorker.worker.terminate());
    }

    // Wait for all workers to terminate
    try {
      await Promise.all(terminationPromises);
    } catch (error) {
      logger.error('Error terminating workers', { error: (error as Error).message });
    }

    // Clear workers map
    this.workers.clear();

    // Remove all listeners
    this.removeAllListeners();

    this.isInitialized = false;
    logger.info('Worker pool shutdown complete');
  }

  // Type-safe event emitter methods
  on<K extends keyof WorkerPoolEvents>(event: K, listener: WorkerPoolEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof WorkerPoolEvents>(event: K, listener: WorkerPoolEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof WorkerPoolEvents>(
    event: K,
    ...args: Parameters<WorkerPoolEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let workerPoolInstance: WorkerPool | null = null;

/**
 * Get or create the worker pool instance
 */
export async function getWorkerPool(
  config?: Partial<WorkerPoolConfig>
): Promise<WorkerPool> {
  if (!workerPoolInstance) {
    workerPoolInstance = new WorkerPool(config);
    await workerPoolInstance.initialize();
  }
  return workerPoolInstance;
}

/**
 * Shutdown the worker pool
 */
export async function shutdownWorkerPool(): Promise<void> {
  if (workerPoolInstance) {
    await workerPoolInstance.shutdown();
    workerPoolInstance = null;
  }
}

export default WorkerPool;
