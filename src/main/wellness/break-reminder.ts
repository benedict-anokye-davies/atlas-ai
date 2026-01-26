/**
 * Break Reminder
 * 
 * Smart break reminder system that analyzes work patterns and suggests
 * optimal break times. Uses activity data and health research to provide
 * personalized recommendations.
 * 
 * @module wellness/break-reminder
 */

import { EventEmitter } from 'events';
import { Notification, app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getActivityTracker, DailyStats } from './activity-tracker';
import { getTTSManager } from '../tts/manager';
import { count } from '../../shared/utils';

const logger = createModuleLogger('BreakReminder');

// ============================================================================
// Types
// ============================================================================

export interface BreakReminderConfig {
  // Reminder intervals
  microBreakIntervalMs: number;    // Eye rest (20-20-20 rule)
  shortBreakIntervalMs: number;    // Stand/stretch break
  longBreakIntervalMs: number;     // Walk/rest break
  
  // Reminder durations
  microBreakDurationMs: number;    // 20 seconds
  shortBreakDurationMs: number;    // 5 minutes
  longBreakDurationMs: number;     // 15-30 minutes
  
  // Behavior settings
  enableMicroBreaks: boolean;
  enableShortBreaks: boolean;
  enableLongBreaks: boolean;
  
  // Notification settings
  notificationType: 'native' | 'overlay' | 'both';
  soundEnabled: boolean;
  snoozeMinutes: number;
  maxSnoozes: number;
  
  // Smart features
  respectFocusMode: boolean;       // Delay reminders during focus
  adaptToWorkPattern: boolean;     // Learn optimal break times
  respectMeetings: boolean;        // Check calendar for meetings
}

export interface BreakReminder {
  id: string;
  type: 'micro' | 'short' | 'long';
  scheduledTime: number;
  title: string;
  message: string;
  suggestions: string[];
  snoozed: boolean;
  snoozeCount: number;
  dismissed: boolean;
  taken: boolean;
  takenAt?: number;
  takenDuration?: number;
}

export interface BreakSuggestion {
  type: 'micro' | 'short' | 'long';
  activity: string;
  duration: string;
  benefit: string;
  icon?: string;
}

export type BreakReminderStatus = 'active' | 'paused' | 'focus-mode' | 'break-active';

const DEFAULT_CONFIG: BreakReminderConfig = {
  // 20-20-20 rule: Every 20 min, look 20 feet away for 20 sec
  microBreakIntervalMs: 1200000,    // 20 minutes
  shortBreakIntervalMs: 3600000,    // 1 hour
  longBreakIntervalMs: 14400000,    // 4 hours
  
  microBreakDurationMs: 20000,      // 20 seconds
  shortBreakDurationMs: 300000,     // 5 minutes
  longBreakDurationMs: 900000,      // 15 minutes
  
  enableMicroBreaks: true,
  enableShortBreaks: true,
  enableLongBreaks: true,
  
  notificationType: 'native',
  soundEnabled: true,
  snoozeMinutes: 5,
  maxSnoozes: 3,
  
  respectFocusMode: true,
  adaptToWorkPattern: true,
  respectMeetings: true,
};

// Break activity suggestions
const BREAK_SUGGESTIONS: Record<string, BreakSuggestion[]> = {
  micro: [
    { type: 'micro', activity: 'Look at something 20 feet away', duration: '20 seconds', benefit: 'Reduces eye strain', icon: '👁️' },
    { type: 'micro', activity: 'Close your eyes and breathe deeply', duration: '20 seconds', benefit: 'Reduces stress', icon: '😌' },
    { type: 'micro', activity: 'Roll your shoulders', duration: '20 seconds', benefit: 'Releases tension', icon: '🔄' },
    { type: 'micro', activity: 'Stretch your neck side to side', duration: '20 seconds', benefit: 'Prevents stiffness', icon: '↔️' },
  ],
  short: [
    { type: 'short', activity: 'Stand up and stretch', duration: '2-3 minutes', benefit: 'Improves circulation', icon: '🧘' },
    { type: 'short', activity: 'Walk to get water', duration: '3-5 minutes', benefit: 'Hydration + movement', icon: '💧' },
    { type: 'short', activity: 'Do desk exercises', duration: '5 minutes', benefit: 'Reduces sedentary harm', icon: '💪' },
    { type: 'short', activity: 'Step outside briefly', duration: '5 minutes', benefit: 'Fresh air + light', icon: '☀️' },
    { type: 'short', activity: 'Make a healthy snack', duration: '5 minutes', benefit: 'Sustained energy', icon: '🍎' },
  ],
  long: [
    { type: 'long', activity: 'Take a walk outside', duration: '15-20 minutes', benefit: 'Mental clarity + exercise', icon: '🚶' },
    { type: 'long', activity: 'Have a proper meal', duration: '20-30 minutes', benefit: 'Nutrition + reset', icon: '🍽️' },
    { type: 'long', activity: 'Do a short workout', duration: '15-20 minutes', benefit: 'Energy boost', icon: '🏃' },
    { type: 'long', activity: 'Practice mindfulness', duration: '15 minutes', benefit: 'Stress reduction', icon: '🧘‍♂️' },
    { type: 'long', activity: 'Take a power nap', duration: '15-20 minutes', benefit: 'Cognitive refresh', icon: '😴' },
  ],
};

