/**
 * Atlas Desktop - Task Status Handler
 *
 * Handles voice queries about running tasks, providing natural language
 * status updates and task control (cancel, pause, resume).
 *
 * Supports queries like:
 * - "What's running?"
 * - "How's that refactoring going?"
 * - "Cancel that last task"
 * - "Pause the deployment"
 *
 * @module agent/task-status-handler
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTaskQueueManager, TaskQueueManager } from './task-queue';
import type { Task } from '../../shared/types/task';

const logger = createModuleLogger('TaskStatusHandler');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Task status handler interface
 */
export interface TaskStatusHandler {
  getRunningTasksSummary(): string;
  getTaskProgress(taskNameOrId: string): string;
  getQueueSummary(): string;
  cancelTask(taskNameOrId: string): boolean;
  pauseTask(taskNameOrId: string): boolean;
  resumeTask(taskNameOrId: string): boolean;
}

/**
 * Task match result from fuzzy search
 */
interface TaskMatch {
  task: Task;
  score: number;
  matchType: 'exact-id' | 'exact-name' | 'fuzzy-name' | 'keyword';
}

/**
 * Events emitted by TaskStatusHandlerImpl
 */
export interface TaskStatusHandlerEvents {
  /** Task was referenced in a query */
  'task-referenced': (taskId: string, query: string) => void;
  /** Status summary was requested */
  'status-requested': (type: 'running' | 'queue' | 'progress') => void;
  /** Task control action executed */
  'task-action': (action: 'cancel' | 'pause' | 'resume', taskId: string, success: boolean) => void;
}

// ============================================================================
// Response Templates
// ============================================================================

/**
 * JARVIS-style response templates
 */
const RESPONSE_TEMPLATES = {
  noRunningTasks: [
    "All clear. I don't have any tasks running at the moment.",
    "Nothing running right now. I'm standing by.",
    'No active tasks. Ready when you are.',
  ],

  singleTask: [
    "I'm currently working on {name}. It's about {progress}% complete.",
    "Right now I'm handling {name}, roughly {progress}% done.",
    'Working on {name} at the moment. About {progress}% through it.',
  ],

  multipleTasks: [
    "I'm currently working on {count} tasks: {list}. The {first} is about {progress}% complete.",
    'Got {count} tasks running: {list}. {first} is at {progress}%.',
    'Running {count} tasks at the moment: {list}. Leading with {first} at {progress}%.',
  ],

  taskProgress: [
    '{name} is about {progress}% done. {timeEstimate}',
    '{name} is {progress}% complete. {timeEstimate}',
    'Progress on {name}: {progress}%. {timeEstimate}',
  ],

  noQueuedTasks: [
    'The queue is empty. No tasks waiting.',
    'Nothing queued up right now.',
    "Queue's clear. Ready for new tasks.",
  ],

  queuedTasks: [
    'I have {count} tasks queued up: {list}.',
    'There are {count} tasks in the queue: {list}.',
    '{count} tasks waiting: {list}.',
  ],

  cancelSuccess: [
    'Cancelled. {name} has been stopped.',
    "Done. I've cancelled {name}.",
    '{name} has been cancelled.',
  ],

  cancelFailure: [
    "I couldn't find a task matching '{query}' to cancel.",
    "No matching task found for '{query}'.",
    "Unable to cancel - couldn't locate '{query}'.",
  ],

  pauseSuccess: [
    "Paused {name}. Say 'resume' when you're ready.",
    '{name} is now paused. Let me know when to continue.',
    "I've paused {name}. Just say 'resume' to continue.",
  ],

  pauseFailure: [
    "Couldn't pause '{query}'. It may not be running.",
    "Unable to pause - '{query}' isn't currently active.",
    "No running task matching '{query}' to pause.",
  ],

  resumeSuccess: [
    'Resuming {name}. Picking up where we left off.',
    '{name} is back in action.',
    'Continuing with {name}.',
  ],

  resumeFailure: [
    "Nothing to resume matching '{query}'.",
    "Couldn't find a paused task matching '{query}'.",
    "'{query}' isn't paused or doesn't exist.",
  ],

  taskNotFound: [
    "I couldn't find a task matching '{query}'.",
    "No task found for '{query}'.",
    "'{query}' doesn't match any of my tasks.",
  ],

  timeEstimates: {
    short: 'Should be done shortly.',
    medium: 'Should be finished in roughly {time}.',
    long: 'Still some time to go, maybe {time}.',
    unknown: 'Hard to estimate the remaining time.',
  },
};

