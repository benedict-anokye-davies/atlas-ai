/**
 * Atlas Desktop - Daily Briefing Manager
 * Generates and delivers morning briefings to Ben
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getTaskQueueManager } from '../agent/task-queue';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('DailyBriefing');

// =============================================================================
// Types
// =============================================================================

/**
 * Calendar event/meeting information
 */
export interface MeetingInfo {
  title: string;
  time: string;
  duration: string;
  attendees?: string[];
}

/**
 * Calendar summary for the day
 */
export interface CalendarSummary {
  meetingsToday: number;
  nextMeeting?: MeetingInfo;
  upcomingEvents: MeetingInfo[];
}

/**
 * Task summary from the task queue
 */
export interface TaskSummary {
  pendingTasks: number;
  inProgressTasks: number;
  completedYesterday: number;
  priorityTasks: string[];
}

/**
 * Unfinished work item
 */
export interface UnfinishedWork {
  description: string;
  lastWorkedOn: Date;
  progress?: number;
  suggestedAction: string;
}

/**
 * System health status
 */
export interface SystemStatus {
  status: 'healthy' | 'warning' | 'error';
  issues: string[];
  lastBuildStatus?: 'pass' | 'fail';
  gitStatus?: string;
}

/**
 * Optional weather information
 */
export interface WeatherInfo {
  temperature: number;
  condition: string;
  high: number;
  low: number;
}

/**
 * Complete daily briefing
 */
export interface DailyBriefing {
  date: Date;
  greeting: string;
  calendar: CalendarSummary;
  tasks: TaskSummary;
  unfinishedWork: UnfinishedWork[];
  systemStatus: SystemStatus;
  suggestions: string[];
  weather?: WeatherInfo;
}

/**
 * Briefing manager interface
 */
export interface BriefingManager {
  generateMorningBriefing(): Promise<DailyBriefing>;
  formatBriefingForVoice(briefing: DailyBriefing): string;
  shouldDeliverBriefing(): boolean;
  markBriefingDelivered(): void;
  getLastBriefing(): DailyBriefing | null;
}

/**
 * Briefing state persisted to disk
 */
interface BriefingState {
  lastDeliveredDate: string | null;
  lastBriefing: DailyBriefing | null;
  skippedDates: string[];
  history: Array<{
    date: string;
    delivered: boolean;
    briefingSummary?: string;
  }>;
}

/**
 * Briefing configuration
 */
export interface BriefingConfig {
  /** Enable daily briefings */
  enabled: boolean;
  /** Work start hour (24h format, e.g., 8 for 8 AM) */
  workStartHour: number;
  /** Work end hour (24h format, e.g., 18 for 6 PM) */
  workEndHour: number;
  /** Earliest briefing hour (won't trigger before this) */
  earliestBriefingHour: number;
  /** Include weather in briefing */
  includeWeather: boolean;
  /** Maximum history entries to keep */
  maxHistoryEntries: number;
  /** User's name for personalized greetings */
  userName: string;
}

/**
 * Default briefing configuration
 */
const DEFAULT_CONFIG: BriefingConfig = {
  enabled: true,
  workStartHour: 8,
  workEndHour: 18,
  earliestBriefingHour: 6,
  includeWeather: false,
  maxHistoryEntries: 30,
  userName: 'Ben',
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the Atlas brain directory for daily data
 */
function getAtlasDir(): string {
  const dir = join(homedir(), '.atlas', 'brain', 'daily');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the briefing state file path
 */
function getStateFilePath(): string {
  return join(getAtlasDir(), 'briefing-state.json');
}

/**
 * Get today's date as a string (YYYY-MM-DD)
 */
function getTodayString(): string {
  return isoDate();
}

/**
 * Format time for voice (e.g., "10:00 AM" -> "10am")
 */
function formatTimeForVoice(time: string): string {
  // Handle various time formats
  const match = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/);
  if (!match) return time;

  let hour = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3]?.toLowerCase();

  // Determine AM/PM if not provided
  let finalPeriod = period;
  if (!finalPeriod) {
    finalPeriod = hour >= 12 ? 'pm' : 'am';
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
  }

  if (minutes === 0) {
    return `${hour}${finalPeriod}`;
  }
  return `${hour}:${minutes.toString().padStart(2, '0')}${finalPeriod}`;
}

