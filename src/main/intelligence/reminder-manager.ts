/**
 * Atlas Desktop - Reminder Manager
 * Comprehensive reminder system for deadlines, calendar, wellness, and custom reminders
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ReminderManager');

// =============================================================================
// Types & Interfaces
// =============================================================================

/**
 * Reminder types
 */
export type ReminderType =
  | 'deadline'
  | 'calendar'
  | 'wellness'
  | 'custom'
  | 'break'
  | 'hydrate'
  | 'stretch';

/**
 * Reminder priority
 */
export type ReminderPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Recurrence pattern for recurring reminders
 */
export interface RecurrencePattern {
  /** Type of recurrence */
  type: 'interval' | 'daily' | 'weekly';
  /** Interval in milliseconds for 'interval' type */
  intervalMs?: number;
  /** Times of day for 'daily' type, e.g., ['09:00', '14:00'] */
  times?: string[];
  /** Days of week for 'weekly' type, 0-6 (Sunday-Saturday) */
  days?: number[];
}

/**
 * Reminder interface
 */
export interface Reminder {
  id: string;
  type: ReminderType;
  message: string;
  scheduledTime: Date;
  delivered: boolean;
  recurring?: RecurrencePattern;
  priority: ReminderPriority;
  source?: string;
  /** Snooze until this time */
  snoozedUntil?: Date;
  /** Creation timestamp */
  createdAt: Date;
  /** Metadata for additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Calendar event interface
 */
export interface CalendarEvent {
  title: string;
  startTime: Date;
  endTime?: Date;
  location?: string;
}

/**
 * Serializable reminder for storage
 */
interface StoredReminder {
  id: string;
  type: ReminderType;
  message: string;
  scheduledTime: string;
  delivered: boolean;
  recurring?: RecurrencePattern;
  priority: ReminderPriority;
  source?: string;
  snoozedUntil?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Wellness configuration
 */
export interface WellnessConfig {
  /** Enable wellness reminders */
  enabled: boolean;
  /** Break reminder interval in minutes (default: 60) */
  breakIntervalMinutes: number;
  /** Hydration reminder interval in minutes (default: 90) */
  hydrateIntervalMinutes: number;
  /** Stretch reminder interval in minutes (default: 120) */
  stretchIntervalMinutes: number;
  /** Work hours start (24h format, default: 8) */
  workHoursStart: number;
  /** Work hours end (24h format, default: 18) */
  workHoursEnd: number;
}

/**
 * Reminder manager configuration
 */
export interface ReminderManagerConfig {
  /** Enable reminders */
  enabled: boolean;
  /** Check interval in milliseconds (default: 60000 - 1 minute) */
  checkIntervalMs: number;
  /** Wellness configuration */
  wellness: WellnessConfig;
  /** User name for personalized messages */
  userName: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: ReminderManagerConfig = {
  enabled: true,
  checkIntervalMs: 60000, // 1 minute
  wellness: {
    enabled: true,
    breakIntervalMinutes: 60,
    hydrateIntervalMinutes: 90,
    stretchIntervalMinutes: 120,
    workHoursStart: 8,
    workHoursEnd: 18,
  },
  userName: 'Ben',
};

const STORAGE_PATH = join(homedir(), '.atlas', 'brain', 'self', 'reminders.json');

// =============================================================================
// Wellness Messages (JARVIS-style)
// =============================================================================

const BREAK_MESSAGES = [
  "Ben, you've been at it for an hour. Might be a good time for a quick break.",
  "Consider stepping away for a few minutes. I'll keep things running.",
  "You've been focused for a while. A short break might help.",
  'A brief pause could do wonders for your concentration, Ben.',
  "Time to rest your eyes for a moment. I'll be here when you get back.",
];

const HYDRATE_MESSAGES = [
  'Hydration check, Ben.',
  "Don't forget to drink some water.",
  'Your last water break was a while ago.',
  'Quick reminder to stay hydrated.',
  'Water break time, Ben.',
];

const STRETCH_MESSAGES = [
  'Time to stretch, Ben. Your back will thank you.',
  "Quick stretch break? You've been sitting for 2 hours.",
  'Movement reminder - even a brief stretch helps.',
  'Your body could use a quick stretch right about now.',
  "Two hours of sitting - time to move around a bit, don't you think?",
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get random message from array
 */
function getRandomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Parse time string (e.g., "3pm", "15:00", "3:30 PM") to hours and minutes
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  const lowerTime = timeStr.toLowerCase().trim();

  // Try 24-hour format (15:00)
  const time24Match = lowerTime.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) {
    return {
      hours: parseInt(time24Match[1], 10),
      minutes: parseInt(time24Match[2], 10),
    };
  }

