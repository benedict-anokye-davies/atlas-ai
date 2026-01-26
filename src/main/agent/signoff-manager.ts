/**
 * Atlas Sign-off Manager
 *
 * Generates contextual JARVIS-style sign-offs based on time of day,
 * task completion status, and system health. Tracks daily accomplishments
 * and detects goodbye intent from voice input.
 *
 * @module agent/signoff-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SignoffManager');

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Time of day categories for contextual sign-offs */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** System health status */
export type SystemStatus = 'stable' | 'warning' | 'error';

/**
 * Context for generating sign-offs
 */
export interface SignoffContext {
  /** Current time of day */
  timeOfDay: TimeOfDay;
  /** Number of tasks completed this session */
  tasksCompleted: number;
  /** Number of tasks still pending */
  tasksRemaining: number;
  /** Current system health status */
  systemStatus: SystemStatus;
  /** Hours worked this session (optional) */
  hoursWorked?: number;
  /** Active task name if any (optional) */
  activeTask?: string;
  /** Warning message if system has issues (optional) */
  warningMessage?: string;
}

/**
 * Session summary information
 */
export interface SessionSummary {
  /** Tasks completed this session */
  tasksCompleted: string[];
  /** Total task count */
  totalTasks: number;
  /** Session start time */
  sessionStart: Date;
  /** Session duration in minutes */
  durationMinutes: number;
}

// ============================================================================
// Sign-off Templates
// ============================================================================

/** Productive day sign-offs (3+ tasks completed) */
const PRODUCTIVE_DAY_SIGNOFFS = [
  'Nice work today, Ben. {tasks} tasks done, systems stable. See you tomorrow.',
  'All done. Systems stable. Get some rest, Ben.',
  "That's a wrap. {tasks} tasks completed. Good day's work.",
  'Solid progress today, Ben. {tasks} tasks checked off. Until next time.',
  "Everything's wrapped up. {tasks} tasks complete. Rest up, Ben.",
];

/** Sign-offs when tasks are still pending */
const TASKS_REMAINING_SIGNOFFS = [
  "Wrapping up. {remaining} tasks still in progress - I'll keep an eye on them.",
  "Signing off. The {task} is still running, I'll let you know when it's done.",
  "Heading out with {remaining} items pending. I'll monitor progress.",
  "Taking off. {remaining} tasks queued - I'll have updates ready for you.",
];

/** Sign-offs when system has warnings */
const WARNING_SIGNOFFS = [
  "Wrapping up. Note: {issue}. I'll monitor it.",
  'Before you go - {issue}. Want me to look into it?',
  "Signing off with a heads up: {issue}. I'll keep watch.",
  "One thing to note: {issue}. I'll track it overnight.",
];

/** Sign-offs when system has errors */
const ERROR_SIGNOFFS = [
  'Before you go, Ben - {issue}. Might want to address this.',
  "Heads up: {issue}. I can investigate while you're away.",
  "Wrapping up, but {issue}. I'll try some fixes.",
];

/** Late night sign-offs (after 10pm) */
const LATE_NIGHT_SIGNOFFS = [
  "Get some rest, Ben. I'll hold down the fort.",
  "Time to call it a night. I'll be here if anything comes up.",
  "It's late, Ben. Go get some sleep - I've got things covered.",
  "You should get some rest. I'll keep watch.",
  "Late one tonight. Get some sleep, I'll handle things.",
];

/** Short session sign-offs (< 30 min or < 2 tasks) */
const SHORT_SESSION_SIGNOFFS = [
  "Already done? Alright, I'll be here.",
  'Quick session. Talk soon, Ben.',
  'Short and sweet. Catch you later.',
  "That was quick. I'll be around.",
];

/** Generic/neutral sign-offs */
const GENERIC_SIGNOFFS = [
  'Talk to you later, Ben.',
  "Signing off. I'll be here when you need me.",
  'Until next time, Ben.',
  "Take care, Ben. I'll be ready when you're back.",
];

