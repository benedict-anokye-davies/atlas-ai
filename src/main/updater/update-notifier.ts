/**
 * Atlas Desktop - Update Notifier
 * Handles notifications for the auto-update system
 *
 * Features:
 * - System notifications for update events
 * - Progress notifications during download
 * - Release notes display
 * - User-friendly error messages
 */

import { Notification, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { UpdateInfo, UpdateProgress, UpdateError, RollbackInfo } from '../../shared/types/updater';

const logger = createModuleLogger('UpdateNotifier');

/**
 * Singleton instance
 */
let notifierInstance: UpdateNotifier | null = null;

/**
 * Update Notifier class
 * Manages all update-related notifications
 */
export class UpdateNotifier {
  private mainWindow: BrowserWindow | null = null;
  private currentNotification: Notification | null = null;
  private supportsNotifications: boolean;

  constructor() {
    this.supportsNotifications = Notification.isSupported();
    if (!this.supportsNotifications) {
      logger.warn('System notifications are not supported on this platform');
    }
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Show notification that update is available
   */
  showUpdateAvailable(updateInfo: UpdateInfo): void {
    const releaseNotes = this.formatReleaseNotes(updateInfo.releaseNotes);

    this.showNotification({
      title: 'Update Available',
      body: `Atlas ${updateInfo.version} is available.\n${releaseNotes.substring(0, 100)}${releaseNotes.length > 100 ? '...' : ''}`,
      actions: [
        { type: 'button', text: 'Download Now' },
        { type: 'button', text: 'Later' },
      ],
      onClick: () => {
        this.focusMainWindow();
        this.sendToRenderer('atlas:update-action', { action: 'show-details' });
      },
    });

    logger.info('Update available notification shown', { version: updateInfo.version });
  }

  /**
   * Update download progress notification
   */
  updateDownloadProgress(progress: UpdateProgress): void {
    // On Windows, we can update the taskbar progress
    if (this.mainWindow && process.platform === 'win32') {
      this.mainWindow.setProgressBar(progress.percent / 100);
    }

    // Only show notification at certain milestones to avoid spam
    if (progress.percent === 25 || progress.percent === 50 || progress.percent === 75) {
      this.showNotification({
        title: 'Downloading Update',
        body: `Download progress: ${Math.round(progress.percent)}%\nSpeed: ${this.formatBytes(progress.bytesPerSecond)}/s`,
        silent: true,
        timeoutType: 'default',
      });
    }
  }

  /**
   * Show notification that update is ready to install
   */
  showUpdateReady(updateInfo: UpdateInfo): void {
    // Clear taskbar progress
    if (this.mainWindow && process.platform === 'win32') {
      this.mainWindow.setProgressBar(-1);
    }

    const releaseNotes = this.formatReleaseNotes(updateInfo.releaseNotes);

    this.showNotification({
      title: 'Update Ready to Install',
      body: `Atlas ${updateInfo.version} has been downloaded and is ready to install.\n\n${releaseNotes.substring(0, 150)}${releaseNotes.length > 150 ? '...' : ''}`,
      urgency: 'normal',
      actions: [
        { type: 'button', text: 'Restart Now' },
        { type: 'button', text: 'Later' },
      ],
      onClick: () => {
        this.focusMainWindow();
        this.sendToRenderer('atlas:update-action', { action: 'show-install-dialog' });
      },
    });

    logger.info('Update ready notification shown', { version: updateInfo.version });
  }

  /**
   * Show notification that update is scheduled for next restart
   */
  showUpdateScheduled(updateInfo: UpdateInfo): void {
    this.showNotification({
      title: 'Update Scheduled',
      body: `Atlas ${updateInfo.version} will be installed when you restart the app.`,
      timeoutType: 'default',
    });

    logger.info('Update scheduled notification shown', { version: updateInfo.version });
  }

  /**
   * Show error notification
   */
  showUpdateError(error: UpdateError): void {
    // Clear any taskbar progress on error
    if (this.mainWindow && process.platform === 'win32') {
      this.mainWindow.setProgressBar(-1);
    }

    const message = this.getErrorMessage(error);

    this.showNotification({
      title: 'Update Error',
      body: message,
      urgency: 'critical',
      onClick: () => {
        this.focusMainWindow();
        this.sendToRenderer('atlas:update-action', { action: 'show-error-details', error });
      },
    });

    logger.info('Update error notification shown', { code: error.code, message: error.message });
  }

  /**
   * Show rollback information
   */
  showRollbackInfo(rollbackInfo: RollbackInfo): void {
    this.showNotification({
      title: 'Rollback Available',
      body: `You can rollback to version ${rollbackInfo.previousVersion} if you experience issues with the current version.`,
      timeoutType: 'default',
      onClick: () => {
        this.focusMainWindow();
        this.sendToRenderer('atlas:update-action', { action: 'show-rollback-dialog' });
      },
    });

    logger.info('Rollback info notification shown', {
      previousVersion: rollbackInfo.previousVersion,
    });
  }

  /**
   * Show generic notification
   */
  showNotification(options: NotificationOptions): void {
    if (!this.supportsNotifications) {
      // Fallback: send to renderer to show in-app notification
      this.sendToRenderer('atlas:in-app-notification', {
        title: options.title,
        body: options.body,
        type: options.urgency === 'critical' ? 'error' : 'info',
      });
      return;
    }

    // Close existing notification if any
    if (this.currentNotification) {
      this.currentNotification.close();
    }

    try {
      this.currentNotification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent ?? false,
        urgency: options.urgency ?? 'normal',
        timeoutType: options.timeoutType ?? 'default',
        icon: this.getNotificationIcon(),
      });

      if (options.onClick) {
        this.currentNotification.on('click', options.onClick);
      }

      // Handle action buttons (platform-specific)
      if (options.actions && options.actions.length > 0) {
        this.currentNotification.on('action', (_event, index) => {
          const action = options.actions![index];
          this.handleNotificationAction(action.text, options);
        });
      }

      this.currentNotification.show();
    } catch (error) {
      logger.error('Failed to show notification', { error: (error as Error).message });
      // Fallback to renderer notification
      this.sendToRenderer('atlas:in-app-notification', {
        title: options.title,
        body: options.body,
        type: 'info',
      });
    }
  }

  /**
   * Close current notification
   */
  closeNotification(): void {
    if (this.currentNotification) {
      this.currentNotification.close();
      this.currentNotification = null;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get notification icon path
   */
  private getNotificationIcon(): string | undefined {
    // Return undefined to use default app icon
    return undefined;
  }

  /**
   * Handle notification action button clicks
   */
  private handleNotificationAction(action: string, _options: NotificationOptions): void {
    switch (action.toLowerCase()) {
      case 'download now':
        this.sendToRenderer('atlas:update-action', { action: 'download' });
        break;
      case 'restart now':
        this.sendToRenderer('atlas:update-action', { action: 'install' });
        break;
      case 'later':
        // Just dismiss the notification
        break;
      default:
        logger.debug('Unknown notification action', { action });
    }
  }

  /**
   * Format release notes for display
   */
  private formatReleaseNotes(notes: UpdateInfo['releaseNotes']): string {
    if (!notes) {
      return 'No release notes available.';
    }

    if (typeof notes === 'string') {
      // Strip HTML tags and clean up markdown
      return notes
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/#{1,6}\s*/g, '') // Remove markdown headers
        .replace(/\*\*/g, '') // Remove bold markers
        .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
        .trim();
    }

    if (Array.isArray(notes)) {
      return notes
        .map((note) => `${note.version}:\n${note.note}`)
        .join('\n\n')
        .substring(0, 500);
    }

    return 'No release notes available.';
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: UpdateError): string {
    switch (error.code) {
      case 'ERR_NETWORK':
        return 'Unable to download update. Please check your internet connection and try again.';
      case 'ERR_DNS':
        return 'Could not reach the update server. Please check your network settings.';
      case 'ERR_CHECKSUM':
        return 'Downloaded update file is corrupted. Will retry automatically.';
      case 'ERR_PERMISSION':
        return 'Insufficient permissions to install update. Please run as administrator.';
      case 'ERR_DISK_SPACE':
        return 'Not enough disk space to download update. Please free up some space.';
      default:
        return error.message || 'An unknown error occurred during update.';
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  /**
   * Focus the main window
   */
  private focusMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  /**
   * Send message to renderer process
   */
  private sendToRenderer(channel: string, data?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

/**
 * Notification options interface
 */
interface NotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
  urgency?: 'low' | 'normal' | 'critical';
  timeoutType?: 'default' | 'never';
  actions?: Array<{ type: string; text: string }>;
  onClick?: () => void;
}

/**
 * Get or create the singleton notifier instance
 */
export function getUpdateNotifier(): UpdateNotifier {
  if (!notifierInstance) {
    notifierInstance = new UpdateNotifier();
  }
  return notifierInstance;
}

/**
 * Shutdown the notifier
 */
export function shutdownUpdateNotifier(): void {
  if (notifierInstance) {
    notifierInstance.closeNotification();
    notifierInstance = null;
    logger.info('Update notifier shutdown complete');
  }
}

export default getUpdateNotifier;
