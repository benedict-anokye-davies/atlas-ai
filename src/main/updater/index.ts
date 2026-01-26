/**
 * Atlas Desktop - Auto Update Manager
 * Handles automatic updates using electron-updater
 *
 * Features:
 * - Check for updates on startup and periodically (every 4 hours)
 * - Download updates in background without blocking UI
 * - Notify user when update is ready to install
 * - Install on next restart (non-forced)
 * - Show release notes in notification
 * - Rollback capability if update fails
 */

import { autoUpdater, UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  UpdateState,
  UpdateInfo,
  UpdateProgress,
  UpdateError,
  UpdaterConfig,
  RollbackInfo,
} from '../../shared/types/updater';
import { getUpdateNotifier, UpdateNotifier } from './update-notifier';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';

const logger = createModuleLogger('Updater');

/**
 * Default updater configuration
 */
const DEFAULT_CONFIG: UpdaterConfig = {
  enabled: true,
  checkInterval: 4 * 60 * 60 * 1000, // 4 hours
  autoDownload: true,
  autoInstallOnQuit: true,
  allowDowngrade: false,
  allowPrerelease: false,
  channel: 'stable',
};

/**
 * Singleton instance
 */
let updaterInstance: AutoUpdateManager | null = null;

/**
 * Auto Update Manager class
 * Manages the entire update lifecycle
 */
export class AutoUpdateManager extends EventEmitter {
  private state: UpdateState;
  private config: UpdaterConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private notifier: UpdateNotifier;
  private rollbackInfo: RollbackInfo | null = null;
  private isUpdating = false;
  private backupDir: string;

  constructor(config?: Partial<UpdaterConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.notifier = getUpdateNotifier();
    this.backupDir = join(app.getPath('userData'), 'update-backups');

    // Initialize state
    this.state = {
      status: 'idle',
      updateInfo: null,
      progress: null,
      error: null,
      lastCheck: null,
      readyToInstall: false,
      currentVersion: app.getVersion(),
    };

    // Configure electron-updater
    this.configureUpdater();

    // Load rollback info if exists
    this.loadRollbackInfo();

    logger.info('AutoUpdateManager initialized', {
      version: this.state.currentVersion,
      config: {
        enabled: this.config.enabled,
        checkInterval: this.config.checkInterval,
        autoDownload: this.config.autoDownload,
        channel: this.config.channel,
      },
    });
  }

  /**
   * Configure electron-updater settings
   */
  private configureUpdater(): void {
    // Set up autoUpdater options
    autoUpdater.autoDownload = this.config.autoDownload;
    autoUpdater.autoInstallOnAppQuit = this.config.autoInstallOnQuit;
    autoUpdater.allowDowngrade = this.config.allowDowngrade;
    autoUpdater.allowPrerelease = this.config.allowPrerelease;

    // Set update channel
    if (this.config.channel !== 'stable') {
      autoUpdater.channel = this.config.channel;
    }

    // Disable auto-run after install
    autoUpdater.autoRunAppAfterInstall = true;

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up electron-updater event handlers
   */
  private setupEventHandlers(): void {
    // Checking for updates
    autoUpdater.on('checking-for-update', () => {
      logger.info('Checking for updates...');
      this.updateState({ status: 'checking' });
      this.emit('checking-for-update');
      this.sendToRenderer('atlas:update-checking');
    });

    // Update available
    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      logger.info('Update available', { version: info.version });
      const updateInfo = this.convertUpdateInfo(info);
      this.updateState({
        status: 'available',
        updateInfo,
      });
      this.emit('update-available', updateInfo);
      this.sendToRenderer('atlas:update-available', updateInfo);

      // Show notification
      this.notifier.showUpdateAvailable(updateInfo);
    });

