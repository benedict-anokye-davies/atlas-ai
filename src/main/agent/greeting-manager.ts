/**
 * Atlas Greeting Manager
 *
 * Generates contextual JARVIS-style greetings for Ben based on time of day,
 * session state, and task context. Tracks interaction times for appropriate
 * return greetings.
 *
 * @module agent/greeting-manager
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('GreetingManager');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Context for generating appropriate greetings
 */
export interface GreetingContext {
  /** Current time of day */
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Whether this is the first session ever or first of the day */
  isFirstSession: boolean;
  /** Minutes since last interaction */
  timeSinceLastInteraction: number;
  /** Whether it's Saturday or Sunday */
  isWeekend: boolean;
  /** Number of pending tasks */
  pendingTasks: number;
  /** Context of what user was working on */
  lastWorkContext?: string;
}

/**
 * Persistent state stored to disk
 */
interface GreetingPersistentState {
  /** Timestamp of last interaction (ms since epoch) */
  lastInteractionTime: number;
  /** Timestamp of session start (ms since epoch) */
  sessionStartTime: number;
  /** Last work context string */
  lastWorkContext?: string;
  /** Whether a greeting has been shown this session */
  hasGreetedThisSession: boolean;
}

/**
 * Greeting manager interface
 */
export interface IGreetingManager {
  generateGreeting(context: GreetingContext): string;
  getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night';
  shouldGreet(lastInteractionTime: number): boolean;
  updateLastInteraction(): void;
}

// ============================================================================
// Greeting Templates
// ============================================================================

/** Morning first login greetings */
const MORNING_FIRST_LOGIN = [
  'Good morning, Ben.',
  'Good morning, Ben. Ready to get started?',
  'Morning, Ben. Systems online and ready.',
];

/** Morning with pending tasks */
const MORNING_WITH_TASKS = [
  'Good morning, Ben. {count} tasks from yesterday are still pending.',
  'Morning, Ben. You have {count} items waiting for your attention.',
  "Good morning, Ben. {count} tasks are queued up when you're ready.",
];

/** Afternoon greetings */
const AFTERNOON_GREETINGS = [
  'Good afternoon, Ben.',
  'Afternoon, Ben. How can I assist?',
  'Good afternoon, Ben. Back to it?',
];

/** Evening greetings */
const EVENING_GREETINGS = [
  'Good evening, Ben.',
  'Evening, Ben. Winding down?',
  "Good evening, Ben. I'm here if you need me.",
];

/** Late night greetings (after 10 PM) */
const LATE_NIGHT_GREETINGS = [
  'Burning the midnight oil, Ben?',
  "Still at it, Ben? I'm here if you need me.",
  "It's getting late, Ben. Though I appreciate the company.",
  'Working late, Ben? Just say the word.',
];

/** Return after absence (30+ minutes) */
const RETURN_GREETINGS = [
  'Welcome back, Ben.',
  'Back online, Ben.',
  "Ah, you've returned. How can I help?",
];

/** Return with context */
const RETURN_WITH_CONTEXT = [
  'Welcome back, Ben. You were working on {context}.',
  'Back already? Shall we continue with {context}?',
  'Welcome back, Ben. {context} is still where you left it.',
];

/** Return with duration */
const RETURN_WITH_DURATION = [
  'Welcome back, Ben. You were gone {duration}.',
  'Back after {duration}. Shall we pick up where we left off?',
  "You've been away {duration}. Ready to continue?",
];

/** Weekend greetings */
const WEEKEND_GREETINGS = [
  "Working on the weekend, Ben? I won't tell.",
  'Good {timeOfDay}, Ben. Light schedule today, I hope?',
  '{TimeOfDay}, Ben. Weekend project?',
  'Ah, a weekend session. Good {timeOfDay}, Ben.',
];

/** Greetings with pending tasks */
const WITH_TASKS_GREETINGS = [
  'Good {timeOfDay}, Ben. You have {count} tasks waiting.',
  '{TimeOfDay}, Ben. Shall we pick up where we left off?',
  'Good {timeOfDay}, Ben. {count} items in the queue.',
];

// ============================================================================
// GreetingManager Class
// ============================================================================

