/**
 * Atlas Desktop - Cross-Session Task Continuity
 * Persist incomplete tasks across app restarts
 *
 * Features:
 * - Auto-save task state on exit
 * - Resume tasks on startup
 * - Task progress tracking
 * - Dependency management between tasks
 * - Smart task prioritization
 *
 * @module agent/task-continuity
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TaskContinuity');

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface PersistentTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  steps: TaskStep[];
  currentStepIndex: number;
  context: Record<string, unknown>;
  dependencies: string[]; // IDs of tasks that must complete first
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
  estimatedDuration?: number; // in minutes
  actualDuration?: number; // in minutes
  tags: string[];
  retryCount: number;
  maxRetries: number;
  parentTaskId?: string;
  childTaskIds: string[];
}

export interface TaskProgress {
  taskId: string;
  completedSteps: number;
  totalSteps: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}

export interface TaskContinuityEvents {
  'task-created': (task: PersistentTask) => void;
  'task-updated': (task: PersistentTask) => void;
  'task-resumed': (task: PersistentTask) => void;
  'task-completed': (task: PersistentTask) => void;
  'task-failed': (task: PersistentTask, error: string) => void;
  'task-paused': (task: PersistentTask) => void;
  'step-completed': (task: PersistentTask, step: TaskStep) => void;
  'tasks-loaded': (count: number) => void;
  error: (error: Error) => void;
}

export interface TaskFilter {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  tags?: string[];
  createdAfter?: number;
  createdBefore?: number;
}

// ============================================================================
// Task Continuity Manager
// ============================================================================

export class TaskContinuityManager extends EventEmitter {
  private tasks: Map<string, PersistentTask> = new Map();
  private storagePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'task-continuity.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadTasks();
      this.startAutoSave();
      this.setupShutdownHook();
      logger.info('TaskContinuityManager initialized', {
        taskCount: this.tasks.size,
        pendingTasks: this.getTasksByStatus('pending').length,
        inProgressTasks: this.getTasksByStatus('in_progress').length,
      });
    } catch (error) {
      logger.error('Failed to initialize task continuity', { error });
      this.emit('error', error as Error);
    }
  }

  private async loadTasks(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        if (data.tasks && Array.isArray(data.tasks)) {
          for (const task of data.tasks) {
            // Mark in_progress tasks as paused (they were interrupted)
            if (task.status === 'in_progress') {
              task.status = 'paused';
              task.pausedAt = Date.now();
            }
            this.tasks.set(task.id, task);
          }
        }
        this.emit('tasks-loaded', this.tasks.size);
      }
    } catch (error) {
      logger.error('Failed to load tasks', { error });
    }
  }

  private async saveTasks(): Promise<void> {
    if (!this.isDirty) return;

    try {
      const data = {
        version: 1,
        savedAt: Date.now(),
        tasks: Array.from(this.tasks.values()),
      };
      await fs.writeJson(this.storagePath, data, { spaces: 2 });
      this.isDirty = false;
      logger.debug('Tasks saved', { count: this.tasks.size });
    } catch (error) {
      logger.error('Failed to save tasks', { error });
    }
  }

  private startAutoSave(): void {
    this.autoSaveInterval = setInterval(() => {
      this.saveTasks();
    }, 30000); // Save every 30 seconds
  }

  private setupShutdownHook(): void {
    app.on('before-quit', async () => {
      await this.saveTasks();
    });
  }

  // ============================================================================
  // Task Creation
  // ============================================================================

  /**
   * Create a new persistent task
   */
  createTask(options: {
    title: string;
    description: string;
    steps?: Array<{ description: string }>;
    priority?: TaskPriority;
    dependencies?: string[];
    tags?: string[];
    context?: Record<string, unknown>;
    estimatedDuration?: number;
    parentTaskId?: string;
  }): PersistentTask {
    const id = this.generateId();
    const now = Date.now();

    const task: PersistentTask = {
      id,
      title: options.title,
      description: options.description,
      status: 'pending',
      priority: options.priority || 'medium',
      steps:
        options.steps?.map((s, i) => ({
          id: `${id}-step-${i}`,
          description: s.description,
          status: 'pending' as TaskStatus,
        })) || [],
      currentStepIndex: 0,
      context: options.context || {},
      dependencies: options.dependencies || [],
      createdAt: now,
      updatedAt: now,
      tags: options.tags || [],
      retryCount: 0,
      maxRetries: 3,
      parentTaskId: options.parentTaskId,
      childTaskIds: [],
      estimatedDuration: options.estimatedDuration,
    };

    // If this is a subtask, update parent
    if (options.parentTaskId) {
      const parent = this.tasks.get(options.parentTaskId);
      if (parent) {
        parent.childTaskIds.push(id);
        parent.updatedAt = now;
      }
    }

    this.tasks.set(id, task);
    this.isDirty = true;
    this.emit('task-created', task);
    logger.info('Task created', { id, title: options.title, steps: task.steps.length });

    return task;
  }

  /**
   * Create a task from a natural language description
   */
  createTaskFromDescription(description: string, context?: Record<string, unknown>): PersistentTask {
    // Parse description to extract title and steps
    const lines = description.split('\n').filter((l) => l.trim());
    const title = lines[0] || 'Untitled Task';

    // Look for numbered steps or bullet points
    const stepPatterns = [/^\d+\.\s*(.+)$/, /^[-*]\s*(.+)$/, /^Step\s*\d*:?\s*(.+)$/i];

    const steps: Array<{ description: string }> = [];
    for (const line of lines.slice(1)) {
      for (const pattern of stepPatterns) {
        const match = line.match(pattern);
        if (match) {
          steps.push({ description: match[1].trim() });
          break;
        }
      }
    }

    // If no steps found, create a single step with the full description
    if (steps.length === 0) {
      steps.push({ description: description });
    }

    return this.createTask({
      title,
      description,
      steps,
      context,
    });
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // ============================================================================
  // Task Execution
  // ============================================================================

  /**
   * Start or resume a task
   */
  startTask(taskId: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn('Task not found', { taskId });
      return null;
    }

    // Check dependencies
    const blockedBy = this.getBlockingDependencies(task);
    if (blockedBy.length > 0) {
      logger.warn('Task blocked by dependencies', {
        taskId,
        blockedBy: blockedBy.map((t) => t.id),
      });
      return task;
    }

    const wasResumed = task.status === 'paused';

    task.status = 'in_progress';
    task.updatedAt = Date.now();

    if (!task.startedAt) {
      task.startedAt = Date.now();
    }

    // Mark current step as in progress
    if (task.steps[task.currentStepIndex]) {
      task.steps[task.currentStepIndex].status = 'in_progress';
      task.steps[task.currentStepIndex].startedAt = Date.now();
    }

    this.isDirty = true;

    if (wasResumed) {
      this.emit('task-resumed', task);
      logger.info('Task resumed', { taskId, step: task.currentStepIndex });
    } else {
      this.emit('task-updated', task);
      logger.info('Task started', { taskId });
    }

    return task;
  }

  /**
   * Pause a task
   */
  pauseTask(taskId: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'in_progress') {
      return task || null;
    }

    task.status = 'paused';
    task.pausedAt = Date.now();
    task.updatedAt = Date.now();

    // Pause current step
    if (task.steps[task.currentStepIndex]) {
      task.steps[task.currentStepIndex].status = 'paused';
    }

    this.isDirty = true;
    this.emit('task-paused', task);
    logger.info('Task paused', { taskId, step: task.currentStepIndex });

    return task;
  }

  /**
   * Complete the current step and move to the next
   */
  completeStep(taskId: string, result?: unknown): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'in_progress') {
      return task || null;
    }

    const currentStep = task.steps[task.currentStepIndex];
    if (!currentStep) {
      return task;
    }

    // Complete current step
    currentStep.status = 'completed';
    currentStep.completedAt = Date.now();
    currentStep.result = result;

    this.emit('step-completed', task, currentStep);
    logger.info('Step completed', {
      taskId,
      stepIndex: task.currentStepIndex,
      totalSteps: task.steps.length,
    });

    // Move to next step
    task.currentStepIndex++;
    task.updatedAt = Date.now();

    // Check if all steps are complete
    if (task.currentStepIndex >= task.steps.length) {
      this.completeTask(taskId);
    } else {
      // Start next step
      task.steps[task.currentStepIndex].status = 'in_progress';
      task.steps[task.currentStepIndex].startedAt = Date.now();
      this.emit('task-updated', task);
    }

    this.isDirty = true;
    return task;
  }

  /**
   * Fail the current step
   */
  failStep(taskId: string, error: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const currentStep = task.steps[task.currentStepIndex];
    if (!currentStep) return task;

    currentStep.status = 'failed';
    currentStep.error = error;
    currentStep.completedAt = Date.now();
    task.updatedAt = Date.now();

    // Check retry logic
    task.retryCount++;
    if (task.retryCount < task.maxRetries) {
      // Reset step for retry
      currentStep.status = 'pending';
      currentStep.error = undefined;
      currentStep.completedAt = undefined;
      task.status = 'paused';
      logger.info('Step failed, will retry', {
        taskId,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      });
    } else {
      this.failTask(taskId, error);
    }

    this.isDirty = true;
    return task;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    if (task.startedAt) {
      task.actualDuration = Math.round((task.completedAt - task.startedAt) / 60000);
    }

    this.isDirty = true;
    this.emit('task-completed', task);
    logger.info('Task completed', { taskId, duration: task.actualDuration });

    return task;
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = 'failed';
    task.updatedAt = Date.now();

    this.isDirty = true;
    this.emit('task-failed', task, error);
    logger.error('Task failed', { taskId, error });

    return task;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = 'cancelled';
    task.updatedAt = Date.now();

    // Cancel child tasks too
    for (const childId of task.childTaskIds) {
      this.cancelTask(childId);
    }

    this.isDirty = true;
    this.emit('task-updated', task);
    logger.info('Task cancelled', { taskId });

    return task;
  }

  // ============================================================================
  // Task Queries
  // ============================================================================

  /**
   * Get a task by ID
   */
  getTask(taskId: string): PersistentTask | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): PersistentTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): PersistentTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  /**
   * Get tasks that can be resumed
   */
  getResumableTasks(): PersistentTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => (t.status === 'paused' || t.status === 'pending') && this.getBlockingDependencies(t).length === 0
    );
  }

  /**
   * Get tasks matching a filter
   */
  filterTasks(filter: TaskFilter): PersistentTask[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (filter.status && !filter.status.includes(task.status)) return false;
      if (filter.priority && !filter.priority.includes(task.priority)) return false;
      if (filter.tags && !filter.tags.some((tag) => task.tags.includes(tag))) return false;
      if (filter.createdAfter && task.createdAt < filter.createdAfter) return false;
      if (filter.createdBefore && task.createdAt > filter.createdBefore) return false;
      return true;
    });
  }

  /**
   * Get tasks blocking a given task
   */
  getBlockingDependencies(task: PersistentTask): PersistentTask[] {
    return task.dependencies
      .map((id) => this.tasks.get(id))
      .filter((t): t is PersistentTask => t !== undefined && t.status !== 'completed');
  }

  /**
   * Get task progress
   */
  getTaskProgress(taskId: string): TaskProgress | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const completedSteps = task.steps.filter((s) => s.status === 'completed').length;
    const totalSteps = task.steps.length;
    const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    let estimatedTimeRemaining: number | undefined;
    if (task.estimatedDuration && totalSteps > 0) {
      const remainingSteps = totalSteps - completedSteps;
      const timePerStep = task.estimatedDuration / totalSteps;
      estimatedTimeRemaining = Math.round(remainingSteps * timePerStep);
    }

    return {
      taskId,
      completedSteps,
      totalSteps,
      percentage,
      estimatedTimeRemaining,
    };
  }

  // ============================================================================
  // Task Context
  // ============================================================================

  /**
   * Update task context
   */
  updateContext(taskId: string, context: Record<string, unknown>): PersistentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.context = { ...task.context, ...context };
    task.updatedAt = Date.now();
    this.isDirty = true;

    return task;
  }

  /**
   * Get task context
   */
  getContext(taskId: string): Record<string, unknown> | null {
    return this.tasks.get(taskId)?.context || null;
  }

  // ============================================================================
  // Smart Features
  // ============================================================================

  /**
   * Get suggested next tasks based on priority and dependencies
   */
  getSuggestedNextTasks(limit = 5): PersistentTask[] {
    const resumable = this.getResumableTasks();

    // Sort by priority and age
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return resumable
      .sort((a, b) => {
        // First by priority
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        // Then by age (older first)
        return a.createdAt - b.createdAt;
      })
      .slice(0, limit);
  }

  /**
   * Generate a task summary for LLM context
   */
  getTaskSummaryForLLM(): string {
    const inProgress = this.getTasksByStatus('in_progress');
    const paused = this.getTasksByStatus('paused');
    const pending = this.getTasksByStatus('pending');

    const lines: string[] = ['## Current Tasks'];

    if (inProgress.length > 0) {
      lines.push('\n### In Progress');
      for (const task of inProgress) {
        const progress = this.getTaskProgress(task.id);
        lines.push(
          `- **${task.title}**: Step ${task.currentStepIndex + 1}/${task.steps.length} - ${task.steps[task.currentStepIndex]?.description || 'Unknown'} (${progress?.percentage}% complete)`
        );
      }
    }

    if (paused.length > 0) {
      lines.push('\n### Paused (Can Resume)');
      for (const task of paused.slice(0, 5)) {
        const progress = this.getTaskProgress(task.id);
        lines.push(`- **${task.title}**: ${progress?.percentage}% complete, paused at: ${task.steps[task.currentStepIndex]?.description || 'Unknown'}`);
      }
    }

    if (pending.length > 0) {
      lines.push('\n### Pending');
      for (const task of pending.slice(0, 5)) {
        lines.push(`- **${task.title}**: ${task.steps.length} steps`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove from parent
    if (task.parentTaskId) {
      const parent = this.tasks.get(task.parentTaskId);
      if (parent) {
        parent.childTaskIds = parent.childTaskIds.filter((id) => id !== taskId);
      }
    }

    // Delete children recursively
    for (const childId of task.childTaskIds) {
      this.deleteTask(childId);
    }

    this.tasks.delete(taskId);
    this.isDirty = true;
    logger.info('Task deleted', { taskId });

    return true;
  }

  /**
   * Delete old completed tasks
   */
  cleanupCompletedTasks(olderThanDays = 30): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let count = 0;

    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' && task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id);
        count++;
      }
    }

    if (count > 0) {
      this.isDirty = true;
      logger.info('Cleaned up old tasks', { count });
    }

    return count;
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    await this.saveTasks();
    logger.info('TaskContinuityManager shutdown complete');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let taskContinuityManager: TaskContinuityManager | null = null;

export function getTaskContinuityManager(): TaskContinuityManager {
  if (!taskContinuityManager) {
    taskContinuityManager = new TaskContinuityManager();
  }
  return taskContinuityManager;
}
