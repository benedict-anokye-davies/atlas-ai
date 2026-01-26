/* eslint-disable no-console */
/**
 * Atlas Desktop - Development Helper
 * Provides enhanced development experience with HMR-like functionality (048-A)
 *
 * Features:
 * - Graceful restart with state preservation
 * - Module hot reloading where possible
 * - Development status IPC channel
 * - Quick iteration support
 *
 * @module dev/dev-helper
 */

import { app, BrowserWindow, ipcMain, Menu, MenuItem } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getDevStatePersistence, applyWindowState, trackWindowState } from './state-persistence';
import { getPerformanceProfiler, shutdownPerformanceProfiler } from './performance-profiler';

/**
 * Development mode configuration
 */
export interface DevConfig {
  /** Dev server port (default: 5173) */
  devServerPort: number;
  /** Enable state persistence (default: true) */
  enableStatePersistence: boolean;
  /** Auto-open DevTools (default: true) */
  autoOpenDevTools: boolean;
  /** Reload delay in ms after file change (default: 100) */
  reloadDelay: number;
  /** Watch directories for changes */
  watchDirectories: string[];
}

/**
 * Default development configuration
 */
const DEFAULT_DEV_CONFIG: DevConfig = {
  devServerPort: 5173,
  enableStatePersistence: true,
  autoOpenDevTools: true,
  reloadDelay: 100,
  watchDirectories: ['src/main'],
};

/**
 * Development helper for enhanced DX
 */
export class DevHelper {
  private config: DevConfig;
  private isShuttingDown = false;
  private mainWindow: BrowserWindow | null = null;

  constructor(config?: Partial<DevConfig>) {
    this.config = { ...DEFAULT_DEV_CONFIG, ...config };
  }

  /**
   * Check if we're in development mode
   */
  static isDev(): boolean {
    return process.env.NODE_ENV === 'development' || !app.isPackaged;
  }

  /**
   * Get the dev server URL
   */
  getDevServerUrl(): string {
    return `http://localhost:${this.config.devServerPort}`;
  }

  /**
   * Initialize development mode enhancements
   */
  initialize(): void {
    if (!DevHelper.isDev()) {
      return;
    }

    console.log('[DevHelper] Initializing development mode...');

    // Register development IPC handlers
    this.registerDevIPCHandlers();

    // Set up graceful restart handling
    this.setupGracefulRestart();

    console.log('[DevHelper] Development mode initialized');
  }

  /**
   * Configure the main window with dev enhancements
   */
  configureWindow(window: BrowserWindow): void {
    if (!DevHelper.isDev()) {
      return;
    }

    this.mainWindow = window;

    // Apply saved window state if this is a fresh restart
    const persistence = getDevStatePersistence();
    if (this.config.enableStatePersistence && persistence.isFreshRestart()) {
      console.log('[DevHelper] Applying saved window state from HMR restart');
      applyWindowState(window);
    }

    // Track window state for future restarts
    if (this.config.enableStatePersistence) {
      trackWindowState(window);
    }

    // Setup keyboard shortcuts for development
    this.setupDevKeyboardShortcuts(window);

    // Add development context menu
    this.setupDevContextMenu(window);
  }

