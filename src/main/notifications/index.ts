/**
 * Atlas Desktop - Notifications Module
 * Exports notification system components
 */

export {
  NotificationManager,
  getNotificationManager,
  initializeNotificationManager,
  shutdownNotificationManager,
} from './manager';

export {
  registerNotificationIPCHandlers,
  unregisterNotificationIPCHandlers,
} from './ipc-handlers';
