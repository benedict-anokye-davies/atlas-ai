/**
 * @fileoverview Cron/Scheduler - Background Task Automation
 * @module gateway/cron
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * The Cron/Scheduler system enables Atlas to perform automated tasks
 * on schedules or in response to events. It supports:
 * - Cron expression scheduling (minute/hour/day/etc.)
 * - One-time scheduled tasks
 * - Recurring tasks with intervals
 * - Event-triggered tasks
 * - Task persistence and recovery
 *
 * @see https://docs.clawd.bot/tools/cron
 *
 * @example
 * import { CronScheduler, getCronScheduler } from './cron';
 *
 * const scheduler = getCronScheduler();
 *
 * // Schedule a daily task
 * scheduler.schedule({
 *   name: 'daily-summary',
 *   cron: '0 9 * * *', // 9 AM daily
 *   action: { type: 'message', channel: 'desktop', content: 'Good morning!' },
 * });
 *
 * // Schedule a one-time reminder
 * scheduler.scheduleOnce({
 *   name: 'meeting-reminder',
 *   runAt: Date.now() + 3600000, // 1 hour from now
 *   action: { type: 'notify', title: 'Meeting starts soon' },
 * });
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CronScheduler');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Cron expression parts
 * 
 * Format: minute hour day-of-month month day-of-week
 * Example: '0 9 * * 1-5' = 9 AM on weekdays
 */