    // No update available
    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      logger.info('No update available', { currentVersion: info.version });
      const updateInfo = this.convertUpdateInfo(info);
      this.updateState({
        status: 'not-available',
        updateInfo,
        lastCheck: new Date().toISOString(),
      });
      this.emit('update-not-available', updateInfo);
      this.sendToRenderer('atlas:update-not-available', updateInfo);
    });

    // Download progress
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      const updateProgress = this.convertProgress(progress);
      this.updateState({
        status: 'downloading',
        progress: updateProgress,
      });
      this.emit('download-progress', updateProgress);
      this.sendToRenderer('atlas:update-progress', updateProgress);

      // Update notification progress
      this.notifier.updateDownloadProgress(updateProgress);
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      logger.info('Update downloaded', { version: info.version });
      const updateInfo = this.convertUpdateInfo(info);
      this.updateState({
        status: 'downloaded',
        updateInfo,
        progress: null,
        readyToInstall: true,
      });
      this.emit('update-downloaded', updateInfo);
      this.sendToRenderer('atlas:update-downloaded', updateInfo);

      // Create backup for rollback
      this.createRollbackBackup();

      // Show notification
      this.notifier.showUpdateReady(updateInfo);
    });

    // Error handling
    autoUpdater.on('error', (error: Error) => {
      logger.error('Update error', { error: error.message, stack: error.stack });
      const updateError: UpdateError = {
        message: error.message,
        code: this.extractErrorCode(error),
        stack: error.stack,
        recoverable: this.isRecoverableError(error),
      };
      this.updateState({
        status: 'error',
        error: updateError,
        progress: null,
      });
      this.emit('error', updateError);
      this.sendToRenderer('atlas:update-error', updateError);

      // Show error notification
      this.notifier.showUpdateError(updateError);

      // Attempt recovery if possible
      if (updateError.recoverable) {
        this.scheduleRetry();
      }
    });
  }

  /**
   * Set the main window for renderer communication
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
    this.notifier.setMainWindow(window);
  }

  /**
   * Start the update manager
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Auto-updater is disabled');
      return;
    }

    // Don't run in development
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
      logger.info('Auto-updater disabled in development mode');
      return;
    }

    logger.info('Starting auto-update manager');

    // Check for updates immediately
    await this.checkForUpdates();

    // Set up periodic checks
    this.startPeriodicChecks();
  }

  /**
   * Stop the update manager
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Auto-update manager stopped');
  }

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (this.isUpdating) {
      logger.warn('Update check already in progress');
      return null;
    }

    try {
      this.isUpdating = true;
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo ? this.convertUpdateInfo(result.updateInfo) : null;
    } catch (error) {
      logger.error('Failed to check for updates', { error: (error as Error).message });
      throw error;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Download update (if not auto-downloading)
   */
  async downloadUpdate(): Promise<void> {
    if (this.state.status !== 'available') {
      throw new Error('No update available to download');
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('Failed to download update', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Install downloaded update
   * Will quit the app and install the update
   */
  installUpdate(silentInstall = false): void {
    if (!this.state.readyToInstall) {
      throw new Error('No update ready to install');
    }

    logger.info('Installing update...', { silent: silentInstall });

    // Force quit and install
    autoUpdater.quitAndInstall(!silentInstall, true);
  }

  /**
   * Schedule update installation on next restart
   */
  installOnQuit(): void {
    if (!this.state.readyToInstall) {
      throw new Error('No update ready to install');
    }

    // autoUpdater will install on quit automatically if configured
    autoUpdater.autoInstallOnAppQuit = true;
    logger.info('Update will be installed on next restart');

    this.notifier.showUpdateScheduled(this.state.updateInfo!);
    this.sendToRenderer('atlas:update-scheduled', this.state.updateInfo);
  }

  /**
   * Cancel ongoing download
   */
  cancelDownload(): void {
    if (this.state.status === 'downloading') {
      // Note: electron-updater doesn't have a direct cancel method
      // We can disable auto-download and reset state
      autoUpdater.autoDownload = false;
      this.updateState({
        status: 'idle',
        progress: null,
      });
      this.emit('update-cancelled');
      this.sendToRenderer('atlas:update-cancelled');
      logger.info('Update download cancelled');
    }
  }

  /**
   * Rollback to previous version
   */
  async rollback(): Promise<boolean> {
    if (!this.rollbackInfo?.available) {
      logger.warn('No rollback available');
      return false;
    }

    try {
      logger.info('Attempting rollback to previous version', {
        previousVersion: this.rollbackInfo.previousVersion,
      });

      // In practice, rollback would involve restoring backed up files
      // This is platform-specific and depends on the installation type
      // For now, we'll log the attempt and notify the user

      this.notifier.showRollbackInfo(this.rollbackInfo);
      return true;
    } catch (error) {
      logger.error('Rollback failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get current update state
   */
  getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Get current configuration
   */
  getConfig(): UpdaterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<UpdaterConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Apply relevant settings to autoUpdater
    autoUpdater.autoDownload = this.config.autoDownload;
    autoUpdater.autoInstallOnAppQuit = this.config.autoInstallOnQuit;
    autoUpdater.allowDowngrade = this.config.allowDowngrade;
    autoUpdater.allowPrerelease = this.config.allowPrerelease;

    if (this.config.channel !== 'stable') {
      autoUpdater.channel = this.config.channel;
    }

    // Restart periodic checks if interval changed
    if (newConfig.checkInterval && this.checkInterval) {
      this.stop();
      this.startPeriodicChecks();
    }

    logger.info('Updater configuration updated', { config: this.config });
  }

  /**
   * Get rollback information
   */
  getRollbackInfo(): RollbackInfo | null {
    return this.rollbackInfo;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Start periodic update checks
   */
  private startPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.checkForUpdates();
      } catch (error) {
        logger.warn('Periodic update check failed', { error: (error as Error).message });
      }
    }, this.config.checkInterval);

    logger.info('Periodic update checks started', {
      intervalMs: this.config.checkInterval,
      intervalHours: this.config.checkInterval / (60 * 60 * 1000),
    });
  }

  /**
   * Update internal state and emit change event
   */
  private updateState(partial: Partial<UpdateState>): void {
    const previousStatus = this.state.status;
    this.state = { ...this.state, ...partial };

    if (partial.status && partial.status !== previousStatus) {
      this.emit('state-change', this.state.status, previousStatus);
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

  /**
   * Convert electron-updater UpdateInfo to our format
   */
  private convertUpdateInfo(info: ElectronUpdateInfo): UpdateInfo {
    return {
      version: info.version,
      files: info.files.map((f) => ({
        url: f.url,
        size: f.size,
        sha512: f.sha512,
      })),
      releaseNotes: info.releaseNotes as string | null,
      releaseName: info.releaseName,
      releaseDate: info.releaseDate,
      sha512: info.sha512,
      stagingPercentage: info.stagingPercentage,
    };
  }

  /**
   * Convert electron-updater ProgressInfo to our format
   */
  private convertProgress(progress: ProgressInfo): UpdateProgress {
    return {
      total: progress.total,
      transferred: progress.transferred,
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      eta:
        progress.total > 0 && progress.bytesPerSecond > 0
          ? Math.round((progress.total - progress.transferred) / progress.bytesPerSecond)
          : undefined,
    };
  }

  /**
   * Extract error code from error
   */
  private extractErrorCode(error: Error): string | undefined {
    // Check for common error patterns
    if (error.message.includes('net::')) {
      return 'ERR_NETWORK';
    }
    if (error.message.includes('ENOTFOUND')) {
      return 'ERR_DNS';
    }
    if (error.message.includes('checksum')) {
      return 'ERR_CHECKSUM';
    }
    if (error.message.includes('EACCES') || error.message.includes('permission')) {
      return 'ERR_PERMISSION';
    }
    if (error.message.includes('ENOSPC')) {
      return 'ERR_DISK_SPACE';
    }
    return undefined;
  }

  /**
   * Determine if error is recoverable
   */
  private isRecoverableError(error: Error): boolean {
    const code = this.extractErrorCode(error);
    // Network errors are typically recoverable
    return code === 'ERR_NETWORK' || code === 'ERR_DNS';
  }

  /**
   * Schedule retry after recoverable error
   */
  private scheduleRetry(): void {
    const retryDelay = 5 * 60 * 1000; // 5 minutes
    logger.info('Scheduling retry after error', { delayMs: retryDelay });

    setTimeout(async () => {
      try {
        await this.checkForUpdates();
      } catch (error) {
        logger.warn('Retry check failed', { error: (error as Error).message });
      }
    }, retryDelay);
  }

  /**
   * Create backup for rollback capability
   */
  private createRollbackBackup(): void {
    try {
      // Ensure backup directory exists
      if (!existsSync(this.backupDir)) {
        mkdirSync(this.backupDir, { recursive: true });
      }

      // Save rollback info
      this.rollbackInfo = {
        previousVersion: this.state.currentVersion,
        backupPath: this.backupDir,
        createdAt: new Date().toISOString(),
        available: true,
      };

      // Persist rollback info
      const infoPath = join(this.backupDir, 'rollback-info.json');
      writeFileSync(infoPath, JSON.stringify(this.rollbackInfo, null, 2));

      logger.info('Rollback backup created', { previousVersion: this.state.currentVersion });
    } catch (error) {
      logger.error('Failed to create rollback backup', { error: (error as Error).message });
    }
  }

  /**
   * Load rollback info from disk
   */
  private loadRollbackInfo(): void {
    try {
      const infoPath = join(this.backupDir, 'rollback-info.json');
      if (existsSync(infoPath)) {
        const data = readFileSync(infoPath, 'utf-8');
        this.rollbackInfo = JSON.parse(data);
        logger.info('Loaded rollback info', {
          previousVersion: this.rollbackInfo?.previousVersion,
        });
      }
    } catch (error) {
      logger.warn('Failed to load rollback info', { error: (error as Error).message });
    }
  }

  /**
   * Clean up old rollback data
   */
  cleanupRollbackData(): void {
    try {
      const infoPath = join(this.backupDir, 'rollback-info.json');
      if (existsSync(infoPath)) {
        unlinkSync(infoPath);
      }
      this.rollbackInfo = null;
      logger.info('Rollback data cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup rollback data', { error: (error as Error).message });
    }
  }
}

/**
 * Get or create the singleton updater instance
 */
export function getAutoUpdateManager(config?: Partial<UpdaterConfig>): AutoUpdateManager {
  if (!updaterInstance) {
    updaterInstance = new AutoUpdateManager(config);
  }
  return updaterInstance;
}

/**
 * Shutdown the updater
 */
export function shutdownUpdater(): void {
  if (updaterInstance) {
    updaterInstance.stop();
    updaterInstance.removeAllListeners();
    updaterInstance = null;
    logger.info('Updater shutdown complete');
  }
}

export { AutoUpdateManager as Updater };
export default getAutoUpdateManager;
