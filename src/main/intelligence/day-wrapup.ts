/**
 * Atlas Desktop - Day Wrapup Manager
 *
 * Generates end-of-day summaries for Ben, wrapping up the work day
 * with accomplishments, in-progress work, and tomorrow preview.
 *
 * Features:
 * - Auto-tracking of daily accomplishments
 * - Goodbye detection for wrapup trigger
 * - Concise bullet-point format for voice delivery
 * - Tomorrow context and system health status
 *
 * @module intelligence/day-wrapup
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createModuleLogger } from '../utils/logger';
import {
  getSignoffManager,
  SignoffManager,
  TimeOfDay,
  SystemStatus,
} from '../agent/signoff-manager';
import { getTaskScheduler, TaskScheduler, ScheduledTask } from './task-scheduler';
import { clamp100, isoDate } from '../../shared/utils';

const logger = createModuleLogger('DayWrapup');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Category of accomplishment
 */
export type AccomplishmentCategory = 'task' | 'code' | 'review' | 'fix' | 'meeting' | 'other';

/**
 * Impact level of accomplishment
 */
export type ImpactLevel = 'minor' | 'moderate' | 'significant';

/**
 * A single accomplishment tracked during the day
 */
export interface Accomplishment {
  /** Description of what was accomplished */
  description: string;
  /** Category of the accomplishment */
  category: AccomplishmentCategory;
  /** When this was accomplished */
  timestamp: Date;
  /** Impact level of the accomplishment */
  impact?: ImpactLevel;
}

/**
 * Work that is still in progress
 */
export interface InProgressWork {
  /** Description of the work */
  description: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether this will continue tomorrow */
  willContinue: boolean;
  /** Any blockers preventing progress */
  blockers?: string[];
}

/**
 * Daily statistics
 */
export interface DailyStats {
  /** Number of tasks completed */
  tasksCompleted: number;
  /** Number of code changes made */
  codeChanges: number;
  /** Number of PRs reviewed */
  prsReviewed: number;
  /** Number of meetings attended */
  meetingsAttended: number;
  /** Hours actively working */
  hoursActive: number;
}

/**
 * Complete day wrapup summary
 */
export interface DayWrapup {
  /** Date of the wrapup */
  date: Date;
  /** Context-aware greeting */
  greeting: string;
  /** List of accomplishments for the day */
  accomplishments: Accomplishment[];
  /** Work still in progress */
  inProgress: InProgressWork[];
  /** Preview of tomorrow's tasks */
  tomorrowPreview: string[];
  /** Current system status */
  systemStatus: string;
  /** Hours worked (if tracked) */
  hoursWorked?: number;
  /** JARVIS-style sign-off */
  signoff: string;
}

/**
 * Persisted daily stats structure
 */
interface PersistedDailyStats {
  date: string;
  accomplishments: Array<{
    description: string;
    category: AccomplishmentCategory;
    timestamp: string;
    impact?: ImpactLevel;
  }>;
  inProgress: InProgressWork[];
  stats: DailyStats;
  sessionStartTime?: string;
  lastActivityTime?: string;
}

/**
 * Configuration for the wrapup manager
 */
export interface WrapupConfig {
  /** Enable automatic wrapup offers */
  enabled: boolean;
  /** After-work hour to offer wrapup (24h format) */
  afterWorkHour: number;
  /** Minutes of inactivity before offering wrapup */
  inactivityMinutes: number;
  /** Path to store daily stats */
  statsFilePath: string;
}

// ============================================================================
// Greeting & Sign-off Templates
// ============================================================================

/** Context-aware greetings for productive days */
const PRODUCTIVE_GREETINGS = [
  'Nice work today, Ben.',
  "That's a wrap for today.",
  'Solid day of work, Ben.',
  'Good progress today.',
];

/** Greetings for lighter days */
const LIGHT_DAY_GREETINGS = [
  'Ready to call it a day?',
  'Wrapping up for today.',
  "Here's your day summary.",
  'Quick recap before you go.',
];

/** JARVIS-style sign-offs */
const SIGNOFFS = [
  'Get some rest, Ben!',
  "I'll hold down the fort.",
  'Systems stable. See you tomorrow.',
  'All done. Have a good evening.',
  "Rest up. I'll be here when you're back.",
  'Take care, Ben.',
  'Until tomorrow.',
];