/** Morning sign-offs */
const MORNING_SIGNOFFS = [
  "Have a good morning, Ben. I'll be here.",
  'Off to a good start. Talk soon.',
  'Morning session wrapped. See you later.',
];

// ============================================================================
// Goodbye Intent Detection
// ============================================================================

/** Patterns that indicate user wants to end session */
const GOODBYE_PATTERNS = [
  // Direct farewells
  /\b(goodbye|good\s*bye|bye|bye\s*bye)\b/i,
  /\b(see\s+you|see\s+ya|later|laters)\b/i,
  /\b(good\s*night|goodnight|night|nite)\b/i,
  /\b(take\s+care|farewell)\b/i,

  // Session ending phrases
  /\b(i'?m\s+done|that'?s\s+all|all\s+done)\b/i,
  /\b(signing\s+off|sign\s+off|logging\s+off)\b/i,
  /\b(heading\s+out|gotta\s+go|got\s+to\s+go)\b/i,
  /\b(that'?s\s+it\s+for\s+(now|today|tonight))\b/i,
  /\b(call\s+it\s+a\s+(day|night))\b/i,
  /\b(wrap\s*(it)?\s*up)\b/i,

  // Time-based departures
  /\b(going\s+to\s+(bed|sleep))\b/i,
  /\b(time\s+to\s+(go|leave|sleep))\b/i,
  /\b(off\s+to\s+bed)\b/i,

  // Thanks and done
  /\b(thanks,?\s*(that'?s\s+all|i'?m\s+good))\b/i,
  /\b(thanks\s+(for\s+)?everything)\b/i,
];

// ============================================================================
// SignoffManager Class
// ============================================================================

/**
 * Events emitted by SignoffManager
 */
export interface SignoffManagerEvents {
  /** Goodbye intent detected from user speech */
  'goodbye-detected': (transcript: string, confidence: number) => void;
  /** Task was completed and tracked */
  'task-completed': (taskName: string, totalCompleted: number) => void;
  /** Daily tracking was reset */
  'daily-reset': () => void;
}

/**
 * Manages contextual sign-offs and session tracking for Atlas.
 *
 * Responsibilities:
 * - Generate JARVIS-style sign-offs based on context
 * - Track daily task accomplishments
 * - Detect goodbye intent from voice transcripts
 * - Provide session summaries
 *
 * @example
 * ```typescript
 * const manager = getSignoffManager();
 *
 * // Track a completed task
 * manager.trackTaskCompletion('Fixed TypeScript errors');
 *
 * // Check for goodbye intent
 * if (manager.detectGoodbyeIntent('Alright, I\'m done for today')) {
 *   const signoff = manager.generateSignoff({
 *     timeOfDay: 'evening',
 *     tasksCompleted: 5,
 *     tasksRemaining: 0,
 *     systemStatus: 'stable'
 *   });
 *   console.log(signoff);
 * }
 * ```
 */
export class SignoffManager extends EventEmitter {
  /** Tasks completed during current session */
  private dailyAccomplishments: string[] = [];

  /** Session start timestamp */
  private sessionStart: Date = new Date();

  /** Last reset date (for midnight reset) */
  private lastResetDate: string = this.getDateString(new Date());

  /** Midnight reset timer */
  private midnightTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.scheduleMidnightReset();
    logger.info('SignoffManager initialized');
  }

  // ==========================================================================
  // Sign-off Generation
  // ==========================================================================

  /**
   * Generate a contextual sign-off message.
   *
   * Selection logic:
   * 1. System errors/warnings take priority
   * 2. Late night (after 10pm) gets special messages
   * 3. Short sessions (< 30 min, < 2 tasks) get quick sign-offs
   * 4. Tasks remaining get follow-up messages
   * 5. Productive days (3+ tasks) get celebration
   * 6. Otherwise, use time-appropriate generic
   *
   * @param context - Sign-off context including time, tasks, system status
   * @returns Personalized sign-off message
   */
  public generateSignoff(context: SignoffContext): string {
    // Check for midnight and reset if needed
    this.checkAndResetIfNewDay();

    const {
      timeOfDay,
      tasksCompleted,
      tasksRemaining,
      systemStatus,
      hoursWorked,
      activeTask,
      warningMessage,
    } = context;

    logger.debug('Generating sign-off', { context });

    // Priority 1: System issues
    if (systemStatus === 'error' && warningMessage) {
      return this.selectAndFill(ERROR_SIGNOFFS, {
        issue: warningMessage,
      });
    }

    if (systemStatus === 'warning' && warningMessage) {
      return this.selectAndFill(WARNING_SIGNOFFS, {
        issue: warningMessage,
      });
    }

    // Priority 2: Late night
    if (timeOfDay === 'night') {
      const hour = new Date().getHours();
      if (hour >= 22 || hour < 5) {
        return this.selectAndFill(LATE_NIGHT_SIGNOFFS, {});
      }
    }

    // Priority 3: Short session
    const isShortSession = (hoursWorked !== undefined && hoursWorked < 0.5) || tasksCompleted < 2;
    if (isShortSession && tasksRemaining === 0) {
      return this.selectAndFill(SHORT_SESSION_SIGNOFFS, {});
    }

    // Priority 4: Tasks remaining
    if (tasksRemaining > 0) {
      return this.selectAndFill(TASKS_REMAINING_SIGNOFFS, {
        remaining: tasksRemaining.toString(),
        task: activeTask || 'current task',
      });
    }

    // Priority 5: Productive day
    if (tasksCompleted >= 3) {
      return this.selectAndFill(PRODUCTIVE_DAY_SIGNOFFS, {
        tasks: tasksCompleted.toString(),
      });
    }

    // Priority 6: Time-appropriate generic
    if (timeOfDay === 'morning') {
      return this.selectAndFill(MORNING_SIGNOFFS, {});
    }

    return this.selectAndFill(GENERIC_SIGNOFFS, {});
  }

  // ==========================================================================
  // Goodbye Intent Detection
  // ==========================================================================

  /**
   * Detect if the transcript contains goodbye intent.
   *
   * Checks against known goodbye patterns and emits event if detected.
   *
   * @param transcript - Voice transcript to analyze
   * @returns True if goodbye intent detected
   */
  public detectGoodbyeIntent(transcript: string): boolean {
    const normalizedTranscript = transcript.toLowerCase().trim();

    for (const pattern of GOODBYE_PATTERNS) {
      if (pattern.test(normalizedTranscript)) {
        // Calculate confidence based on how explicit the goodbye is
        const confidence = this.calculateGoodbyeConfidence(normalizedTranscript);

        logger.info('Goodbye intent detected', {
          transcript: normalizedTranscript,
          confidence,
        });

        this.emit('goodbye-detected', transcript, confidence);
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate confidence score for goodbye detection.
   *
   * Higher confidence for explicit farewells, lower for implicit ones.
   */
  private calculateGoodbyeConfidence(transcript: string): number {
    // Explicit farewells
    if (/\b(goodbye|bye|goodnight|see\s+you)\b/i.test(transcript)) {
      return 0.95;
    }

    // Session ending phrases
    if (/\b(i'?m\s+done|that'?s\s+all|signing\s+off)\b/i.test(transcript)) {
      return 0.85;
    }

    // Time-based departures
    if (/\b(heading\s+out|gotta\s+go|time\s+to\s+go)\b/i.test(transcript)) {
      return 0.75;
    }

    // Implicit
    return 0.65;
  }

  // ==========================================================================
  // Task Tracking
  // ==========================================================================

  /**
   * Track a completed task.
   *
   * @param taskName - Name/description of completed task
   */
  public trackTaskCompletion(taskName: string): void {
    this.checkAndResetIfNewDay();

    this.dailyAccomplishments.push(taskName);

    logger.info('Task completed', {
      task: taskName,
      totalCompleted: this.dailyAccomplishments.length,
    });

    this.emit('task-completed', taskName, this.dailyAccomplishments.length);
  }

  /**
   * Get list of tasks completed today.
   *
   * @returns Array of task names
   */
  public getDailyAccomplishments(): string[] {
    this.checkAndResetIfNewDay();
    return [...this.dailyAccomplishments];
  }

  /**
   * Get the number of tasks completed today.
   *
   * @returns Task count
   */
  public getTaskCount(): number {
    this.checkAndResetIfNewDay();
    return this.dailyAccomplishments.length;
  }

  /**
   * Reset daily tracking manually.
   */
  public resetDailyTracking(): void {
    this.dailyAccomplishments = [];
    this.sessionStart = new Date();
    this.lastResetDate = this.getDateString(new Date());

    logger.info('Daily tracking reset');
    this.emit('daily-reset');
  }

  // ==========================================================================
  // Session Summary
  // ==========================================================================

  /**
   * Get summary of current session.
   *
   * @returns Session summary with tasks and duration
   */
  public getSessionSummary(): SessionSummary {
    this.checkAndResetIfNewDay();

    const now = new Date();
    const durationMs = now.getTime() - this.sessionStart.getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    return {
      tasksCompleted: [...this.dailyAccomplishments],
      totalTasks: this.dailyAccomplishments.length,
      sessionStart: this.sessionStart,
      durationMinutes,
    };
  }

  /**
   * Get current time of day category.
   *
   * @returns Time of day category
   */
  public getCurrentTimeOfDay(): TimeOfDay {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Select random template and fill placeholders.
   */
  private selectAndFill(templates: string[], replacements: Record<string, string>): string {
    const template = templates[Math.floor(Math.random() * templates.length)];

    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return result;
  }

  /**
   * Get date string for comparison (YYYY-MM-DD).
   */
  private getDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Check if it's a new day and reset if needed.
   */
  private checkAndResetIfNewDay(): void {
    const today = this.getDateString(new Date());
    if (today !== this.lastResetDate) {
      logger.info('New day detected, resetting tracking', {
        previousDate: this.lastResetDate,
        newDate: today,
      });
      this.resetDailyTracking();
    }
  }

  /**
   * Schedule automatic reset at midnight.
   */
  private scheduleMidnightReset(): void {
    // Clear existing timer
    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
    }

    // Calculate ms until midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    this.midnightTimer = setTimeout(() => {
      this.resetDailyTracking();
      // Schedule next reset
      this.scheduleMidnightReset();
    }, msUntilMidnight);

    logger.debug('Scheduled midnight reset', {
      msUntilMidnight,
      resetTime: midnight.toISOString(),
    });
  }

  /**
   * Shutdown and cleanup.
   */
  public shutdown(): void {
    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }
    this.removeAllListeners();
    logger.info('SignoffManager shutdown complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let signoffManagerInstance: SignoffManager | null = null;

/**
 * Get or create the SignoffManager singleton instance.
 *
 * @returns SignoffManager instance
 */
export function getSignoffManager(): SignoffManager {
  if (!signoffManagerInstance) {
    signoffManagerInstance = new SignoffManager();
    logger.info('SignoffManager singleton created');
  }
  return signoffManagerInstance;
}

/**
 * Shutdown and cleanup SignoffManager singleton.
 */
export function shutdownSignoffManager(): void {
  if (signoffManagerInstance) {
    signoffManagerInstance.shutdown();
    signoffManagerInstance = null;
    logger.info('SignoffManager singleton shutdown');
  }
}

/**
 * Reset SignoffManager singleton (for testing).
 */
export function resetSignoffManager(): void {
  if (signoffManagerInstance) {
    signoffManagerInstance.shutdown();
  }
  signoffManagerInstance = null;
}

// Default export for convenience
export default getSignoffManager;