// ============================================================================
// Fuzzy Matching Utilities
// ============================================================================

/**
 * Calculate similarity between two strings (Levenshtein-based)
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check for substring match
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.8;
  }

  // Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(s1.length, s2.length);
  return 1 - matrix[s1.length][s2.length] / maxLen;
}

/**
 * Extract keywords from a task name
 */
function extractKeywords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/**
 * Check if query matches any keyword in task name
 */
function matchesKeyword(query: string, taskName: string): boolean {
  const queryKeywords = extractKeywords(query);
  const taskKeywords = extractKeywords(taskName);

  return queryKeywords.some((qk) => taskKeywords.some((tk) => tk.includes(qk) || qk.includes(tk)));
}

// ============================================================================
// TaskStatusHandlerImpl Class
// ============================================================================

/**
 * Implementation of task status handler with natural language support.
 *
 * Provides JARVIS-style responses for task queries and supports fuzzy
 * matching for task identification from voice commands.
 */
export class TaskStatusHandlerImpl extends EventEmitter implements TaskStatusHandler {
  private queueManager: TaskQueueManager;
  private lastMentionedTaskId: string | null = null;
  private lastMentionedAt: number = 0;

  /** Timeout for "that" references (5 minutes) */
  private static readonly REFERENCE_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(queueManager?: TaskQueueManager) {
    super();
    this.queueManager = queueManager || getTaskQueueManager();
    logger.info('TaskStatusHandler initialized');
  }

  // ==========================================================================
  // Public API - Status Queries
  // ==========================================================================

  /**
   * Get a natural language summary of all running tasks.
   *
   * Responds to queries like "What's running?" or "Atlas, status?"
   *
   * @returns Human-readable status summary
   */
  public getRunningTasksSummary(): string {
    this.emit('status-requested', 'running');

    const runningTasks = this.queueManager.getRunningTasks();

    if (runningTasks.length === 0) {
      return this.randomTemplate(RESPONSE_TEMPLATES.noRunningTasks);
    }

    // Update last mentioned task to the first running task
    this.setLastMentionedTask(runningTasks[0].id);

    if (runningTasks.length === 1) {
      const task = runningTasks[0];
      return this.randomTemplate(RESPONSE_TEMPLATES.singleTask)
        .replace('{name}', task.name)
        .replace('{progress}', String(Math.round(task.progress)));
    }

    // Multiple tasks
    const taskNames = runningTasks.map((t) => t.name);
    const listStr = this.formatTaskList(taskNames);
    const firstTask = runningTasks[0];

    return this.randomTemplate(RESPONSE_TEMPLATES.multipleTasks)
      .replace('{count}', String(runningTasks.length))
      .replace('{list}', listStr)
      .replace('{first}', firstTask.name)
      .replace('{progress}', String(Math.round(firstTask.progress)));
  }

  /**
   * Get progress information for a specific task.
   *
   * Responds to queries like "How's that refactoring going?"
   * Supports fuzzy matching and "that" references.
   *
   * @param taskNameOrId - Task name, ID, or "that"/"last"
   * @returns Human-readable progress report
   */
  public getTaskProgress(taskNameOrId: string): string {
    this.emit('status-requested', 'progress');

    const task = this.findTask(taskNameOrId);

    if (!task) {
      return this.randomTemplate(RESPONSE_TEMPLATES.taskNotFound).replace('{query}', taskNameOrId);
    }

    this.setLastMentionedTask(task.id);
    this.emit('task-referenced', task.id, taskNameOrId);

    const timeEstimate = this.getTimeEstimate(task);

    return this.randomTemplate(RESPONSE_TEMPLATES.taskProgress)
      .replace('{name}', task.name)
      .replace('{progress}', String(Math.round(task.progress)))
      .replace('{timeEstimate}', timeEstimate);
  }