/** Late night sign-offs */
const LATE_NIGHT_SIGNOFFS = [
  "Get some rest, Ben. I'll keep watch.",
  "It's late - get some sleep!",
  "I've got things covered. Good night.",
  'Systems stable. Sleep well.',
];

// ============================================================================
// System Status Templates
// ============================================================================

/** Positive system status messages */
const POSITIVE_STATUS = [
  'The codebase is in good shape - all tests passing.',
  'Systems stable. No issues detected.',
  'All systems nominal.',
  'Everything looks good on my end.',
];

/** Warning system status messages */
const WARNING_STATUS = [
  'Note: Still have that failing CI test to address.',
  "Heads up: There's a build warning to look at.",
  'One thing to note: Some tests are flaky.',
];

// ============================================================================
// WrapupManager Class
// ============================================================================

/**
 * Events emitted by WrapupManager
 */
export interface WrapupManagerEvents {
  /** Wrapup was generated */
  'wrapup-generated': (wrapup: DayWrapup) => void;
  /** Accomplishment was tracked */
  'accomplishment-tracked': (accomplishment: Accomplishment) => void;
  /** In-progress work was tracked */
  'in-progress-tracked': (work: InProgressWork) => void;
  /** Daily stats were reset */
  'daily-reset': () => void;
  /** Wrapup should be offered to user */
  'offer-wrapup': () => void;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: WrapupConfig = {
  enabled: true,
  afterWorkHour: 18, // 6 PM
  inactivityMinutes: 30,
  statsFilePath: join(homedir(), '.atlas', 'brain', 'daily', 'daily-stats.json'),
};

/**
 * Manages end-of-day summaries and daily tracking for Atlas.
 *
 * Responsibilities:
 * - Track accomplishments throughout the day
 * - Generate contextual day wrapup summaries
 * - Format summaries for voice delivery
 * - Determine when to offer wrapup
 * - Persist daily stats
 *
 * @example
 * ```typescript
 * const manager = getWrapupManager();
 *
 * // Track accomplishments during the day
 * manager.trackAccomplishment('Completed auth module login flow', 'code');
 * manager.trackAccomplishment('Fixed session handler bugs', 'fix');
 *
 * // At end of day, generate wrapup
 * const wrapup = await manager.generateDayWrapup();
 * const voiceText = manager.formatWrapupForVoice(wrapup);
 * ```
 */
export class WrapupManager extends EventEmitter {
  private config: WrapupConfig;
  private signoffManager: SignoffManager;
  private taskScheduler: TaskScheduler;

  /** Today's accomplishments */
  private accomplishments: Accomplishment[] = [];

  /** Current in-progress work */
  private inProgressWork: InProgressWork[] = [];

  /** Daily stats */
  private stats: DailyStats = this.createEmptyStats();

  /** Session tracking */
  private sessionStartTime: Date = new Date();
  private lastActivityTime: Date = new Date();

  /** Current tracking date */
  private currentDate: string = this.getDateString(new Date());

  /** Inactivity check timer */
  private inactivityTimer: NodeJS.Timeout | null = null;

  /** Midnight reset timer */
  private midnightTimer: NodeJS.Timeout | null = null;

  /** System status (can be updated externally) */
  private systemHealthStatus: SystemStatus = 'stable';
  private systemWarning?: string;

  constructor(config?: Partial<WrapupConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.signoffManager = getSignoffManager();
    this.taskScheduler = getTaskScheduler();

    // Ensure stats directory exists
    this.ensureStatsDirectory();

    // Load persisted stats if they exist
    this.loadPersistedStats();

    // Setup event listeners
    this.setupEventListeners();

    // Schedule midnight reset
    this.scheduleMidnightReset();

    // Start inactivity monitoring
    if (this.config.enabled) {
      this.startInactivityMonitor();
    }

    logger.info('WrapupManager initialized', {
      statsPath: this.config.statsFilePath,
      afterWorkHour: this.config.afterWorkHour,
    });
  }

  // ==========================================================================
  // Public API - WrapupManager Interface Implementation
  // ==========================================================================

