/**
 * Atlas Desktop - Task Announcer
 * Background task announcements via voice in JARVIS style.
 * Announces task status changes with smart timing and queuing.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTaskQueueManager, TaskQueueManager } from './task-queue';
import type {
  Task,
  TaskResult,
  TaskCompletionEvent,
  TaskProgressEvent,
} from '../../shared/types/task';

const logger = createModuleLogger('TaskAnnouncer');

/**
 * Announcement priority levels
 */
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Queued announcement
 */
export interface QueuedAnnouncement {
  /** Unique ID */
  id: string;
  /** Text to speak */
  text: string;
  /** Priority level */
  priority: AnnouncementPriority;
  /** Related task ID */
  taskId?: string;
  /** Timestamp when queued */
  queuedAt: number;
  /** Announcement type for deduplication */
  type: 'start' | 'complete' | 'failed' | 'progress';
}

/**
 * Task Announcer configuration
 */
export interface TaskAnnouncerConfig {
  /** Enable announcements */
  enabled: boolean;
  /** Announce task starts */
  announceStarts: boolean;
  /** Announce task completions */
  announceCompletions: boolean;
  /** Announce task failures */
  announceFailures: boolean;
  /** Announce progress (only for long tasks) */
  announceProgress: boolean;
  /** Minimum task duration before progress announcements (ms) */
  progressThresholdMs: number;
  /** Minimum time between progress announcements (ms) */
  progressIntervalMs: number;
  /** Maximum queued announcements */
  maxQueueSize: number;
  /** Don't announce during user speech */
  respectUserSpeech: boolean;
  /** Delay before speaking (to batch rapid updates) */
  batchDelayMs: number;
}

/**
 * Default configuration - minimal announcements (Ben's preference)
 */
const DEFAULT_CONFIG: TaskAnnouncerConfig = {
  enabled: true,
  announceStarts: true,
  announceCompletions: true,
  announceFailures: true,
  announceProgress: true,
  progressThresholdMs: 5 * 60 * 1000, // 5 minutes
  progressIntervalMs: 60 * 1000, // 1 minute between progress updates
  maxQueueSize: 10,
  respectUserSpeech: true,
  batchDelayMs: 500,
};

/**
 * JARVIS-style announcement templates - casual and warm
 */
const TEMPLATES = {
  start: [
    'On it.',
    'Got it.',
    "I'll handle that.",
    'Working on it.',
    'Right away.',
    'One sec.',
  ],
  startWithName: [
    'Working on {name}.',
    "I'll get {name} going.",
    'Handling {name}.',
    'Starting {name}.',
  ],
  complete: [
    'Ben, {name} is done. {summary}',
    "All set. {summary}",
    '{name} is finished. {summary}',
    'Done with {name}. {summary}',
    'That one\'s wrapped. {summary}',
  ],
  completeSimple: ["That's done.", 'Finished.', 'All done.', 'Handled.'],
  failed: [
    'Ben, hit a snag with {name}. {error}',
    'Got a problem with {name}. {error}',
    '{name} didn\'t work out. {error}',
    'Issue with {name}. {error}',
  ],
  failedSimple: [
    'That failed. {error}',
    'Hit a wall. {error}',
    'Didn\'t work. {error}',
  ],
  progress: [
    'Still on {name}. About {percent}% there.',
    '{name} is taking a bit. {percent}% done.',
    'Making progress on {name}. {percent}%.',
    '{percent}% through {name}.',
  ],
  progressGeneric: [
    'Still working. About {percent}% done.',
    'Making progress. {percent}%.',
  ],
};

/**
 * Task Announcer events
 */
export interface TaskAnnouncerEvents {
  /** Announcement ready to speak */
  announcement: (text: string, priority: AnnouncementPriority) => void;
  /** Announcement queued */
  queued: (announcement: QueuedAnnouncement) => void;
  /** Announcement skipped */
  skipped: (reason: string, taskId?: string) => void;
  /** Queue cleared */
  'queue-cleared': () => void;
}

/**
 * Task Announcer
 * Manages JARVIS-style voice announcements for background tasks
 */
export class TaskAnnouncer extends EventEmitter {
  private config: TaskAnnouncerConfig;
  private queue: QueuedAnnouncement[] = [];
  private taskQueueManager: TaskQueueManager | null = null;
  private isUserSpeaking = false;
  private isSpeaking = false;
  private batchTimer: NodeJS.Timeout | null = null;
  private progressTimers: Map<string, number> = new Map(); // taskId -> lastProgressTime
  private announcementCounter = 0;

