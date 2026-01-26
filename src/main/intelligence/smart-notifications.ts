/**
 * Atlas Desktop - Smart Notifications Manager
 * Proactive suggestions and intelligent notifications
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
// Reserved for future integration
// import { getBackgroundResearchManager } from './background-research';

const logger = createModuleLogger('SmartNotifications');

/**
 * Notification priority levels
 */
export type NotificationPriority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * Notification action types
 */
export type NotificationAction = 'view' | 'dismiss' | 'snooze' | 'learn_more' | 'custom';

/**
 * Smart notification
 */
export interface SmartNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  source: string;
  timestamp: number;
  expiresAt?: number;
  actions?: NotificationActionConfig[];
  metadata?: Record<string, unknown>;
  dismissed?: boolean;
  snoozedUntil?: number;
}

/**
 * Notification type
 */
export type NotificationType =
  | 'research_complete'
  | 'suggestion'
  | 'reminder'
  | 'insight'
  | 'pattern_detected'
  | 'context_update'
  | 'follow_up'
  | 'proactive_help';

/**
 * Notification action configuration
 */
export interface NotificationActionConfig {
  type: NotificationAction;
  label: string;
  data?: unknown;
}

/**
 * Suggestion based on patterns
 */
export interface Suggestion {
  id: string;
  text: string;
  reason: string;
  confidence: number;
  category: string;
  actions: string[];
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  /** Enable smart notifications */
  enabled: boolean;
  /** Maximum active notifications */
  maxActive: number;
  /** Default notification expiration (ms) */
  defaultExpirationMs: number;
  /** Minimum interval between notifications (ms) */
  minIntervalMs: number;
  /** Enable follow-up notifications */
  enableFollowUps: boolean;
  /** Enable pattern-based suggestions */
  enablePatternSuggestions: boolean;
  /** Priority threshold to show notification */
  priorityThreshold: NotificationPriority;
  /** Quiet hours (no notifications) */
  quietHours?: { start: number; end: number };
}

/**
 * Default notification configuration
 */
const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  maxActive: 5,
  defaultExpirationMs: 30 * 60 * 1000, // 30 minutes
  minIntervalMs: 60 * 1000, // 1 minute
  enableFollowUps: true,
  enablePatternSuggestions: true,
  priorityThreshold: 'low',
};

/**
 * User pattern types
 */
interface UserPattern {
  type: string;
  pattern: string;
  frequency: number;
  lastSeen: number;
  suggestionGenerated: boolean;
}

/**
 * SmartNotificationsManager - Intelligent notification system
 */
export class SmartNotificationsManager extends EventEmitter {
  private config: NotificationConfig;
  private notifications: Map<string, SmartNotification> = new Map();
  private patterns: Map<string, UserPattern> = new Map();
  private lastNotificationTime: number = 0;
  private followUpQueue: Array<{ query: string; time: number }> = [];