  // Try 12-hour format (3pm, 3:30pm, 3 pm)
  const time12Match = lowerTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (time12Match) {
    let hours = parseInt(time12Match[1], 10);
    const minutes = time12Match[2] ? parseInt(time12Match[2], 10) : 0;
    const period = time12Match[3];

    if (period === 'pm' && hours !== 12) {
      hours += 12;
    } else if (period === 'am' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  return null;
}

/**
 * Parse relative time (e.g., "in 30 minutes", "in 2 hours")
 */
function parseRelativeTime(text: string): number | null {
  const relativeMatch = text.match(/in\s+(\d+)\s*(minute|min|minutes|mins|hour|hours|hr|hrs)/i);

  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();

    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      return value * 60 * 60 * 1000;
    }
    return value * 60 * 1000;
  }

  return null;
}

/**
 * Format time remaining
 */
function formatTimeRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

// =============================================================================
// ReminderManager Class
// =============================================================================

/**
 * ReminderManager - Comprehensive reminder system
 */
export class ReminderManager extends EventEmitter {
  private config: ReminderManagerConfig;
  private reminders: Map<string, Reminder> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private wellnessIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastActivityTime: number = Date.now();
  private isInVoiceInteraction: boolean = false;

  constructor(config?: Partial<ReminderManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Load persisted reminders
    this.loadReminders();

    logger.info('ReminderManager initialized', {
      enabled: this.config.enabled,
      wellnessEnabled: this.config.wellness.enabled,
    });
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Start the reminder manager
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Reminder manager is disabled');
      return;
    }

    if (this.checkInterval) {
      return; // Already running
    }

    // Start checking reminders every minute
    this.checkInterval = setInterval(() => {
      this.checkReminders();
    }, this.config.checkIntervalMs);

    // Start wellness reminders if enabled
    if (this.config.wellness.enabled) {
      this.startWellnessReminders();
    }

    logger.info('Reminder manager started');
  }

  /**
   * Stop the reminder manager
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Stop wellness intervals
    this.wellnessIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.wellnessIntervals.clear();

    logger.info('Reminder manager stopped');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ReminderManagerConfig>): void {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (!this.checkInterval) {
      this.start();
    }

    // Restart wellness if config changed
    if (config.wellness) {
      this.stopWellnessReminders();
      if (this.config.wellness.enabled) {
        this.startWellnessReminders();
      }
    }

    logger.info('Configuration updated');
  }

  // ===========================================================================
  // Deadline Reminders
  // ===========================================================================

  /**
   * Schedule deadline reminders
   * @param deadline - The deadline date
   * @param task - Description of the task
   * @param remindersBefore - Array of minutes before deadline to remind
   */
  scheduleDeadlineReminder(deadline: Date, task: string, remindersBefore: number[]): void {
    const deadlineTime = deadline.getTime();
    const now = Date.now();

    for (const minutesBefore of remindersBefore) {
      const reminderTime = deadlineTime - minutesBefore * 60 * 1000;

      // Skip if reminder time is in the past
      if (reminderTime <= now) {
        continue;
      }

      const timeRemaining = formatTimeRemaining(minutesBefore * 60 * 1000);
      const messages = [
        `Ben, the ${task} deadline is in ${timeRemaining}.`,
        `Heads up: ${task} is due in ${timeRemaining}.`,
        `Reminder: ${task} - ${timeRemaining} remaining.`,
      ];

      const reminder: Reminder = {
        id: generateId(),
        type: 'deadline',
        message: getRandomMessage(messages),
        scheduledTime: new Date(reminderTime),
        delivered: false,
        priority: minutesBefore <= 30 ? 'urgent' : minutesBefore <= 60 ? 'high' : 'normal',
        source: 'deadline_scheduler',
        createdAt: new Date(),
        metadata: { task, deadline: deadline.toISOString(), minutesBefore },
      };

      this.reminders.set(reminder.id, reminder);
      this.emit('reminder:scheduled', reminder);
      logger.debug('Deadline reminder scheduled', { id: reminder.id, minutesBefore });
    }

    this.saveReminders();
  }