  /**
   * Generate a complete day wrapup summary.
   *
   * @returns Day wrapup with greeting, accomplishments, status, and sign-off
   */
  async generateDayWrapup(): Promise<DayWrapup> {
    this.checkAndResetIfNewDay();

    const timeOfDay = this.signoffManager.getCurrentTimeOfDay();
    const hoursWorked = this.calculateHoursWorked();

    // Get tomorrow's preview from task scheduler
    const tomorrowPreview = this.getTomorrowPreview();

    // Build the wrapup
    const wrapup: DayWrapup = {
      date: new Date(),
      greeting: this.selectGreeting(),
      accomplishments: [...this.accomplishments],
      inProgress: [...this.inProgressWork],
      tomorrowPreview,
      systemStatus: this.getSystemStatusMessage(),
      hoursWorked,
      signoff: this.selectSignoff(timeOfDay),
    };

    // Persist stats
    this.persistStats();

    this.emit('wrapup-generated', wrapup);
    logger.info('Day wrapup generated', {
      accomplishments: this.accomplishments.length,
      inProgress: this.inProgressWork.length,
      hoursWorked,
    });

    return wrapup;
  }

  /**
   * Format a wrapup for voice delivery.
   *
   * Creates a natural, conversational summary suitable for TTS.
   *
   * @param wrapup - The day wrapup to format
   * @returns Voice-friendly text
   */
  formatWrapupForVoice(wrapup: DayWrapup): string {
    const parts: string[] = [];

    // Greeting
    parts.push(wrapup.greeting);

    // Accomplishments
    if (wrapup.accomplishments.length > 0) {
      if (wrapup.accomplishments.length === 1) {
        parts.push(`Completed: ${wrapup.accomplishments[0].description}.`);
      } else if (wrapup.accomplishments.length <= 3) {
        const items = wrapup.accomplishments.map((a) => a.description).join(', ');
        parts.push(`Completed: ${items}.`);
      } else {
        // Summarize for voice
        const taskCount = wrapup.accomplishments.filter((a) => a.category === 'task').length;
        const codeCount = wrapup.accomplishments.filter((a) => a.category === 'code').length;
        const fixCount = wrapup.accomplishments.filter((a) => a.category === 'fix').length;
        const reviewCount = wrapup.accomplishments.filter((a) => a.category === 'review').length;

        const summaryParts: string[] = [];
        if (taskCount > 0) summaryParts.push(`${taskCount} task${taskCount > 1 ? 's' : ''}`);
        if (codeCount > 0) summaryParts.push(`${codeCount} code change${codeCount > 1 ? 's' : ''}`);
        if (fixCount > 0) summaryParts.push(`${fixCount} bug fix${fixCount > 1 ? 'es' : ''}`);
        if (reviewCount > 0) summaryParts.push(`${reviewCount} PR${reviewCount > 1 ? 's' : ''}`);

        if (summaryParts.length > 0) {
          parts.push(`Completed: ${summaryParts.join(', ')}.`);
        } else {
          parts.push(`Productive day - ${wrapup.accomplishments.length} items completed.`);
        }
      }
    }

    // In progress
    if (wrapup.inProgress.length > 0) {
      const inProgressItems = wrapup.inProgress
        .filter((w) => w.willContinue)
        .map((w) => `${w.description} - about ${w.progress}% done`);

      if (inProgressItems.length === 1) {
        parts.push(`Still in progress: ${inProgressItems[0]}.`);
      } else if (inProgressItems.length > 1) {
        parts.push(`In progress: ${inProgressItems.join('; ')}.`);
      }
    }

    // Tomorrow preview
    if (wrapup.tomorrowPreview.length > 0) {
      if (wrapup.tomorrowPreview.length === 1) {
        parts.push(`Tomorrow: ${wrapup.tomorrowPreview[0]}.`);
      } else {
        parts.push(`Tomorrow: ${wrapup.tomorrowPreview.slice(0, 2).join('. ')}.`);
      }
    }

    // System status
    parts.push(wrapup.systemStatus);

    // Sign-off
    parts.push(wrapup.signoff);

    return parts.join('\n\n');
  }

