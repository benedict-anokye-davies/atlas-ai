/**
 * Atlas Desktop - Task Scheduler
 * Reminders and scheduled tasks
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getSmartNotificationsManager } from './smart-notifications';

const logger = createModuleLogger('TaskScheduler');

/**
 * Task priority
 */
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * Task recurrence type
 */
export type RecurrenceType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

/**
 * Scheduled task
 */
export interface ScheduledTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  scheduledAt: number;
  recurrence: TaskRecurrence;
  reminders: ReminderConfig[];
  category?: string;
  tags?: string[];
  completed: boolean;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Task recurrence configuration
 */
export interface TaskRecurrence {
  type: RecurrenceType;
  /** For weekly: days of week (0-6, Sunday-Saturday) */
  daysOfWeek?: number[];
  /** For monthly: day of month (1-31) */
  dayOfMonth?: number;
  /** For custom: interval in milliseconds */
  intervalMs?: number;
  /** End date for recurring tasks */
  endDate?: number;
  /** Number of occurrences */
  maxOccurrences?: number;
  /** Current occurrence count */
  occurrenceCount?: number;
}

/**
 * Reminder configuration
 */
export interface ReminderConfig {
  /** Minutes before scheduled time to remind */
  minutesBefore: number;
  /** Whether this reminder has been sent */
  sent: boolean;
}

/**
 * Task status
 */
export type TaskStatus = 'pending' | 'due' | 'overdue' | 'completed' | 'cancelled';

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Enable task scheduling */
  enabled: boolean;
  /** Default reminder times (minutes before) */
  defaultReminders: number[];
  /** Check interval for due tasks (ms) */
  checkIntervalMs: number;
  /** Auto-complete overdue tasks after this time (ms) */
  autoCompleteAfterMs?: number;
  /** Maximum active tasks */
  maxActiveTasks: number;
}

/**
 * Default scheduler configuration
 */
const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  defaultReminders: [0, 5, 15, 60], // At time, 5min, 15min, 1hr before
  checkIntervalMs: 60000, // 1 minute
  maxActiveTasks: 100,
};

/**
 * TaskScheduler - Manages reminders and scheduled tasks
 */