/**
 * Events emitted by GreetingManager
 */
export interface GreetingManagerEvents {
  /** Greeting generated */
  'greeting-generated': (greeting: string, context: GreetingContext) => void;
  /** Interaction time updated */
  'interaction-updated': (timestamp: number) => void;
}

/**
 * Manages contextual greeting generation for Atlas.
 *
 * Tracks session state and interaction times to generate appropriate
 * JARVIS-style greetings. Persists state to disk for cross-session awareness.
 *
 * @example
 * ```typescript
 * const manager = getGreetingManager();
 *
 * // Check if we should show a greeting
 * if (manager.shouldGreet(lastTime)) {
 *   const context = manager.buildContext(pendingTasks, workContext);
 *   const greeting = manager.generateGreeting(context);
 *   console.log(greeting); // "Good morning, Ben."
 * }
 *
 * // Update interaction time after each exchange
 * manager.updateLastInteraction();
 * ```
 */
export class GreetingManager extends EventEmitter implements IGreetingManager {
  private state: GreetingPersistentState;
  private pendingTaskCount: number = 0;
  private statePath: string;
  private minAbsenceMinutes: number = 30; // Ben's preference: only greet after 30+ min

  constructor(statePath?: string) {
    super();
    this.statePath = statePath || join(homedir(), '.atlas', 'brain', 'self', 'greeting-state.json');
    this.state = this.loadState();
    logger.info('GreetingManager initialized', { statePath: this.statePath });
  }

  // ==========================================================================
  // State Persistence
  // ==========================================================================

  /**
   * Load persistent state from disk
   */
  private loadState(): GreetingPersistentState {
    try {
      if (existsSync(this.statePath)) {
        const data = readFileSync(this.statePath, 'utf-8');
        const loaded = JSON.parse(data) as GreetingPersistentState;
        logger.debug('Loaded greeting state', { lastInteraction: loaded.lastInteractionTime });
        return {
          ...loaded,
          // Reset session flag on new app launch
          hasGreetedThisSession: false,
          sessionStartTime: Date.now(),
        };
      }
    } catch (error) {
      logger.warn('Failed to load greeting state, using defaults', {
        error: (error as Error).message,
      });
    }

    // Default state for first run
    return {
      lastInteractionTime: 0,
      sessionStartTime: Date.now(),
      hasGreetedThisSession: false,
    };
  }