  // ===========================================================================
  // Calendar Reminders
  // ===========================================================================

  /**
   * Schedule a calendar event reminder
   * @param event - Calendar event
   * @param minutesBefore - Minutes before event to remind
   */
  scheduleCalendarReminder(event: CalendarEvent, minutesBefore: number): void {
    const eventTime = event.startTime.getTime();
    const reminderTime = eventTime - minutesBefore * 60 * 1000;
    const now = Date.now();

    if (reminderTime <= now) {
      logger.debug('Calendar reminder time already passed');
      return;
    }

    const locationStr = event.location ? ` at ${event.location}` : '';
    const timeStr = event.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const reminder: Reminder = {
      id: generateId(),
      type: 'calendar',
      message: `Ben, "${event.title}" starts in ${minutesBefore} minutes${locationStr}. It's scheduled for ${timeStr}.`,
      scheduledTime: new Date(reminderTime),
      delivered: false,
      priority: minutesBefore <= 15 ? 'high' : 'normal',
      source: 'calendar',
      createdAt: new Date(),
      metadata: {
        eventTitle: event.title,
        eventTime: event.startTime.toISOString(),
        location: event.location,
      },
    };

    this.reminders.set(reminder.id, reminder);
    this.emit('reminder:scheduled', reminder);
    this.saveReminders();

    logger.info('Calendar reminder scheduled', {
      id: reminder.id,
      event: event.title,
      minutesBefore,
    });
  }

  // ===========================================================================
  // Wellness Reminders
  // ===========================================================================

  /**
   * Schedule break reminders (every 60 min of work by default)
   */
  scheduleBreakReminder(): void {
    const intervalMs = this.config.wellness.breakIntervalMinutes * 60 * 1000;

    // Clear existing interval
    if (this.wellnessIntervals.has('break')) {
      clearInterval(this.wellnessIntervals.get('break')!);
    }

    const interval = setInterval(() => {
      if (this.shouldDeliverWellnessReminder()) {
        this.deliverWellnessReminder('break', BREAK_MESSAGES);
      }
    }, intervalMs);

    this.wellnessIntervals.set('break', interval);
    logger.debug('Break reminder scheduled', {
      intervalMinutes: this.config.wellness.breakIntervalMinutes,
    });
  }

  /**
   * Schedule hydration reminders (every 90 min by default)
   */
  scheduleHydrateReminder(): void {
    const intervalMs = this.config.wellness.hydrateIntervalMinutes * 60 * 1000;

    if (this.wellnessIntervals.has('hydrate')) {
      clearInterval(this.wellnessIntervals.get('hydrate')!);
    }

    const interval = setInterval(() => {
      if (this.shouldDeliverWellnessReminder()) {
        this.deliverWellnessReminder('hydrate', HYDRATE_MESSAGES);
      }
    }, intervalMs);

    this.wellnessIntervals.set('hydrate', interval);
    logger.debug('Hydrate reminder scheduled', {
      intervalMinutes: this.config.wellness.hydrateIntervalMinutes,
    });
  }

  /**
   * Schedule stretch reminders (every 2 hours by default)
   */
  scheduleStretchReminder(): void {
    const intervalMs = this.config.wellness.stretchIntervalMinutes * 60 * 1000;

    if (this.wellnessIntervals.has('stretch')) {
      clearInterval(this.wellnessIntervals.get('stretch')!);
    }

    const interval = setInterval(() => {
      if (this.shouldDeliverWellnessReminder()) {
        this.deliverWellnessReminder('stretch', STRETCH_MESSAGES);
      }
    }, intervalMs);

    this.wellnessIntervals.set('stretch', interval);
    logger.debug('Stretch reminder scheduled', {
      intervalMinutes: this.config.wellness.stretchIntervalMinutes,
    });
  }

  /**
   * Start all wellness reminders
   */
  private startWellnessReminders(): void {
    this.scheduleBreakReminder();
    this.scheduleHydrateReminder();
    this.scheduleStretchReminder();
    logger.info('Wellness reminders started');
  }

  /**
   * Stop all wellness reminders
   */
  private stopWellnessReminders(): void {
    this.wellnessIntervals.forEach((interval, type) => {
      clearInterval(interval);
      logger.debug('Wellness reminder stopped', { type });
    });
    this.wellnessIntervals.clear();
  }