  /**
   * Check if wrapup should be offered to the user.
   *
   * Returns true if:
   * - After work hours AND inactive for configured time
   * - OR user has significant accomplishments and it's getting late
   *
   * @returns Whether to offer wrapup
   */
  shouldOfferWrapup(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();

    // Check if after work hours
    if (currentHour < this.config.afterWorkHour) {
      return false;
    }

    // Check inactivity
    const inactiveMs = now.getTime() - this.lastActivityTime.getTime();
    const inactiveMinutes = inactiveMs / (1000 * 60);

    if (inactiveMinutes >= this.config.inactivityMinutes) {
      // Have accomplishments to summarize
      if (this.accomplishments.length > 0 || this.inProgressWork.length > 0) {
        return true;
      }
    }

    // Late night with any activity
    if (currentHour >= 21 && this.accomplishments.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Track an accomplishment for the day.
   *
   * @param description - What was accomplished
   * @param category - Category of accomplishment
   * @param impact - Impact level (optional)
   */
  trackAccomplishment(
    description: string,
    category: AccomplishmentCategory,
    impact?: ImpactLevel
  ): void {
    this.checkAndResetIfNewDay();
    this.recordActivity();

    const accomplishment: Accomplishment = {
      description,
      category,
      timestamp: new Date(),
      impact,
    };

    this.accomplishments.push(accomplishment);

    // Update stats
    this.stats.tasksCompleted++;
    if (category === 'code') this.stats.codeChanges++;
    if (category === 'review') this.stats.prsReviewed++;
    if (category === 'meeting') this.stats.meetingsAttended++;

    // Also track in signoff manager for compatibility
    this.signoffManager.trackTaskCompletion(description);

    // Persist immediately
    this.persistStats();

    this.emit('accomplishment-tracked', accomplishment);
    logger.info('Accomplishment tracked', {
      description,
      category,
      impact,
      totalToday: this.accomplishments.length,
    });
  }

  /**
   * Track work that is in progress.
   *
   * @param description - Description of the work
   * @param progress - Progress percentage (0-100)
   * @param willContinue - Whether work will continue tomorrow
   * @param blockers - Optional blockers
   */
  trackInProgress(
    description: string,
    progress: number,
    willContinue: boolean = true,
    blockers?: string[]
  ): void {
    this.checkAndResetIfNewDay();
    this.recordActivity();

    // Update existing or add new
    const existingIndex = this.inProgressWork.findIndex(
      (w) => w.description.toLowerCase() === description.toLowerCase()
    );

    const work: InProgressWork = {
      description,
      progress: clamp100(progress),
      willContinue,
      blockers,
    };

    if (existingIndex >= 0) {
      this.inProgressWork[existingIndex] = work;
    } else {
      this.inProgressWork.push(work);
    }

    // Persist immediately
    this.persistStats();

    this.emit('in-progress-tracked', work);
    logger.debug('In-progress tracked', {
      description,
      progress,
      willContinue,
    });
  }

  /**
   * Mark in-progress work as complete.
   *
   * @param description - Description to match
   * @param accomplishmentCategory - Category for the accomplishment
   */
  completeInProgress(description: string, accomplishmentCategory: AccomplishmentCategory): void {
    const index = this.inProgressWork.findIndex(
      (w) => w.description.toLowerCase() === description.toLowerCase()
    );

    if (index >= 0) {
      const work = this.inProgressWork[index];
      this.inProgressWork.splice(index, 1);

      // Track as accomplishment
      this.trackAccomplishment(work.description, accomplishmentCategory, 'moderate');
    }
  }

  /**
   * Get current daily statistics.
   *
   * @returns Current daily stats
   */
  getDailyStats(): DailyStats {
    this.checkAndResetIfNewDay();
    return {
      ...this.stats,
      hoursActive: this.calculateHoursWorked(),
    };
  }

  /**
   * Update system health status.
   *
   * @param status - Current system status
   * @param warning - Optional warning message
   */
  setSystemStatus(status: SystemStatus, warning?: string): void {
    this.systemHealthStatus = status;
    this.systemWarning = warning;
    logger.debug('System status updated', { status, warning });
  }

  /**
   * Record activity (resets inactivity timer).
   */
  recordActivity(): void {
    this.lastActivityTime = new Date();
  }

  /**
   * Update configuration.
   *
   * @param config - Partial config to update
   */
  setConfig(config: Partial<WrapupConfig>): void {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      this.stopInactivityMonitor();
    } else if (!this.inactivityTimer) {
      this.startInactivityMonitor();
    }

    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Shutdown and cleanup.
   */
  shutdown(): void {
    this.stopInactivityMonitor();

    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }

    // Persist final stats
    this.persistStats();

    this.removeAllListeners();
    logger.info('WrapupManager shutdown complete');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Setup event listeners for signoff manager.
   */
  private setupEventListeners(): void {
    // When goodbye is detected, check if we should offer wrapup
    this.signoffManager.on('goodbye-detected', (_transcript: string, _confidence: number) => {
      if (this.accomplishments.length > 0 || this.inProgressWork.length > 0) {
        this.emit('offer-wrapup');
      }
    });

    // Track task completions from signoff manager
    this.signoffManager.on('task-completed', (_taskName: string, _total: number) => {
      this.recordActivity();
    });
  }

  /**
   * Select appropriate greeting based on day's productivity.
   */
  private selectGreeting(): string {
    const isProductive = this.accomplishments.length >= 3;
    const templates = isProductive ? PRODUCTIVE_GREETINGS : LIGHT_DAY_GREETINGS;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Select appropriate sign-off based on time of day.
   */
  private selectSignoff(timeOfDay: TimeOfDay): string {
    const hour = new Date().getHours();

    // Use late night sign-offs after 10pm
    if (timeOfDay === 'night' && (hour >= 22 || hour < 5)) {
      return LATE_NIGHT_SIGNOFFS[Math.floor(Math.random() * LATE_NIGHT_SIGNOFFS.length)];
    }

    return SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)];
  }

  /**
   * Get system status message.
   */
  private getSystemStatusMessage(): string {
    if (this.systemHealthStatus === 'error' && this.systemWarning) {
      return `Warning: ${this.systemWarning}`;
    }

    if (this.systemHealthStatus === 'warning') {
      // Use custom warning or pick from templates
      if (this.systemWarning) {
        return this.systemWarning;
      }
      return WARNING_STATUS[Math.floor(Math.random() * WARNING_STATUS.length)];
    }

    // Return positive status
    return POSITIVE_STATUS[Math.floor(Math.random() * POSITIVE_STATUS.length)];
  }

  /**
   * Get preview of tomorrow's tasks from scheduler.
   */
  private getTomorrowPreview(): string[] {
    const preview: string[] = [];

    try {
      // Get tasks scheduled for tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const tomorrowMs = dayAfter.getTime() - Date.now();
      const upcomingTasks = this.taskScheduler.getUpcomingTasks(tomorrowMs);

      // Filter to tomorrow only
      const tomorrowTasks = upcomingTasks.filter((task: ScheduledTask) => {
        const taskDate = new Date(task.scheduledAt);
        return taskDate >= tomorrow && taskDate < dayAfter;
      });

      // Add task previews
      for (const task of tomorrowTasks.slice(0, 3)) {
        const taskTime = new Date(task.scheduledAt);
        const timeStr = taskTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });
        preview.push(`${task.title} at ${timeStr}`);
      }

      // Add in-progress items that will continue
      const continuing = this.inProgressWork.filter((w) => w.willContinue);
      if (continuing.length > 0) {
        const item = continuing[0];
        preview.push(`You mentioned wanting to continue ${item.description}`);
      }
    } catch (error) {
      logger.warn('Failed to get tomorrow preview', { error });
    }

