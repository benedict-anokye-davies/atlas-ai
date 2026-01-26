/**
 * Atlas Desktop - Conversation Manager
 * Enables non-blocking voice interaction while background tasks run.
 *
 * This manager decouples voice listening from task execution, allowing:
 * - Wake word detection during task execution
 * - New voice commands while tasks run in background
 * - Priority-based command handling
 * - Quick acknowledgments before background work
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTaskQueueManager, TaskQueueManager } from '../agent/task-queue';
// Task types imported from task-queue module

const logger = createModuleLogger('ConversationManager');

/**
 * Command priority levels
 */
export type CommandPriority = 'urgent' | 'normal' | 'background';

/**
 * Queued voice command
 */
export interface QueuedCommand {
  id: string;
  transcript: string;
  priority: CommandPriority;
  timestamp: number;
  processed: boolean;
}

/**
 * Command classification result
 */
export interface CommandClassification {
  priority: CommandPriority;
  isTaskQuery: boolean; // "What's running?", "Status?"
  isTaskControl: boolean; // "Cancel that", "Pause"
  isAdditive: boolean; // "Also do X", "While that's running..."
  requiresImmediateResponse: boolean;
  suggestedAcknowledgment?: string;
}

/**
 * Conversation manager configuration
 */
export interface ConversationManagerConfig {
  /** Maximum queued commands */
  maxQueueSize: number;
  /** Enable background task execution */
  enableBackgroundTasks: boolean;
  /** Quick acknowledgment phrases */
  acknowledgments: string[];
  /** Patterns that indicate urgent commands */
  urgentPatterns: RegExp[];
  /** Patterns that indicate task queries */
  taskQueryPatterns: RegExp[];
  /** Patterns that indicate task control */
  taskControlPatterns: RegExp[];
  /** Patterns that indicate additive commands */
  additivePatterns: RegExp[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConversationManagerConfig = {
  maxQueueSize: 10,
  enableBackgroundTasks: true,
  acknowledgments: [
    "Working on it, Ben. I'll let you know when it's done.",
    "On it. I'll keep you posted.",
    "Consider it done. I'll report back shortly.",
    "I'm on it, Ben.",
    "Right then. I'll handle that in the background.",
  ],
  urgentPatterns: [
    /\b(stop|cancel|abort|emergency|urgent|now|immediately)\b/i,
    /\b(help|error|broken|crashed|failed)\b/i,
  ],
  taskQueryPatterns: [
    /\b(what'?s?\s+(running|happening|going on|the status))\b/i,
    /\b(status|progress|how'?s?\s+(it|that)\s+going)\b/i,
    /\b(what\s+are\s+you\s+(doing|working on))\b/i,
    /\b(any\s+updates?)\b/i,
  ],
  taskControlPatterns: [
    /\b(cancel|stop|pause|resume|abort)\s+(that|it|the\s+\w+)/i,
    /\b(cancel|stop|pause|resume)\s+(\w+\s+)?task/i,
  ],
  additivePatterns: [
    /\b(also|and also|while you'?re?\s+(at it|doing that))\b/i,
    /\b(add(itionally)?|another thing|one more thing)\b/i,
    /\b(in the meantime|meanwhile)\b/i,
    /\b(after that|when you'?re?\s+done|next)\b/i,
  ],
};

/**
 * Conversation Manager Events
 */
export interface ConversationManagerEvents {
  /** New command received and queued */
  'command-queued': (command: QueuedCommand) => void;
  /** Command processed */
  'command-processed': (command: QueuedCommand) => void;
  /** Immediate response needed */
  'immediate-response': (command: QueuedCommand, classification: CommandClassification) => void;
  /** Background task started */
  'background-task-started': (taskId: string, acknowledgment: string) => void;
  /** Task query received */
  'task-query': (command: QueuedCommand) => void;
  /** Task control received */
  'task-control': (command: QueuedCommand, action: string) => void;
}

/**
 * Conversation Manager
 * Manages voice command queuing and classification for non-blocking interaction
 */
export class ConversationManager extends EventEmitter {
  private config: ConversationManagerConfig;
  private commandQueue: QueuedCommand[] = [];
  private taskQueueManager: TaskQueueManager;
  private isProcessing: boolean = false;
  private commandCounter: number = 0;

  constructor(config: Partial<ConversationManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taskQueueManager = getTaskQueueManager();

    logger.info('ConversationManager initialized', {
      maxQueueSize: this.config.maxQueueSize,
      enableBackgroundTasks: this.config.enableBackgroundTasks,
    });
  }

  /**
   * Check if listening is enabled (always true - we can receive commands anytime)
   */
  isListeningEnabled(): boolean {
    return true;
  }

  /**
   * Check if we're currently busy with a conversation turn
   * (Different from task execution - this is about immediate voice interaction)
   */
  isConversationBusy(): boolean {
    return this.isProcessing;
  }

  /**
   * Get number of running background tasks
   */
  getRunningTaskCount(): number {
    return this.taskQueueManager.getRunningTasks().length;
  }

  /**
   * Queue a voice command for processing
   */
  queueVoiceCommand(transcript: string): QueuedCommand {
    const classification = this.classifyCommand(transcript);

    const command: QueuedCommand = {
      id: `cmd-${++this.commandCounter}-${Date.now()}`,
      transcript,
      priority: classification.priority,
      timestamp: Date.now(),
      processed: false,
    };

    // Handle queue overflow
    if (this.commandQueue.length >= this.config.maxQueueSize) {
      // Remove oldest non-urgent command
      const oldestNonUrgent = this.commandQueue.findIndex((c) => c.priority !== 'urgent');
      if (oldestNonUrgent >= 0) {
        this.commandQueue.splice(oldestNonUrgent, 1);
      } else {
        this.commandQueue.shift();
      }
      logger.warn('Command queue overflow, removed oldest command');
    }

    // Insert by priority
    const insertIndex = this.findInsertIndex(command.priority);
    this.commandQueue.splice(insertIndex, 0, command);

    logger.info('Voice command queued', {
      id: command.id,
      priority: command.priority,
      queuePosition: insertIndex,
      queueSize: this.commandQueue.length,
      isTaskQuery: classification.isTaskQuery,
      isTaskControl: classification.isTaskControl,
      isAdditive: classification.isAdditive,
    });

    this.emit('command-queued', command);

    // Handle immediate responses
    if (classification.requiresImmediateResponse) {
      this.emit('immediate-response', command, classification);
    }

    // Handle task queries
    if (classification.isTaskQuery) {
      this.emit('task-query', command);
    }

    // Handle task control
    if (classification.isTaskControl) {
      const action = this.extractTaskControlAction(transcript);
      this.emit('task-control', command, action);
    }

    return command;
  }

  /**
   * Classify a voice command to determine priority and type
   */
  classifyCommand(transcript: string): CommandClassification {
    const lowerTranscript = transcript.toLowerCase();

    // Check for urgent patterns
    const isUrgent = this.config.urgentPatterns.some((p) => p.test(lowerTranscript));

    // Check for task queries
    const isTaskQuery = this.config.taskQueryPatterns.some((p) => p.test(lowerTranscript));

    // Check for task control
    const isTaskControl = this.config.taskControlPatterns.some((p) => p.test(lowerTranscript));

    // Check for additive commands
    const isAdditive = this.config.additivePatterns.some((p) => p.test(lowerTranscript));

    // Determine priority
    let priority: CommandPriority = 'normal';
    if (isUrgent || isTaskControl) {
      priority = 'urgent';
    } else if (isAdditive) {
      priority = 'background';
    }

    // Determine if immediate response is needed
    const requiresImmediateResponse = isUrgent || isTaskQuery || isTaskControl;

    // Generate acknowledgment for background tasks
    let suggestedAcknowledgment: string | undefined;
    if (!requiresImmediateResponse && this.config.enableBackgroundTasks) {
      suggestedAcknowledgment = this.getRandomAcknowledgment();
    }

    return {
      priority,
      isTaskQuery,
      isTaskControl,
      isAdditive,
      requiresImmediateResponse,
      suggestedAcknowledgment,
    };
  }

  /**
   * Determine if a command should get an immediate response
   * or can be processed in the background
   */
  shouldRespondImmediately(transcript: string): boolean {
    const classification = this.classifyCommand(transcript);
    return classification.requiresImmediateResponse;
  }

  /**
   * Get a random acknowledgment phrase
   */
  getRandomAcknowledgment(): string {
    const index = Math.floor(Math.random() * this.config.acknowledgments.length);
    return this.config.acknowledgments[index];
  }

  /**
   * Get the next command to process
   */
  getNextCommand(): QueuedCommand | null {
    const next = this.commandQueue.find((c) => !c.processed);
    return next || null;
  }

  /**
   * Mark a command as processed
   */
  markCommandProcessed(commandId: string): void {
    const command = this.commandQueue.find((c) => c.id === commandId);
    if (command) {
      command.processed = true;
      this.emit('command-processed', command);

      // Clean up old processed commands
      this.cleanupProcessedCommands();
    }
  }

  /**
   * Get all pending (unprocessed) commands
   */
  getPendingCommands(): QueuedCommand[] {
    return this.commandQueue.filter((c) => !c.processed);
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): {
    total: number;
    pending: number;
    urgent: number;
    backgroundTasks: number;
  } {
    const pending = this.commandQueue.filter((c) => !c.processed);
    return {
      total: this.commandQueue.length,
      pending: pending.length,
      urgent: pending.filter((c) => c.priority === 'urgent').length,
      backgroundTasks: this.getRunningTaskCount(),
    };
  }

  /**
   * Clear all pending commands
   */
  clearQueue(): void {
    const pendingCount = this.commandQueue.filter((c) => !c.processed).length;
    this.commandQueue = this.commandQueue.filter((c) => c.processed);
    logger.info('Command queue cleared', { removedCount: pendingCount });
  }

  /**
   * Handle wake word detection
   * This should be called even during task execution
   */
  handleWakeWord(): void {
    logger.info('Wake word detected - ready for command');
    // The voice pipeline will handle the actual listening
    // This just signals that we're ready to receive commands
  }

  /**
   * Set processing state
   */
  setProcessing(processing: boolean): void {
    this.isProcessing = processing;
  }

  /**
   * Find insert index based on priority
   */
  private findInsertIndex(priority: CommandPriority): number {
    if (priority === 'urgent') {
      // Urgent goes to front (after other urgents)
      // ES5-compatible findLastIndex implementation
      let lastUrgent = -1;
      for (let i = this.commandQueue.length - 1; i >= 0; i--) {
        if (this.commandQueue[i].priority === 'urgent') {
          lastUrgent = i;
          break;
        }
      }
      return lastUrgent >= 0 ? lastUrgent + 1 : 0;
    } else if (priority === 'normal') {
      // Normal goes after urgents
      const firstBackground = this.commandQueue.findIndex((c) => c.priority === 'background');
      if (firstBackground >= 0) {
        return firstBackground;
      }
      return this.commandQueue.length;
    } else {
      // Background goes to end
      return this.commandQueue.length;
    }
  }

  /**
   * Extract task control action from transcript
   */
  private extractTaskControlAction(transcript: string): string {
    const lowerTranscript = transcript.toLowerCase();
    if (/\bcancel\b/.test(lowerTranscript)) return 'cancel';
    if (/\bstop\b/.test(lowerTranscript)) return 'stop';
    if (/\bpause\b/.test(lowerTranscript)) return 'pause';
    if (/\bresume\b/.test(lowerTranscript)) return 'resume';
    if (/\babort\b/.test(lowerTranscript)) return 'abort';
    return 'unknown';
  }

  /**
   * Clean up old processed commands
   */
  private cleanupProcessedCommands(): void {
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const cutoff = Date.now() - maxAge;

    this.commandQueue = this.commandQueue.filter((c) => !c.processed || c.timestamp > cutoff);
  }
}

// Singleton instance
let conversationManager: ConversationManager | null = null;

/**
 * Get the conversation manager instance
 */
export function getConversationManager(): ConversationManager {
  if (!conversationManager) {
    conversationManager = new ConversationManager();
  }
  return conversationManager;
}

/**
 * Initialize conversation manager with custom config
 */
export function initializeConversationManager(
  config?: Partial<ConversationManagerConfig>
): ConversationManager {
  if (conversationManager) {
    logger.warn('ConversationManager already initialized, returning existing instance');
    return conversationManager;
  }
  conversationManager = new ConversationManager(config);
  return conversationManager;
}

/**
 * Reset conversation manager (for testing)
 */
export function resetConversationManager(): void {
  conversationManager = null;
}