  /**
   * Check if wellness reminder should be delivered
   */
  private shouldDeliverWellnessReminder(): boolean {
    // Don't interrupt voice interactions
    if (this.isInVoiceInteraction) {
      return false;
    }

    // Check work hours
    const now = new Date();
    const hour = now.getHours();
    const { workHoursStart, workHoursEnd } = this.config.wellness;

    if (hour < workHoursStart || hour >= workHoursEnd) {
      return false;
    }

    return true;
  }

  /**
   * Deliver a wellness reminder
   */
  private deliverWellnessReminder(type: ReminderType, messages: string[]): void {
    const reminder: Reminder = {
      id: generateId(),
      type,
      message: getRandomMessage(messages),
      scheduledTime: new Date(),
      delivered: true,
      priority: 'low',
      source: 'wellness',
      createdAt: new Date(),
    };

    this.emit('reminder:due', reminder);
    logger.debug('Wellness reminder delivered', { type });
  }

  // ===========================================================================
  // Custom Reminders
  // ===========================================================================

  /**
   * Schedule a custom reminder
   * @param time - When to remind
   * @param message - Reminder message
   * @returns Reminder ID
   */
  scheduleCustomReminder(time: Date, message: string): string {
    const reminder: Reminder = {
      id: generateId(),
      type: 'custom',
      message: `Ben, you asked me to remind you: ${message}`,
      scheduledTime: time,
      delivered: false,
      priority: 'normal',
      source: 'custom',
      createdAt: new Date(),
      metadata: { originalMessage: message },
    };

    this.reminders.set(reminder.id, reminder);
    this.emit('reminder:scheduled', reminder);
    this.saveReminders();

    logger.info('Custom reminder scheduled', { id: reminder.id, time: time.toISOString() });
    return reminder.id;
  }

  // ===========================================================================
  // Management Methods
  // ===========================================================================

  /**
   * Cancel a reminder
   * @param id - Reminder ID
   * @returns True if cancelled
   */
  cancelReminder(id: string): boolean {
    const reminder = this.reminders.get(id);
    if (!reminder) {
      return false;
    }

    this.reminders.delete(id);
    this.emit('reminder:cancelled', reminder);
    this.saveReminders();

    logger.info('Reminder cancelled', { id });
    return true;
  }

  /**
   * Snooze a reminder
   * @param id - Reminder ID
   * @param minutes - Minutes to snooze
   */
  snoozeReminder(id: string, minutes: number): void {
    const reminder = this.reminders.get(id);
    if (!reminder) {
      logger.warn('Cannot snooze: reminder not found', { id });
      return;
    }

    const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
    reminder.snoozedUntil = snoozedUntil;
    reminder.delivered = false;

    this.reminders.set(id, reminder);
    this.saveReminders();

    logger.info('Reminder snoozed', { id, minutes, until: snoozedUntil.toISOString() });
  }

  /**
   * Get upcoming reminders
   * @param withinMinutes - Optional limit to next N minutes
   * @returns Array of upcoming reminders
   */
  getUpcomingReminders(withinMinutes?: number): Reminder[] {
    const now = Date.now();
    const cutoff = withinMinutes ? now + withinMinutes * 60 * 1000 : Infinity;

    return Array.from(this.reminders.values())
      .filter((r) => {
        if (r.delivered) return false;
        const time = r.snoozedUntil?.getTime() || r.scheduledTime.getTime();
        return time > now && time <= cutoff;
      })
      .sort((a, b) => {
        const timeA = a.snoozedUntil?.getTime() || a.scheduledTime.getTime();
        const timeB = b.snoozedUntil?.getTime() || b.scheduledTime.getTime();
        return timeA - timeB;
      });
  }

  /**
   * Get pending reminders (due but not yet delivered)
   * @returns Array of pending reminders
   */
  getPendingReminders(): Reminder[] {
    const now = Date.now();

    return Array.from(this.reminders.values())
      .filter((r) => {
        if (r.delivered) return false;
        const time = r.snoozedUntil?.getTime() || r.scheduledTime.getTime();
        return time <= now;
      })
      .sort((a, b) => {
        // Sort by priority first, then by time
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        const timeA = a.snoozedUntil?.getTime() || a.scheduledTime.getTime();
        const timeB = b.snoozedUntil?.getTime() || b.scheduledTime.getTime();
        return timeA - timeB;
      });
  }

