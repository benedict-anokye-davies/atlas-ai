/**
 * Atlas Desktop - Task Handoff Manager
 * Handles "also do X" and "while that's running" commands for concurrent task management
 */

import { EventEmitter } from 'events';
import type { Task, TaskPriority } from '../../shared/types/task';
import { getTaskQueueManager, TaskQueueManager } from './task-queue';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TaskHandoff');

/**
 * Parsed task from natural language
 */
export interface ParsedTask {
  /** Task name derived from command */
  name: string;
  /** Full description of the task */
  description: string;
  /** Extracted command/action if identifiable */
  extractedCommand?: string;
  /** Task priority */
  priority: TaskPriority;
  /** Whether to run after current task completes */
  runAfterCurrent: boolean;
}

/**
 * Task handoff event types
 */
export interface TaskHandoffEvents {
  /** Concurrent task added */
  'handoff:concurrent-added': (task: Task, confirmation: string) => void;
  /** Task queued for later */
  'handoff:queued': (task: Task, confirmation: string) => void;
  /** Additive command detected */
  'handoff:additive-detected': (transcript: string, pattern: string) => void;
  /** Task parsing failed */
  'handoff:parse-failed': (transcript: string, reason: string) => void;
}

/**
 * Pattern definitions for additive command detection
 */
interface AdditivePattern {
  /** Pattern name for logging */
  name: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Whether this indicates concurrent execution */
  concurrent: boolean;
  /** Whether this indicates sequential execution */
  sequential: boolean;
}

/**
 * Additive patterns for detecting concurrent/sequential task requests
 */
