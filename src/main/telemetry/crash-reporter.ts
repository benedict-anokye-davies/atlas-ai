/**
 * Atlas Desktop - Crash Reporter
 * Comprehensive crash handling, error tracking, and recovery system
 */

import { app, dialog, BrowserWindow, crashReporter } from 'electron';
import { EventEmitter } from 'events';
import { 
  writeFile, readFile, mkdir, readdir, unlink, stat 
} from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch, cpus, totalmem, freemem, release } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage, safeJsonParse } from '../../shared/utils';

const logger = createModuleLogger('CrashReporter');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Severity levels for crash reports
 */
export enum CrashSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Types of crashes/errors
 */
export enum CrashType {
  UNCAUGHT_EXCEPTION = 'uncaught_exception',
  UNHANDLED_REJECTION = 'unhandled_rejection',
  RENDER_CRASH = 'render_crash',
  GPU_CRASH = 'gpu_crash',
  MEMORY_EXHAUSTION = 'memory_exhaustion',
  NATIVE_MODULE = 'native_module',
  MANUAL = 'manual',
}

/**
 * System information snapshot
 */
export interface SystemInfo {
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  appVersion: string;
  appPath: string;
}

/**
 * Application state snapshot
 */
export interface AppState {
  windowCount: number;
  activeWindows: string[];
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  pipelineState?: string;
  lastUserAction?: string;
  lastAction?: string;
  customState?: Record<string, unknown>;
}

/**
 * Crash report structure
 */
export interface CrashReport {
  id: string;
  timestamp: number;
  type: CrashType;
  severity: CrashSeverity;
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  system: SystemInfo;
  appState: AppState;
  context?: Record<string, unknown>;
  userConsent?: boolean;
  uploaded?: boolean;
  uploadedAt?: number;
}

/**
 * Session state for recovery
 */
export interface SessionState {
  timestamp: number;
  windowStates: WindowState[];
  pipelineState?: string;
  conversationId?: string;
  lastUserMessage?: string;
  pendingOperations?: string[];
  customData?: Record<string, unknown>;
}

/**
 * Window state for recovery
 */
export interface WindowState {
  id: number;
  url: string;
  bounds: Electron.Rectangle;
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
}

/**
 * Crash reporter configuration
 */
export interface CrashReporterConfig {
  /** Directory to store crash reports */
  crashDir?: string;
  /** Maximum number of crash reports to keep */
  maxReports?: number;
  /** Maximum age of crash reports in days */
  maxAgeDays?: number;
  /** Whether to show crash dialog to user */
  showDialog?: boolean;
  /** Remote URL for crash report upload (optional) */
  remoteUrl?: string;
  /** Whether to collect system info */
  collectSystemInfo?: boolean;
  /** Whether to collect app state */
  collectAppState?: boolean;
  /** Callback to get custom app state */
  getCustomState?: () => Record<string, unknown>;
  /** Callback when crash is captured */
  onCrash?: (report: CrashReport) => void;
  /** Whether to attempt session restore on next launch */
  enableSessionRestore?: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<CrashReporterConfig, 'remoteUrl' | 'getCustomState' | 'onCrash'>> = {
  crashDir: join(homedir(), '.atlas', 'crashes'),
  maxReports: 50,
  maxAgeDays: 30,
  showDialog: true,
  collectSystemInfo: true,
  collectAppState: true,
  enableSessionRestore: true,
};

// ============================================================================
// Crash Reporter Class
// ============================================================================

/**
 * CrashReporter - Handles crash detection, reporting, and recovery
 */
export class CrashReporter extends EventEmitter {
  private config: Required<Omit<CrashReporterConfig, 'remoteUrl' | 'getCustomState' | 'onCrash'>> &
    Pick<CrashReporterConfig, 'remoteUrl' | 'getCustomState' | 'onCrash'>;
  private initialized: boolean = false;
  private lastSessionState: SessionState | null = null;
  private sessionStateInterval: NodeJS.Timeout | null = null;
  private crashCount: number = 0;
  private startTime: number = Date.now();
  private lastAction: string = 'startup';

  constructor(config: CrashReporterConfig = {}) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureCrashDir();
  }