export interface CronExpression {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/**
 * Task action types
 */
export type TaskActionType =
  | 'message'      // Send a message to a channel
  | 'tool'         // Execute a tool
  | 'notify'       // Send a notification
  | 'function'     // Run a custom function
  | 'http'         // Make an HTTP request
  | 'workflow';    // Trigger a workflow

/**
 * Base task action
 */
export interface TaskAction {
  type: TaskActionType;
  /** Additional action parameters */
  params?: Record<string, unknown>;
}

/**
 * Message action - send a message to a channel
 */
export interface MessageAction extends TaskAction {
  type: 'message';
  /** Target channel */
  channel: string;
  /** Message content */
  content: string;
  /** Session to send to (optional) */
  sessionId?: string;
}

/**
 * Tool action - execute an Atlas tool
 */
export interface ToolAction extends TaskAction {
  type: 'tool';
  /** Tool name */
  tool: string;
  /** Tool parameters */
  toolParams: Record<string, unknown>;
}

/**
 * Notify action - send a notification
 */
export interface NotifyAction extends TaskAction {
  type: 'notify';
  /** Notification title */
  title: string;
  /** Notification body */
  body?: string;
  /** Target (desktop, node, etc.) */
  target?: string;
}

/**
 * Function action - run a registered function
 */
export interface FunctionAction extends TaskAction {
  type: 'function';
  /** Function name (must be registered) */
  functionName: string;
  /** Function arguments */
  args?: unknown[];
}

/**
 * HTTP action - make an HTTP request
 */
export interface HttpAction extends TaskAction {
  type: 'http';
  /** Request URL */
  url: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
}

/**
 * Workflow action - trigger a workflow
 */
export interface WorkflowAction extends TaskAction {
  type: 'workflow';
  /** Workflow ID */
  workflowId: string;
  /** Workflow input */
  input?: Record<string, unknown>;
}

/**
 * All action types
 */
export type AnyTaskAction =
  | MessageAction
  | ToolAction
  | NotifyAction
  | FunctionAction
  | HttpAction
  | WorkflowAction;

/**
 * Task state
 */
export type TaskState = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Scheduled task definition
 */
export interface ScheduledTask {
  /** Unique task ID */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Task description */
  description?: string;
  /** Cron expression (for recurring tasks) */
  cron?: string;
  /** Interval in ms (alternative to cron) */
  interval?: number;
  /** One-time run timestamp (for scheduled tasks) */
  runAt?: number;
  /** Task action to perform */
  action: AnyTaskAction;
  /** Task state */
  state: TaskState;
  /** Task creation time */
  createdAt: number;
  /** Last run time */
  lastRunAt?: number;
  /** Next scheduled run time */
  nextRunAt?: number;
  /** Number of times task has run */
  runCount: number;
  /** Last run result */
  lastResult?: {
    success: boolean;
    result?: unknown;
    error?: string;
    duration: number;
  };
  /** Maximum number of runs (0 = unlimited) */
  maxRuns?: number;
  /** Task tags for organization */
  tags?: string[];
  /** Task metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task creation options
 */
export interface CreateTaskOptions {
  name: string;
  description?: string;
  cron?: string;
  interval?: number;
  runAt?: number;
  action: AnyTaskAction;
  maxRuns?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  timestamp: number;
}

// =============================================================================
// Cron Parser
// =============================================================================

/**
 * Parse a cron expression into its parts
 * 
 * @param expression - Cron expression string
 * @returns Parsed cron expression
 */
function parseCronExpression(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}. Expected 5 parts.`);
  }

  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
}

/**
 * Check if a cron part matches a value
 * 
 * @param part - Cron part (e.g., '*', '0', '1-5', '0,15,30,45')
 * @param value - Value to check
 * @param max - Maximum value for the field
 */
function cronPartMatches(part: string, value: number, max: number): boolean {
  if (part === '*') {
    return true;
  }

  // Handle step values (*/5)
  if (part.startsWith('*/')) {
    const step = parseInt(part.slice(2), 10);
    return value % step === 0;
  }

  // Handle ranges (1-5)
  if (part.includes('-')) {
    const [start, end] = part.split('-').map((p) => parseInt(p, 10));
    return value >= start && value <= end;
  }

  // Handle lists (0,15,30,45)
  if (part.includes(',')) {
    const values = part.split(',').map((p) => parseInt(p, 10));
    return values.includes(value);
  }

  // Simple value match
  return parseInt(part, 10) === value;
}

/**
 * Check if a date matches a cron expression
 * 
 * @param cron - Parsed cron expression
 * @param date - Date to check
 */
function cronMatches(cron: CronExpression, date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JavaScript months are 0-indexed
  const dayOfWeek = date.getDay(); // 0 = Sunday

  return (
    cronPartMatches(cron.minute, minute, 59) &&
    cronPartMatches(cron.hour, hour, 23) &&
    cronPartMatches(cron.dayOfMonth, dayOfMonth, 31) &&
    cronPartMatches(cron.month, month, 12) &&
    cronPartMatches(cron.dayOfWeek, dayOfWeek, 6)
  );
}

/**
 * Calculate next run time for a cron expression
 * 
 * @param cron - Cron expression string
 * @param from - Start time
 * @returns Next run timestamp
 */
function getNextCronRun(cron: string, from: Date = new Date()): number {
  const parsed = parseCronExpression(cron);
  const next = new Date(from);
  
  // Start from the next minute
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Search for next matching time (max 1 year)
  const maxIterations = 525600; // minutes in a year
  
  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(parsed, next)) {
      return next.getTime();
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error('Could not find next run time within a year');
}

// =============================================================================
// Cron Scheduler Class
// =============================================================================

/**
 * Atlas Cron Scheduler
 * 
 * Manages background task scheduling and execution. Supports cron expressions,
 * intervals, and one-time scheduled tasks.
 * 
 * @class CronScheduler
 * @extends EventEmitter
 * 
 * @example
 * const scheduler = new CronScheduler();
 * await scheduler.start();
 * 
 * // Schedule a recurring task
 * scheduler.schedule({
 *   name: 'hourly-check',
 *   cron: '0 * * * *', // Every hour
 *   action: { type: 'tool', tool: 'health-check', toolParams: {} },
 * });
 */
export class CronScheduler extends EventEmitter {
  private _tasks: Map<string, ScheduledTask> = new Map();
  private _timers: Map<string, NodeJS.Timeout> = new Map();
  private _tickTimer: NodeJS.Timeout | null = null;
  private _isRunning: boolean = false;
  private _functions: Map<string, (...args: unknown[]) => Promise<unknown>> = new Map();

  // Handlers for different action types
  private _actionHandlers: Map<TaskActionType, (action: AnyTaskAction) => Promise<unknown>> =
    new Map();

  constructor() {
    super();
    this._registerDefaultHandlers();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this._isRunning = true;

    // Start tick timer (checks cron tasks every minute)
    this._tickTimer = setInterval(() => {
      this._tick();
    }, 60000); // 1 minute

    // Run initial tick
    this._tick();

    // Schedule all interval and one-time tasks
    for (const task of this._tasks.values()) {
      if (task.state === 'active') {
        this._scheduleTask(task);
      }
    }

    logger.info('Cron scheduler started');
    this.emit('started');
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    // Stop tick timer
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }

    // Clear all timers
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();

    this._isRunning = false;
    logger.info('Cron scheduler stopped');
    this.emit('stopped');
  }

  // ===========================================================================
  // Task Management
  // ===========================================================================

  /**
   * Schedule a new task
   * 
   * @param options - Task options
   * @returns Created task
   */
  schedule(options: CreateTaskOptions): ScheduledTask {
    // Validate that at least one scheduling method is provided
    if (!options.cron && !options.interval && !options.runAt) {
      throw new Error('Task must have cron, interval, or runAt');
    }

    const taskId = uuidv4();
    const now = Date.now();

    const task: ScheduledTask = {
      id: taskId,
      name: options.name,
      description: options.description,
      cron: options.cron,
      interval: options.interval,
      runAt: options.runAt,
      action: options.action,
      state: 'active',
      createdAt: now,
      runCount: 0,
      maxRuns: options.maxRuns,
      tags: options.tags,
      metadata: options.metadata,
    };

    // Calculate next run time
    if (options.runAt) {
      task.nextRunAt = options.runAt;
    } else if (options.cron) {
      task.nextRunAt = getNextCronRun(options.cron);
    } else if (options.interval) {
      task.nextRunAt = now + options.interval;
    }

    this._tasks.set(taskId, task);

    // Schedule if running
    if (this._isRunning && task.state === 'active') {
      this._scheduleTask(task);
    }

    logger.info('Task scheduled', {
      taskId,
      name: options.name,
      nextRunAt: task.nextRunAt ? new Date(task.nextRunAt).toISOString() : null,
    });

    this.emit('task-scheduled', task);

    return task;
  }

  /**
   * Schedule a one-time task
   * 
   * Convenience method for tasks that run once at a specific time
   * 
   * @param options - Task options (without cron/interval)
   * @returns Created task
   */
  scheduleOnce(options: Omit<CreateTaskOptions, 'cron' | 'interval'>): ScheduledTask {
    if (!options.runAt) {
      throw new Error('runAt is required for one-time tasks');
    }

    return this.schedule({
      ...options,
      maxRuns: 1,
    });
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this._tasks.get(taskId);
  }

  /**
   * List all tasks
   */
  listTasks(filter?: { state?: TaskState; tags?: string[] }): ScheduledTask[] {
    const tasks: ScheduledTask[] = [];

    for (const task of this._tasks.values()) {
      if (filter?.state && task.state !== filter.state) {
        continue;
      }

      if (filter?.tags) {
        const taskTags = task.tags || [];
        if (!filter.tags.some((t) => taskTags.includes(t))) {
          continue;
        }
      }

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Pause a task
   */
  pauseTask(taskId: string): boolean {
    const task = this._tasks.get(taskId);
    if (!task || task.state !== 'active') {
      return false;
    }

    task.state = 'paused';
    
    // Clear any scheduled timer
    const timer = this._timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(taskId);
    }

    logger.info('Task paused', { taskId });
    this.emit('task-paused', task);
    return true;
  }

  /**
   * Resume a paused task
   */
  resumeTask(taskId: string): boolean {
    const task = this._tasks.get(taskId);
    if (!task || task.state !== 'paused') {
      return false;
    }

    task.state = 'active';

    // Reschedule
    if (this._isRunning) {
      this._scheduleTask(task);
    }

    logger.info('Task resumed', { taskId });
    this.emit('task-resumed', task);
    return true;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const task = this._tasks.get(taskId);
    if (!task) {
      return false;
    }

    task.state = 'cancelled';

    // Clear any scheduled timer
    const timer = this._timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(taskId);
    }

    logger.info('Task cancelled', { taskId });
    this.emit('task-cancelled', task);
    return true;
  }

  /**
   * Delete a task entirely
   */
  deleteTask(taskId: string): boolean {
    const task = this._tasks.get(taskId);
    if (!task) {
      return false;
    }

    // Clear timer
    const timer = this._timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(taskId);
    }

    this._tasks.delete(taskId);

    logger.info('Task deleted', { taskId });
    this.emit('task-deleted', task);
    return true;
  }

  /**
   * Run a task immediately (manual trigger)
   */
  async runTask(taskId: string): Promise<TaskExecutionResult> {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    return this._executeTask(task);
  }

  // ===========================================================================
  // Function Registration
  // ===========================================================================

  /**
   * Register a function that can be called by tasks
   * 
   * @param name - Function name
   * @param fn - Function implementation
   */
  registerFunction(name: string, fn: (...args: unknown[]) => Promise<unknown>): void {
    this._functions.set(name, fn);
    logger.debug('Function registered', { name });
  }

  /**
   * Unregister a function
   */
  unregisterFunction(name: string): void {
    this._functions.delete(name);
  }

  // ===========================================================================
  // Action Handlers
  // ===========================================================================

  /**
   * Register default action handlers
   */
  private _registerDefaultHandlers(): void {
    // Message action - emit event for gateway to handle
    this._actionHandlers.set('message', async (action) => {
      const msg = action as MessageAction;
      this.emit('send-message', msg);
      return { sent: true };
    });

    // Notify action - emit event for notification system
    this._actionHandlers.set('notify', async (action) => {
      const notify = action as NotifyAction;
      this.emit('send-notification', notify);
      return { notified: true };
    });

    // Function action - call registered function
    this._actionHandlers.set('function', async (action) => {
      const fn = action as FunctionAction;
      const func = this._functions.get(fn.functionName);
      if (!func) {
        throw new Error(`Function not registered: ${fn.functionName}`);
      }
      return func(...(fn.args || []));
    });

    // HTTP action - make HTTP request
    this._actionHandlers.set('http', async (action) => {
      const http = action as HttpAction;
      const response = await fetch(http.url, {
        method: http.method,
        headers: http.headers,
        body: http.body ? JSON.stringify(http.body) : undefined,
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    });

    // Tool action - emit event for agent to handle
    this._actionHandlers.set('tool', async (action) => {
      const tool = action as ToolAction;
      this.emit('execute-tool', tool);
      return { queued: true };
    });

    // Workflow action - emit event for workflow manager
    this._actionHandlers.set('workflow', async (action) => {
      const workflow = action as WorkflowAction;
      this.emit('trigger-workflow', workflow);
      return { triggered: true };
    });
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(
    type: TaskActionType,
    handler: (action: AnyTaskAction) => Promise<unknown>
  ): void {
    this._actionHandlers.set(type, handler);
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Tick handler - checks cron tasks every minute
   */
  private _tick(): void {
    const now = new Date();
    
    for (const task of this._tasks.values()) {
      if (task.state !== 'active' || !task.cron) {
        continue;
      }

      try {
        const cron = parseCronExpression(task.cron);
        if (cronMatches(cron, now)) {
          // Execute task asynchronously
          this._executeTask(task).catch((error) => {
            logger.error('Task execution failed', { taskId: task.id, error });
          });
        }
      } catch (error) {
        logger.error('Failed to check cron task', { taskId: task.id, error });
      }
    }
  }

  /**
   * Schedule a task (for interval and one-time tasks)
   */
  private _scheduleTask(task: ScheduledTask): void {
    // Clear existing timer
    const existingTimer = this._timers.get(task.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Cron tasks are handled by tick, not individual timers
    if (task.cron) {
      task.nextRunAt = getNextCronRun(task.cron);
      return;
    }

    // Calculate delay
    let delay: number;

    if (task.runAt) {
      delay = task.runAt - Date.now();
    } else if (task.interval) {
      delay = task.interval;
    } else {
      return;
    }

    // Don't schedule if delay is negative
    if (delay <= 0) {
      // Run immediately
      this._executeTask(task).catch((error) => {
        logger.error('Task execution failed', { taskId: task.id, error });
      });
      return;
    }

    // Schedule
    const timer = setTimeout(() => {
      this._timers.delete(task.id);
      this._executeTask(task).catch((error) => {
        logger.error('Task execution failed', { taskId: task.id, error });
      });
    }, delay);

    this._timers.set(task.id, timer);
    task.nextRunAt = Date.now() + delay;
  }

  /**
   * Execute a task
   */
  private async _executeTask(task: ScheduledTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    logger.info('Executing task', { taskId: task.id, name: task.name });

    const result: TaskExecutionResult = {
      taskId: task.id,
      success: false,
      timestamp: startTime,
      duration: 0,
    };

    try {
      const handler = this._actionHandlers.get(task.action.type);
      if (!handler) {
        throw new Error(`No handler for action type: ${task.action.type}`);
      }

      result.result = await handler(task.action);
      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Task execution error', { taskId: task.id, error });
    }

    result.duration = Date.now() - startTime;

    // Update task state
    task.lastRunAt = startTime;
    task.runCount++;
    task.lastResult = {
      success: result.success,
      result: result.result,
      error: result.error,
      duration: result.duration,
    };

    // Check max runs
    if (task.maxRuns && task.runCount >= task.maxRuns) {
      task.state = 'completed';
      task.nextRunAt = undefined;
      logger.info('Task completed (max runs reached)', { taskId: task.id });
      this.emit('task-completed', task);
    } else if (task.interval && task.state === 'active') {
      // Reschedule interval tasks
      this._scheduleTask(task);
    } else if (task.cron && task.state === 'active') {
      // Update next run for cron tasks
      task.nextRunAt = getNextCronRun(task.cron);
    } else if (task.runAt && task.state === 'active') {
      // One-time task completed
      task.state = 'completed';
      task.nextRunAt = undefined;
      this.emit('task-completed', task);
    }

    this.emit('task-executed', task, result);

    return result;
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  get isRunning(): boolean {
    return this._isRunning;
  }

  get taskCount(): number {
    return this._tasks.size;
  }

  get activeTaskCount(): number {
    let count = 0;
    for (const task of this._tasks.values()) {
      if (task.state === 'active') {
        count++;
      }
    }
    return count;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let cronSchedulerInstance: CronScheduler | null = null;

/**
 * Get the cron scheduler singleton instance
 */
export function getCronScheduler(): CronScheduler {
  if (!cronSchedulerInstance) {
    cronSchedulerInstance = new CronScheduler();
  }
  return cronSchedulerInstance;
}

/**
 * Start the cron scheduler
 */
export async function startCronScheduler(): Promise<void> {
  const scheduler = getCronScheduler();
  await scheduler.start();
}

/**
 * Stop and shutdown the cron scheduler
 */
export async function shutdownCronScheduler(): Promise<void> {
  if (cronSchedulerInstance) {
    await cronSchedulerInstance.stop();
    cronSchedulerInstance = null;
  }
}

export default CronScheduler;
