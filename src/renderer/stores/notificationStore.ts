/**
 * Atlas Desktop - Notification Store
 * Zustand store for notification state management in renderer process
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Notification,
  NotificationType,
  NotificationAction,
  NotificationSettings,
  CreateNotificationOptions,
} from '../../shared/types/notification';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getDefaultTimeout,
  getPriorityValue,
} from '../../shared/types/notification';

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
 * Notification store state
 */
interface NotificationStore {
  // State
  notifications: Notification[];
  settings: NotificationSettings;
  isHistoryOpen: boolean;
  unreadCount: number;

  // Actions - Notifications
  addNotification: (options: CreateNotificationOptions) => string;
  dismissNotification: (id: string) => void;
  dismissAllNotifications: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearHistory: () => void;
  triggerAction: (notificationId: string, actionId: string) => void;

  // Actions - Settings
  updateSettings: (settings: Partial<NotificationSettings>) => void;
  toggleDoNotDisturb: () => void;

  // Actions - UI
  toggleHistory: () => void;
  setHistoryOpen: (open: boolean) => void;

  // Selectors
  getVisibleToasts: () => Notification[];
  getNotificationById: (id: string) => Notification | undefined;

  // Helpers
  info: (title: string, message?: string, options?: Partial<CreateNotificationOptions>) => string;
  success: (title: string, message?: string, options?: Partial<CreateNotificationOptions>) => string;
  warning: (title: string, message?: string, options?: Partial<CreateNotificationOptions>) => string;
  error: (title: string, message?: string, options?: Partial<CreateNotificationOptions>) => string;
}

/**
 * Auto-dismiss timers storage
 */
const dismissTimers = new Map<string, NodeJS.Timeout>();

/**
 * Action handlers registry
 */
type ActionHandler = (notification: Notification, actionId: string) => void;
const actionHandlers = new Map<string, ActionHandler>();

/**
 * Register an action handler for notifications
 */
export function registerActionHandler(handlerId: string, handler: ActionHandler): () => void {
  actionHandlers.set(handlerId, handler);
  return () => actionHandlers.delete(handlerId);
}

/**
 * Notification store
 */