  constructor(config?: Partial<TaskAnnouncerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('TaskAnnouncer initialized', {
      enabled: this.config.enabled,
      announceStarts: this.config.announceStarts,
      announceCompletions: this.config.announceCompletions,
    });
  }

  /**
   * Connect to TaskQueueManager and listen for events
   */
  connectToTaskQueue(): void {
    try {
      this.taskQueueManager = getTaskQueueManager();
      this.setupTaskQueueListeners();
      logger.info('Connected to TaskQueueManager');
    } catch (error) {
      logger.error('Failed to connect to TaskQueueManager', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Set up listeners for task queue events
   */
  private setupTaskQueueListeners(): void {
    if (!this.taskQueueManager) return;

    this.taskQueueManager.on('task:started', (task: Task) => {
      if (this.config.announceStarts) {
        this.announceTaskStarted(task);
      }
    });

    this.taskQueueManager.on('task:completed', (event: TaskCompletionEvent) => {
      const task = this.taskQueueManager?.getTask(event.taskId);
      if (!task) return;

      if (event.status === 'completed' && this.config.announceCompletions) {
        this.announceTaskCompleted(task, event.result!);
      } else if (event.status === 'failed' && this.config.announceFailures) {
        this.announceTaskFailed(task, event.error || 'Unknown error');
      }
    });

    this.taskQueueManager.on('task:progress', (event: TaskProgressEvent) => {
      if (this.config.announceProgress) {
        const task = this.taskQueueManager?.getTask(event.taskId);
        if (task) {
          this.announceTaskProgress(task, event.progress);
        }
      }
    });
  }

  /**
   * Announce task started
   */
  announceTaskStarted(task: Task): void {
    if (!this.config.enabled || !this.config.announceStarts) {
      return;
    }

    let text: string;
    if (task.name && task.name.length < 50) {
      // Use template with task name
      const template = this.pickRandom(TEMPLATES.startWithName);
      text = this.fillTemplate(template, { name: task.name });
    } else {
      // Use simple template
      text = this.pickRandom(TEMPLATES.start);
    }

    this.queueAnnouncement({
      text,
      priority: this.taskPriorityToAnnouncementPriority(task.priority),
      taskId: task.id,
      type: 'start',
    });

    logger.debug('Task start announcement queued', { taskId: task.id, text });
  }

  /**
   * Announce task completed
   */
  announceTaskCompleted(task: Task, result: TaskResult): void {
    if (!this.config.enabled || !this.config.announceCompletions) {
      return;
    }

    const summary = this.generateCompletionSummary(task, result);

    let text: string;
    if (task.name && task.name.length < 50 && summary) {
      const template = this.pickRandom(TEMPLATES.complete);
      text = this.fillTemplate(template, { name: task.name, summary });
    } else if (summary) {
      const template = this.pickRandom(TEMPLATES.completeSimple);
      text = template + (summary ? ` ${summary}` : '');
    } else {
      text = this.pickRandom(TEMPLATES.completeSimple);
    }

    this.queueAnnouncement({
      text,
      priority: 'normal',
      taskId: task.id,
      type: 'complete',
    });

    logger.debug('Task completion announcement queued', { taskId: task.id, text });
  }

  /**
   * Announce task failed
   */
  announceTaskFailed(task: Task, error: string): void {
    if (!this.config.enabled || !this.config.announceFailures) {
      return;
    }

    const errorSummary = this.summarizeError(error);

    let text: string;
    if (task.name && task.name.length < 50) {
      const template = this.pickRandom(TEMPLATES.failed);
      text = this.fillTemplate(template, { name: task.name, error: errorSummary });
    } else {
      const template = this.pickRandom(TEMPLATES.failedSimple);
      text = this.fillTemplate(template, { error: errorSummary });
    }

    // Failures are higher priority
    this.queueAnnouncement({
      text,
      priority: 'high',
      taskId: task.id,
      type: 'failed',
    });

    logger.debug('Task failure announcement queued', { taskId: task.id, text });
  }

  /**
   * Announce task progress (only for long-running tasks)
   */
  announceTaskProgress(task: Task, progress: number): void {
    if (!this.config.enabled || !this.config.announceProgress) {
      return;
    }

    // Check if task has been running long enough
    const runningTime = task.startedAt ? Date.now() - task.startedAt : 0;
    if (runningTime < this.config.progressThresholdMs) {
      return;
    }

    // Check if enough time has passed since last progress announcement
    const lastProgress = this.progressTimers.get(task.id) || 0;
    if (Date.now() - lastProgress < this.config.progressIntervalMs) {
      return;
    }

    this.progressTimers.set(task.id, Date.now());

    const percent = Math.round(progress);
    let text: string;
    if (task.name && task.name.length < 50) {
      const template = this.pickRandom(TEMPLATES.progress);
      text = this.fillTemplate(template, { name: task.name, percent: percent.toString() });
    } else {
      const template = this.pickRandom(TEMPLATES.progressGeneric);
      text = this.fillTemplate(template, { percent: percent.toString() });
    }

    this.queueAnnouncement({
      text,
      priority: 'low',
      taskId: task.id,
      type: 'progress',
    });

    logger.debug('Task progress announcement queued', {
      taskId: task.id,
      progress: percent,
      text,
    });
  }

  /**
   * Queue an announcement
   */
  private queueAnnouncement(params: Omit<QueuedAnnouncement, 'id' | 'queuedAt'>): void {
    // Check queue size
    if (this.queue.length >= this.config.maxQueueSize) {
      // Remove lowest priority item
      const lowestPriority = this.queue.reduce((min, item) =>
        this.priorityToNumber(item.priority) < this.priorityToNumber(min.priority) ? item : min
      );
      const index = this.queue.indexOf(lowestPriority);
      if (index !== -1) {
        this.queue.splice(index, 1);
        this.emit('skipped', 'Queue full, removed lower priority', lowestPriority.taskId);
      }
    }

    // Deduplicate - remove existing announcement for same task and type
    if (params.taskId) {
      const existingIndex = this.queue.findIndex(
        (a) => a.taskId === params.taskId && a.type === params.type
      );
      if (existingIndex !== -1) {
        this.queue.splice(existingIndex, 1);
      }
    }

    const announcement: QueuedAnnouncement = {
      id: `announce-${++this.announcementCounter}`,
      ...params,
      queuedAt: Date.now(),
    };

    // Insert based on priority
    const insertIndex = this.queue.findIndex(
      (a) => this.priorityToNumber(a.priority) < this.priorityToNumber(params.priority)
    );
    if (insertIndex === -1) {
      this.queue.push(announcement);
    } else {
      this.queue.splice(insertIndex, 0, announcement);
    }

    this.emit('queued', announcement);

    // Schedule processing with batching delay
    this.scheduleBatchProcess();
  }

  /**
   * Schedule batch processing of announcements
   */
  private scheduleBatchProcess(): void {
    if (this.batchTimer) {
      return; // Already scheduled
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.processQueue();
    }, this.config.batchDelayMs);
  }

  /**
   * Process the announcement queue
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    // Respect user speech
    if (this.config.respectUserSpeech && this.isUserSpeaking) {
      logger.debug('Deferring announcement - user is speaking');
      // Reschedule for later
      this.scheduleBatchProcess();
      return;
    }

    // Don't interrupt if already speaking
    if (this.isSpeaking) {
      logger.debug('Deferring announcement - already speaking');
      this.scheduleBatchProcess();
      return;
    }

    // Get highest priority announcement
    const announcement = this.queue.shift();
    if (!announcement) {
      return;
    }

    // Clean up progress timer if this is a completion/failure
    if (
      announcement.taskId &&
      (announcement.type === 'complete' || announcement.type === 'failed')
    ) {
      this.progressTimers.delete(announcement.taskId);
    }

    // Emit the announcement for TTS to handle
    logger.info('Emitting announcement', {
      id: announcement.id,
      type: announcement.type,
      priority: announcement.priority,
      text: announcement.text.substring(0, 50),
    });

    this.emit('announcement', announcement.text, announcement.priority);

    // Continue processing if more in queue
    if (this.queue.length > 0) {
      this.scheduleBatchProcess();
    }
  }

  /**
   * Notify that user has started speaking
   */
  setUserSpeaking(speaking: boolean): void {
    this.isUserSpeaking = speaking;
    if (!speaking && this.queue.length > 0) {
      // User stopped speaking, process queue
      this.scheduleBatchProcess();
    }
  }

  /**
   * Notify that TTS is speaking
   */
  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    if (!speaking && this.queue.length > 0) {
      // TTS finished, process queue
      this.scheduleBatchProcess();
    }
  }

  /**
   * Clear all queued announcements
   */
  clearQueue(): void {
    this.queue = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.emit('queue-cleared');
    logger.debug('Announcement queue cleared');
  }

  /**
   * Get current queue
   */
  getQueue(): QueuedAnnouncement[] {
    return [...this.queue];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TaskAnnouncerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('TaskAnnouncer config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): TaskAnnouncerConfig {
    return { ...this.config };
  }

  /**
   * Enable or disable announcements
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.clearQueue();
    }
    logger.info('TaskAnnouncer enabled state changed', { enabled });
  }

  /**
   * Shutdown the announcer
   */
  shutdown(): void {
    this.clearQueue();
    this.progressTimers.clear();
    if (this.taskQueueManager) {
      this.taskQueueManager.removeAllListeners();
      this.taskQueueManager = null;
    }
    logger.info('TaskAnnouncer shutdown');
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Pick a random template from an array
   */
  private pickRandom(templates: string[]): string {
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Fill template placeholders
   */
  private fillTemplate(template: string, values: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Convert task priority to announcement priority
   */
  private taskPriorityToAnnouncementPriority(taskPriority: Task['priority']): AnnouncementPriority {
    switch (taskPriority) {
      case 'urgent':
        return 'urgent';
      case 'high':
        return 'high';
      case 'normal':
        return 'normal';
      case 'low':
        return 'low';
      default:
        return 'normal';
    }
  }

  /**
   * Convert priority to number for comparison
   */
  private priorityToNumber(priority: AnnouncementPriority): number {
    switch (priority) {
      case 'urgent':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Generate a brief completion summary
   */
  private generateCompletionSummary(_task: Task, result: TaskResult): string {
    const parts: string[] = [];

    // Duration info for long tasks
    if (result.duration > 60000) {
      const minutes = Math.round(result.duration / 60000);
      parts.push(`Took ${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    // Step info
    if (result.totalSteps > 1) {
      parts.push(`${result.completedSteps} of ${result.totalSteps} steps completed`);
    }

    // Try to extract meaningful data from result
    if (result.data && typeof result.data === 'object') {
      const data = result.data as Record<string, unknown>;

      // Look for common result patterns
      if (typeof data.filesUpdated === 'number') {
        parts.push(`${data.filesUpdated} files updated`);
      }
      if (typeof data.testsPass === 'boolean' && data.testsPass) {
        parts.push('all tests pass');
      }
      if (typeof data.message === 'string' && data.message.length < 50) {
        parts.push(data.message);
      }
    }

    return parts.join('. ');
  }

  /**
   * Summarize an error message for voice
   */
  private summarizeError(error: string): string {
    // Truncate long errors
    if (error.length > 100) {
      // Try to extract the main message
      const firstLine = error.split('\n')[0];
      if (firstLine.length < 100) {
        return firstLine;
      }
      return error.substring(0, 97) + '...';
    }
    return error;
  }

  // Type-safe event emitter methods
  on<K extends keyof TaskAnnouncerEvents>(event: K, listener: TaskAnnouncerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof TaskAnnouncerEvents>(event: K, listener: TaskAnnouncerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof TaskAnnouncerEvents>(
    event: K,
    ...args: Parameters<TaskAnnouncerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let taskAnnouncer: TaskAnnouncer | null = null;

/**
 * Get or create the TaskAnnouncer singleton
 */
export function getTaskAnnouncer(config?: Partial<TaskAnnouncerConfig>): TaskAnnouncer {
  if (!taskAnnouncer) {
    taskAnnouncer = new TaskAnnouncer(config);
  }
  return taskAnnouncer;
}

/**
 * Initialize TaskAnnouncer and connect to TaskQueueManager
 */
export function initializeTaskAnnouncer(config?: Partial<TaskAnnouncerConfig>): TaskAnnouncer {
  const announcer = getTaskAnnouncer(config);
  announcer.connectToTaskQueue();
  return announcer;
}

/**
 * Shutdown the TaskAnnouncer
 */
export function shutdownTaskAnnouncer(): void {
  if (taskAnnouncer) {
    taskAnnouncer.shutdown();
    taskAnnouncer = null;
  }
}

export default TaskAnnouncer;