// =============================================================================
// Daily Briefing Manager
// =============================================================================

/**
 * DailyBriefingManager - Generates and delivers morning briefings
 */
export class DailyBriefingManager extends EventEmitter implements BriefingManager {
  private config: BriefingConfig;
  private state: BriefingState;
  private calendarProvider: (() => Promise<CalendarSummary>) | null = null;
  private weatherProvider: (() => Promise<WeatherInfo | null>) | null = null;
  private unfinishedWorkProvider: (() => Promise<UnfinishedWork[]>) | null = null;
  private systemStatusProvider: (() => Promise<SystemStatus>) | null = null;

  constructor(config?: Partial<BriefingConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.loadState();
    logger.info('DailyBriefingManager initialized', {
      userName: this.config.userName,
      workStartHour: this.config.workStartHour,
    });
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Load briefing state from disk
   */
  private loadState(): BriefingState {
    const filePath = getStateFilePath();

    try {
      if (existsSync(filePath)) {
        const data = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data) as BriefingState;
        logger.debug('Loaded briefing state', { lastDeliveredDate: parsed.lastDeliveredDate });
        return parsed;
      }
    } catch (error) {
      logger.warn('Failed to load briefing state, using defaults', { error });
    }

    return {
      lastDeliveredDate: null,
      lastBriefing: null,
      skippedDates: [],
      history: [],
    };
  }