    return preview;
  }

  /**
   * Calculate hours worked today.
   */
  private calculateHoursWorked(): number {
    const now = new Date();
    const msWorked = now.getTime() - this.sessionStartTime.getTime();
    return Math.round((msWorked / (1000 * 60 * 60)) * 10) / 10; // Round to 1 decimal
  }

  /**
   * Create empty stats object.
   */
  private createEmptyStats(): DailyStats {
    return {
      tasksCompleted: 0,
      codeChanges: 0,
      prsReviewed: 0,
      meetingsAttended: 0,
      hoursActive: 0,
    };
  }

  /**
   * Get date string for comparison (YYYY-MM-DD).
   */
  private getDateString(date: Date): string {
    return isoDate(date);
  }

  /**
   * Check if it's a new day and reset if needed.
   */
  private checkAndResetIfNewDay(): void {
    const today = this.getDateString(new Date());
    if (today !== this.currentDate) {
      logger.info('New day detected, resetting tracking', {
        previousDate: this.currentDate,
        newDate: today,
      });
      this.resetDailyTracking();
    }
  }

  /**
   * Reset all daily tracking.
   */
  private resetDailyTracking(): void {
    this.accomplishments = [];
    this.inProgressWork = this.inProgressWork.filter((w) => w.willContinue);
    this.stats = this.createEmptyStats();
    this.sessionStartTime = new Date();
    this.lastActivityTime = new Date();
    this.currentDate = this.getDateString(new Date());

    this.persistStats();
    this.emit('daily-reset');
    logger.info('Daily tracking reset');
  }