export const useNotificationStore = create<NotificationStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    notifications: [],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS },
    isHistoryOpen: false,
    unreadCount: 0,

    // Add a notification
    addNotification: (options: CreateNotificationOptions): string => {
      const { settings, notifications } = get();

      // Don't add notifications in do-not-disturb mode (except urgent)
      if (settings.doNotDisturb && options.priority !== 'urgent') {
        return '';
      }

      const id = generateId();
      const timeout = options.timeout ?? getDefaultTimeout(options.type, settings);

      // Process actions to add IDs
      const actions: NotificationAction[] | undefined = options.actions?.map((action) => ({
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

      // Add notification, maintaining history limit
      const updatedNotifications = [notification, ...notifications].slice(
        0,
        settings.maxHistorySize
      );

      set({
        notifications: updatedNotifications,
        unreadCount: get().unreadCount + 1,
      });

      // Set up auto-dismiss timer if timeout > 0
      if (timeout > 0) {
        const timer = setTimeout(() => {
          get().dismissNotification(id);
        }, timeout);
        dismissTimers.set(id, timer);
      }

      // Play sound if enabled
      if (notification.playSound && settings.soundEnabled) {
        playNotificationSound(notification.type);
      }

      // Show system notification if enabled
      if (notification.showSystemNotification && settings.systemNotificationsEnabled) {
        showSystemNotification(notification);
      }

      return id;
    },

    // Dismiss a notification
    dismissNotification: (id: string): void => {
      // Clear any auto-dismiss timer
      const timer = dismissTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        dismissTimers.delete(id);
      }

      set((state) => {
        const notification = state.notifications.find((n) => n.id === id);
        const wasUnread = notification && !notification.read;

        return {
          notifications: state.notifications.filter((n) => n.id !== id),
          unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
        };
      });
    },

    // Dismiss all notifications
    dismissAllNotifications: (): void => {
      // Clear all timers
      dismissTimers.forEach((timer) => clearTimeout(timer));
      dismissTimers.clear();

      set({ notifications: [], unreadCount: 0 });
    },

    // Mark notification as read
    markAsRead: (id: string): void => {
      set((state) => {
        const notification = state.notifications.find((n) => n.id === id);
        if (!notification || notification.read) {
          return state;
        }

        return {
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        };
      });
    },

    // Mark all notifications as read
    markAllAsRead: (): void => {
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      }));
    },

    // Clear notification history (keep unread)
    clearHistory: (): void => {
      // Clear timers for dismissed notifications
      const { notifications } = get();
      notifications.forEach((n) => {
        if (n.read) {
          const timer = dismissTimers.get(n.id);
          if (timer) {
            clearTimeout(timer);
            dismissTimers.delete(n.id);
          }
        }
      });

      set((state) => ({
        notifications: state.notifications.filter((n) => !n.read),
      }));
    },

    // Trigger a notification action
    triggerAction: (notificationId: string, actionId: string): void => {
      const notification = get().notifications.find((n) => n.id === notificationId);
      if (!notification) return;

      const action = notification.actions?.find((a) => a.id === actionId);
      if (!action) return;

      // Call all registered action handlers
      actionHandlers.forEach((handler) => {
        try {
          handler(notification, actionId);
        } catch (error) {
          console.error('[NotificationStore] Action handler error:', error);
        }
      });

      // Dismiss if action requires it
      if (action.dismissOnClick !== false) {
        get().dismissNotification(notificationId);
      }
    },

    // Update settings
    updateSettings: (newSettings: Partial<NotificationSettings>): void => {
      set((state) => ({
        settings: { ...state.settings, ...newSettings },
      }));

      // Persist settings
      try {
        const currentSettings = get().settings;
        localStorage.setItem('atlas-notification-settings', JSON.stringify(currentSettings));
      } catch (e) {
        console.warn('[NotificationStore] Failed to persist settings:', e);
      }
    },

    // Toggle do not disturb
    toggleDoNotDisturb: (): void => {
      set((state) => ({
        settings: { ...state.settings, doNotDisturb: !state.settings.doNotDisturb },
      }));
    },

    // Toggle history panel
    toggleHistory: (): void => {
      set((state) => ({ isHistoryOpen: !state.isHistoryOpen }));
    },

    // Set history panel open state
    setHistoryOpen: (open: boolean): void => {
      set({ isHistoryOpen: open });
    },

    // Get visible toasts (sorted by priority and time)
    getVisibleToasts: (): Notification[] => {
      const { notifications, settings } = get();

      return notifications
        .filter((n) => !n.read || Date.now() - n.timestamp < 10000) // Show unread or recent
        .sort((a, b) => {
          // Sort by priority first, then by timestamp
          const priorityDiff = getPriorityValue(b.priority) - getPriorityValue(a.priority);
          if (priorityDiff !== 0) return priorityDiff;
          return b.timestamp - a.timestamp;
        })
        .slice(0, settings.maxVisibleToasts);
    },

    // Get notification by ID
    getNotificationById: (id: string): Notification | undefined => {
      return get().notifications.find((n) => n.id === id);
    },

    // Helper: Create info notification
    info: (
      title: string,
      message?: string,
      options?: Partial<CreateNotificationOptions>
    ): string => {
      return get().addNotification({ type: 'info', title, message, ...options });
    },

    // Helper: Create success notification
    success: (
      title: string,
      message?: string,
      options?: Partial<CreateNotificationOptions>
    ): string => {
      return get().addNotification({ type: 'success', title, message, ...options });
    },

    // Helper: Create warning notification
    warning: (
      title: string,
      message?: string,
      options?: Partial<CreateNotificationOptions>
    ): string => {
      return get().addNotification({ type: 'warning', title, message, ...options });
    },

    // Helper: Create error notification
    error: (
      title: string,
      message?: string,
      options?: Partial<CreateNotificationOptions>
    ): string => {
      return get().addNotification({ type: 'error', title, message, ...options });
    },
  }))
);

// Load settings from localStorage on initialization
if (typeof window !== 'undefined') {
  try {
    const savedSettings = localStorage.getItem('atlas-notification-settings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings) as Partial<NotificationSettings>;
      useNotificationStore.getState().updateSettings(parsed);
    }
  } catch (e) {
    console.warn('[NotificationStore] Failed to load saved settings:', e);
  }
}

/**
 * Play notification sound
 */
function playNotificationSound(type: NotificationType): void {
  try {
    // Use Web Audio API for notification sounds
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configure sound based on type
    switch (type) {
      case 'success':
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        break;
      case 'warning':
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        break;
      case 'error':
        oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(180, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
        break;
      case 'info':
      default:
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
        break;
    }
  } catch (e) {
    console.warn('[NotificationStore] Failed to play notification sound:', e);
  }
}

/**
 * Show system notification via Electron API
 */
function showSystemNotification(notification: Notification): void {
  if (typeof window !== 'undefined' && window.atlas) {
    // Send to main process for system tray notification
    window.atlas.send('notification:show-system', {
      title: notification.title,
      body: notification.message,
      type: notification.type,
    });
  }
}

// Selectors for optimized re-renders
export const selectNotifications = (state: NotificationStore) => state.notifications;
export const selectSettings = (state: NotificationStore) => state.settings;
export const selectIsHistoryOpen = (state: NotificationStore) => state.isHistoryOpen;
export const selectUnreadCount = (state: NotificationStore) => state.unreadCount;
export const selectDoNotDisturb = (state: NotificationStore) => state.settings.doNotDisturb;

export default useNotificationStore;
