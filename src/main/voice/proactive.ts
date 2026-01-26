/**
 * Atlas Desktop - Proactive Announcer
 * JARVIS-style proactive speech - unprompted observations and announcements.
 * Atlas initiates conversation when he has something relevant to share.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ProactiveAnnouncer');

/**
 * Types of proactive announcements
 */
export type ProactiveType =
  | 'observation'    // Something Atlas noticed
  | 'reminder'       // Gentle reminder
  | 'suggestion'     // Helpful suggestion
  | 'status'         // Status update
  | 'wellness'       // Break/hydration reminder
  | 'completion'     // Task completion
  | 'alert';         // Something requiring attention

/**
 * Proactive announcement
 */
export interface ProactiveAnnouncement {
  /** Unique ID */
  id: string;
  /** Type of announcement */
  type: ProactiveType;
  /** Message to speak */
  message: string;
  /** Priority (higher = more important) */
  priority: number;
  /** When to announce (unix timestamp, 0 = immediately) */
  announceAt: number;
  /** Cooldown before similar announcement (ms) */
  cooldownMs: number;
  /** Whether to interrupt current speech */
  canInterrupt: boolean;
  /** Context for the announcement */
  context?: Record<string, unknown>;
}

/**
 * Proactive announcer configuration
 */
export interface ProactiveConfig {
  /** Enable proactive announcements */
  enabled: boolean;
  /** Enable observations (noticed something interesting) */
  enableObservations: boolean;
  /** Enable wellness reminders */
  enableWellnessReminders: boolean;
  /** Enable status updates */
  enableStatusUpdates: boolean;
  /** Enable suggestions */
  enableSuggestions: boolean;
  /** Minimum interval between any proactive speech (ms) */
  minIntervalMs: number;
  /** Wellness reminder interval (ms) */
  wellnessIntervalMs: number;
  /** Quiet hours - no proactive speech */
  quietHours: { start: number; end: number };
  /** Max announcements per hour */
  maxPerHour: number;
}

/**
 * Default configuration - helpful but not annoying
 */
const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  enableObservations: true,
  enableWellnessReminders: true,
  enableStatusUpdates: true,
  enableSuggestions: true,
  minIntervalMs: 5 * 60 * 1000, // 5 minutes between proactive speech
  wellnessIntervalMs: 45 * 60 * 1000, // 45 minute reminder for breaks
  quietHours: { start: 22, end: 7 }, // 10pm - 7am (respects night mode)
  maxPerHour: 4,
};

/**
 * JARVIS-style proactive message templates
 */
const TEMPLATES = {
  observation: [
    'By the way, {observation}.',
    'Noticed something - {observation}.',
    'Just spotted this: {observation}.',
    'Heads up: {observation}.',
  ],
  reminder: [
    'Quick reminder: {reminder}.',
    'Hey Ben, {reminder}.',
    "Don't forget: {reminder}.",
  ],
  suggestion: [
    'Might be worth {suggestion}.',
    'Just a thought - {suggestion}.',
    'You might want to {suggestion}.',
  ],
  wellness: {
    break: [
      "Been at it for a while. Maybe stretch your legs?",
      "You've been going for hours. Quick break?",
      "How about a 5-minute breather?",
    ],
    hydration: [
      'Stay hydrated, Ben.',
      'Water break?',
      "When's the last time you had some water?",
    ],
    posture: [
      'Check your posture.',
      'Shoulders back.',
    ],
    lateNight: [
      "It's getting late. The code will still be here tomorrow.",
      "Almost midnight. You should probably get some sleep.",
      "Ben, it's past midnight. Take care of yourself.",
    ],
  },
  completion: [
    "That's done. {summary}",
    'Finished. {summary}',
    'All set. {summary}',
  ],
  alert: [
    'Ben, {alert}.',
    'Need your attention: {alert}.',
    'Heads up - {alert}.',
  ],
};

/**
 * Proactive Announcer Events
 */
export interface ProactiveAnnouncerEvents {
  /** Ready to announce something */
  'announcement': (announcement: ProactiveAnnouncement) => void;
  /** Announcement was suppressed */
  'suppressed': (reason: string, type: ProactiveType) => void;
  /** Config updated */
  'config-updated': (config: ProactiveConfig) => void;
}