  /**
   * Register development-specific IPC handlers
   */
  private registerDevIPCHandlers(): void {
    // Get development status
    ipcMain.handle('dev:get-status', () => {
      return {
        isDev: DevHelper.isDev(),
        devServerPort: this.config.devServerPort,
        statePersistence: this.config.enableStatePersistence,
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
      };
    });

    // Force reload main process (triggers Vite rebuild)
    ipcMain.handle('dev:reload-main', async () => {
      console.log('[DevHelper] Manual reload requested');
      this.triggerReload();
      return { success: true };
    });

    // Clear development state
    ipcMain.handle('dev:clear-state', () => {
      const persistence = getDevStatePersistence();
      persistence.clear();
      console.log('[DevHelper] Development state cleared');
      return { success: true };
    });

    // Get development state
    ipcMain.handle('dev:get-state', () => {
      const persistence = getDevStatePersistence();
      return {
        windowState: persistence.getWindowState(),
        voiceState: persistence.getVoiceState(),
        isFreshRestart: persistence.isFreshRestart(),
      };
    });

    // Toggle DevTools
    ipcMain.handle('dev:toggle-devtools', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.webContents.isDevToolsOpened()) {
          this.mainWindow.webContents.closeDevTools();
        } else {
          this.mainWindow.webContents.openDevTools();
        }
        return { success: true };
      }
      return { success: false };
    });

    // Hot reload renderer (Vite handles this, but provide manual trigger)
    ipcMain.handle('dev:reload-renderer', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.reload();
        return { success: true };
      }
      return { success: false };
    });

    // 048-C: Performance Profiler IPC handlers
    const profiler = getPerformanceProfiler();

    // Get current performance snapshot
    ipcMain.handle('profiler:get-snapshot', () => {
      return {
        success: true,
        data: profiler.takeSnapshot(),
      };
    });

    // Get memory stats
    ipcMain.handle('profiler:get-memory', () => {
      return {
        success: true,
        data: profiler.getMemoryStats(),
      };
    });

    // Get CPU stats
    ipcMain.handle('profiler:get-cpu', () => {
      return {
        success: true,
        data: profiler.getCPUStats(),
      };
    });

    // Get event loop stats
    ipcMain.handle('profiler:get-event-loop', () => {
      return {
        success: true,
        data: profiler.getEventLoopStats(),
      };
    });

    // Get profiler summary
    ipcMain.handle('profiler:get-summary', () => {
      return {
        success: true,
        data: profiler.getSummary(),
      };
    });

    // Get recent snapshots
    ipcMain.handle('profiler:get-recent', (_event, count: number = 60) => {
      return {
        success: true,
        data: profiler.getRecentSnapshots(count),
      };
    });

    // Start profiler monitoring
    ipcMain.handle('profiler:start-monitoring', (_event, intervalMs: number = 1000) => {
      profiler.startMonitoring(intervalMs);
      return { success: true };
    });

    // Stop profiler monitoring
    ipcMain.handle('profiler:stop-monitoring', () => {
      profiler.stopMonitoring();
      return { success: true };
    });

    // Start profiling session
    ipcMain.handle('profiler:start-session', (_event, name?: string) => {
      const id = profiler.startSession(name);
      return { success: true, data: { id } };
    });

    // End profiling session
    ipcMain.handle('profiler:end-session', (_event, id: string) => {
      const session = profiler.endSession(id);
      return { success: !!session, data: session };
    });

    // Get all sessions
    ipcMain.handle('profiler:get-sessions', () => {
      return {
        success: true,
        data: profiler.getSessions(),
      };
    });

    // Force garbage collection
    ipcMain.handle('profiler:force-gc', () => {
      const success = profiler.forceGC();
      return { success };
    });

    // Get heap info
    ipcMain.handle('profiler:get-heap-info', () => {
      return {
        success: true,
        data: profiler.getHeapSnapshotInfo(),
      };
    });

    // Clear profiler data
    ipcMain.handle('profiler:clear', () => {
      profiler.clear();
      return { success: true };
    });

    console.log('[DevHelper] IPC handlers registered');
  }

  /**
   * Setup graceful restart handling
   */
  private setupGracefulRestart(): void {
    // Handle Vite plugin restart signal
    process.on('message', (message) => {
      if (message === 'hot-reload') {
        console.log('[DevHelper] Hot reload signal received');
        this.saveStateAndRestart();
      }
    });

    // Save state before quit for manual restarts
    app.on('before-quit', () => {
      if (!this.isShuttingDown && this.config.enableStatePersistence) {
        const persistence = getDevStatePersistence();
        persistence.forceSave();
        console.log('[DevHelper] State saved before quit');
      }
    });
  }

  /**
   * Setup development keyboard shortcuts
   */
  private setupDevKeyboardShortcuts(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      // F5 or Ctrl+R: Reload renderer
      if (input.key === 'F5' || (input.control && input.key === 'r')) {
        event.preventDefault();
        window.webContents.reload();
      }

      // Ctrl+Shift+R: Full reload (clear cache)
      if (input.control && input.shift && input.key === 'R') {
        event.preventDefault();
        window.webContents.reloadIgnoringCache();
      }

      // F12 or Ctrl+Shift+I: Toggle DevTools
      if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
        event.preventDefault();
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools();
        } else {
          window.webContents.openDevTools();
        }
      }

      // Ctrl+Shift+M: Reload main process (requires manual trigger file)
      if (input.control && input.shift && input.key === 'M') {
        event.preventDefault();
        console.log('[DevHelper] Manual main process reload requested');
        this.triggerReload();
      }
    });
  }

  /**
   * Setup development context menu
   */
  private setupDevContextMenu(window: BrowserWindow): void {
    window.webContents.on('context-menu', (_event, params) => {
      // Only show dev menu on right-click in dev mode
      const menu = new Menu();

      menu.append(
        new MenuItem({
          label: 'Inspect Element',
          click: () => {
            window.webContents.inspectElement(params.x, params.y);
          },
        })
      );

      menu.append(new MenuItem({ type: 'separator' }));

      menu.append(
        new MenuItem({
          label: 'Reload Renderer',
          accelerator: 'F5',
          click: () => {
            window.webContents.reload();
          },
        })
      );

      menu.append(
        new MenuItem({
          label: 'Reload (Clear Cache)',
          accelerator: 'Ctrl+Shift+R',
          click: () => {
            window.webContents.reloadIgnoringCache();
          },
        })
      );

      menu.append(
        new MenuItem({
          label: 'Toggle DevTools',
          accelerator: 'F12',
          click: () => {
            if (window.webContents.isDevToolsOpened()) {
              window.webContents.closeDevTools();
            } else {
              window.webContents.openDevTools();
            }
          },
        })
      );

      menu.append(new MenuItem({ type: 'separator' }));

      menu.append(
        new MenuItem({
          label: 'Clear Dev State',
          click: () => {
            const persistence = getDevStatePersistence();
            persistence.clear();
            console.log('[DevHelper] Development state cleared via context menu');
          },
        })
      );

      menu.popup();
    });
  }

  /**
   * Trigger a reload by touching a watched file
   */
  private triggerReload(): void {
    // Create a trigger file that Vite watches
    const triggerFile = path.join(app.getAppPath(), 'src', 'main', '.dev-reload-trigger');
    try {
      fs.writeFileSync(triggerFile, Date.now().toString());
      console.log('[DevHelper] Reload trigger written');
    } catch (error) {
      console.error('[DevHelper] Failed to trigger reload:', error);
    }
  }

  /**
   * Save state and prepare for restart
   */
  private saveStateAndRestart(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    if (this.config.enableStatePersistence) {
      const persistence = getDevStatePersistence();

      // Save window state
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        persistence.saveWindowState(this.mainWindow);
      }

      persistence.forceSave();
      console.log('[DevHelper] State saved for HMR restart');
    }
  }

  /**
   * Shutdown the dev helper
   */
  shutdown(): void {
    if (this.config.enableStatePersistence && this.mainWindow && !this.mainWindow.isDestroyed()) {
      const persistence = getDevStatePersistence();
      persistence.saveWindowState(this.mainWindow);
      persistence.forceSave();
    }
    shutdownPerformanceProfiler();
    this.mainWindow = null;
  }
}

// Singleton instance
let devHelper: DevHelper | null = null;

/**
 * Get the singleton DevHelper instance
 */
export function getDevHelper(config?: Partial<DevConfig>): DevHelper {
  if (!devHelper) {
    devHelper = new DevHelper(config);
  }
  return devHelper;
}

/**
 * Initialize development mode (call early in main process)
 */
export function initializeDevMode(config?: Partial<DevConfig>): DevHelper {
  const helper = getDevHelper(config);
  helper.initialize();
  return helper;
}

/**
 * Shutdown the dev helper
 */
export function shutdownDevHelper(): void {
  if (devHelper) {
    devHelper.shutdown();
    devHelper = null;
  }
}

export default DevHelper;