const ADDITIVE_PATTERNS: AdditivePattern[] = [
  // Concurrent patterns - run alongside current task
  {
    name: 'also',
    pattern: /^(?:and\s+)?also\s+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'additionally',
    pattern: /^additionally[,\s]+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'while-running',
    pattern:
      /^while\s+(?:that's|that\s+is|you're|you\s+are)\s+(?:running|working|doing\s+that)[,\s]+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'while-at-it',
    pattern: /^while\s+you're\s+at\s+it[,\s]+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'in-meantime',
    pattern: /^(?:in\s+the\s+)?meantime[,\s]+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'one-more-thing',
    pattern: /^(?:one\s+more\s+thing|another\s+thing)[,:\s]+/i,
    concurrent: true,
    sequential: false,
  },
  {
    name: 'can-you-also',
    pattern: /^can\s+you\s+(?:also|additionally)\s+/i,
    concurrent: true,
    sequential: false,
  },

  // Sequential patterns - run after current task
  {
    name: 'after-that',
    pattern: /^(?:and\s+)?after\s+that[,\s]+/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'when-done',
    pattern: /^(?:and\s+)?when\s+(?:you're|you\s+are)\s+done[,\s]+/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'then',
    pattern: /^(?:and\s+)?then[,\s]+/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'next',
    pattern: /^(?:do\s+this\s+)?next[,:\s]+/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'add-task',
    pattern: /^add\s+(?:another\s+)?task[,:\s]+/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'queue',
    pattern: /^(?:queue|schedule)\s+(?:this|a\s+task)?[,:\s]*/i,
    concurrent: false,
    sequential: true,
  },
  {
    name: 'afterwards',
    pattern: /^afterwards[,\s]+/i,
    concurrent: false,
    sequential: true,
  },
];

/**
 * Common action verbs for task extraction
 */
const ACTION_VERBS = [
  'run',
  'execute',
  'start',
  'check',
  'test',
  'build',
  'deploy',
  'update',
  'open',
  'close',
  'send',
  'create',
  'delete',
  'move',
  'copy',
  'search',
  'find',
  'install',
  'uninstall',
  'download',
  'upload',
  'compile',
  'launch',
  'stop',
  'restart',
  'refresh',
  'sync',
  'backup',
  'restore',
  'clean',
  'clear',
  'set',
  'get',
  'show',
  'hide',
  'enable',
  'disable',
  'configure',
  'setup',
];

/**
 * Task Handoff Manager
 * Detects and processes additive voice commands for concurrent task management
 */
export class TaskHandoffManager extends EventEmitter {
  private queueManager: TaskQueueManager;
  private userName: string = 'Ben'; // Default user name for confirmations

  constructor(queueManager?: TaskQueueManager) {
    super();
    this.queueManager = queueManager || getTaskQueueManager();
    logger.info('TaskHandoffManager initialized');
  }

  /**
   * Set the user's name for personalized confirmations
   */
  setUserName(name: string): void {
    this.userName = name;
  }

  /**
   * Detect if a command is additive (vs replacement)
   * Returns true if the command should add to current work rather than replace it
   */
  isAdditiveCommand(transcript: string): boolean {
    const normalizedTranscript = transcript.trim().toLowerCase();

    for (const pattern of ADDITIVE_PATTERNS) {
      if (pattern.pattern.test(normalizedTranscript)) {
        logger.debug('Additive command detected', {
          pattern: pattern.name,
          transcript: transcript.substring(0, 50),
        });
        this.emit('handoff:additive-detected', transcript, pattern.name);
        return true;
      }
    }

    return false;
  }

  /**
   * Get the type of additive command (concurrent or sequential)
   */
  private getAdditiveType(transcript: string): {
    concurrent: boolean;
    sequential: boolean;
    pattern: AdditivePattern | null;
  } {
    const normalizedTranscript = transcript.trim().toLowerCase();

    for (const pattern of ADDITIVE_PATTERNS) {
      if (pattern.pattern.test(normalizedTranscript)) {
        return {
          concurrent: pattern.concurrent,
          sequential: pattern.sequential,
          pattern,
        };
      }
    }

    return { concurrent: false, sequential: false, pattern: null };
  }

  /**
   * Extract the actual task description from a transcript
   * Removes additive prefixes and cleans up the command
   */
  private extractTaskDescription(transcript: string): string {
    let cleaned = transcript.trim();

    // Remove additive patterns from the beginning
    for (const pattern of ADDITIVE_PATTERNS) {
      cleaned = cleaned.replace(pattern.pattern, '');
    }

    // Clean up common prefixes
    cleaned = cleaned
      .replace(/^(?:please\s+)?(?:can\s+you\s+)?/i, '')
      .replace(/^(?:i\s+want\s+you\s+to\s+)/i, '')
      .replace(/^(?:i\s+need\s+you\s+to\s+)/i, '')
      .replace(/^(?:could\s+you\s+)/i, '')
      .replace(/^(?:would\s+you\s+)/i, '')
      .trim();

    return cleaned;
  }

  /**
   * Extract command from task description if possible
   */
  private extractCommand(description: string): string | undefined {
    const lowerDesc = description.toLowerCase();

    // Look for action verbs at the start
    for (const verb of ACTION_VERBS) {
      if (lowerDesc.startsWith(verb + ' ')) {
        // Return the full description as command since it starts with an action
        return description;
      }
    }

    // Check for quoted commands
    const quotedMatch = description.match(/["']([^"']+)["']/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Check for "the X" pattern (e.g., "the tests", "the build")
    const theMatch = description.match(/(?:run|execute|start|check)\s+(?:the\s+)?(\w+)/i);
    if (theMatch) {
      return theMatch[0];
    }

    return undefined;
  }

  /**
   * Determine task priority from description
   */
  private determinePriority(description: string): TaskPriority {
    const lowerDesc = description.toLowerCase();

    // Check for urgency indicators
    if (
      lowerDesc.includes('urgent') ||
      lowerDesc.includes('asap') ||
      lowerDesc.includes('immediately') ||
      lowerDesc.includes('right now') ||
      lowerDesc.includes('critical')
    ) {
      return 'urgent';
    }

    if (
      lowerDesc.includes('important') ||
      lowerDesc.includes('priority') ||
      lowerDesc.includes('high priority')
    ) {
      return 'high';
    }

    if (
      lowerDesc.includes('when you have time') ||
      lowerDesc.includes('no rush') ||
      lowerDesc.includes('low priority') ||
      lowerDesc.includes('whenever')
    ) {
      return 'low';
    }

    return 'normal';
  }

  /**
   * Generate a task name from description
   */
  private generateTaskName(description: string): string {
    // Take first few words, capitalize appropriately
    const words = description.split(/\s+/).slice(0, 5);
    const name = words.join(' ');

    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Parse natural language into a structured task
   */
  parseTaskFromTranscript(transcript: string): ParsedTask | null {
    if (!transcript || transcript.trim().length === 0) {
      logger.warn('Empty transcript provided for parsing');
      this.emit('handoff:parse-failed', transcript, 'Empty transcript');
      return null;
    }

    const { concurrent, sequential } = this.getAdditiveType(transcript);
    const description = this.extractTaskDescription(transcript);

    if (description.length < 3) {
      logger.warn('Task description too short', { description });
      this.emit('handoff:parse-failed', transcript, 'Description too short');
      return null;
    }

    const parsedTask: ParsedTask = {
      name: this.generateTaskName(description),
      description,
      extractedCommand: this.extractCommand(description),
      priority: this.determinePriority(description),
      runAfterCurrent: sequential && !concurrent,
    };

    logger.info('Parsed task from transcript', {
      name: parsedTask.name,
      priority: parsedTask.priority,
      runAfterCurrent: parsedTask.runAfterCurrent,
    });

    return parsedTask;
  }

  /**
   * Add a task to run concurrently with current work
   */
  addConcurrentTask(command: string): Task {
    const parsedTask = this.parseTaskFromTranscript(command);

    if (!parsedTask) {
      throw new Error('Failed to parse task from command');
    }

    // Create task with voice source
    const task = this.queueManager.createTask({
      name: parsedTask.name,
      description: parsedTask.description,
      priority: parsedTask.priority,
      source: 'voice',
      steps: [
        {
          name: 'Execute command',
          description: parsedTask.description,
          type: 'llm',
          errorStrategy: 'fail',
          config: {
            type: 'llm',
            prompt: parsedTask.description,
            stream: true,
          },
        },
      ],
      context: {
        originalCommand: command,
        extractedCommand: parsedTask.extractedCommand,
      },
    });

    // Enqueue for immediate processing
    this.queueManager.enqueue(task);

    const confirmation = this.generateConfirmation('concurrent', parsedTask.name);

    logger.info('Concurrent task added', {
      taskId: task.id,
      name: task.name,
    });

    this.emit('handoff:concurrent-added', task, confirmation);

    return task;
  }

  /**
   * Queue a task to run after the current task completes
   */
  queueNextTask(command: string): Task {
    const parsedTask = this.parseTaskFromTranscript(command);

    if (!parsedTask) {
      throw new Error('Failed to parse task from command');
    }

    // Create task with lower effective priority so it runs after current
    const task = this.queueManager.createTask({
      name: parsedTask.name,
      description: parsedTask.description,
      priority: parsedTask.priority === 'urgent' ? 'high' : parsedTask.priority,
      source: 'voice',
      steps: [
        {
          name: 'Execute command',
          description: parsedTask.description,
          type: 'llm',
          errorStrategy: 'fail',
          config: {
            type: 'llm',
            prompt: parsedTask.description,
            stream: true,
          },
        },
      ],
      context: {
        originalCommand: command,
        extractedCommand: parsedTask.extractedCommand,
        queuedAfterCurrent: true,
      },
    });

    // Enqueue - will be processed when slot available
    this.queueManager.enqueue(task);

    const confirmation = this.generateConfirmation('queued', parsedTask.name);

    logger.info('Task queued for later', {
      taskId: task.id,
      name: task.name,
    });

    this.emit('handoff:queued', task, confirmation);

    return task;
  }

  /**
   * Process a voice command, automatically detecting if it's additive
   * Returns the created task or null if not an additive command
   */
  processCommand(transcript: string): Task | null {
    if (!this.isAdditiveCommand(transcript)) {
      return null;
    }

    const { concurrent } = this.getAdditiveType(transcript);

    if (concurrent) {
      return this.addConcurrentTask(transcript);
    } else {
      return this.queueNextTask(transcript);
    }
  }

  /**
   * Generate a natural confirmation message
   */
  private generateConfirmation(type: 'concurrent' | 'queued', taskName: string): string {
    const confirmations = {
      concurrent: [
        `On it, ${this.userName}. I'll handle that alongside the current task.`,
        `Got it. Working on "${taskName}" now.`,
        `Added to the queue, ${this.userName}.`,
        `Running that concurrently.`,
        `I'll take care of that too, ${this.userName}.`,
      ],
      queued: [
        `Queued up "${taskName}" for when I'm done, ${this.userName}.`,
        `I'll do that next, ${this.userName}.`,
        `Added to the queue. I'll get to it after this.`,
        `Noted. "${taskName}" is next in line.`,
        `Got it queued, ${this.userName}.`,
      ],
    };

    const options = confirmations[type];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Get current queue status summary
   */
  getQueueSummary(): string {
    const stats = this.queueManager.getStats();
    const running = this.queueManager.getRunningTasks();
    const queued = this.queueManager.getQueuedTasks();

    let summary = '';

    if (running.length > 0) {
      const runningNames = running.map((t) => t.name).join(', ');
      summary += `Currently working on: ${runningNames}. `;
    }

    if (queued.length > 0) {
      summary += `${queued.length} task${queued.length > 1 ? 's' : ''} queued. `;
    }

    if (stats.completed > 0) {
      summary += `${stats.completed} completed this session.`;
    }

    return summary.trim() || 'No tasks in progress.';
  }
}

// Singleton instance
let taskHandoffManager: TaskHandoffManager | null = null;

/**
 * Get the task handoff manager instance
 */
export function getTaskHandoffManager(): TaskHandoffManager {
  if (!taskHandoffManager) {
    taskHandoffManager = new TaskHandoffManager();
  }
  return taskHandoffManager;
}

/**
 * Initialize the task handoff manager with custom queue manager
 */
export function initializeTaskHandoff(queueManager?: TaskQueueManager): TaskHandoffManager {
  if (taskHandoffManager) {
    logger.warn('TaskHandoffManager already initialized, returning existing instance');
    return taskHandoffManager;
  }
  taskHandoffManager = new TaskHandoffManager(queueManager);
  return taskHandoffManager;
}

/**
 * Shutdown the task handoff manager
 */
export function shutdownTaskHandoff(): void {
  if (taskHandoffManager) {
    taskHandoffManager.removeAllListeners();
    taskHandoffManager = null;
    logger.info('TaskHandoffManager shutdown complete');
  }
}

export default TaskHandoffManager;