export class TaskScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private tasks: Map<string, ScheduledTask> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('TaskScheduler initialized');
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Task scheduler is disabled');
      return;
    }

    if (this.checkInterval) {
      return; // Already running
    }

    this.checkInterval = setInterval(() => {
      this.checkDueTasks();
    }, this.config.checkIntervalMs);

    logger.info('Task scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Task scheduler stopped');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (!this.checkInterval) {
      this.start();
    }

    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Create a new scheduled task
   */
  createTask(
    title: string,
    scheduledAt: Date | number,
    options?: Partial<
      Omit<ScheduledTask, 'id' | 'title' | 'scheduledAt' | 'createdAt' | 'updatedAt' | 'completed'>
    >
  ): ScheduledTask {
    if (this.tasks.size >= this.config.maxActiveTasks) {
      throw new Error('Maximum active tasks limit reached');
    }

    const now = Date.now();
    const scheduleTime = scheduledAt instanceof Date ? scheduledAt.getTime() : scheduledAt;

    const task: ScheduledTask = {
      id: this.generateId(),
      title,
      description: options?.description,
      priority: options?.priority || 'medium',
      scheduledAt: scheduleTime,
      recurrence: options?.recurrence || { type: 'once' },
      reminders: options?.reminders || this.createDefaultReminders(),
      category: options?.category,
      tags: options?.tags,
      completed: false,
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
    };

    this.tasks.set(task.id, task);
    this.emit('task-created', task);
    logger.info('Task created', {
      id: task.id,
      title,
      scheduledAt: new Date(scheduleTime).toISOString(),
    });

    return task;
  }

  /**
   * Create a quick reminder
   */
  createReminder(title: string, inMinutes: number, description?: string): ScheduledTask {
    const scheduledAt = Date.now() + inMinutes * 60 * 1000;
    return this.createTask(title, scheduledAt, {
      description,
      priority: 'high',
      reminders: [{ minutesBefore: 0, sent: false }],
    });
  }

  /**
   * Create a daily recurring task
   */
  createDailyTask(
    title: string,
    time: { hour: number; minute: number },
    options?: Partial<
      Omit<
        ScheduledTask,
        'id' | 'title' | 'scheduledAt' | 'recurrence' | 'createdAt' | 'updatedAt' | 'completed'
      >
    >
  ): ScheduledTask {
    const now = new Date();
    const scheduledAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      time.hour,
      time.minute
    );

    // If time has passed today, schedule for tomorrow
    if (scheduledAt.getTime() < now.getTime()) {
      scheduledAt.setDate(scheduledAt.getDate() + 1);
    }

    return this.createTask(title, scheduledAt, {
      ...options,
      recurrence: { type: 'daily' },
    });
  }

  /**
   * Update a task
   */
  updateTask(
    id: string,
    updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>
  ): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updatedTask: ScheduledTask = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    this.tasks.set(id, updatedTask);
    this.emit('task-updated', updatedTask);
    logger.debug('Task updated', { id });

    return updatedTask;
  }

  /**
   * Complete a task
   */
  completeTask(id: string): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.completed = true;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    // Handle recurring tasks
    if (task.recurrence.type !== 'once') {
      this.scheduleNextOccurrence(task);
    }

    this.emit('task-completed', task);
    logger.info('Task completed', { id, title: task.title });

    return task;
  }

  /**
   * Delete a task
   */
  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    this.emit('task-deleted', task);
    logger.info('Task deleted', { id, title: task.title });

    return true;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | null {
    return this.tasks.get(id) || null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get pending tasks (not completed)
   */
  getPendingTasks(): ScheduledTask[] {
    return this.getAllTasks().filter((t) => !t.completed);
  }

  /**
   * Get due tasks (scheduledAt <= now and not completed)
   */
  getDueTasks(): ScheduledTask[] {
    const now = Date.now();
    return this.getPendingTasks().filter((t) => t.scheduledAt <= now);
  }

  /**
   * Get overdue tasks (past due and not completed)
   */
  getOverdueTasks(): ScheduledTask[] {
    const now = Date.now();
    return this.getPendingTasks().filter((t) => t.scheduledAt < now);
  }

  /**
   * Get upcoming tasks within a time range
   */
  getUpcomingTasks(withinMs: number): ScheduledTask[] {
    const now = Date.now();
    const cutoff = now + withinMs;
    return this.getPendingTasks()
      .filter((t) => t.scheduledAt > now && t.scheduledAt <= cutoff)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  /**
   * Get tasks by category
   */
  getTasksByCategory(category: string): ScheduledTask[] {
    return this.getAllTasks().filter((t) => t.category === category);
  }

  /**
   * Get task status
   */
  getTaskStatus(id: string): TaskStatus | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (task.completed) return 'completed';

    const now = Date.now();
    if (task.scheduledAt > now) return 'pending';
    if (task.scheduledAt === now) return 'due';
    return 'overdue';
  }

  /**
   * Snooze a task
   */
  snoozeTask(id: string, snoozeMinutes: number): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const newScheduledAt = Date.now() + snoozeMinutes * 60 * 1000;

    return this.updateTask(id, {
      scheduledAt: newScheduledAt,
      reminders: this.createDefaultReminders(),
    });
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    total: number;
    pending: number;
    due: number;
    overdue: number;
    completed: number;
    byPriority: Record<TaskPriority, number>;
    byCategory: Record<string, number>;
  } {
    const tasks = this.getAllTasks();
    const now = Date.now();

    const stats = {
      total: tasks.length,
      pending: 0,
      due: 0,
      overdue: 0,
      completed: 0,
      byPriority: { urgent: 0, high: 0, medium: 0, low: 0 } as Record<TaskPriority, number>,
      byCategory: {} as Record<string, number>,
    };

    for (const task of tasks) {
      stats.byPriority[task.priority]++;

      if (task.category) {
        stats.byCategory[task.category] = (stats.byCategory[task.category] || 0) + 1;
      }

      if (task.completed) {
        stats.completed++;
      } else if (task.scheduledAt > now) {
        stats.pending++;
      } else if (task.scheduledAt <= now) {
        stats.due++;
        if (task.scheduledAt < now) {
          stats.overdue++;
        }
      }
    }

    return stats;
  }

  /**
   * Clear all completed tasks
   */
  clearCompleted(): number {
    let cleared = 0;
    const entries = Array.from(this.tasks.entries());

    for (const [id, task] of entries) {
      if (task.completed) {
        this.tasks.delete(id);
        cleared++;
      }
    }

    logger.info('Cleared completed tasks', { count: cleared });
    return cleared;
  }

  // Private methods

  private checkDueTasks(): void {
    const now = Date.now();
    const tasks = Array.from(this.tasks.values());

    for (const task of tasks) {
      if (task.completed) continue;

      // Check reminders
      this.checkTaskReminders(task, now);

      // Check if task is due
      if (task.scheduledAt <= now) {
        this.notifyTaskDue(task);
      }
    }
  }

  private checkTaskReminders(task: ScheduledTask, now: number): void {
    for (const reminder of task.reminders) {
      if (reminder.sent) continue;

      const reminderTime = task.scheduledAt - reminder.minutesBefore * 60 * 1000;

      if (now >= reminderTime) {
        this.sendReminder(task, reminder);
        reminder.sent = true;
        this.tasks.set(task.id, task);
      }
    }
  }

  private sendReminder(task: ScheduledTask, reminder: ReminderConfig): void {
    const notificationsManager = getSmartNotificationsManager();

    let message: string;
    if (reminder.minutesBefore === 0) {
      message = `"${task.title}" is due now!`;
    } else {
      message = `"${task.title}" is due in ${reminder.minutesBefore} minute${reminder.minutesBefore === 1 ? '' : 's'}`;
    }

    notificationsManager.notifyReminder(`Task Reminder`, message);
    this.emit('reminder-sent', { task, reminder });
    logger.debug('Reminder sent', { taskId: task.id, minutesBefore: reminder.minutesBefore });
  }

  private notifyTaskDue(task: ScheduledTask): void {
    // Only notify once per check cycle to avoid spam
    const notificationKey = `due-${task.id}`;
    if ((task.metadata as Record<string, boolean>)?.[notificationKey]) {
      return;
    }

    const notificationsManager = getSmartNotificationsManager();
    notificationsManager.notifyReminder(
      'Task Due',
      `"${task.title}" is now due${task.description ? `: ${task.description}` : ''}`
    );

    // Mark as notified
    if (!task.metadata) task.metadata = {};
    (task.metadata as Record<string, boolean>)[notificationKey] = true;
    this.tasks.set(task.id, task);

    this.emit('task-due', task);
    logger.info('Task due notification sent', { id: task.id, title: task.title });
  }

  private scheduleNextOccurrence(task: ScheduledTask): void {
    const recurrence = task.recurrence;

    // Check if max occurrences reached
    if (recurrence.maxOccurrences) {
      recurrence.occurrenceCount = (recurrence.occurrenceCount || 0) + 1;
      if (recurrence.occurrenceCount >= recurrence.maxOccurrences) {
        logger.info('Max occurrences reached for task', { id: task.id });
        return;
      }
    }

    // Check if end date reached
    if (recurrence.endDate && Date.now() >= recurrence.endDate) {
      logger.info('End date reached for task', { id: task.id });
      return;
    }

    let nextScheduledAt: number;

    switch (recurrence.type) {
      case 'daily':
        nextScheduledAt = task.scheduledAt + 24 * 60 * 60 * 1000;
        break;
      case 'weekly':
        nextScheduledAt = task.scheduledAt + 7 * 24 * 60 * 60 * 1000;
        break;
      case 'monthly': {
        const date = new Date(task.scheduledAt);
        date.setMonth(date.getMonth() + 1);
        nextScheduledAt = date.getTime();
        break;
      }
      case 'custom':
        if (recurrence.intervalMs) {
          nextScheduledAt = task.scheduledAt + recurrence.intervalMs;
        } else {
          return; // No interval specified
        }
        break;
      default:
        return;
    }

    // Create next occurrence
    this.createTask(task.title, nextScheduledAt, {
      description: task.description,
      priority: task.priority,
      recurrence: { ...recurrence },
      reminders: this.createDefaultReminders(),
      category: task.category,
      tags: task.tags,
      metadata: { ...task.metadata, parentId: task.id },
    });

    logger.debug('Next occurrence scheduled', {
      taskId: task.id,
      nextAt: new Date(nextScheduledAt).toISOString(),
    });
  }

  private createDefaultReminders(): ReminderConfig[] {
    return this.config.defaultReminders.map((minutes) => ({
      minutesBefore: minutes,
      sent: false,
    }));
  }

  private generateId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Singleton instance
let taskScheduler: TaskScheduler | null = null;

/**
 * Get or create the task scheduler
 */
export function getTaskScheduler(): TaskScheduler {
  if (!taskScheduler) {
    taskScheduler = new TaskScheduler();
  }
  return taskScheduler;
}

/**
 * Shutdown the task scheduler
 */
export function shutdownTaskScheduler(): void {
  if (taskScheduler) {
    taskScheduler.stop();
    taskScheduler = null;
  }
}

export default TaskScheduler;
