/**
 * Atlas Desktop - Timer Skill
 * Session 043-B: Built-in skills
 *
 * Provides timer and reminder functionality.
 */

import { BaseSkill } from './base-skill';
import type {
  SkillMetadata,
  SkillTrigger,
  SkillCapabilities,
  SkillContext,
  SkillResult,
} from '../../../shared/types/skill';
import type { AgentTool } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const logger = createModuleLogger('timer-skill');

/**
 * Timer entry
 */
interface Timer {
  id: string;
  name: string;
  duration: number; // Duration in milliseconds
  startTime: number;
  endTime: number;
  completed: boolean;
  notified: boolean;
}

/**
 * Timer Skill
 * Handles timers and countdown functionality
 */
export class TimerSkill extends BaseSkill {
  readonly id = 'timer';

  readonly metadata: SkillMetadata = {
    displayName: 'Timer',
    description: 'Set timers and countdowns',
    longDescription:
      'Set timers for any duration, track multiple timers, and get notified when time is up. Perfect for cooking, reminders, and time management.',
    version: '1.0.0',
    icon: 'clock',
    category: 'productivity',
    tags: ['timer', 'countdown', 'alarm', 'reminder', 'time'],
    exampleQueries: [
      'Set a timer for 5 minutes',
      'Start a 30 second timer',
      'Timer for 1 hour',
      'Set a 10 minute cooking timer',
      'How much time is left on my timer?',
      'Cancel my timer',
      'List all timers',
    ],
    builtIn: true,
  };

  readonly triggers: SkillTrigger[] = [
    {
      type: 'keyword',
      keywords: [
        'timer',
        'countdown',
        'set timer',
        'start timer',
        'time for',
        'remind me in',
        'alarm',
        'minutes',
        'seconds',
        'hours',
      ],
      priority: 1,
    },
    {
      type: 'intent',
      intents: ['set_timer', 'check_timer', 'cancel_timer'],
      priority: 1,
    },
  ];

  readonly capabilities: SkillCapabilities = {
    required: ['scheduling'],
    optional: [],
    requiresInternet: false,
    offlineCapable: true,
  };

  private timers: Map<string, Timer> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize timer skill
   */
  async activate(): Promise<void> {
    await super.activate();

    // Start checking for completed timers
    this.checkInterval = setInterval(() => this.checkTimers(), 1000);
  }

  /**
   * Deactivate timer skill
   */
  async deactivate(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    await super.deactivate();
  }

  /**
   * Check if should handle
   */
  async shouldHandle(context: SkillContext): Promise<number> {
    const query = context.query.toLowerCase();

    // High confidence for timer-specific queries
    if (/\b(set|start|create)\s+(a\s+)?timer\b/.test(query)) {
      return 0.9;
    }

    if (/\btimer\s+for\b/.test(query)) {
      return 0.85;
    }

    // Check for time patterns with timer context
    if (/\d+\s*(minute|second|hour|min|sec|hr)s?\b/.test(query)) {
      if (/\b(timer|countdown|set|start|remind)\b/.test(query)) {
        return 0.8;
      }
    }

    // Timer management queries
    if (/\b(cancel|stop|check|status|time left|how much time)\b.*\btimer\b/.test(query)) {
      return 0.85;
    }

    if (/\b(list|show)\s+(all\s+)?(my\s+)?timers\b/.test(query)) {
      return 0.9;
    }

    return super.shouldHandle(context);
  }

