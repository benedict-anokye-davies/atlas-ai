/**
 * Atlas Desktop - Notification Types
 * Type definitions for the notification system
 */

/**
 * Notification types for visual styling and priority
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification action button
 */
export interface NotificationAction {
  /** Unique action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Whether this is the primary action */
  primary?: boolean;
  /** Whether clicking dismisses the notification */
  dismissOnClick?: boolean;
}

/**
 * Notification data structure
 */
export interface Notification {
  /** Unique notification identifier */
  id: string;
  /** Notification type for styling */
  type: NotificationType;
  /** Title/heading */
  title: string;
  /** Detailed message body */
  message?: string;
  /** Priority level */
  priority: NotificationPriority;
  /** Creation timestamp */
  timestamp: number;
  /** Auto-dismiss timeout in ms (0 = never) */
  timeout: number;
  /** Whether notification has been read */
  read: boolean;
  /** Whether notification is dismissible */
  dismissible: boolean;
  /** Optional action buttons */
  actions?: NotificationAction[];
  /** Source component/module */
  source?: string;
  /** Optional icon name */
  icon?: string;
  /** Whether to show system tray notification */
  showSystemNotification?: boolean;
  /** Whether to play sound */
  playSound?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for creating a notification
 */
export interface CreateNotificationOptions {
  /** Notification type */
  type: NotificationType;
  /** Title/heading */
  title: string;
  /** Detailed message body */
  message?: string;
  /** Priority level (default: 'normal') */
  priority?: NotificationPriority;
  /** Auto-dismiss timeout in ms (default: 5000, 0 = never) */
  timeout?: number;
  /** Whether notification is dismissible (default: true) */
  dismissible?: boolean;
  /** Optional action buttons */
  actions?: Omit<NotificationAction, 'id'>[];
  /** Source component/module */
  source?: string;
  /** Optional icon name */
  icon?: string;
  /** Whether to show system tray notification (default: false) */
  showSystemNotification?: boolean;
  /** Whether to play sound (default: based on type) */
  playSound?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Notification settings configuration
 */
export interface NotificationSettings {
  /** Maximum number of visible toasts */
  maxVisibleToasts: number;
  /** Maximum notifications in history */
  maxHistorySize: number;
  /** Default timeout for info notifications */
  defaultInfoTimeout: number;
  /** Default timeout for success notifications */
  defaultSuccessTimeout: number;
  /** Default timeout for warning notifications */
  defaultWarningTimeout: number;
  /** Default timeout for error notifications */
  defaultErrorTimeout: number;
  /** Enable sound effects */
  soundEnabled: boolean;
  /** Enable system tray notifications */
  systemNotificationsEnabled: boolean;
  /** Position of toast notifications */
  toastPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  /** Do not disturb mode */
  doNotDisturb: boolean;
}

/**
 * Default notification settings
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  maxVisibleToasts: 5,
  maxHistorySize: 100,
  defaultInfoTimeout: 5000,
  defaultSuccessTimeout: 4000,
  defaultWarningTimeout: 7000,
  defaultErrorTimeout: 0, // Errors persist until dismissed
  soundEnabled: true,
  systemNotificationsEnabled: true,
  toastPosition: 'top-right',
  doNotDisturb: false,
};

/**
 * Notification event types for IPC
 */
export interface NotificationEvents {
  'notification:created': Notification;
  'notification:dismissed': string;
  'notification:action': { notificationId: string; actionId: string };
  'notification:cleared-all': void;
  'notification:settings-changed': Partial<NotificationSettings>;
}

/**
 * Sound effect types for notifications
 */
export type NotificationSound = 'info' | 'success' | 'warning' | 'error' | 'none';

/**
 * Get default timeout based on notification type
 */
export function getDefaultTimeout(
  type: NotificationType,
  settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): number {
  switch (type) {
    case 'info':
      return settings.defaultInfoTimeout;
    case 'success':
      return settings.defaultSuccessTimeout;
    case 'warning':
      return settings.defaultWarningTimeout;
    case 'error':
      return settings.defaultErrorTimeout;
    default:
      return settings.defaultInfoTimeout;
  }
}

/**
 * Get priority value for sorting
 */
export function getPriorityValue(priority: NotificationPriority): number {
  switch (priority) {
    case 'urgent':
      return 4;
    case 'high':
      return 3;
    case 'normal':
      return 2;
    case 'low':
      return 1;
    default:
      return 2;
  }
}