/**
 * Proactive Announcer
 * Manages JARVIS-style unprompted speech
 */
export class ProactiveAnnouncer extends EventEmitter {
  private config: ProactiveConfig;
  private queue: ProactiveAnnouncement[] = [];
  private lastAnnouncementTime = 0;
  private announcementsThisHour = 0;
  private hourResetTimer: NodeJS.Timeout | null = null;
  private wellnessTimer: NodeJS.Timeout | null = null;
  private workSessionStart = Date.now();
  private announcementCounter = 0;
  private cooldowns: Map<string, number> = new Map(); // type -> lastAnnouncedAt

  constructor(config?: Partial<ProactiveConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startHourlyReset();
    this.startWellnessTimer();
    logger.info('ProactiveAnnouncer initialized', { config: this.config });
  }

  /**
   * Check if we're in quiet hours
   */
  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    const { start, end } = this.config.quietHours;
    
    if (start > end) {
      // Crosses midnight (e.g., 22-7)
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  }

  /**
   * Check if we can announce right now
   */
  private canAnnounce(type: ProactiveType, priority: number = 0): boolean {
    if (!this.config.enabled) return false;
    
    // High priority (>= 8) ignores quiet hours
    if (priority < 8 && this.isQuietHours()) {
      logger.debug('Suppressed: quiet hours', { type });
      return false;
    }

    // Check hourly limit
    if (this.announcementsThisHour >= this.config.maxPerHour) {
      logger.debug('Suppressed: hourly limit reached', { type });
      return false;
    }

    // Check minimum interval
    const timeSinceLastAnnouncement = Date.now() - this.lastAnnouncementTime;
    if (timeSinceLastAnnouncement < this.config.minIntervalMs) {
      logger.debug('Suppressed: too soon', { type, timeSince: timeSinceLastAnnouncement });
      return false;
    }

    return true;
  }

  /**
   * Queue a proactive announcement
   */
  public announce(
    type: ProactiveType,
    message: string,
    options: Partial<ProactiveAnnouncement> = {}
  ): string | null {
    // Check type-specific config
    if (type === 'observation' && !this.config.enableObservations) return null;
    if (type === 'wellness' && !this.config.enableWellnessReminders) return null;
    if (type === 'status' && !this.config.enableStatusUpdates) return null;
    if (type === 'suggestion' && !this.config.enableSuggestions) return null;

    const priority = options.priority ?? 5;
    
    if (!this.canAnnounce(type, priority)) {
      this.emit('suppressed', 'rate limited', type);
      return null;
    }

    // Check cooldown for this type
    const lastOfType = this.cooldowns.get(type);
    const cooldownMs = options.cooldownMs ?? 10 * 60 * 1000; // 10 min default
    if (lastOfType && Date.now() - lastOfType < cooldownMs) {
      this.emit('suppressed', 'cooldown', type);
      return null;
    }

    const announcement: ProactiveAnnouncement = {
      id: `proactive-${++this.announcementCounter}`,
      type,
      message,
      priority,
      announceAt: options.announceAt ?? 0,
      cooldownMs,
      canInterrupt: options.canInterrupt ?? false,
      context: options.context,
    };

    // If immediate, emit now
    if (announcement.announceAt === 0) {
      this.emitAnnouncement(announcement);
    } else {
      // Schedule for later
      this.queue.push(announcement);
      this.queue.sort((a, b) => a.announceAt - b.announceAt);
      this.scheduleNext();
    }

    return announcement.id;
  }

  /**
   * Emit an announcement
   */
  private emitAnnouncement(announcement: ProactiveAnnouncement): void {
    this.lastAnnouncementTime = Date.now();
    this.announcementsThisHour++;
    this.cooldowns.set(announcement.type, Date.now());
    
    logger.info('Proactive announcement', {
      id: announcement.id,
      type: announcement.type,
      message: announcement.message,
    });

    this.emit('announcement', announcement);
  }

  /**
   * Schedule next queued announcement
   */
  private scheduleNext(): void {
    if (this.queue.length === 0) return;
    
    const next = this.queue[0];
    const delay = Math.max(0, next.announceAt - Date.now());
    
    setTimeout(() => {
      const announcement = this.queue.shift();
      if (announcement && this.canAnnounce(announcement.type, announcement.priority)) {
        this.emitAnnouncement(announcement);
      }
      this.scheduleNext();
    }, delay);
  }