  /**
   * Get a summary of queued tasks.
   *
   * Responds to queries like "What's in the queue?"
   *
   * @returns Human-readable queue summary
   */
  public getQueueSummary(): string {
    this.emit('status-requested', 'queue');

    const queuedTasks = this.queueManager.getQueuedTasks();

    if (queuedTasks.length === 0) {
      return this.randomTemplate(RESPONSE_TEMPLATES.noQueuedTasks);
    }

    const taskNames = queuedTasks.map((t) => t.name);
    const listStr = this.formatTaskList(taskNames);

    return this.randomTemplate(RESPONSE_TEMPLATES.queuedTasks)
      .replace('{count}', String(queuedTasks.length))
      .replace('{list}', listStr);
  }

  // ==========================================================================
  // Public API - Task Control
  // ==========================================================================

  /**
   * Cancel a task by name or ID.
   *
   * Responds to commands like "Cancel that last task" or "Stop the deployment"
   *
   * @param taskNameOrId - Task name, ID, or "that"/"last"
   * @returns true if cancelled, false otherwise
   */
  public cancelTask(taskNameOrId: string): boolean {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      logger.warn('Cancel failed - task not found', { query: taskNameOrId });
      this.emit('task-action', 'cancel', '', false);
      return false;
    }

    const success = this.queueManager.cancelTask(task.id, 'Cancelled by user');
    this.emit('task-action', 'cancel', task.id, success);

    if (success) {
      logger.info('Task cancelled', { taskId: task.id, name: task.name });
      // Clear last mentioned if it was cancelled
      if (this.lastMentionedTaskId === task.id) {
        this.lastMentionedTaskId = null;
      }
    }