// ============================================================================
// Break Reminder Class
// ============================================================================

export class BreakReminderManager extends EventEmitter {
  private config: BreakReminderConfig;
  private status: BreakReminderStatus = 'paused';
  
  // Timers
  private microBreakTimer: NodeJS.Timeout | null = null;
  private shortBreakTimer: NodeJS.Timeout | null = null;
  private longBreakTimer: NodeJS.Timeout | null = null;
  
  // Tracking
  private lastMicroBreak: number = 0;
  private lastShortBreak: number = 0;
  private lastLongBreak: number = 0;
  
  private currentReminder: BreakReminder | null = null;
  private reminderHistory: BreakReminder[] = [];
  
  // Adaptive learning
  private breakPatterns: {
    preferredMicroInterval: number;
    preferredShortInterval: number;
    acceptanceRate: number;
    bestTimeOfDay: number[];
  } = {
    preferredMicroInterval: DEFAULT_CONFIG.microBreakIntervalMs,
    preferredShortInterval: DEFAULT_CONFIG.shortBreakIntervalMs,
    acceptanceRate: 0.5,
    bestTimeOfDay: [10, 14, 16],  // Hours when breaks work best
  };

  constructor(config?: Partial<BreakReminderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the break reminder system
   */
  start(): void {
    if (this.status === 'active') {
      logger.warn('Break reminder already active');
      return;
    }

    logger.info('Starting break reminder system');
    
    const now = Date.now();
    this.lastMicroBreak = now;
    this.lastShortBreak = now;
    this.lastLongBreak = now;
    
    this.status = 'active';
    this.scheduleAllBreaks();
    
    // Listen to activity tracker for break events
    const activityTracker = getActivityTracker();
    activityTracker.on('break:ended', (breakInfo) => {
      this.onBreakTaken(breakInfo);
    });
    
    this.emit('status:changed', this.status);
  }

  /**
   * Stop the break reminder system
   */
  stop(): void {
    this.clearAllTimers();
    this.status = 'paused';
    
    // Clean up event listeners to prevent memory leaks
    this.removeAllListeners();
    
    logger.info('Break reminder system stopped');
  }

  /**
   * Pause reminders (e.g., during focus mode)
   */
  pause(reason: 'focus-mode' | 'meeting' | 'manual'): void {
    if (this.status !== 'active') return;
    
    this.clearAllTimers();
    this.status = reason === 'focus-mode' ? 'focus-mode' : 'paused';
    
    logger.info(`Break reminders paused: ${reason}`);
    this.emit('status:changed', this.status);
  }

  /**
   * Resume reminders
   */
  resume(): void {
    if (this.status === 'active') return;
    
    this.status = 'active';
    this.scheduleAllBreaks();
    
    logger.info('Break reminders resumed');
    this.emit('status:changed', this.status);
  }

  /**
   * Get current status
   */
  getStatus(): BreakReminderStatus {
    return this.status;
  }

  /**
   * Get next scheduled breaks
   */
  getUpcomingBreaks(): { type: string; time: number; in: number }[] {
    const now = Date.now();
    const upcoming = [];
    
    if (this.config.enableMicroBreaks) {
      const microTime = this.lastMicroBreak + this.getAdaptedInterval('micro');
      upcoming.push({ type: 'micro', time: microTime, in: microTime - now });
    }
    
    if (this.config.enableShortBreaks) {
      const shortTime = this.lastShortBreak + this.getAdaptedInterval('short');
      upcoming.push({ type: 'short', time: shortTime, in: shortTime - now });
    }
    
    if (this.config.enableLongBreaks) {
      const longTime = this.lastLongBreak + this.config.longBreakIntervalMs;
      upcoming.push({ type: 'long', time: longTime, in: longTime - now });
    }
    
    return upcoming.sort((a, b) => a.time - b.time);
  }

  /**
   * Snooze current reminder
   */
  snoozeReminder(): boolean {
    if (!this.currentReminder || this.currentReminder.snoozeCount >= this.config.maxSnoozes) {
      return false;
    }
    
    this.currentReminder.snoozed = true;
    this.currentReminder.snoozeCount++;
    
    // Reschedule
    const snoozeMs = this.config.snoozeMinutes * 60000;
    this.scheduleBreak(this.currentReminder.type, snoozeMs);
    
    logger.info(`Reminder snoozed (${this.currentReminder.snoozeCount}/${this.config.maxSnoozes})`);
    this.emit('reminder:snoozed', this.currentReminder);
    
    this.currentReminder = null;
    return true;
  }

  /**
   * Dismiss current reminder
   */
  dismissReminder(): void {
    if (!this.currentReminder) return;
    
    this.currentReminder.dismissed = true;
    this.reminderHistory.push(this.currentReminder);
    
    // Update acceptance rate (negatively)
    this.breakPatterns.acceptanceRate = 
      this.breakPatterns.acceptanceRate * 0.9;
    
    logger.info('Reminder dismissed');
    this.emit('reminder:dismissed', this.currentReminder);
    
    this.currentReminder = null;
  }

  /**
   * Mark break as taken
   */
  markBreakTaken(duration?: number): void {
    if (!this.currentReminder) return;
    
    this.currentReminder.taken = true;
    this.currentReminder.takenAt = Date.now();
    this.currentReminder.takenDuration = duration;
    this.reminderHistory.push(this.currentReminder);
    
    // Update last break time
    const type = this.currentReminder.type;
    const now = Date.now();
    
    if (type === 'micro') this.lastMicroBreak = now;
    else if (type === 'short') this.lastShortBreak = now;
    else this.lastLongBreak = now;
    
    // Update acceptance rate (positively)
    this.breakPatterns.acceptanceRate = 
      Math.min(1, this.breakPatterns.acceptanceRate * 1.1);
    
    logger.info(`Break taken: ${type}`);
    this.emit('break:taken', this.currentReminder);
    
    this.currentReminder = null;
    
    // Reschedule
    this.scheduleBreak(type);
  }

  /**
   * Get break suggestions
   */
  getBreakSuggestions(type: 'micro' | 'short' | 'long'): BreakSuggestion[] {
    return BREAK_SUGGESTIONS[type] || [];
  }

  /**
   * Get today's break statistics
   */
  getTodayBreakStats(): {
    microBreaks: number;
    shortBreaks: number;
    longBreaks: number;
    totalBreakTime: number;
    acceptanceRate: number;
    score: number;
  } {
    const activityTracker = getActivityTracker();
    const todayStats = activityTracker.getTodayStats();
    
    const takenToday = this.reminderHistory.filter(r => {
      const reminderDate = new Date(r.scheduledTime).toDateString();
      const today = new Date().toDateString();
      return reminderDate === today && r.taken;
    });
    
    return {
      microBreaks: count(takenToday, r => r.type === 'micro'),
      shortBreaks: count(takenToday, r => r.type === 'short'),
      longBreaks: count(takenToday, r => r.type === 'long'),
      totalBreakTime: todayStats?.totalBreakTime || 0,
      acceptanceRate: this.breakPatterns.acceptanceRate,
      score: todayStats?.breakScore || 0,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Schedule all break types
   */
  private scheduleAllBreaks(): void {
    if (this.config.enableMicroBreaks) {
      this.scheduleBreak('micro');
    }
    if (this.config.enableShortBreaks) {
      this.scheduleBreak('short');
    }
    if (this.config.enableLongBreaks) {
      this.scheduleBreak('long');
    }
  }

  /**
   * Schedule a specific break type
   */
  private scheduleBreak(type: 'micro' | 'short' | 'long', customDelayMs?: number): void {
    const delay = customDelayMs || this.getAdaptedInterval(type);
    
    const timer = setTimeout(() => {
      this.triggerReminder(type);
    }, delay);
    
    // Store timer reference
    if (type === 'micro') this.microBreakTimer = timer;
    else if (type === 'short') this.shortBreakTimer = timer;
    else this.longBreakTimer = timer;
    
    logger.debug(`Scheduled ${type} break in ${Math.round(delay / 60000)} minutes`);
  }

  /**
   * Get adapted interval based on learning
   */
  private getAdaptedInterval(type: 'micro' | 'short' | 'long'): number {
    if (!this.config.adaptToWorkPattern) {
      return type === 'micro' ? this.config.microBreakIntervalMs :
             type === 'short' ? this.config.shortBreakIntervalMs :
             this.config.longBreakIntervalMs;
    }
    
    // Adjust based on acceptance rate
    // Lower acceptance = longer intervals to be less intrusive
    const acceptanceMultiplier = 0.8 + (1 - this.breakPatterns.acceptanceRate) * 0.4;
    
    const baseInterval = type === 'micro' ? this.breakPatterns.preferredMicroInterval :
                        type === 'short' ? this.breakPatterns.preferredShortInterval :
                        this.config.longBreakIntervalMs;
    
    return Math.round(baseInterval * acceptanceMultiplier);
  }

  /**
   * Trigger a break reminder
   */
  private triggerReminder(type: 'micro' | 'short' | 'long'): void {
    if (this.status !== 'active') return;
    
    const suggestions = this.getBreakSuggestions(type);
    const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    
    const reminder: BreakReminder = {
      id: `reminder_${Date.now()}`,
      type,
      scheduledTime: Date.now(),
      title: this.getReminderTitle(type),
      message: suggestion.activity,
      suggestions: suggestions.map(s => s.activity),
      snoozed: false,
      snoozeCount: 0,
      dismissed: false,
      taken: false,
    };
    
    this.currentReminder = reminder;
    
    // Show notification
    this.showNotification(reminder);
    
    logger.info(`Triggered ${type} break reminder`);
    this.emit('reminder:triggered', reminder);
  }

  /**
   * Get reminder title
   */
  private getReminderTitle(type: 'micro' | 'short' | 'long'): string {
    switch (type) {
      case 'micro':
        return 'Eye Break';
      case 'short':
        return 'Time to stretch!';
      case 'long':
        return 'Take a real break';
    }
  }

  /**
   * Show notification
   */
  private showNotification(reminder: BreakReminder): void {
    // Speak the reminder via TTS
    try {
      const tts = getTTSManager();
      const spokenMessage = reminder.type === 'micro' 
        ? `Time for an eye break. ${reminder.message}`
        : reminder.type === 'short'
        ? `Time to stretch! ${reminder.message}`
        : `You've been working for a while. ${reminder.message}`;
      tts.speak(spokenMessage, reminder.type === 'long' ? 5 : 1);
    } catch (err) {
      logger.error('Failed to speak break reminder', { error: (err as Error).message });
    }

    if (this.config.notificationType === 'native' || this.config.notificationType === 'both') {
      const notification = new Notification({
        title: reminder.title,
        body: reminder.message,
        silent: !this.config.soundEnabled,
        actions: [
          { type: 'button', text: 'Take Break' },
          { type: 'button', text: 'Snooze' },
        ],
      });
      
      notification.on('click', () => {
        this.markBreakTaken();
      });
      
      notification.on('action', (_, index) => {
        if (index === 0) this.markBreakTaken();
        else this.snoozeReminder();
      });
      
      notification.show();
    }
    
    // Overlay notification handled by renderer
    if (this.config.notificationType === 'overlay' || this.config.notificationType === 'both') {
      this.emit('notification:show', reminder);
    }
  }

  /**
   * Handle break taken from activity tracker
   */
  private onBreakTaken(breakInfo: { duration: number; type: string }): void {
    const now = Date.now();
    
    // Update last break times based on duration
    if (breakInfo.duration >= this.config.longBreakDurationMs) {
      this.lastLongBreak = now;
      this.lastShortBreak = now;
      this.lastMicroBreak = now;
    } else if (breakInfo.duration >= this.config.shortBreakDurationMs) {
      this.lastShortBreak = now;
      this.lastMicroBreak = now;
    } else if (breakInfo.duration >= this.config.microBreakDurationMs) {
      this.lastMicroBreak = now;
    }
    
    // Clear current reminder if break taken
    if (this.currentReminder && !this.currentReminder.taken) {
      this.currentReminder.taken = true;
      this.currentReminder.takenAt = now;
      this.currentReminder.takenDuration = breakInfo.duration;
      this.reminderHistory.push(this.currentReminder);
      this.currentReminder = null;
    }
    
    // Reschedule breaks
    this.scheduleAllBreaks();
  }

  /**
   * Clear all timers
   */
  private clearAllTimers(): void {
    if (this.microBreakTimer) {
      clearTimeout(this.microBreakTimer);
      this.microBreakTimer = null;
    }
    if (this.shortBreakTimer) {
      clearTimeout(this.shortBreakTimer);
      this.shortBreakTimer = null;
    }
    if (this.longBreakTimer) {
      clearTimeout(this.longBreakTimer);
      this.longBreakTimer = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let reminderInstance: BreakReminderManager | null = null;

export function getBreakReminder(config?: Partial<BreakReminderConfig>): BreakReminderManager {
  if (!reminderInstance) {
    reminderInstance = new BreakReminderManager(config);
  }
  return reminderInstance;
}

export function resetBreakReminder(): void {
  if (reminderInstance) {
    reminderInstance.stop();
  }
  reminderInstance = null;
}