  /**
   * Save persistent state to disk
   */
  private saveState(): void {
    try {
      const dir = dirname(this.statePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
      logger.debug('Saved greeting state');
    } catch (error) {
      logger.warn('Failed to save greeting state', { error: (error as Error).message });
    }
  }

  // ==========================================================================
  // Time Utilities
  // ==========================================================================

  /**
   * Get current time of day based on hour
   */
  public getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
      return 'morning';
    } else if (hour >= 12 && hour < 17) {
      return 'afternoon';
    } else if (hour >= 17 && hour < 22) {
      return 'evening';
    } else {
      return 'night';
    }
  }

  /**
   * Check if current day is a weekend
   */
  public isWeekend(): boolean {
    const day = new Date().getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
  }

  /**
   * Check if it's late night (after 10 PM)
   */
  public isLateNight(): boolean {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 5;
  }

  /**
   * Format duration in minutes to human-readable string
   */
  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)} minutes`;
    } else if (minutes < 120) {
      const hrs = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hrs} hour and ${mins} minutes` : `${hrs} hour`;
    } else {
      const hrs = Math.round(minutes / 60);
      return `${hrs} hours`;
    }
  }

  // ==========================================================================
  // Greeting Logic
  // ==========================================================================

  /**
   * Determine if a greeting should be shown
   *
   * Based on Ben's preference: only greet on session start or after 30+ min absence
   *
   * @param lastInteractionTime - Timestamp of last interaction (ms)
   * @returns Whether to show a greeting
   */
  public shouldGreet(lastInteractionTime?: number): boolean {
    // Always greet on first session start
    if (!this.state.hasGreetedThisSession) {
      return true;
    }

    // Check time since last interaction
    const lastTime = lastInteractionTime ?? this.state.lastInteractionTime;
    if (lastTime === 0) {
      return true; // First ever interaction
    }

    const minutesSince = (Date.now() - lastTime) / (1000 * 60);
    return minutesSince >= this.minAbsenceMinutes;
  }

  /**
   * Build greeting context from current state
   *
   * @param pendingTasks - Number of pending tasks (optional override)
   * @param lastWorkContext - Description of last work context
   * @returns GreetingContext for generating greeting
   */
  public buildContext(pendingTasks?: number, lastWorkContext?: string): GreetingContext {
    const now = Date.now();
    const lastTime = this.state.lastInteractionTime;
    const timeSinceLastInteraction = lastTime > 0 ? (now - lastTime) / (1000 * 60) : 0;

    return {
      timeOfDay: this.getTimeOfDay(),
      isFirstSession: this.state.lastInteractionTime === 0 || !this.state.hasGreetedThisSession,
      timeSinceLastInteraction,
      isWeekend: this.isWeekend(),
      pendingTasks: pendingTasks ?? this.pendingTaskCount,
      lastWorkContext: lastWorkContext ?? this.state.lastWorkContext,
    };
  }

  /**
   * Generate a contextual greeting based on provided context
   *
   * @param context - Greeting context with time, session, and task info
   * @returns Appropriate JARVIS-style greeting for Ben
   */
  public generateGreeting(context: GreetingContext): string {
    let greeting: string;

    // Late night takes priority
    if (this.isLateNight()) {
      greeting = this.randomChoice(LATE_NIGHT_GREETINGS);
    }
    // Return after absence (30+ minutes)
    else if (context.timeSinceLastInteraction >= this.minAbsenceMinutes) {
      greeting = this.generateReturnGreeting(context);
    }
    // Weekend
    else if (context.isWeekend && context.isFirstSession) {
      greeting = this.generateWeekendGreeting(context);
    }
    // First session with tasks
    else if (context.isFirstSession && context.pendingTasks > 0) {
      greeting = this.generateGreetingWithTasks(context);
    }
    // Regular first session
    else if (context.isFirstSession) {
      greeting = this.generateFirstSessionGreeting(context);
    }
    // Tasks pending
    else if (context.pendingTasks > 0) {
      greeting = this.generateGreetingWithTasks(context);
    }
    // Default time-based greeting
    else {
      greeting = this.generateTimeBasedGreeting(context.timeOfDay);
    }

    // Mark that we've greeted this session
    this.state.hasGreetedThisSession = true;
    this.saveState();

    this.emit('greeting-generated', greeting, context);
    logger.debug('Generated greeting', { greeting, context });

    return greeting;
  }

  /**
   * Generate a return greeting after absence
   */
  private generateReturnGreeting(context: GreetingContext): string {
    // With work context
    if (context.lastWorkContext) {
      const template = this.randomChoice(RETURN_WITH_CONTEXT);
      return template.replace('{context}', context.lastWorkContext);
    }

    // With duration if significant
    if (context.timeSinceLastInteraction >= 60) {
      const template = this.randomChoice(RETURN_WITH_DURATION);
      const duration = this.formatDuration(context.timeSinceLastInteraction);
      return template.replace('{duration}', duration);
    }

    // Simple return greeting
    return this.randomChoice(RETURN_GREETINGS);
  }

  /**
   * Generate weekend-appropriate greeting
   */
  private generateWeekendGreeting(context: GreetingContext): string {
    const template = this.randomChoice(WEEKEND_GREETINGS);
    const timeOfDay = context.timeOfDay;
    const capitalizedTime = timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1);

    return template.replace('{timeOfDay}', timeOfDay).replace('{TimeOfDay}', capitalizedTime);
  }

  /**
   * Generate greeting mentioning pending tasks
   */
  private generateGreetingWithTasks(context: GreetingContext): string {
    // Morning with tasks has special templates
    if (context.timeOfDay === 'morning' && context.isFirstSession) {
      const template = this.randomChoice(MORNING_WITH_TASKS);
      return template.replace('{count}', String(context.pendingTasks));
    }

    // General tasks greeting
    const template = this.randomChoice(WITH_TASKS_GREETINGS);
    const timeOfDay = context.timeOfDay;
    const capitalizedTime = timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1);

    return template
      .replace('{timeOfDay}', timeOfDay)
      .replace('{TimeOfDay}', capitalizedTime)
      .replace('{count}', String(context.pendingTasks));
  }

  /**
   * Generate first session greeting based on time of day
   */
  private generateFirstSessionGreeting(context: GreetingContext): string {
    switch (context.timeOfDay) {
      case 'morning':
        return this.randomChoice(MORNING_FIRST_LOGIN);
      case 'afternoon':
        return this.randomChoice(AFTERNOON_GREETINGS);
      case 'evening':
        return this.randomChoice(EVENING_GREETINGS);
      case 'night':
        return this.randomChoice(LATE_NIGHT_GREETINGS);
    }
  }

  /**
   * Generate simple time-based greeting
   */
  private generateTimeBasedGreeting(
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  ): string {
    switch (timeOfDay) {
      case 'morning':
        return this.randomChoice(MORNING_FIRST_LOGIN);
      case 'afternoon':
        return this.randomChoice(AFTERNOON_GREETINGS);
      case 'evening':
        return this.randomChoice(EVENING_GREETINGS);
      case 'night':
        return this.randomChoice(LATE_NIGHT_GREETINGS);
    }
  }

  // ==========================================================================
  // Interaction Tracking
  // ==========================================================================

  /**
   * Update the last interaction timestamp
   *
   * Call this after each user interaction to track absence duration
   */
  public updateLastInteraction(): void {
    this.state.lastInteractionTime = Date.now();
    this.saveState();
    this.emit('interaction-updated', this.state.lastInteractionTime);
    logger.debug('Updated last interaction time');
  }

  /**
   * Set the last work context for contextual return greetings
   *
   * @param context - Brief description of what user was working on
   */
  public setLastWorkContext(context: string): void {
    this.state.lastWorkContext = context;
    this.saveState();
    logger.debug('Set work context', { context });
  }

  /**
   * Set pending tasks count
   *
   * @param count - Number of pending tasks
   */
  public setPendingTasks(count: number): void {
    this.pendingTaskCount = count;
    logger.debug('Set pending tasks', { count });
  }

  /**
   * Get the last interaction timestamp
   */
  public getLastInteractionTime(): number {
    return this.state.lastInteractionTime;
  }

  /**
   * Get session start timestamp
   */
  public getSessionStartTime(): number {
    return this.state.sessionStartTime;
  }

  /**
   * Check if we've already greeted this session
   */
  public hasGreetedThisSession(): boolean {
    return this.state.hasGreetedThisSession;
  }

  /**
   * Reset session greeting flag (for testing or new day)
   */
  public resetSessionGreeting(): void {
    this.state.hasGreetedThisSession = false;
    this.state.sessionStartTime = Date.now();
    this.saveState();
    logger.debug('Reset session greeting flag');
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get random element from array
   */
  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Get current state (for debugging/testing)
   */
  public getState(): Readonly<GreetingPersistentState> {
    return { ...this.state };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let greetingManagerInstance: GreetingManager | null = null;

/**
 * Get or create the GreetingManager singleton instance.
 *
 * @param statePath - Optional custom path for state file (only used on first call)
 * @returns GreetingManager instance
 */
export function getGreetingManager(statePath?: string): GreetingManager {
  if (!greetingManagerInstance) {
    greetingManagerInstance = new GreetingManager(statePath);
    logger.info('GreetingManager singleton created');
  }
  return greetingManagerInstance;
}

/**
 * Shutdown and cleanup GreetingManager singleton.
 */
export function shutdownGreetingManager(): void {
  if (greetingManagerInstance) {
    // Save state before shutdown
    greetingManagerInstance.updateLastInteraction();
    greetingManagerInstance.removeAllListeners();
    greetingManagerInstance = null;
    logger.info('GreetingManager shutdown complete');
  }
}

/**
 * Reset GreetingManager singleton (for testing).
 */
export function resetGreetingManager(): void {
  greetingManagerInstance = null;
}

export default GreetingManager;