  /**
   * Schedule automatic reset at midnight.
   */
  private scheduleMidnightReset(): void {
    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
    }

    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    this.midnightTimer = setTimeout(() => {
      this.resetDailyTracking();
      this.scheduleMidnightReset();
    }, msUntilMidnight);

    logger.debug('Scheduled midnight reset', {
      msUntilMidnight,
      resetTime: midnight.toISOString(),
    });
  }

  /**
   * Start inactivity monitor.
   */
  private startInactivityMonitor(): void {
    if (this.inactivityTimer) {
      return;
    }

    // Check every minute
    this.inactivityTimer = setInterval(() => {
      if (this.shouldOfferWrapup()) {
        this.emit('offer-wrapup');
      }
    }, 60000);

    logger.debug('Inactivity monitor started');
  }

  /**
   * Stop inactivity monitor.
   */
  private stopInactivityMonitor(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    logger.debug('Inactivity monitor stopped');
  }

  /**
   * Ensure stats directory exists.
   */
  private ensureStatsDirectory(): void {
    const dir = join(homedir(), '.atlas');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load persisted stats from disk.
   */
  private loadPersistedStats(): void {
    try {
      if (!existsSync(this.config.statsFilePath)) {
        return;
      }

      const data = readFileSync(this.config.statsFilePath, 'utf-8');
      const persisted: PersistedDailyStats = JSON.parse(data);

      // Only load if same day
      const today = this.getDateString(new Date());
      if (persisted.date !== today) {
        // Keep in-progress items that should continue
        if (persisted.inProgress) {
          this.inProgressWork = persisted.inProgress.filter((w) => w.willContinue);
        }
        return;
      }

      // Load accomplishments
      this.accomplishments = persisted.accomplishments.map((a) => ({
        ...a,
        timestamp: new Date(a.timestamp),
      }));

      // Load in-progress
      this.inProgressWork = persisted.inProgress || [];

      // Load stats
      this.stats = persisted.stats || this.createEmptyStats();

      // Load session times
      if (persisted.sessionStartTime) {
        this.sessionStartTime = new Date(persisted.sessionStartTime);
      }
      if (persisted.lastActivityTime) {
        this.lastActivityTime = new Date(persisted.lastActivityTime);
      }

      this.currentDate = persisted.date;

      logger.info('Loaded persisted stats', {
        accomplishments: this.accomplishments.length,
        inProgress: this.inProgressWork.length,
      });
    } catch (error) {
      logger.warn('Failed to load persisted stats', { error });
    }
  }

  /**
   * Persist stats to disk.
   */
  private persistStats(): void {
    try {
      const data: PersistedDailyStats = {
        date: this.currentDate,
        accomplishments: this.accomplishments.map((a) => ({
          ...a,
          timestamp: a.timestamp.toISOString(),
        })),
        inProgress: this.inProgressWork,
        stats: this.stats,
        sessionStartTime: this.sessionStartTime.toISOString(),
        lastActivityTime: this.lastActivityTime.toISOString(),
      };

      writeFileSync(this.config.statsFilePath, JSON.stringify(data, null, 2));
      logger.debug('Stats persisted to disk');
    } catch (error) {
      logger.warn('Failed to persist stats', { error });
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let wrapupManagerInstance: WrapupManager | null = null;

/**
 * Get or create the WrapupManager singleton instance.
 *
 * @returns WrapupManager instance
 */
export function getWrapupManager(): WrapupManager {
  if (!wrapupManagerInstance) {
    wrapupManagerInstance = new WrapupManager();
    logger.info('WrapupManager singleton created');
  }
  return wrapupManagerInstance;
}

/**
 * Shutdown and cleanup WrapupManager singleton.
 */
export function shutdownWrapupManager(): void {
  if (wrapupManagerInstance) {
    wrapupManagerInstance.shutdown();
    wrapupManagerInstance = null;
    logger.info('WrapupManager singleton shutdown');
  }
}

/**
 * Reset WrapupManager singleton (for testing).
 */
export function resetWrapupManager(): void {
  if (wrapupManagerInstance) {
    wrapupManagerInstance.shutdown();
  }
  wrapupManagerInstance = null;
}

// Default export for convenience
export default getWrapupManager;
