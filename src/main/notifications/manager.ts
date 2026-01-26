/**
 * Atlas Desktop - Notification Manager
 * Main process notification handling with system tray integration
 */

import { Notification as ElectronNotification, BrowserWindow, nativeImage } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationSettings,
  CreateNotificationOptions,
} from '../../shared/types/notification';
import { DEFAULT_NOTIFICATION_SETTINGS, getDefaultTimeout } from '../../shared/types/notification';

const logger = createModuleLogger('NotificationManager');

/**
 * Notification event types
 */
export interface NotificationManagerEvents {
  'notification-created': (notification: Notification) => void;
  'notification-clicked': (notification: Notification) => void;
  'notification-closed': (notification: Notification) => void;
  'notification-action': (notification: Notification, actionId: string) => void;
  'settings-changed': (settings: Partial<NotificationSettings>) => void;
}

/**
 * Generate unique notification ID
 */
function generateId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate action ID
 */
function generateActionId(): string {
  return `action-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Notification Manager for main process
 * Handles system tray notifications and IPC communication
 */
export class NotificationManager extends EventEmitter {
  private settings: NotificationSettings;
  private mainWindow: BrowserWindow | null = null;
  private notificationHistory: Notification[] = [];
  private activeSystemNotifications: Map<string, ElectronNotification> = new Map();

  constructor(settings: Partial<NotificationSettings> = {}) {
    super();
    this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...settings };
  }

  /**
   * Initialize the notification manager
   */
  async initialize(mainWindow?: BrowserWindow): Promise<void> {
    this.mainWindow = mainWindow || null;
    logger.info('Notification manager initialized');
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Create and display a notification
   */
  notify(options: CreateNotificationOptions): string {
    // Check do not disturb mode
    if (this.settings.doNotDisturb && options.priority !== 'urgent') {
      logger.debug('Notification blocked by DND mode', { title: options.title });
      return '';
    }

    const id = generateId();
    const timeout = options.timeout ?? getDefaultTimeout(options.type, this.settings);

    // Process actions
    const actions = options.actions?.map((action) => ({
      ...action,
      id: generateActionId(),
    }));

    const notification: Notification = {
      id,
      type: options.type,
      title: options.title,
      message: options.message,
      priority: options.priority ?? 'normal',
      timestamp: Date.now(),
      timeout,
      read: false,
      dismissible: options.dismissible ?? true,
      actions,
      source: options.source,
      icon: options.icon,
      showSystemNotification: options.showSystemNotification ?? false,
      playSound: options.playSound ?? (options.type === 'error' || options.type === 'warning'),
      metadata: options.metadata,
    };

    // Add to history
    this.notificationHistory.unshift(notification);
    if (this.notificationHistory.length > this.settings.maxHistorySize) {
      this.notificationHistory = this.notificationHistory.slice(0, this.settings.maxHistorySize);
    }

    // Send to renderer
    this.sendToRenderer('notification:created', notification);

    // Show system notification if requested
    if (notification.showSystemNotification && this.settings.systemNotificationsEnabled) {
      this.showSystemNotification(notification);
    }

    // Emit event
    this.emit('notification-created', notification);

    logger.debug('Notification created', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
    });

    return id;
  }

  /**
   * Show a system tray notification (native OS notification)
   */
  private showSystemNotification(notification: Notification): void {
    try {
      // Check if notifications are supported
      if (!ElectronNotification.isSupported()) {
        logger.warn('System notifications not supported on this platform');
        return;
      }

      // Create notification icon based on type
      const icon = this.createNotificationIcon(notification.type);

      // Create the system notification
      const systemNotification = new ElectronNotification({
        title: notification.title,
        body: notification.message || '',
        icon,
        silent: !notification.playSound,
        urgency: this.mapPriorityToUrgency(notification.priority),
        timeoutType: notification.timeout > 0 ? 'default' : 'never',
        actions: notification.actions?.map((action) => ({
          type: 'button' as const,
          text: action.label,
        })),
      });

      // Handle click
      systemNotification.on('click', () => {
        logger.debug('System notification clicked', { id: notification.id });
        this.emit('notification-clicked', notification);

        // Focus the main window
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.focus();
        }

        // Send click event to renderer
        this.sendToRenderer('notification:clicked', { id: notification.id });
      });

      // Handle close
      systemNotification.on('close', () => {
        logger.debug('System notification closed', { id: notification.id });
        this.activeSystemNotifications.delete(notification.id);
        this.emit('notification-closed', notification);
      });

      // Handle action buttons (Windows/macOS)
      systemNotification.on('action', (_event, index) => {
        const action = notification.actions?.[index];
        if (action) {
          logger.debug('System notification action triggered', {
            id: notification.id,
            actionId: action.id,
          });
          this.emit('notification-action', notification, action.id);
          this.sendToRenderer('notification:action', {
            notificationId: notification.id,
            actionId: action.id,
          });
        }
      });

      // Show the notification
      systemNotification.show();
      this.activeSystemNotifications.set(notification.id, systemNotification);

      logger.debug('System notification shown', { id: notification.id });
    } catch (error) {
      logger.error('Failed to show system notification', {
        error: (error as Error).message,
        id: notification.id,
      });
    }
  }

  /**
   * Create notification icon based on type
   */
  private createNotificationIcon(type: NotificationType): Electron.NativeImage | undefined {
    const size = 32;
    const colors: Record<NotificationType, string> = {
      info: '#3b82f6',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    };

    const color = colors[type];
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}" />
        ${this.getIconPath(type, size)}
      </svg>
    `;

    try {
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      return nativeImage.createFromDataURL(dataUrl);
    } catch (error) {
      logger.warn('Failed to create notification icon', { error: (error as Error).message });
      return undefined;
    }
  }

  /**
   * Get SVG path for notification type icon
   */
  private getIconPath(type: NotificationType, size: number): string {
    const center = size / 2;

    switch (type) {
      case 'success':
        // Checkmark
        return `<path d="M${center - 6} ${center} L${center - 2} ${center + 4} L${center + 6} ${center - 4}" stroke="white" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;

      case 'warning':
        // Exclamation mark
        return `
          <line x1="${center}" y1="${center - 6}" x2="${center}" y2="${center + 1}" stroke="white" stroke-width="3" stroke-linecap="round" />
          <circle cx="${center}" cy="${center + 6}" r="1.5" fill="white" />
        `;

      case 'error':
        // X mark
        return `
          <line x1="${center - 5}" y1="${center - 5}" x2="${center + 5}" y2="${center + 5}" stroke="white" stroke-width="3" stroke-linecap="round" />
          <line x1="${center + 5}" y1="${center - 5}" x2="${center - 5}" y2="${center + 5}" stroke="white" stroke-width="3" stroke-linecap="round" />
        `;

      case 'info':
      default:
        // Info "i"
        return `
          <circle cx="${center}" cy="${center - 5}" r="1.5" fill="white" />
          <line x1="${center}" y1="${center - 1}" x2="${center}" y2="${center + 6}" stroke="white" stroke-width="3" stroke-linecap="round" />
        `;
    }
  }

  /**
   * Map notification priority to system urgency
   */
  private mapPriorityToUrgency(priority: NotificationPriority): 'normal' | 'critical' | 'low' {
    switch (priority) {
      case 'urgent':
        return 'critical';
      case 'high':
        return 'critical';
      case 'low':
        return 'low';
      case 'normal':
      default:
        return 'normal';
    }
  }

  /**
   * Close a system notification
   */
  closeSystemNotification(id: string): void {
    const systemNotification = this.activeSystemNotifications.get(id);
    if (systemNotification) {
      systemNotification.close();
      this.activeSystemNotifications.delete(id);
    }
  }

  /**
   * Close all system notifications
   */
  closeAllSystemNotifications(): void {
    this.activeSystemNotifications.forEach((notification) => {
      notification.close();
    });
    this.activeSystemNotifications.clear();
  }

  /**
   * Send event to renderer
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Update notification settings
   */
  updateSettings(newSettings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.emit('settings-changed', newSettings);
    this.sendToRenderer('notification:settings-changed', newSettings);
    logger.info('Notification settings updated', newSettings);
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  /**
   * Get notification history
   */
  getHistory(): Notification[] {
    return [...this.notificationHistory];
  }

  /**
   * Clear notification history
   */
  clearHistory(): void {
    this.notificationHistory = [];
    this.sendToRenderer('notification:history-cleared', {});
    logger.info('Notification history cleared');
  }

  /**
   * Get notification by ID
   */
  getNotificationById(id: string): Notification | undefined {
    return this.notificationHistory.find((n) => n.id === id);
  }

  // =========================================================================
  // Convenience methods for common notification types
  // =========================================================================

  /**
   * Show info notification
   */
  info(title: string, message?: string, options?: Partial<CreateNotificationOptions>): string {
    return this.notify({ type: 'info', title, message, ...options });
  }

  /**
   * Show success notification
   */
  success(title: string, message?: string, options?: Partial<CreateNotificationOptions>): string {
    return this.notify({ type: 'success', title, message, ...options });
  }

  /**
   * Show warning notification
   */
  warning(title: string, message?: string, options?: Partial<CreateNotificationOptions>): string {
    return this.notify({ type: 'warning', title, message, ...options });
  }

  /**
   * Show error notification
   */
  error(title: string, message?: string, options?: Partial<CreateNotificationOptions>): string {
    return this.notify({
      type: 'error',
      title,
      message,
      showSystemNotification: true, // Errors always show system notification
      ...options,
    });
  }

  // =========================================================================
  // Atlas-specific notification helpers
  // =========================================================================

  /**
   * Notify voice recognition event
   */
  notifyVoiceRecognized(transcript: string): string {
    return this.info('Voice Recognized', transcript, {
      source: 'voice-pipeline',
      timeout: 3000,
      icon: 'microphone',
    });
  }

  /**
   * Notify task completion
   */
  notifyTaskComplete(taskName: string, details?: string): string {
    return this.success('Task Complete', details || taskName, {
      source: 'agent',
      showSystemNotification: true,
      actions: [{ label: 'View Details', primary: true }],
    });
  }

  /**
   * Notify connection status change
   */
  notifyConnectionStatus(isOnline: boolean, service?: string): string {
    if (isOnline) {
      return this.success(
        'Connection Restored',
        service ? `${service} is now available` : 'Back online',
        {
          source: 'connectivity',
          timeout: 4000,
        }
      );
    } else {
      return this.warning(
        'Connection Lost',
        service ? `${service} is unavailable` : 'You are offline',
        {
          source: 'connectivity',
          showSystemNotification: true,
          priority: 'high',
        }
      );
    }
  }

  /**
   * Notify budget warning
   */
  notifyBudgetWarning(percentUsed: number, remaining: number): string {
    return this.warning(
      'Budget Warning',
      `You've used ${percentUsed.toFixed(0)}% of your daily budget. $${remaining.toFixed(2)} remaining.`,
      {
        source: 'budget',
        showSystemNotification: true,
        priority: 'high',
        actions: [{ label: 'View Usage', primary: true }],
      }
    );
  }

  /**
   * Notify budget exceeded
   */
  notifyBudgetExceeded(): string {
    return this.error(
      'Budget Exceeded',
      'Daily budget limit reached. Increase your budget or wait until tomorrow.',
      {
        source: 'budget',
        showSystemNotification: true,
        priority: 'urgent',
        actions: [{ label: 'Increase Budget', primary: true }, { label: 'Dismiss' }],
      }
    );
  }

  /**
   * Destroy the notification manager
   */
  async destroy(): Promise<void> {
    this.closeAllSystemNotifications();
    this.notificationHistory = [];
    this.mainWindow = null;
    this.removeAllListeners();
    logger.info('Notification manager destroyed');
  }
}

// Singleton instance
let notificationManagerInstance: NotificationManager | null = null;

/**
 * Get or create the notification manager singleton
 */
export function getNotificationManager(
  settings?: Partial<NotificationSettings>
): NotificationManager {
  if (!notificationManagerInstance) {
    notificationManagerInstance = new NotificationManager(settings);
  }
  return notificationManagerInstance;
}

/**
 * Initialize the notification manager with a main window
 */
export async function initializeNotificationManager(
  mainWindow?: BrowserWindow,
  settings?: Partial<NotificationSettings>
): Promise<NotificationManager> {
  const manager = getNotificationManager(settings);
  await manager.initialize(mainWindow);
  return manager;
}

/**
 * Shutdown the notification manager
 */
export async function shutdownNotificationManager(): Promise<void> {
  if (notificationManagerInstance) {
    await notificationManagerInstance.destroy();
    notificationManagerInstance = null;
  }
}

export default NotificationManager;