  constructor(config?: Partial<NotificationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('SmartNotificationsManager initialized');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Create and emit a notification
   */
  notify(notification: Omit<SmartNotification, 'id' | 'timestamp'>): SmartNotification | null {
    if (!this.config.enabled) {
      logger.debug('Notifications disabled');
      return null;
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      logger.debug('In quiet hours, notification suppressed');
      return null;
    }

    // Check rate limiting
    if (Date.now() - this.lastNotificationTime < this.config.minIntervalMs) {
      logger.debug('Rate limited, notification queued');
      return null;
    }

    // Check priority threshold
    if (!this.meetsPriorityThreshold(notification.priority)) {
      logger.debug('Below priority threshold', { priority: notification.priority });
      return null;
    }

    // Check max active notifications
    if (this.getActiveNotifications().length >= this.config.maxActive) {
      // Remove oldest low-priority notification
      this.removeOldestLowPriority();
    }

    const fullNotification: SmartNotification = {
      ...notification,
      id: this.generateId(),
      timestamp: Date.now(),
      expiresAt: notification.expiresAt || Date.now() + this.config.defaultExpirationMs,
    };

    this.notifications.set(fullNotification.id, fullNotification);
    this.lastNotificationTime = Date.now();

    this.emit('notification', fullNotification);
    logger.info('Notification created', { id: fullNotification.id, type: fullNotification.type });

    return fullNotification;
  }

  /**
   * Dismiss a notification
   */
  dismiss(id: string): boolean {
    const notification = this.notifications.get(id);
    if (!notification) return false;

    notification.dismissed = true;
    this.emit('dismissed', notification);
    logger.debug('Notification dismissed', { id });
    return true;
  }

  /**
   * Snooze a notification
   */
  snooze(id: string, durationMs: number): boolean {
    const notification = this.notifications.get(id);
    if (!notification) return false;

    notification.snoozedUntil = Date.now() + durationMs;
    this.emit('snoozed', notification);
    logger.debug('Notification snoozed', { id, durationMs });
    return true;
  }

  /**
   * Handle notification action
   */
  handleAction(id: string, action: NotificationAction, data?: unknown): void {
    const notification = this.notifications.get(id);
    if (!notification) return;

    this.emit('action', { notification, action, data });
    logger.debug('Notification action', { id, action });

    if (action === 'dismiss') {
      this.dismiss(id);
    }
  }

  /**
   * Get active (non-dismissed, non-expired) notifications
   */
  getActiveNotifications(): SmartNotification[] {
    const now = Date.now();
    const active: SmartNotification[] = [];

    for (const [id, notification] of Array.from(this.notifications.entries())) {
      // Check if expired
      if (notification.expiresAt && now >= notification.expiresAt) {
        this.notifications.delete(id);
        continue;
      }

      // Check if dismissed
      if (notification.dismissed) continue;

      // Check if snoozed
      if (notification.snoozedUntil && now < notification.snoozedUntil) continue;

      active.push(notification);
    }

    return active.sort((a, b) => {
      // Sort by priority then timestamp
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * Process conversation for potential suggestions
   */
  processConversation(userMessage: string, assistantResponse?: string): void {
    if (!this.config.enabled) return;

    // Track patterns
    this.trackPatterns(userMessage);

    // Check for follow-up opportunities
    if (this.config.enableFollowUps) {
      this.checkForFollowUps(userMessage, assistantResponse);
    }

    // Generate pattern-based suggestions
    if (this.config.enablePatternSuggestions) {
      this.generatePatternSuggestions();
    }
  }

  /**
   * Create a research-complete notification
   */
  notifyResearchComplete(
    query: string,
    summary: string,
    facts: string[]
  ): SmartNotification | null {
    return this.notify({
      type: 'research_complete',
      title: 'Research Complete',
      message: `I found some information about "${query}": ${summary.slice(0, 100)}...`,
      priority: 'medium',
      source: 'background_research',
      actions: [
        { type: 'view', label: 'View Details' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
      metadata: { query, facts: facts.slice(0, 5) },
    });
  }

  /**
   * Create a suggestion notification
   */
  notifySuggestion(suggestion: Suggestion): SmartNotification | null {
    return this.notify({
      type: 'suggestion',
      title: 'Suggestion',
      message: suggestion.text,
      priority: suggestion.confidence > 0.8 ? 'high' : 'medium',
      source: suggestion.category,
      actions: [
        { type: 'learn_more', label: 'Tell me more' },
        { type: 'dismiss', label: 'Not now' },
      ],
      metadata: { suggestion },
    });
  }

  /**
   * Create a reminder notification
   */
  notifyReminder(title: string, message: string): SmartNotification | null {
    return this.notify({
      type: 'reminder',
      title,
      message,
      priority: 'high',
      source: 'reminder',
      actions: [
        { type: 'view', label: 'View' },
        { type: 'snooze', label: 'Snooze' },
        { type: 'dismiss', label: 'Done' },
      ],
    });
  }

  /**
   * Create an insight notification
   */
  notifyInsight(insight: string, reason: string): SmartNotification | null {
    return this.notify({
      type: 'insight',
      title: 'Insight',
      message: insight,
      priority: 'low',
      source: 'pattern_analysis',
      metadata: { reason },
      actions: [
        { type: 'learn_more', label: 'Learn More' },
        { type: 'dismiss', label: 'Got it' },
      ],
    });
  }

  /**
   * Create a proactive help notification
   */
  notifyProactiveHelp(topic: string, helpText: string): SmartNotification | null {
    return this.notify({
      type: 'proactive_help',
      title: `About ${topic}`,
      message: helpText,
      priority: 'low',
      source: 'proactive_assistance',
      actions: [
        { type: 'learn_more', label: 'Tell me more' },
        { type: 'dismiss', label: 'Thanks' },
      ],
    });
  }

  /**
   * Get notification statistics
   */
  getStats(): {
    total: number;
    active: number;
    dismissed: number;
    byType: Record<string, number>;
  } {
    let dismissed = 0;
    const byType: Record<string, number> = {};

    const values = Array.from(this.notifications.values());
    for (const notification of values) {
      if (notification.dismissed) dismissed++;
      byType[notification.type] = (byType[notification.type] || 0) + 1;
    }

    return {
      total: this.notifications.size,
      active: this.getActiveNotifications().length,
      dismissed,
      byType,
    };
  }

  /**
   * Clear all notifications
   */
  clear(): void {
    this.notifications.clear();
    this.emit('cleared');
    logger.info('All notifications cleared');
  }

  // Private methods

  private isQuietHours(): boolean {
    if (!this.config.quietHours) return false;

    const now = new Date();
    const hour = now.getHours();

    const { start, end } = this.config.quietHours;

    if (start < end) {
      // Same day (e.g., 9-17)
      return hour >= start && hour < end;
    } else {
      // Overnight (e.g., 22-7)
      return hour >= start || hour < end;
    }
  }

  private meetsPriorityThreshold(priority: NotificationPriority): boolean {
    const order = { urgent: 0, high: 1, medium: 2, low: 3 };
    return order[priority] <= order[this.config.priorityThreshold];
  }

  private removeOldestLowPriority(): void {
    const active = this.getActiveNotifications();
    const lowPriority = active.filter((n) => n.priority === 'low');

    if (lowPriority.length > 0) {
      // Remove oldest low priority
      const oldest = lowPriority[lowPriority.length - 1];
      this.notifications.delete(oldest.id);
    } else {
      // Remove oldest medium priority
      const medium = active.filter((n) => n.priority === 'medium');
      if (medium.length > 0) {
        const oldest = medium[medium.length - 1];
        this.notifications.delete(oldest.id);
      }
    }
  }

  private trackPatterns(message: string): void {
    const lowerMessage = message.toLowerCase();

    // Track question patterns
    const questionPatterns = [
      { regex: /how do i (.+?)\?/gi, type: 'how_to' },
      { regex: /what is (.+?)\?/gi, type: 'definition' },
      { regex: /when should i (.+?)\?/gi, type: 'timing' },
      { regex: /why (.+?)\?/gi, type: 'explanation' },
    ];

    for (const { regex, type } of questionPatterns) {
      const matches = lowerMessage.matchAll(regex);
      for (const match of matches) {
        const key = `${type}:${match[1]}`;
        const existing = this.patterns.get(key);

        if (existing) {
          existing.frequency++;
          existing.lastSeen = Date.now();
        } else {
          this.patterns.set(key, {
            type,
            pattern: match[1],
            frequency: 1,
            lastSeen: Date.now(),
            suggestionGenerated: false,
          });
        }
      }
    }
  }

  private checkForFollowUps(userMessage: string, _assistantResponse?: string): void {
    // Look for follow-up indicators
    const followUpIndicators = [
      /i'll try that/gi,
      /let me check/gi,
      /remind me/gi,
      /i need to/gi,
      /i should/gi,
    ];

    const lowerMessage = userMessage.toLowerCase();
    for (const indicator of followUpIndicators) {
      if (indicator.test(lowerMessage)) {
        this.followUpQueue.push({
          query: userMessage,
          time: Date.now() + 30 * 60 * 1000, // 30 minutes from now
        });
        break;
      }
    }

    // Check and emit follow-up notifications
    this.processFollowUpQueue();
  }

  private processFollowUpQueue(): void {
    const now = Date.now();
    const toNotify = this.followUpQueue.filter((item) => now >= item.time);

    for (const item of toNotify) {
      this.notify({
        type: 'follow_up',
        title: 'Follow Up',
        message: `Earlier you mentioned: "${item.query.slice(0, 50)}..." How did it go?`,
        priority: 'low',
        source: 'follow_up',
        actions: [
          { type: 'view', label: 'It worked!' },
          { type: 'learn_more', label: 'Need help' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      });
    }

    // Remove processed items
    this.followUpQueue = this.followUpQueue.filter((item) => now < item.time);
  }

  private generatePatternSuggestions(): void {
    const frequentPatterns = Array.from(this.patterns.entries())
      .filter(([_, p]) => p.frequency >= 3 && !p.suggestionGenerated)
      .sort((a, b) => b[1].frequency - a[1].frequency)
      .slice(0, 3);

    for (const [key, pattern] of frequentPatterns) {
      const suggestion: Suggestion = {
        id: this.generateId(),
        text: this.generateSuggestionText(pattern),
        reason: `You've asked about "${pattern.pattern}" ${pattern.frequency} times`,
        confidence: Math.min(0.9, 0.6 + pattern.frequency * 0.05),
        category: pattern.type,
        actions: ['view', 'dismiss'],
      };

      this.notifySuggestion(suggestion);
      pattern.suggestionGenerated = true;
      this.patterns.set(key, pattern);
    }
  }

  private generateSuggestionText(pattern: UserPattern): string {
    switch (pattern.type) {
      case 'how_to':
        return `I notice you often ask about how to ${pattern.pattern}. Would you like me to prepare a guide?`;
      case 'definition':
        return `You've been curious about ${pattern.pattern}. Want me to compile a comprehensive overview?`;
      case 'timing':
        return `You often ask about when to ${pattern.pattern}. I can help create a schedule or reminders.`;
      case 'explanation':
        return `You seem interested in understanding why ${pattern.pattern}. Want me to research this topic?`;
      default:
        return `I've noticed you're interested in ${pattern.pattern}. Would you like more information?`;
    }
  }

  private generateId(): string {
    return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Singleton instance
let notificationsManager: SmartNotificationsManager | null = null;

/**
 * Get or create the smart notifications manager
 */
export function getSmartNotificationsManager(): SmartNotificationsManager {
  if (!notificationsManager) {
    notificationsManager = new SmartNotificationsManager();
  }
  return notificationsManager;
}

/**
 * Shutdown the smart notifications manager
 */
export function shutdownSmartNotificationsManager(): void {
  if (notificationsManager) {
    notificationsManager.clear();
    notificationsManager = null;
  }
}

export default SmartNotificationsManager;