    return success;
  }

  /**
   * Pause a running task.
   *
   * Responds to commands like "Pause the deployment"
   *
   * @param taskNameOrId - Task name, ID, or "that"/"last"
   * @returns true if paused, false otherwise
   */
  public pauseTask(taskNameOrId: string): boolean {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      logger.warn('Pause failed - task not found', { query: taskNameOrId });
      this.emit('task-action', 'pause', '', false);
      return false;
    }

    const success = this.queueManager.pauseTask(task.id);
    this.emit('task-action', 'pause', task.id, success);

    if (success) {
      logger.info('Task paused', { taskId: task.id, name: task.name });
      this.setLastMentionedTask(task.id);
    }

    return success;
  }

  /**
   * Resume a paused task.
   *
   * Responds to commands like "Resume" or "Continue the deployment"
   *
   * @param taskNameOrId - Task name, ID, or "that"/"last"
   * @returns true if resumed, false otherwise
   */
  public resumeTask(taskNameOrId: string): boolean {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      logger.warn('Resume failed - task not found', { query: taskNameOrId });
      this.emit('task-action', 'resume', '', false);
      return false;
    }

    const success = this.queueManager.resumeTask(task.id);
    this.emit('task-action', 'resume', task.id, success);

    if (success) {
      logger.info('Task resumed', { taskId: task.id, name: task.name });
      this.setLastMentionedTask(task.id);
    }

    return success;
  }

  // ==========================================================================
  // Response Generation
  // ==========================================================================

  /**
   * Generate a response for a cancel action.
   *
   * @param taskNameOrId - Task identifier used in the command
   * @returns Human-readable response
   */
  public getCancelResponse(taskNameOrId: string): string {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      return this.randomTemplate(RESPONSE_TEMPLATES.cancelFailure).replace('{query}', taskNameOrId);
    }

    return this.randomTemplate(RESPONSE_TEMPLATES.cancelSuccess).replace('{name}', task.name);
  }

  /**
   * Generate a response for a pause action.
   *
   * @param taskNameOrId - Task identifier used in the command
   * @returns Human-readable response
   */
  public getPauseResponse(taskNameOrId: string): string {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      return this.randomTemplate(RESPONSE_TEMPLATES.pauseFailure).replace('{query}', taskNameOrId);
    }

    return this.randomTemplate(RESPONSE_TEMPLATES.pauseSuccess).replace('{name}', task.name);
  }

  /**
   * Generate a response for a resume action.
   *
   * @param taskNameOrId - Task identifier used in the command
   * @returns Human-readable response
   */
  public getResumeResponse(taskNameOrId: string): string {
    const task = this.findTask(taskNameOrId);

    if (!task) {
      return this.randomTemplate(RESPONSE_TEMPLATES.resumeFailure).replace('{query}', taskNameOrId);
    }

    return this.randomTemplate(RESPONSE_TEMPLATES.resumeSuccess).replace('{name}', task.name);
  }

  // ==========================================================================
  // Task Finding & Fuzzy Matching
  // ==========================================================================

  /**
   * Find a task by name, ID, or fuzzy match.
   *
   * Supports:
   * - Exact task ID
   * - Exact task name (case-insensitive)
   * - "that", "last", "it" - references last mentioned task
   * - Fuzzy name matching
   * - Keyword matching
   *
   * @param query - Search query
   * @returns Matched task or undefined
   */
  public findTask(query: string): Task | undefined {
    const normalizedQuery = query.toLowerCase().trim();

    // Handle "that", "last", "it" references
    if (this.isReferenceQuery(normalizedQuery)) {
      return this.getLastMentionedTask();
    }

    const allTasks = this.getAllTasks();

    if (allTasks.length === 0) {
      return undefined;
    }

    const matches: TaskMatch[] = [];

    for (const task of allTasks) {
      // Exact ID match
      if (task.id === query || task.id.toLowerCase() === normalizedQuery) {
        return task; // Immediate return for exact ID
      }

      // Exact name match (case-insensitive)
      if (task.name.toLowerCase() === normalizedQuery) {
        matches.push({ task, score: 1.0, matchType: 'exact-name' });
        continue;
      }

      // Fuzzy name match
      const similarity = stringSimilarity(normalizedQuery, task.name);
      if (similarity >= 0.5) {
        matches.push({ task, score: similarity, matchType: 'fuzzy-name' });
        continue;
      }

      // Keyword match
      if (matchesKeyword(normalizedQuery, task.name)) {
        matches.push({ task, score: 0.4, matchType: 'keyword' });
      }
    }

    if (matches.length === 0) {
      return undefined;
    }

    // Sort by score (highest first)
    matches.sort((a, b) => b.score - a.score);

    const bestMatch = matches[0];
    logger.debug('Task matched', {
      query,
      taskId: bestMatch.task.id,
      taskName: bestMatch.task.name,
      score: bestMatch.score,
      matchType: bestMatch.matchType,
    });

    return bestMatch.task;
  }

  /**
   * Find tasks by fuzzy name match (returns multiple matches).
   *
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Array of matched tasks with scores
   */
  public findTasksByFuzzyName(query: string, limit: number = 5): TaskMatch[] {
    const normalizedQuery = query.toLowerCase().trim();
    const allTasks = this.getAllTasks();
    const matches: TaskMatch[] = [];

    for (const task of allTasks) {
      // Exact name match
      if (task.name.toLowerCase() === normalizedQuery) {
        matches.push({ task, score: 1.0, matchType: 'exact-name' });
        continue;
      }

      // Fuzzy name match
      const similarity = stringSimilarity(normalizedQuery, task.name);
      if (similarity >= 0.3) {
        matches.push({ task, score: similarity, matchType: 'fuzzy-name' });
        continue;
      }

      // Keyword match
      if (matchesKeyword(normalizedQuery, task.name)) {
        matches.push({ task, score: 0.25, matchType: 'keyword' });
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Check if query is a reference to the last mentioned task
   */
  private isReferenceQuery(query: string): boolean {
    const referenceWords = ['that', 'it', 'last', 'the last one', 'that one', 'this'];
    return referenceWords.some((word) => query === word || query.startsWith(word + ' '));
  }

  /**
   * Get the last mentioned task if still valid
   */
  private getLastMentionedTask(): Task | undefined {
    if (!this.lastMentionedTaskId) {
      return undefined;
    }

    // Check if reference has timed out
    const now = Date.now();
    if (now - this.lastMentionedAt > TaskStatusHandlerImpl.REFERENCE_TIMEOUT_MS) {
      this.lastMentionedTaskId = null;
      return undefined;
    }

    return this.queueManager.getTask(this.lastMentionedTaskId);
  }

  /**
   * Set the last mentioned task ID
   */
  private setLastMentionedTask(taskId: string): void {
    this.lastMentionedTaskId = taskId;
    this.lastMentionedAt = Date.now();
  }

  /**
   * Get all tasks (running, queued, and recent completed)
   */
  private getAllTasks(): Task[] {
    const running = this.queueManager.getRunningTasks();
    const queued = this.queueManager.getQueuedTasks();
    const recent = this.queueManager.getRecentTasks(10);

    // Combine and deduplicate
    const taskMap = new Map<string, Task>();
    for (const task of [...running, ...queued, ...recent]) {
      taskMap.set(task.id, task);
    }

    return Array.from(taskMap.values());
  }

  /**
   * Format a list of task names for natural language output
   */
  private formatTaskList(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;

    const allButLast = names.slice(0, -1).join(', ');
    return `${allButLast}, and ${names[names.length - 1]}`;
  }

  /**
   * Get a time estimate string for a task
   */
  private getTimeEstimate(task: Task): string {
    // If task just started or no progress, can't estimate
    if (!task.startedAt || task.progress < 5) {
      return RESPONSE_TEMPLATES.timeEstimates.unknown;
    }

    const elapsedMs = Date.now() - task.startedAt;
    const progressFraction = task.progress / 100;

    if (progressFraction === 0) {
      return RESPONSE_TEMPLATES.timeEstimates.unknown;
    }

    // Estimate total time and remaining time
    const estimatedTotalMs = elapsedMs / progressFraction;
    const remainingMs = estimatedTotalMs - elapsedMs;

    if (remainingMs < 30000) {
      return RESPONSE_TEMPLATES.timeEstimates.short;
    }

    const formattedTime = this.formatDuration(remainingMs);

    if (remainingMs < 2 * 60 * 1000) {
      return RESPONSE_TEMPLATES.timeEstimates.medium.replace('{time}', formattedTime);
    }

    return RESPONSE_TEMPLATES.timeEstimates.long.replace('{time}', formattedTime);
  }

  /**
   * Format a duration in milliseconds to human-readable string
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} and ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
      }
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }

    if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  /**
   * Get a random template from an array
   */
  private randomTemplate(templates: string[]): string {
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Get the last mentioned task ID (for testing/debugging)
   */
  public getLastMentionedTaskId(): string | null {
    return this.lastMentionedTaskId;
  }

  /**
   * Clear the last mentioned task reference
   */
  public clearLastMentionedTask(): void {
    this.lastMentionedTaskId = null;
    this.lastMentionedAt = 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let taskStatusHandlerInstance: TaskStatusHandlerImpl | null = null;

/**
 * Get or create the TaskStatusHandler singleton instance.
 *
 * @param queueManager - Optional TaskQueueManager (only used on first call)
 * @returns TaskStatusHandlerImpl instance
 */
export function getTaskStatusHandler(queueManager?: TaskQueueManager): TaskStatusHandlerImpl {
  if (!taskStatusHandlerInstance) {
    taskStatusHandlerInstance = new TaskStatusHandlerImpl(queueManager);
    logger.info('TaskStatusHandler singleton created');
  }
  return taskStatusHandlerInstance;
}

/**
 * Shutdown and cleanup TaskStatusHandler singleton.
 */
export function shutdownTaskStatusHandler(): void {
  if (taskStatusHandlerInstance) {
    taskStatusHandlerInstance.removeAllListeners();
    taskStatusHandlerInstance = null;
    logger.info('TaskStatusHandler shutdown complete');
  }
}

/**
 * Reset TaskStatusHandler singleton (for testing).
 */
export function resetTaskStatusHandler(): void {
  taskStatusHandlerInstance = null;
}