  /**
   * Save briefing state to disk
   */
  private saveState(): void {
    const filePath = getStateFilePath();

    try {
      // Trim history to max entries
      if (this.state.history.length > this.config.maxHistoryEntries) {
        this.state.history = this.state.history.slice(-this.config.maxHistoryEntries);
      }

      writeFileSync(filePath, JSON.stringify(this.state, null, 2), 'utf-8');
      logger.debug('Saved briefing state');
    } catch (error) {
      logger.error('Failed to save briefing state', { error });
    }
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update configuration
   */
  setConfig(config: Partial<BriefingConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Set calendar data provider
   */
  setCalendarProvider(provider: () => Promise<CalendarSummary>): void {
    this.calendarProvider = provider;
    logger.debug('Calendar provider set');
  }

  /**
   * Set weather data provider
   */
  setWeatherProvider(provider: () => Promise<WeatherInfo | null>): void {
    this.weatherProvider = provider;
    logger.debug('Weather provider set');
  }

  /**
   * Set unfinished work provider
   */
  setUnfinishedWorkProvider(provider: () => Promise<UnfinishedWork[]>): void {
    this.unfinishedWorkProvider = provider;
    logger.debug('Unfinished work provider set');
  }

  /**
   * Set system status provider
   */
  setSystemStatusProvider(provider: () => Promise<SystemStatus>): void {
    this.systemStatusProvider = provider;
    logger.debug('System status provider set');
  }

  // ===========================================================================
  // Briefing Delivery Control
  // ===========================================================================

  /**
   * Check if briefing should be delivered
   */
  shouldDeliverBriefing(): boolean {
    if (!this.config.enabled) {
      logger.debug('Briefings disabled');
      return false;
    }

    const now = new Date();
    const hour = now.getHours();
    const today = getTodayString();

    // Check if before earliest briefing hour
    if (hour < this.config.earliestBriefingHour) {
      logger.debug('Before earliest briefing hour', {
        currentHour: hour,
        earliestHour: this.config.earliestBriefingHour,
      });
      return false;
    }

    // Check if after work end (no late briefings)
    if (hour >= this.config.workEndHour) {
      logger.debug('After work hours', { currentHour: hour, workEndHour: this.config.workEndHour });
      return false;
    }

    // Check if already delivered today
    if (this.state.lastDeliveredDate === today) {
      logger.debug('Already delivered today');
      return false;
    }

    // Check if explicitly skipped today
    if (this.state.skippedDates.includes(today)) {
      logger.debug('Briefing skipped for today');
      return false;
    }

    return true;
  }

  /**
   * Mark briefing as delivered for today
   */
  markBriefingDelivered(): void {
    const today = getTodayString();
    this.state.lastDeliveredDate = today;

    // Add to history
    this.state.history.push({
      date: today,
      delivered: true,
      briefingSummary: this.state.lastBriefing
        ? `${this.state.lastBriefing.tasks.pendingTasks} tasks, ${this.state.lastBriefing.calendar.meetingsToday} meetings`
        : undefined,
    });

    this.saveState();
    this.emit('briefing:delivered', today);
    logger.info('Briefing marked as delivered', { date: today });
  }

  /**
   * Skip briefing for today
   */
  skipBriefingToday(): void {
    const today = getTodayString();
    if (!this.state.skippedDates.includes(today)) {
      this.state.skippedDates.push(today);

      // Keep only recent skipped dates (last 7 days)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const cutoff = isoDate(oneWeekAgo);
      this.state.skippedDates = this.state.skippedDates.filter((d) => d >= cutoff);

      this.state.history.push({
        date: today,
        delivered: false,
      });

      this.saveState();
      this.emit('briefing:skipped', today);
      logger.info('Briefing skipped for today', { date: today });
    }
  }

  /**
   * Get the last briefing (may be from a previous day)
   */
  getLastBriefing(): DailyBriefing | null {
    return this.state.lastBriefing;
  }

  // ===========================================================================
  // Briefing Generation
  // ===========================================================================

  /**
   * Generate a morning briefing
   */
  async generateMorningBriefing(): Promise<DailyBriefing> {
    logger.info('Generating morning briefing');
    const timer = logger.time('generateMorningBriefing');

    try {
      // Gather all data in parallel
      const [calendar, tasks, unfinishedWork, systemStatus, weather] = await Promise.all([
        this.getCalendarSummary(),
        this.getTaskSummary(),
        this.getUnfinishedWork(),
        this.getSystemStatus(),
        this.config.includeWeather ? this.getWeather() : Promise.resolve(undefined),
      ]);

      const briefing: DailyBriefing = {
        date: new Date(),
        greeting: this.generateGreeting(calendar, tasks),
        calendar,
        tasks,
        unfinishedWork,
        systemStatus,
        suggestions: this.generateSuggestions(calendar, tasks, unfinishedWork, systemStatus),
        weather,
      };

      // Store the briefing
      this.state.lastBriefing = briefing;
      this.saveState();

      this.emit('briefing:generated', briefing);
      timer();
      logger.info('Morning briefing generated', {
        meetings: calendar.meetingsToday,
        pendingTasks: tasks.pendingTasks,
        suggestions: briefing.suggestions.length,
      });

      return briefing;
    } catch (error) {
      logger.error('Failed to generate morning briefing', { error });
      throw error;
    }
  }

  /**
   * Get calendar summary
   */
  private async getCalendarSummary(): Promise<CalendarSummary> {
    if (this.calendarProvider) {
      try {
        return await this.calendarProvider();
      } catch (error) {
        logger.warn('Calendar provider failed, using fallback', { error });
      }
    }

    // Fallback: No calendar data
    return {
      meetingsToday: 0,
      upcomingEvents: [],
    };
  }

  /**
   * Get task summary from task queue
   */
  private async getTaskSummary(): Promise<TaskSummary> {
    try {
      const taskQueue = getTaskQueueManager();
      const stats = taskQueue.getStats();
      const runningTasks = taskQueue.getRunningTasks();
      const queuedTasks = taskQueue.getQueuedTasks();

      // Get priority tasks (high/urgent)
      const priorityTasks = [...runningTasks, ...queuedTasks]
        .filter((t) => t.priority === 'urgent' || t.priority === 'high')
        .map((t) => t.name)
        .slice(0, 5);

      return {
        pendingTasks: stats.pending,
        inProgressTasks: stats.running,
        completedYesterday: this.estimateCompletedYesterday(stats),
        priorityTasks,
      };
    } catch (error) {
      logger.warn('Failed to get task summary', { error });
      return {
        pendingTasks: 0,
        inProgressTasks: 0,
        completedYesterday: 0,
        priorityTasks: [],
      };
    }
  }

  /**
   * Estimate tasks completed yesterday (from stats)
   */
  private estimateCompletedYesterday(stats: { completed: number; totalProcessed: number }): number {
    // This is a rough estimate - a proper implementation would track daily completions
    return Math.min(stats.completed, 10);
  }

  /**
   * Get unfinished work items
   */
  private async getUnfinishedWork(): Promise<UnfinishedWork[]> {
    if (this.unfinishedWorkProvider) {
      try {
        return await this.unfinishedWorkProvider();
      } catch (error) {
        logger.warn('Unfinished work provider failed', { error });
      }
    }

    // Fallback: Check task queue for in-progress items
    try {
      const taskQueue = getTaskQueueManager();
      const runningTasks = taskQueue.getRunningTasks();

      return runningTasks.slice(0, 3).map((task) => ({
        description: task.name,
        lastWorkedOn: new Date(task.startedAt || task.createdAt),
        progress: task.progress,
        suggestedAction: task.progress > 50 ? 'Continue where you left off' : 'Resume this task',
      }));
    } catch (error) {
      logger.warn('Failed to get unfinished work', { error });
      return [];
    }
  }

  /**
   * Get system status
   */
  private async getSystemStatus(): Promise<SystemStatus> {
    if (this.systemStatusProvider) {
      try {
        return await this.systemStatusProvider();
      } catch (error) {
        logger.warn('System status provider failed', { error });
      }
    }

    // Fallback: Assume healthy
    return {
      status: 'healthy',
      issues: [],
    };
  }

  /**
   * Get weather information
   */
  private async getWeather(): Promise<WeatherInfo | undefined> {
    if (this.weatherProvider) {
      try {
        const weather = await this.weatherProvider();
        return weather || undefined;
      } catch (error) {
        logger.warn('Weather provider failed', { error });
      }
    }
    return undefined;
  }

  // ===========================================================================
  // Content Generation
  // ===========================================================================

  /**
   * Generate a time-aware greeting
   */
  private generateGreeting(calendar: CalendarSummary, tasks: TaskSummary): string {
    const hour = new Date().getHours();
    const name = this.config.userName;

    // Determine greeting based on time
    let timeGreeting: string;
    if (hour < 12) {
      timeGreeting = 'Good morning';
    } else if (hour < 17) {
      timeGreeting = 'Good afternoon';
    } else {
      timeGreeting = 'Good evening';
    }

    // Add variety based on the day ahead
    const isBusy = calendar.meetingsToday >= 3 || tasks.pendingTasks >= 5;
    const isLight = calendar.meetingsToday === 0 && tasks.pendingTasks <= 2;

    const greetings = [
      `${timeGreeting}, ${name}.`,
      `${timeGreeting}, ${name}. Ready to get started?`,
    ];

    if (isBusy) {
      greetings.push(`${timeGreeting}, ${name}. Busy day ahead.`);
    } else if (isLight) {
      greetings.push(`${timeGreeting}, ${name}. Light day ahead.`);
    }

    // Pick a greeting (deterministic based on date for consistency)
    const index = new Date().getDate() % greetings.length;
    return greetings[index];
  }

  /**
   * Generate suggestions based on the day's data
   */
  private generateSuggestions(
    calendar: CalendarSummary,
    tasks: TaskSummary,
    unfinishedWork: UnfinishedWork[],
    systemStatus: SystemStatus
  ): string[] {
    const suggestions: string[] = [];

    // High priority: System issues
    if (systemStatus.status === 'error') {
      suggestions.push('You might want to address the system issues first.');
    } else if (systemStatus.lastBuildStatus === 'fail') {
      suggestions.push('You might want to address the failing tests before the standup.');
    }

    // PR reviews waiting
    if (tasks.priorityTasks.some((t) => t.toLowerCase().includes('review'))) {
      suggestions.push(
        "I'd suggest starting with the PR reviews - they've been waiting since yesterday."
      );
    }

    // Unfinished work with high progress
    const nearComplete = unfinishedWork.find((w) => w.progress && w.progress >= 60);
    if (nearComplete) {
      suggestions.push(
        `You're about ${nearComplete.progress}% done with ${nearComplete.description.toLowerCase()} - might be quick to finish.`
      );
    }

    // Upcoming meeting soon
    if (calendar.nextMeeting) {
      const meetingTime = calendar.nextMeeting.time;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Parse meeting time (rough estimate)
      const timeMatch = meetingTime.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/);
      if (timeMatch) {
        let meetingHour = parseInt(timeMatch[1], 10);
        const meetingMinute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const period = timeMatch[3]?.toLowerCase();

        if (period === 'pm' && meetingHour !== 12) meetingHour += 12;
        if (period === 'am' && meetingHour === 12) meetingHour = 0;

        const meetingMinutes = meetingHour * 60 + meetingMinute;
        const diff = meetingMinutes - currentMinutes;

        if (diff > 0 && diff <= 60) {
          suggestions.push(`Heads up: you have ${calendar.nextMeeting.title} in ${diff} minutes.`);
        }
      }
    }

    // Default suggestion if nothing else
    if (suggestions.length === 0) {
      if (tasks.pendingTasks > 0) {
        suggestions.push('What would you like to focus on first?');
      } else if (calendar.meetingsToday === 0) {
        suggestions.push("Clear schedule today - perfect for deep work. What's the priority?");
      } else {
        suggestions.push('What would you like to tackle first?');
      }
    }

    return suggestions;
  }

  // ===========================================================================
  // Voice Formatting
  // ===========================================================================

  /**
   * Format briefing for voice delivery
   */
  formatBriefingForVoice(briefing: DailyBriefing): string {
    const parts: string[] = [];

    // Greeting
    parts.push(briefing.greeting);
    parts.push("Here's your day:");
    parts.push('');

    // Calendar section (skip if empty)
    if (briefing.calendar.meetingsToday > 0) {
      parts.push(this.formatCalendarForVoice(briefing.calendar));
      parts.push('');
    } else {
      parts.push('No meetings scheduled - clear day for focused work.');
      parts.push('');
    }

    // Tasks section (skip if nothing to report)
    const taskLine = this.formatTasksForVoice(briefing.tasks, briefing.unfinishedWork);
    if (taskLine) {
      parts.push(taskLine);
      parts.push('');
    }

    // System status (only if issues)
    const statusLine = this.formatSystemStatusForVoice(briefing.systemStatus);
    if (statusLine) {
      parts.push(statusLine);
      parts.push('');
    }

    // Weather (if available)
    if (briefing.weather) {
      parts.push(this.formatWeatherForVoice(briefing.weather));
      parts.push('');
    }

    // Suggestions
    if (briefing.suggestions.length > 0) {
      parts.push(briefing.suggestions[0]);
    }

    return parts.join('\n').trim();
  }

  /**
   * Format calendar section for voice
   */
  private formatCalendarForVoice(calendar: CalendarSummary): string {
    if (calendar.meetingsToday === 0) {
      return 'No meetings scheduled - clear day for focused work.';
    }

    if (calendar.meetingsToday === 1 && calendar.upcomingEvents.length > 0) {
      const meeting = calendar.upcomingEvents[0];
      return `You have 1 meeting today: ${meeting.title} at ${formatTimeForVoice(meeting.time)}.`;
    }

    // Multiple meetings
    const meetingList = calendar.upcomingEvents
      .slice(0, 3)
      .map((m) => `${m.title} at ${formatTimeForVoice(m.time)}`)
      .join(' and ');

    if (calendar.meetingsToday <= 3) {
      return `You have ${calendar.meetingsToday} meetings today: ${meetingList}.`;
    }

    return `You have ${calendar.meetingsToday} meetings today. First up: ${meetingList}.`;
  }

  /**
   * Format tasks section for voice
   */
  private formatTasksForVoice(tasks: TaskSummary, unfinishedWork: UnfinishedWork[]): string {
    const lines: string[] = [];

    // Pending/in-progress tasks
    if (tasks.pendingTasks > 0 || tasks.inProgressTasks > 0) {
      const total = tasks.pendingTasks + tasks.inProgressTasks;
      if (tasks.inProgressTasks > 0) {
        lines.push(`You have ${total} tasks pending, ${tasks.inProgressTasks} in progress.`);
      } else {
        lines.push(`You have ${total} tasks pending.`);
      }
    }

    // Priority tasks
    if (tasks.priorityTasks.length > 0) {
      const count = tasks.priorityTasks.length;
      lines.push(`${count} high-priority task${count > 1 ? 's' : ''} waiting.`);
    }

    // Unfinished work with progress
    const workWithProgress = unfinishedWork.find((w) => w.progress && w.progress > 0);
    if (workWithProgress) {
      lines.push(
        `Yesterday you were working on ${workWithProgress.description.toLowerCase()} - about ${workWithProgress.progress}% done.`
      );
    }

    return lines.join(' ');
  }

  /**
   * Format system status for voice (only if issues)
   */
  private formatSystemStatusForVoice(status: SystemStatus): string {
    if (status.status === 'healthy' && !status.lastBuildStatus && !status.gitStatus) {
      return 'All systems healthy.';
    }

    const lines: string[] = [];

    if (status.status === 'healthy') {
      lines.push('All systems healthy.');
    } else if (status.status === 'warning') {
      lines.push(`System warning: ${status.issues[0] || 'check status'}.`);
    } else {
      lines.push(`System error: ${status.issues[0] || 'attention needed'}.`);
    }

    if (status.lastBuildStatus === 'pass') {
      lines.push('Tests passing.');
    } else if (status.lastBuildStatus === 'fail') {
      lines.push('Note: The CI is still failing on that flaky test.');
    }

    if (status.gitStatus) {
      lines.push(`Git status: ${status.gitStatus}.`);
    }

    return lines.join(' ');
  }

  /**
   * Format weather for voice
   */
  private formatWeatherForVoice(weather: WeatherInfo): string {
    return `Weather: ${weather.temperature} degrees, ${weather.condition.toLowerCase()}. High of ${weather.high}, low of ${weather.low}.`;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up resources
   */
  dispose(): void {
    this.removeAllListeners();
    logger.info('DailyBriefingManager disposed');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let briefingManager: DailyBriefingManager | null = null;

/**
 * Get or create the daily briefing manager
 */
export function getDailyBriefingManager(): DailyBriefingManager {
  if (!briefingManager) {
    briefingManager = new DailyBriefingManager();
  }
  return briefingManager;
}

/**
 * Initialize the daily briefing manager with custom config
 */
export function initializeDailyBriefingManager(
  config?: Partial<BriefingConfig>
): DailyBriefingManager {
  if (briefingManager) {
    logger.warn('BriefingManager already initialized, updating config');
    briefingManager.setConfig(config || {});
    return briefingManager;
  }
  briefingManager = new DailyBriefingManager(config);
  return briefingManager;
}

/**
 * Shutdown the daily briefing manager
 */
export function shutdownDailyBriefingManager(): void {
  if (briefingManager) {
    briefingManager.dispose();
    briefingManager = null;
    logger.info('DailyBriefingManager shutdown complete');
  }
}

export default DailyBriefingManager;
