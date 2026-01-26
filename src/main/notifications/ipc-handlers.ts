/**
 * Atlas Desktop - Notification IPC Handlers
 * IPC handlers for notification system
 */

import { ipcMain } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getNotificationManager } from './manager';
import type {
  CreateNotificationOptions,
  NotificationSettings,
} from '../../shared/types/notification';

const logger = createModuleLogger('NotificationIPC');

/**
 * Validate notification options
 */
function validateNotificationOptions(options: unknown): {
  valid: boolean;
  sanitized?: CreateNotificationOptions;
  error?: string;
} {
  if (!options || typeof options !== 'object') {
    return { valid: false, error: 'Options must be an object' };
  }

  const opts = options as Record<string, unknown>;

  // Validate required fields
  if (!opts.type || typeof opts.type !== 'string') {
    return { valid: false, error: 'Type is required and must be a string' };
  }

  if (!['info', 'success', 'warning', 'error'].includes(opts.type)) {
    return { valid: false, error: 'Type must be info, success, warning, or error' };
  }

  if (!opts.title || typeof opts.title !== 'string') {
    return { valid: false, error: 'Title is required and must be a string' };
  }

  // Sanitize and validate optional fields
  const sanitized: CreateNotificationOptions = {
    type: opts.type as CreateNotificationOptions['type'],
    title: opts.title.substring(0, 200), // Limit title length
    message: typeof opts.message === 'string' ? opts.message.substring(0, 1000) : undefined,
    priority: ['low', 'normal', 'high', 'urgent'].includes(opts.priority as string)
      ? (opts.priority as CreateNotificationOptions['priority'])
      : undefined,
    timeout:
      typeof opts.timeout === 'number' ? Math.max(0, Math.min(opts.timeout, 60000)) : undefined,
    dismissible: typeof opts.dismissible === 'boolean' ? opts.dismissible : undefined,
    source: typeof opts.source === 'string' ? opts.source.substring(0, 50) : undefined,
    icon: typeof opts.icon === 'string' ? opts.icon.substring(0, 50) : undefined,
    showSystemNotification:
      typeof opts.showSystemNotification === 'boolean' ? opts.showSystemNotification : undefined,
    playSound: typeof opts.playSound === 'boolean' ? opts.playSound : undefined,
  };

  // Validate actions if provided
  if (opts.actions && Array.isArray(opts.actions)) {
    sanitized.actions = opts.actions
      .slice(0, 5) // Max 5 actions
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .map((action) => ({
        label: typeof action.label === 'string' ? action.label.substring(0, 30) : 'Action',
        primary: typeof action.primary === 'boolean' ? action.primary : undefined,
        dismissOnClick:
          typeof action.dismissOnClick === 'boolean' ? action.dismissOnClick : undefined,
      }));
  }

  return { valid: true, sanitized };
}

/**
 * Result type for IPC handlers
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Register notification IPC handlers
 */
export function registerNotificationIPCHandlers(): void {
  logger.info('Registering notification IPC handlers...');

  // Create notification
  ipcMain.handle(
    'notification:create',
    async (_event, options: unknown): Promise<IPCResult<string>> => {
      try {
        const validation = validateNotificationOptions(options);
        if (!validation.valid || !validation.sanitized) {
          return { success: false, error: validation.error };
        }

        const manager = getNotificationManager();
        const id = manager.notify(validation.sanitized);
        return { success: true, data: id };
      } catch (error) {
        logger.error('Failed to create notification', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Dismiss notification
  ipcMain.handle('notification:dismiss', async (_event, id: unknown): Promise<IPCResult> => {
    if (typeof id !== 'string') {
      return { success: false, error: 'ID must be a string' };
    }

    try {
      const manager = getNotificationManager();
      manager.closeSystemNotification(id);
      return { success: true };
    } catch (error) {
      logger.error('Failed to dismiss notification', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Dismiss all notifications
  ipcMain.handle('notification:dismiss-all', async (): Promise<IPCResult> => {
    try {
      const manager = getNotificationManager();
      manager.closeAllSystemNotifications();
      return { success: true };
    } catch (error) {
      logger.error('Failed to dismiss all notifications', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get notification history
  ipcMain.handle('notification:get-history', (): IPCResult => {
    try {
      const manager = getNotificationManager();
      const history = manager.getHistory();
      return { success: true, data: history };
    } catch (error) {
      logger.error('Failed to get notification history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Clear notification history
  ipcMain.handle('notification:clear-history', async (): Promise<IPCResult> => {
    try {
      const manager = getNotificationManager();
      manager.clearHistory();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear notification history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get notification settings
  ipcMain.handle('notification:get-settings', (): IPCResult<NotificationSettings> => {
    try {
      const manager = getNotificationManager();
      const settings = manager.getSettings();
      return { success: true, data: settings };
    } catch (error) {
      logger.error('Failed to get notification settings', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Update notification settings
  ipcMain.handle(
    'notification:update-settings',
    async (_event, settings: unknown): Promise<IPCResult> => {
      if (!settings || typeof settings !== 'object') {
        return { success: false, error: 'Settings must be an object' };
      }

      try {
        const manager = getNotificationManager();
        manager.updateSettings(settings as Partial<NotificationSettings>);
        return { success: true };
      } catch (error) {
        logger.error('Failed to update notification settings', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Quick notification helpers
  ipcMain.handle(
    'notification:info',
    async (_event, title: string, message?: string): Promise<IPCResult<string>> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }

      try {
        const manager = getNotificationManager();
        const id = manager.info(title, message);
        return { success: true, data: id };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'notification:success',
    async (_event, title: string, message?: string): Promise<IPCResult<string>> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }

      try {
        const manager = getNotificationManager();
        const id = manager.success(title, message);
        return { success: true, data: id };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'notification:warning',
    async (_event, title: string, message?: string): Promise<IPCResult<string>> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }

      try {
        const manager = getNotificationManager();
        const id = manager.warning(title, message);
        return { success: true, data: id };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'notification:error',
    async (_event, title: string, message?: string): Promise<IPCResult<string>> => {
      if (typeof title !== 'string') {
        return { success: false, error: 'Title must be a string' };
      }

      try {
        const manager = getNotificationManager();
        const id = manager.error(title, message);
        return { success: true, data: id };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Handle show system notification from renderer
  ipcMain.on('notification:show-system', (_event, data: unknown) => {
    if (!data || typeof data !== 'object') return;

    const { title, body, type } = data as { title?: string; body?: string; type?: string };
    if (typeof title !== 'string') return;

    try {
      const manager = getNotificationManager();
      manager.notify({
        type: (type as 'info' | 'success' | 'warning' | 'error') || 'info',
        title,
        message: body,
        showSystemNotification: true,
      });
    } catch (error) {
      logger.error('Failed to show system notification', { error: (error as Error).message });
    }
  });

  logger.info('Notification IPC handlers registered');
}

/**
 * Unregister notification IPC handlers
 */
export function unregisterNotificationIPCHandlers(): void {
  const channels = [
    'notification:create',
    'notification:dismiss',
    'notification:dismiss-all',
    'notification:get-history',
    'notification:clear-history',
    'notification:get-settings',
    'notification:update-settings',
    'notification:info',
    'notification:success',
    'notification:warning',
    'notification:error',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.removeAllListeners('notification:show-system');

  logger.info('Notification IPC handlers unregistered');
}

export default {
  registerNotificationIPCHandlers,
  unregisterNotificationIPCHandlers,
};