  /**
   * Get all reminders
   */
  getAllReminders(): Reminder[] {
    return Array.from(this.reminders.values());
  }

  /**
   * Get reminder by ID
   */
  getReminder(id: string): Reminder | null {
    return this.reminders.get(id) || null;
  }

  // ===========================================================================
  // Voice Command Parsing
  // ===========================================================================

  /**
   * Parse reminder from voice transcript
   * @param transcript - Voice transcript
   * @returns Parsed reminder or null
   *
   * Examples:
   * - "Remind me to call Sarah at 3pm"
   * - "Remind me in 30 minutes to check the build"
   * - "Remind me tomorrow to review the PR"
   */
  parseReminderFromVoice(transcript: string): Reminder | null {
    const lowerTranscript = transcript.toLowerCase().trim();

    // Check if it's a reminder request
    if (!lowerTranscript.includes('remind me')) {
      return null;
    }

    let message: string;
    let scheduledTime: Date | null = null;

    // Try to parse "remind me to [task] at [time]"
    const atTimeMatch = lowerTranscript.match(/remind me to (.+?) at (.+)/i);
    if (atTimeMatch) {
      message = atTimeMatch[1].trim();
      const timeStr = atTimeMatch[2].trim();
      const parsedTime = parseTimeString(timeStr);

      if (parsedTime) {
        const now = new Date();
        scheduledTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          parsedTime.hours,
          parsedTime.minutes
        );

        // If time has passed today, schedule for tomorrow
        if (scheduledTime.getTime() <= now.getTime()) {
          scheduledTime.setDate(scheduledTime.getDate() + 1);
        }
      }
    }

    // Try to parse "remind me in [duration] to [task]"
    if (!scheduledTime) {
      const inDurationMatch = lowerTranscript.match(
        /remind me (in \d+ (?:minute|min|minutes|mins|hour|hours|hr|hrs)) to (.+)/i
      );
      if (inDurationMatch) {
        const durationStr = inDurationMatch[1];
        message = inDurationMatch[2].trim();
        const durationMs = parseRelativeTime(durationStr);

        if (durationMs) {
          scheduledTime = new Date(Date.now() + durationMs);
        }
      }
    }

    // Try to parse "remind me tomorrow to [task]"
    if (!scheduledTime) {
      const tomorrowMatch = lowerTranscript.match(/remind me tomorrow (?:to )?(.+)/i);
      if (tomorrowMatch) {
        message = tomorrowMatch[1].trim();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0); // Default to 9 AM
        scheduledTime = tomorrow;
      }
    }

    // Try to parse "remind me to [task]" with relative time elsewhere
    if (!scheduledTime) {
      const simpleMatch = lowerTranscript.match(/remind me to (.+)/i);
      if (simpleMatch) {
        message = simpleMatch[1].trim();

        // Look for relative time anywhere in the message
        const relativeMs = parseRelativeTime(lowerTranscript);
        if (relativeMs) {
          scheduledTime = new Date(Date.now() + relativeMs);
          // Clean up the message
          message = message
            .replace(/in \d+ (?:minute|min|minutes|mins|hour|hours|hr|hrs)/gi, '')
            .trim();
        }
      }
    }

    // If we couldn't determine a time, default to 30 minutes
    if (!scheduledTime && message!) {
      scheduledTime = new Date(Date.now() + 30 * 60 * 1000);
      logger.debug('No time specified, defaulting to 30 minutes');
    }

    if (!message! || !scheduledTime) {
      return null;
    }

    // Clean up message
    message = message.replace(/^to /i, '').replace(/\s+/g, ' ').trim();

    // Capitalize first letter
    message = message.charAt(0).toUpperCase() + message.slice(1);

    const reminder: Reminder = {
      id: generateId(),
      type: 'custom',
      message: `Ben, you asked me to remind you: ${message}`,
      scheduledTime,
      delivered: false,
      priority: 'normal',
      source: 'voice_command',
      createdAt: new Date(),
      metadata: { originalTranscript: transcript, parsedMessage: message },
    };