  /**
   * Initialize the crash reporter and install handlers
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('Crash reporter already initialized');
      return;
    }

    // Initialize Electron's built-in crash reporter for native crashes
    this.initializeElectronCrashReporter();

    // Install JavaScript error handlers
    this.installErrorHandlers();

    // Start session state saving for recovery
    if (this.config.enableSessionRestore) {
      this.startSessionStateSaving();
    }

    // Clean up old crash reports
    this.cleanupOldReports();

    // Check for previous crash and recover if needed
    this.checkPreviousSession();

    this.initialized = true;
    logger.info('Crash reporter initialized', {
      crashDir: this.config.crashDir,
      sessionRestore: this.config.enableSessionRestore,
    });
  }

  /**
   * Shutdown the crash reporter
   */
  shutdown(): void {
    if (this.sessionStateInterval) {
      clearInterval(this.sessionStateInterval);
      this.sessionStateInterval = null;
    }

    // Clear session state on clean shutdown
    this.clearSessionState();
    this.initialized = false;
    logger.info('Crash reporter shutdown');
  }

  /**
   * Record a user action for context
   */
  recordAction(action: string): void {
    this.lastAction = action;
  }

  /**
   * Manually report an error
   */
  reportError(
    error: Error,
    severity: CrashSeverity = CrashSeverity.MEDIUM,
    context?: Record<string, unknown>
  ): CrashReport {
    return this.captureCrash(error, CrashType.MANUAL, severity, context);
  }