  /**
   * Execute timer commands
   */
  async execute(context: SkillContext): Promise<SkillResult> {
    logger.info(`[Timer] Processing query: ${context.query}`);

    const query = context.query.toLowerCase();

    try {
      // Check for list timers
      if (/\b(list|show)\s+(all\s+)?(my\s+)?timers\b/.test(query)) {
        return this.listTimers();
      }

      // Check for cancel timer
      if (/\b(cancel|stop|clear)\b.*\btimer\b/.test(query)) {
        return this.cancelTimer(query);
      }

      // Check for timer status
      if (/\b(check|status|time left|how much time|remaining)\b/.test(query)) {
        return this.checkTimerStatus();
      }

      // Default: set a new timer
      return this.setTimer(query);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`[Timer] Error: ${errorMessage}`);
      return this.failure(errorMessage);
    }
  }

  /**
   * Set a new timer
   */
  private setTimer(query: string): SkillResult {
    const duration = this.parseDuration(query);

    if (!duration) {
      return this.failure(
        'Could not understand the timer duration. Try saying "set a timer for 5 minutes".'
      );
    }

    // Extract timer name if provided
    const nameMatch = query.match(/(?:called|named|for)\s+(.+?)(?:\s+for|\s+timer|$)/i);
    const name = nameMatch ? nameMatch[1].trim() : `Timer ${this.timers.size + 1}`;

    const id = `timer-${Date.now()}`;
    const now = Date.now();

    const timer: Timer = {
      id,
      name,
      duration,
      startTime: now,
      endTime: now + duration,
      completed: false,
      notified: false,
    };

    this.timers.set(id, timer);

    const durationStr = this.formatDuration(duration);
    logger.info(`[Timer] Created timer "${name}" for ${durationStr}`);

    return this.success(
      { timerId: id, duration, name },
      `I've set a ${durationStr} timer. I'll let you know when it's done!`
    );
  }

  /**
   * List all active timers
   */
  private listTimers(): SkillResult {
    const activeTimers = Array.from(this.timers.values()).filter((t) => !t.completed);

    if (activeTimers.length === 0) {
      return this.success({ timers: [] }, "You don't have any active timers.");
    }

    const now = Date.now();
    const timerList = activeTimers.map((t) => {
      const remaining = Math.max(0, t.endTime - now);
      return `${t.name}: ${this.formatDuration(remaining)} remaining`;
    });

    return this.success(
      { timers: activeTimers },
      `You have ${activeTimers.length} active timer(s):\n${timerList.join('\n')}`
    );
  }

  /**
   * Cancel a timer
   */
  private cancelTimer(query: string): SkillResult {
    const activeTimers = Array.from(this.timers.values()).filter((t) => !t.completed);

    if (activeTimers.length === 0) {
      return this.success({ cancelled: false }, "You don't have any active timers to cancel.");
    }

    // If only one timer, cancel it
    if (activeTimers.length === 1) {
      const timer = activeTimers[0];
      this.timers.delete(timer.id);
      return this.success({ cancelled: true, timerId: timer.id }, `Cancelled the ${timer.name}.`);
    }

    // Try to find timer by name in query
    const nameMatch = query.match(/cancel\s+(?:the\s+)?(.+?)\s+timer/i);
    if (nameMatch) {
      const searchName = nameMatch[1].toLowerCase();
      const matchingTimer = activeTimers.find((t) => t.name.toLowerCase().includes(searchName));

      if (matchingTimer) {
        this.timers.delete(matchingTimer.id);
        return this.success(
          { cancelled: true, timerId: matchingTimer.id },
          `Cancelled the ${matchingTimer.name}.`
        );
      }
    }

    // Cancel the most recent timer
    const recentTimer = activeTimers[activeTimers.length - 1];
    this.timers.delete(recentTimer.id);
    return this.success(
      { cancelled: true, timerId: recentTimer.id },
      `Cancelled ${recentTimer.name}. You still have ${activeTimers.length - 1} other timer(s).`
    );
  }

  /**
   * Check timer status
   */
  private checkTimerStatus(): SkillResult {
    const activeTimers = Array.from(this.timers.values()).filter((t) => !t.completed);

    if (activeTimers.length === 0) {
      return this.success({ hasTimers: false }, "You don't have any active timers.");
    }

    const now = Date.now();

    if (activeTimers.length === 1) {
      const timer = activeTimers[0];
      const remaining = Math.max(0, timer.endTime - now);
      return this.success(
        { timer, remaining },
        `${timer.name} has ${this.formatDuration(remaining)} remaining.`
      );
    }

    const timerStatus = activeTimers.map((t) => {
      const remaining = Math.max(0, t.endTime - now);
      return `${t.name}: ${this.formatDuration(remaining)}`;
    });

    return this.success({ timers: activeTimers }, `Timer status:\n${timerStatus.join('\n')}`);
  }

  /**
   * Parse duration from natural language
   */
  private parseDuration(query: string): number | null {
    let totalMs = 0;

    // Match patterns like "5 minutes", "30 seconds", "1 hour"
    const patterns = [
      { regex: /(\d+(?:\.\d+)?)\s*(?:hour|hr)s?/gi, multiplier: 60 * 60 * 1000 },
      { regex: /(\d+(?:\.\d+)?)\s*(?:minute|min)s?/gi, multiplier: 60 * 1000 },
      { regex: /(\d+(?:\.\d+)?)\s*(?:second|sec)s?/gi, multiplier: 1000 },
    ];

    for (const { regex, multiplier } of patterns) {
      let match;
      while ((match = regex.exec(query)) !== null) {
        totalMs += parseFloat(match[1]) * multiplier;
      }
    }

    // If no specific units, check for standalone numbers with context
    if (totalMs === 0) {
      const numberMatch = query.match(/(\d+)/);
      if (numberMatch) {
        const num = parseInt(numberMatch[1], 10);
        // Default to minutes for reasonable numbers
        if (num <= 120) {
          totalMs = num * 60 * 1000; // Assume minutes
        }
      }
    }

    return totalMs > 0 ? totalMs : null;
  }

  /**
   * Format duration for display
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
      const remainingSeconds = seconds % 60;
      if (remainingSeconds > 0 && minutes < 5) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} and ${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}`;
      }
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  /**
   * Check for completed timers
   */
  private checkTimers(): void {
    const now = Date.now();

    for (const timer of this.timers.values()) {
      if (!timer.completed && now >= timer.endTime) {
        timer.completed = true;

        if (!timer.notified) {
          timer.notified = true;
          this.notifyTimerComplete(timer);
        }
      }
    }

    // Clean up old completed timers (older than 5 minutes)
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    for (const [id, timer] of this.timers) {
      if (timer.completed && timer.endTime < fiveMinutesAgo) {
        this.timers.delete(id);
      }
    }
  }

  /**
   * Notify that a timer is complete
   */
  private notifyTimerComplete(timer: Timer): void {
    logger.info(`[Timer] Timer "${timer.name}" completed!`);

    // Emit event for notification system
    // This will be picked up by the main process notification system
    if (typeof process !== 'undefined' && process.emit) {
      process.emit('timer-complete' as unknown as 'message', {
        id: timer.id,
        name: timer.name,
        message: `${timer.name} is done!`,
      });
    }
  }

  /**
   * Register timer tools
   */
  protected registerTools(): AgentTool[] {
    return [
      {
        name: 'set_timer',
        description: 'Set a countdown timer',
        parameters: {
          type: 'object',
          properties: {
            duration: {
              type: 'number',
              description: 'Duration in seconds',
            },
            name: {
              type: 'string',
              description: 'Optional name for the timer',
            },
          },
          required: ['duration'],
        },
        execute: async (params: Record<string, unknown>) => {
          const duration = (params.duration as number) * 1000;
          const name = (params.name as string) || `Timer ${this.timers.size + 1}`;

          const id = `timer-${Date.now()}`;
          const now = Date.now();

          const timer: Timer = {
            id,
            name,
            duration,
            startTime: now,
            endTime: now + duration,
            completed: false,
            notified: false,
          };

          this.timers.set(id, timer);

          return {
            success: true,
            data: { timerId: id, name, duration },
          };
        },
      },
      {
        name: 'list_timers',
        description: 'List all active timers',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          const activeTimers = Array.from(this.timers.values())
            .filter((t) => !t.completed)
            .map((t) => ({
              id: t.id,
              name: t.name,
              remaining: Math.max(0, t.endTime - Date.now()),
            }));

          return {
            success: true,
            data: { timers: activeTimers },
          };
        },
      },
      {
        name: 'cancel_timer',
        description: 'Cancel an active timer',
        parameters: {
          type: 'object',
          properties: {
            timerId: {
              type: 'string',
              description: 'ID of the timer to cancel',
            },
          },
          required: ['timerId'],
        },
        execute: async (params: Record<string, unknown>) => {
          const timerId = params.timerId as string;
          const timer = this.timers.get(timerId);

          if (!timer) {
            return {
              success: false,
              error: 'Timer not found',
            };
          }

          this.timers.delete(timerId);

          return {
            success: true,
            data: { cancelled: true, timerId },
          };
        },
      },
    ];
  }
}

export default TimerSkill;