  /**
   * Start hourly announcement counter reset
   */
  private startHourlyReset(): void {
    this.hourResetTimer = setInterval(() => {
      this.announcementsThisHour = 0;
    }, 60 * 60 * 1000);
  }

  /**
   * Start wellness reminder timer
   */
  private startWellnessTimer(): void {
    if (!this.config.enableWellnessReminders) return;

    this.wellnessTimer = setInterval(() => {
      const sessionDuration = Date.now() - this.workSessionStart;
      
      // Only remind if they've been working for a while
      if (sessionDuration < this.config.wellnessIntervalMs) return;
      
      // Check time of day
      const hour = new Date().getHours();
      
      if (hour >= 0 && hour < 5) {
        // Late night - suggest sleep
        this.announceWellness('lateNight');
      } else {
        // Regular hours - suggest break
        const breakOrHydrate = Math.random() > 0.5 ? 'break' : 'hydration';
        this.announceWellness(breakOrHydrate);
      }
    }, this.config.wellnessIntervalMs);
  }

  /**
   * Announce wellness reminder
   */
  private announceWellness(category: keyof typeof TEMPLATES.wellness): void {
    const messages = TEMPLATES.wellness[category];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    this.announce('wellness', message, {
      priority: category === 'lateNight' ? 6 : 4,
      cooldownMs: this.config.wellnessIntervalMs,
    });
  }

  /**
   * User activity detected - reset work session timer
   */
  public userActivity(): void {
    // Don't reset on every activity, just track session
  }

  /**
   * Reset work session (e.g., after a long break)
   */
  public resetSession(): void {
    this.workSessionStart = Date.now();
  }

  /**
   * Convenience methods for common proactive announcements
   */
  
  public observation(text: string, context?: Record<string, unknown>): string | null {
    const template = TEMPLATES.observation[Math.floor(Math.random() * TEMPLATES.observation.length)];
    const message = template.replace('{observation}', text);
    return this.announce('observation', message, { context });
  }

  public reminder(text: string): string | null {
    const template = TEMPLATES.reminder[Math.floor(Math.random() * TEMPLATES.reminder.length)];
    const message = template.replace('{reminder}', text);
    return this.announce('reminder', message, { priority: 6 });
  }

  public suggestion(text: string): string | null {
    const template = TEMPLATES.suggestion[Math.floor(Math.random() * TEMPLATES.suggestion.length)];
    const message = template.replace('{suggestion}', text);
    return this.announce('suggestion', message, { priority: 4 });
  }

  public alert(text: string): string | null {
    const template = TEMPLATES.alert[Math.floor(Math.random() * TEMPLATES.alert.length)];
    const message = template.replace('{alert}', text);
    return this.announce('alert', message, { priority: 9, canInterrupt: true });
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ProactiveConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart wellness timer if settings changed
    if (this.wellnessTimer) {
      clearInterval(this.wellnessTimer);
      this.startWellnessTimer();
    }
    
    this.emit('config-updated', this.config);
    logger.info('ProactiveAnnouncer config updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  public getConfig(): ProactiveConfig {
    return { ...this.config };
  }

  /**
   * Clear all queued announcements
   */
  public clearQueue(): void {
    this.queue = [];
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    if (this.hourResetTimer) clearInterval(this.hourResetTimer);
    if (this.wellnessTimer) clearInterval(this.wellnessTimer);
    this.removeAllListeners();
    logger.info('ProactiveAnnouncer disposed');
  }
}

// Singleton instance
let proactiveAnnouncer: ProactiveAnnouncer | null = null;

/**
 * Get or create the ProactiveAnnouncer singleton
 */
export function getProactiveAnnouncer(config?: Partial<ProactiveConfig>): ProactiveAnnouncer {
  if (!proactiveAnnouncer) {
    proactiveAnnouncer = new ProactiveAnnouncer(config);
  }
  return proactiveAnnouncer;
}

/**
 * Reset the singleton (for testing)
 */
export function resetProactiveAnnouncer(): void {
  if (proactiveAnnouncer) {
    proactiveAnnouncer.dispose();
    proactiveAnnouncer = null;
  }
}