    return reminder;
  }

  // ===========================================================================
  // Activity & Voice State Management
  // ===========================================================================

  /**
   * Update activity timestamp
   */
  updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Set voice interaction state
   */
  setVoiceInteractionState(inProgress: boolean): void {
    this.isInVoiceInteraction = inProgress;
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Check for due reminders
   */
  private checkReminders(): void {
    const now = Date.now();
    const reminders = Array.from(this.reminders.values());

    for (const reminder of reminders) {
      if (reminder.delivered) continue;

      // Check snooze
      if (reminder.snoozedUntil && reminder.snoozedUntil.getTime() > now) {
        continue;
      }

      const scheduledTime = reminder.scheduledTime.getTime();
      if (scheduledTime <= now) {
        this.deliverReminder(reminder);
      }
    }
  }

  /**
   * Deliver a reminder
   */
  private deliverReminder(reminder: Reminder): void {
    // Don't interrupt voice interactions for non-urgent reminders
    if (this.isInVoiceInteraction && reminder.priority !== 'urgent') {
      logger.debug('Deferring reminder delivery during voice interaction', { id: reminder.id });
      return;
    }

    reminder.delivered = true;
    this.reminders.set(reminder.id, reminder);
    this.saveReminders();

    this.emit('reminder:due', reminder);
    logger.info('Reminder delivered', {
      id: reminder.id,
      type: reminder.type,
      priority: reminder.priority,
    });
  }

  /**
   * Load reminders from persistent storage
   */
  private loadReminders(): void {
    try {
      if (!existsSync(STORAGE_PATH)) {
        logger.debug('No existing reminders file');
        return;
      }

      const data = readFileSync(STORAGE_PATH, 'utf-8');
      const stored: StoredReminder[] = JSON.parse(data);

      for (const item of stored) {
        // Skip already delivered reminders
        if (item.delivered) continue;

        const reminder: Reminder = {
          ...item,
          scheduledTime: new Date(item.scheduledTime),
          createdAt: new Date(item.createdAt),
          snoozedUntil: item.snoozedUntil ? new Date(item.snoozedUntil) : undefined,
        };

        // Only load future reminders
        const time = reminder.snoozedUntil?.getTime() || reminder.scheduledTime.getTime();
        if (time > Date.now()) {
          this.reminders.set(reminder.id, reminder);
        }
      }

      logger.info('Loaded reminders from storage', { count: this.reminders.size });
    } catch (error) {
      logger.error('Failed to load reminders', { error: (error as Error).message });
    }
  }

  /**
   * Save reminders to persistent storage
   */
  private saveReminders(): void {
    try {
      // Ensure directory exists
      const dir = join(homedir(), '.atlas');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const stored: StoredReminder[] = Array.from(this.reminders.values()).map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        scheduledTime: r.scheduledTime.toISOString(),
        delivered: r.delivered,
        recurring: r.recurring,
        priority: r.priority,
        source: r.source,
        snoozedUntil: r.snoozedUntil?.toISOString(),
        createdAt: r.createdAt.toISOString(),
        metadata: r.metadata,
      }));

      writeFileSync(STORAGE_PATH, JSON.stringify(stored, null, 2));
      logger.debug('Saved reminders to storage', { count: stored.length });
    } catch (error) {
      logger.error('Failed to save reminders', { error: (error as Error).message });
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    upcoming: number;
    delivered: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  } {
    const reminders = Array.from(this.reminders.values());
    const now = Date.now();

    const stats = {
      total: reminders.length,
      pending: 0,
      upcoming: 0,
      delivered: 0,
      byType: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
    };

    for (const reminder of reminders) {
      // Count by type
      stats.byType[reminder.type] = (stats.byType[reminder.type] || 0) + 1;

      // Count by priority
      stats.byPriority[reminder.priority] = (stats.byPriority[reminder.priority] || 0) + 1;

      // Count by status
      if (reminder.delivered) {
        stats.delivered++;
      } else {
        const time = reminder.snoozedUntil?.getTime() || reminder.scheduledTime.getTime();
        if (time <= now) {
          stats.pending++;
        } else {
          stats.upcoming++;
        }
      }
    }

    return stats;
  }

  /**
   * Clear all reminders
   */
  clear(): void {
    this.reminders.clear();
    this.saveReminders();
    logger.info('All reminders cleared');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let reminderManager: ReminderManager | null = null;

/**
 * Get or create the reminder manager singleton
 */
export function getReminderManager(): ReminderManager {
  if (!reminderManager) {
    reminderManager = new ReminderManager();
  }
  return reminderManager;
}

/**
 * Shutdown the reminder manager
 */
export function shutdownReminderManager(): void {
  if (reminderManager) {
    reminderManager.stop();
    reminderManager = null;
  }
}

export default ReminderManager;