  /**
   * Get all stored crash reports
   */
  async getCrashReports(): Promise<CrashReport[]> {
    const reports: CrashReport[] = [];

    try {
      const files = await readdir(this.config.crashDir);
      for (const file of files) {
        if (file.endsWith('.json') && file.startsWith('crash-')) {
          try {
            const filePath = join(this.config.crashDir, file);
            const data = await readFile(filePath, 'utf-8');
            const report = safeJsonParse<CrashReport>(data, null as unknown as CrashReport);
            if (report) {
              reports.push(report);
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    return reports.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a specific crash report by ID
   */
  async getCrashReport(id: string): Promise<CrashReport | null> {
    const filePath = join(this.config.crashDir, `crash-${id}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return safeJsonParse<CrashReport>(data, null as unknown as CrashReport);
    } catch {
      return null;
    }
  }

  /**
   * Delete a crash report
   */
  async deleteCrashReport(id: string): Promise<boolean> {
    const filePath = join(this.config.crashDir, `crash-${id}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all crash reports
   */
  async clearCrashReports(): Promise<void> {
    try {
      const files = await readdir(this.config.crashDir);
      for (const file of files) {
        if (file.endsWith('.json') && file.startsWith('crash-')) {
          await unlink(join(this.config.crashDir, file));
        }
      }
      logger.info('All crash reports cleared');
    } catch (error) {
      logger.error('Failed to clear crash reports', { error: getErrorMessage(error) });
    }
  }

  /**
   * Upload crash report to remote server (with user consent)
   */
  async uploadCrashReport(id: string): Promise<boolean> {
    if (!this.config.remoteUrl) {
      logger.warn('No remote URL configured for crash report upload');
      return false;
    }

    const report = await this.getCrashReport(id);
    if (!report) {
      return false;
    }

    try {
      const response = await fetch(this.config.remoteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
      });

      if (response.ok) {
        // Update report as uploaded
        report.uploaded = true;
        report.uploadedAt = Date.now();
        await this.saveCrashReport(report);
        logger.info('Crash report uploaded', { id });
        return true;
      }

      logger.error('Failed to upload crash report', {
        id,
        status: response.status,
      });
      return false;
    } catch (error) {
      logger.error('Error uploading crash report', {
        id,
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Get previous session state for recovery
   */
  getPreviousSessionState(): SessionState | null {
    return this.lastSessionState;
  }

  /**
   * Check if there was a previous unclean shutdown
   */
  hadPreviousCrash(): boolean {
    return this.lastSessionState !== null;
  }

  /**
   * Get crash statistics
   */
  async getStats(): Promise<{ totalCrashes: number; recentCrashes: number; uptime: number }> {
    const reports = await this.getCrashReports();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCrashes = reports.filter((r) => r.timestamp > oneHourAgo).length;

    return {
      totalCrashes: reports.length,
      recentCrashes,
      uptime: Date.now() - this.startTime,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Ensure crash directory exists
   */
  private ensureCrashDir(): void {
    // Use sync for constructor - directory must exist before operations
    if (!existsSync(this.config.crashDir)) {
      mkdir(this.config.crashDir, { recursive: true }).catch(() => {
        // Ignore errors during initialization
      });
    }
  }

  /**
   * Initialize Electron's native crash reporter
   */
  private initializeElectronCrashReporter(): void {
    try {
      crashReporter.start({
        productName: 'Atlas Desktop',
        submitURL: this.config.remoteUrl || '',
        uploadToServer: false, // We handle upload manually with user consent
        compress: true,
      });
      logger.info('Electron crash reporter started');
    } catch (error) {
      logger.error('Failed to start Electron crash reporter', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Install JavaScript error handlers
   */
  private installErrorHandlers(): void {
    // Uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', {
        message: error.message,
        stack: error.stack,
      });

      const report = this.captureCrash(
        error,
        CrashType.UNCAUGHT_EXCEPTION,
        CrashSeverity.CRITICAL
      );

      this.handleCriticalCrash(report);
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));

      logger.error('Unhandled rejection', {
        message: error.message,
        stack: error.stack,
      });

      // Determine severity based on error type
      const isFatal =
        error.message.includes('FATAL') ||
        error.message.includes('CRITICAL') ||
        error.message.includes('OUT_OF_MEMORY');

      const severity = isFatal ? CrashSeverity.CRITICAL : CrashSeverity.HIGH;
      const report = this.captureCrash(error, CrashType.UNHANDLED_REJECTION, severity);

      if (isFatal) {
        this.handleCriticalCrash(report);
      }
    });

    // GPU process crashed
    app.on('gpu-process-crashed' as never, (_event: unknown, killed: boolean) => {
      const error = new Error(killed ? 'GPU process was killed' : 'GPU process crashed');
      const report = this.captureCrash(error, CrashType.GPU_CRASH, CrashSeverity.HIGH);

      logger.error('GPU process crashed', { killed });
      this.emit('gpu-crash', report);
    });

    // Renderer process crashed
    app.on('render-process-gone', (_event, webContents, details) => {
      const error = new Error(`Renderer crashed: ${details.reason}`);
      const report = this.captureCrash(
        error,
        CrashType.RENDER_CRASH,
        details.reason === 'oom' ? CrashSeverity.CRITICAL : CrashSeverity.HIGH,
        { reason: details.reason, exitCode: details.exitCode }
      );

      logger.error('Renderer process crashed', {
        reason: details.reason,
        exitCode: details.exitCode,
      });

      this.emit('renderer-crash', report, webContents);

      // Show recovery dialog for OOM
      if (details.reason === 'oom') {
        this.showRecoveryDialog(report, 'The application ran out of memory.');
      }
    });

    // Child process crashed
    app.on('child-process-gone', (_event, details) => {
      if (details.type !== 'GPU' && details.reason !== 'clean-exit') {
        const error = new Error(`Child process crashed: ${details.type} - ${details.reason}`);
        this.captureCrash(error, CrashType.NATIVE_MODULE, CrashSeverity.MEDIUM, {
          type: details.type,
          reason: details.reason,
        });

        logger.warn('Child process crashed', {
          type: details.type,
          reason: details.reason,
        });
      }
    });

    // Memory warnings
    if (process.platform === 'win32' || process.platform === 'linux') {
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

        // Warn if heap usage is over 80%
        if (heapUsedMB / heapTotalMB > 0.8) {
          logger.warn('High memory usage detected', {
            heapUsedMB: heapUsedMB.toFixed(2),
            heapTotalMB: heapTotalMB.toFixed(2),
            percentage: ((heapUsedMB / heapTotalMB) * 100).toFixed(1),
          });
          this.emit('memory-warning', { heapUsedMB, heapTotalMB });
        }
      }, 30000); // Check every 30 seconds
    }
  }

  /**
   * Capture crash information
   */
  private captureCrash(
    error: Error,
    type: CrashType,
    severity: CrashSeverity,
    context?: Record<string, unknown>
  ): CrashReport {
    this.crashCount++;

    const report: CrashReport = {
      id: this.generateReportId(),
      timestamp: Date.now(),
      type,
      severity,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      },
      system: this.config.collectSystemInfo ? this.collectSystemInfo() : this.getMinimalSystemInfo(),
      appState: this.config.collectAppState ? this.collectAppState() : this.getMinimalAppState(),
      context,
    };

    // Save crash report (fire and forget - don't block on crash)
    this.saveCrashReport(report).catch(() => {
      // Ignore save errors during crash handling
    });

    // Emit event
    this.emit('crash', report);

    // Call callback if configured
    if (this.config.onCrash) {
      try {
        this.config.onCrash(report);
      } catch {
        // Ignore callback errors
      }
    }

    return report;
  }

  /**
   * Handle critical crash
   */
  private handleCriticalCrash(report: CrashReport): void {
    // Save session state immediately
    this.saveSessionState();

    // Show crash dialog
    if (this.config.showDialog) {
      this.showCrashDialog(report);
    }

    // Exit the application
    logger.error('Critical crash, exiting application', { reportId: report.id });
    app.exit(1);
  }

  /**
   * Show crash dialog to user
   */
  private showCrashDialog(report: CrashReport): void {
    const buttons = ['Close', 'Report & Close'];
    if (this.config.remoteUrl) {
      buttons.push('Report & Restart');
    } else {
      buttons.push('Restart');
    }

    const result = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Atlas Crashed',
      message: 'Atlas encountered an unexpected error and needs to close.',
      detail: `Error: ${report.error.message}\n\nA crash report has been saved locally.`,
      buttons,
      defaultId: 0,
      cancelId: 0,
    });

    if (result === 1 || result === 2) {
      // User wants to report
      report.userConsent = true;
      this.saveCrashReport(report);

      if (this.config.remoteUrl) {
        this.uploadCrashReport(report.id).catch(() => {
          // Ignore upload errors during crash
        });
      }
    }

    if (result === 2) {
      // User wants to restart
      app.relaunch();
    }
  }

  /**
   * Show recovery dialog after renderer crash
   */
  private showRecoveryDialog(report: CrashReport, reason: string): void {
    dialog
      .showMessageBox({
        type: 'warning',
        title: 'Atlas Recovery',
        message: reason,
        detail:
          'Would you like to restore your previous session?\n\nNote: Some data may have been lost.',
        buttons: ['Cancel', 'Restore Session'],
        defaultId: 1,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) {
          this.emit('restore-session', this.lastSessionState);
        }
      });
  }

  /**
   * Collect system information
   */
  private collectSystemInfo(): SystemInfo {
    const cpu = cpus()[0];
    return {
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      cpuModel: cpu?.model || 'Unknown',
      cpuCores: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome || 'unknown',
      appVersion: app.getVersion(),
      appPath: app.getAppPath(),
    };
  }

  /**
   * Get minimal system info (for privacy)
   */
  private getMinimalSystemInfo(): SystemInfo {
    return {
      platform: platform(),
      arch: arch(),
      osRelease: 'redacted',
      cpuModel: 'redacted',
      cpuCores: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome || 'unknown',
      appVersion: app.getVersion(),
      appPath: 'redacted',
    };
  }

  /**
   * Collect application state
   */
  private collectAppState(): AppState {
    const windows = BrowserWindow.getAllWindows();
    const customState = this.config.getCustomState?.();

    return {
      windowCount: windows.length,
      activeWindows: windows.map((w) => (w.getTitle() || 'Untitled')),
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      lastAction: this.lastAction,
      customState,
    };
  }

  /**
   * Get minimal app state (for privacy)
   */
  private getMinimalAppState(): AppState {
    return {
      windowCount: BrowserWindow.getAllWindows().length,
      activeWindows: [],
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    };
  }

  /**
   * Generate unique report ID
   */
  private generateReportId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * Save crash report to disk
   */
  private async saveCrashReport(report: CrashReport): Promise<void> {
    try {
      const filePath = join(this.config.crashDir, `crash-${report.id}.json`);
      await writeFile(filePath, JSON.stringify(report, null, 2));
      logger.info('Crash report saved', { id: report.id, path: filePath });
    } catch (error) {
      logger.error('Failed to save crash report', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Start periodic session state saving
   */
  private startSessionStateSaving(): void {
    // Save session state every 30 seconds
    this.sessionStateInterval = setInterval(() => {
      this.saveSessionState();
    }, 30000);

    // Also save on important events
    app.on('before-quit', () => {
      this.clearSessionState();
    });
  }

  /**
   * Save current session state for recovery
   */
  private saveSessionState(): void {
    const windows = BrowserWindow.getAllWindows();
    const windowStates: WindowState[] = windows.map((win) => ({
      id: win.id,
      url: win.webContents.getURL(),
      bounds: win.getBounds(),
      isMaximized: win.isMaximized(),
      isMinimized: win.isMinimized(),
      isFullScreen: win.isFullScreen(),
    }));

    const state: SessionState = {
      timestamp: Date.now(),
      windowStates,
      customData: this.config.getCustomState?.(),
    };

    const filePath = join(this.config.crashDir, 'session-state.json');
    writeFile(filePath, JSON.stringify(state, null, 2)).catch(() => {
      // Ignore save errors
    });
  }

  /**
   * Clear session state (on clean shutdown)
   */
  private clearSessionState(): void {
    const filePath = join(this.config.crashDir, 'session-state.json');
    if (existsSync(filePath)) {
      unlink(filePath).catch(() => {
        // Ignore errors
      });
    }
  }

  /**
   * Check for previous session and recover if needed
   */
  private checkPreviousSession(): void {
    const filePath = join(this.config.crashDir, 'session-state.json');

    if (!existsSync(filePath)) {
      return;
    }

    // Use async read but handle synchronously for startup
    readFile(filePath, 'utf-8')
      .then((data) => {
        this.lastSessionState = safeJsonParse<SessionState>(data, null as unknown as SessionState);

        // Clear the session state file after reading
        unlink(filePath).catch(() => {
          // Ignore errors
        });

        // Check if session is not too old (more than 1 hour)
        const maxAge = 60 * 60 * 1000;
        if (this.lastSessionState && Date.now() - this.lastSessionState.timestamp > maxAge) {
          logger.info('Previous session too old, discarding');
          this.lastSessionState = null;
          return;
        }

        if (this.lastSessionState) {
          logger.info('Previous session state found (possible crash)', {
            timestamp: this.lastSessionState.timestamp,
            windowCount: this.lastSessionState.windowStates.length,
          });

          this.emit('previous-session-found', this.lastSessionState);
        }
      })
      .catch(() => {
        // Ignore read errors
        this.lastSessionState = null;
      });
  }

  /**
   * Clean up old crash reports
   */
  private cleanupOldReports(): void {
    readdir(this.config.crashDir)
      .then(async (files) => {
        const crashFiles: Array<{ name: string; path: string; mtime: number }> = [];

        for (const f of files) {
          if (f.startsWith('crash-') && f.endsWith('.json')) {
            const filePath = join(this.config.crashDir, f);
            try {
              const stats = await stat(filePath);
              crashFiles.push({
                name: f,
                path: filePath,
                mtime: stats.mtime.getTime(),
              });
            } catch {
              // Ignore stat errors
            }
          }
        }

        crashFiles.sort((a, b) => b.mtime - a.mtime);

        const maxAge = this.config.maxAgeDays * 24 * 60 * 60 * 1000;
        const now = Date.now();

        let deleted = 0;
        for (let i = 0; i < crashFiles.length; i++) {
          const file = crashFiles[i];
          // Delete if too old or over limit
          if (i >= this.config.maxReports || now - file.mtime > maxAge) {
            await unlink(file.path).catch(() => {
              // Ignore delete errors
            });
            deleted++;
          }
        }

        if (deleted > 0) {
          logger.info('Cleaned up old crash reports', { deleted });
        }
      })
      .catch(() => {
        // Ignore cleanup errors
      });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let crashReporterInstance: CrashReporter | null = null;

/**
 * Get or create the crash reporter instance
 */
export function getCrashReporter(config?: CrashReporterConfig): CrashReporter {
  if (!crashReporterInstance) {
    crashReporterInstance = new CrashReporter(config);
  }
  return crashReporterInstance;
}

/**
 * Initialize and get the crash reporter
 */
export function initializeCrashReporter(config?: CrashReporterConfig): CrashReporter {
  const reporter = getCrashReporter(config);
  reporter.initialize();
  return reporter;
}

/**
 * Shutdown the crash reporter
 */
export function shutdownCrashReporter(): void {
  if (crashReporterInstance) {
    crashReporterInstance.shutdown();
    crashReporterInstance = null;
  }
}

/**
 * Report an error manually
 */
export function reportError(
  error: Error,
  severity?: CrashSeverity,
  context?: Record<string, unknown>
): CrashReport | null {
  if (crashReporterInstance) {
    return crashReporterInstance.reportError(error, severity, context);
  }
  return null;
}

/**
 * Record a user action for crash context
 */
export function recordAction(action: string): void {
  if (crashReporterInstance) {
    crashReporterInstance.recordAction(action);
  }
}

export { CrashReporter as default };
