/**
 * Atlas Desktop - Electron Main Process
 * Entry point for the Electron application
 *
 * Note: This file uses inline require() for lazy loading of heavy modules
 * to improve application startup time. This is an intentional pattern.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

// Polyfill globalThis.crypto for Node.js/Electron main process
// Required by @deepgram/sdk and other modules that use Web Crypto API
import { webcrypto } from 'crypto';
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

// Handle EPIPE errors globally to prevent crashes during shutdown/hot-reload
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

// Global error handlers - MUST be set before any other imports
// to ensure they catch errors during module initialization
process.on('uncaughtException', (error: Error) => {
  console.error('[FATAL] Uncaught exception:', error);
  // Log to file if logger is available (imported below)
  try {
    // Don't exit immediately - let logger flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  } catch {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[FATAL] Unhandled promise rejection at:', promise);
  console.error('[FATAL] Rejection reason:', reason);
  // Log detailed stack trace if available
  if (reason instanceof Error) {
    console.error('[FATAL] Stack:', reason.stack);
  }
  // Don't exit on unhandled rejection - log and continue
  // This prevents crashes from async operations that aren't properly caught
});

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

// Fix GPU cache access denied errors on Windows
// This redirects cache to userData directory where we have write permissions
app.commandLine.appendSwitch('disk-cache-dir', join(app.getPath('userData'), 'cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

import { isConfigValid, getSafeConfig, getConfigValidation } from './config';
import {
  mainLogger,
  ipcLogger,
  voiceLogger,
  createModuleLogger,
  shutdownLogger,
  PerformanceTimer,
  markLoggerShuttingDown,
} from './utils/logger';
import { WakeWordDetector, getWakeWordDetector, shutdownWakeWordDetector } from './voice/wake-word';
import { AudioPipeline, getAudioPipeline, shutdownAudioPipeline } from './voice/pipeline';
import { getVoicePipeline, shutdownVoicePipeline, VoicePipeline } from './voice/voice-pipeline';
import { registerIPCHandlers, setMainWindow, cleanupIPC } from './ipc';
import { registerTradingIpcHandlers, unregisterTradingIpcHandlers } from './trading/ipc-autonomous';
import { initializeTray, shutdownTray, AtlasTray } from './tray';
import { getWarmupManager } from './services/warmup-manager';
import {
  initializeLazyLoading,
  getLazyLoader,
  shutdownLazyLoader,
  type LoadStats,
} from './services/lazy-loader';
import { getConnectivityManager, shutdownConnectivityManager } from './utils/connectivity';
import { getSmartProviderManager, shutdownSmartProviderManager } from './providers';
import type { WakeWordEvent, VoicePipelineState, SpeechSegment } from '../shared/types/voice';
import { initializeDevMode, getDevHelper, shutdownDevHelper } from './dev';
import {
  getBackgroundResearchManager,
  shutdownBackgroundResearchManager,
  getSmartNotificationsManager,
  shutdownSmartNotificationsManager,
  getTaskScheduler,
  shutdownTaskScheduler,
  initializeIntelligencePlatform,
  shutdownIntelligencePlatform,
  getIntelligencePlatformManager,
} from './intelligence';
import { getAutoUpdateManager, shutdownUpdater } from './updater';
import { initializeShortcuts, shutdownShortcuts } from './shortcuts';
import { registerTradingHandlers, unregisterTradingHandlers } from './trading/ipc';
import { initializeTradingSystem, getTradingSystem } from './trading';
import { registerFinanceIPC, unregisterFinanceIPC } from './finance/ipc';
import { registerDashboardIPC } from './dashboard/ipc';
import { initializeGEPA, cleanupGEPA } from './gepa';
import { initializeBusinessModule, getBusinessModule } from './business';
import {
  initializeBusinessVoiceIntegration,
  shutdownBusinessVoiceIntegration,
} from './business/voice-integration';
import {
  initializeTradingVoiceIntegration,
  shutdownTradingVoiceIntegration,
} from './trading/voice-integration';
import { registerBusinessIPCHandlers } from './business/ipc';
import {
  initializeCodeIntelligence,
  shutdownCodeIntelligence,
  getCodeIntelligenceStatus,
} from './code-intelligence';
import {
  registerCodeIntelligenceHandlers,
  unregisterCodeIntelligenceHandlers,
  setCodeIntelligenceMainWindow,
} from './ipc/code-intelligence-handlers';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// System tray instance
let tray: AtlasTray | null = null;

// Full voice pipeline instance (for tray integration)
let fullVoicePipeline: VoicePipeline | null = null;

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 048-A: Initialize development mode enhancements
if (isDev) {
  initializeDevMode();
}

// Performance timer for startup
const startupTimer = new PerformanceTimer('Startup');

/**
 * Create the main application window
 */
function createWindow(): void {
  startupTimer.start('createWindow');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Enable sandbox for security - native modules handled via IPC
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    frame: true,
    show: false, // Don't show until ready
    backgroundColor: '#0a0a0f', // Dark background matching Atlas theme
    title: 'Atlas',
  });

  // 048-A: Configure window with dev enhancements
  if (isDev) {
    const devHelper = getDevHelper();
    devHelper.configureWindow(mainWindow);
  }

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // DevTools handled by DevHelper via state persistence
  } else {
    // In production, load from built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.setAlwaysOnTop(true);
    setTimeout(() => {
      mainWindow?.setAlwaysOnTop(false);
    }, 1000);
    startupTimer.end('createWindow');
    mainLogger.info('Main window ready and focused');
  });

  // Force show window after 3 seconds in case ready-to-show doesn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainLogger.warn('Window not visible after timeout, forcing show');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainLogger.info('Main window closed');
  });

  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    mainLogger.error(`Failed to load: ${errorCode} - ${errorDescription}`);
  });
}

/**
 * App lifecycle events
 */

// Create window when Electron is ready
app.whenReady().then(async () => {
  startupTimer.end('appReady');
  mainLogger.info('App ready, creating window...');

  // Register voice pipeline IPC handlers
  registerIPCHandlers();

  // Register autonomous trading IPC handlers
  registerTradingIpcHandlers();

  createWindow();

  // Set the main window for IPC event forwarding
  if (mainWindow) {
    setMainWindow(mainWindow);
  }

  // Initialize system tray
  try {
    tray = await initializeTray(mainWindow || undefined);
    setupTrayIntegration();
    mainLogger.info('System tray initialized');
  } catch (error) {
    mainLogger.error('Failed to initialize system tray', { error: (error as Error).message });
  }

  // 047-B: Initialize global keyboard shortcuts
  try {
    if (mainWindow) {
      const shortcutManager = initializeShortcuts(mainWindow);

      // Forward shortcut events to renderer
      shortcutManager.on('shortcut-activated', (action: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('atlas:shortcut', { action, timestamp: Date.now() });
        }
      });

      shortcutManager.on(
        'conflict',
        (event: { action: string; accelerator: string; message: string }) => {
          mainLogger.warn('Shortcut conflict detected', event);
        }
      );

      shortcutManager.on(
        'registration-failed',
        (event: { action: string; accelerator: string; error: string }) => {
          mainLogger.warn('Shortcut registration failed', event);
        }
      );

      mainLogger.info('Global shortcuts initialized');
    }
  } catch (error) {
    mainLogger.error('Failed to initialize shortcuts', { error: (error as Error).message });
  }

  // US-002: Warm up connections in background (non-blocking)
  startupTimer.start('connectionWarmup');
  const warmupManager = getWarmupManager();

  // Forward warmup events to renderer
  warmupManager.on('warmup-complete', (status) => {
    mainWindow?.webContents.send('atlas:warmup-status', {
      complete: true,
      services: Object.fromEntries(status),
    });
  });

  warmupManager.on('service-ready', (service, status) => {
    mainLogger.debug('Service warmed up', { service, latency: status.latencyMs });
  });

  warmupManager
    .warmup()
    .then(() => {
      startupTimer.end('connectionWarmup');
      const health = warmupManager.getHealthStatus();
      mainLogger.info('Connection warmup complete', {
        ...health,
        avgLatencyMs: warmupManager.getAverageLatency().toFixed(2),
      });
    })
    .catch((error) => {
      mainLogger.warn('Connection warmup failed', { error: (error as Error).message });
    });

  // 031-A: Start connectivity monitoring
  const connectivity = getConnectivityManager();
  connectivity.start();

  // Forward connectivity events to renderer
  connectivity.onStatusChange((online, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:connectivity-change', { online, status });
    }
  });

  mainLogger.info('Connectivity monitoring started');

  // 031-B: Start smart provider selection
  const smartProvider = getSmartProviderManager();
  smartProvider.start();

  // Forward provider change events to renderer
  smartProvider.onSTTChange((provider, oldProvider) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:provider-change', { type: 'stt', provider, oldProvider });
    }
  });

  smartProvider.onTTSChange((provider, oldProvider) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:provider-change', { type: 'tts', provider, oldProvider });
    }
  });

  smartProvider.onLLMChange((provider, oldProvider) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:provider-change', { type: 'llm', provider, oldProvider });
    }
  });

  mainLogger.info('Smart provider selection started');

  // 045-A: Start background research manager
  const researchManager = getBackgroundResearchManager();
  researchManager.start();

  // Forward research events to renderer
  researchManager.on('topic-queued', (topic) => {
    mainLogger.debug('Research topic queued', { query: topic.query });
  });

  researchManager.on('research-result', (result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:research-result', {
        query: result.query,
        summary: result.summary,
        facts: result.facts,
      });
    }
    mainLogger.debug('Research completed', { query: result.query });
  });

  researchManager.on('research-started', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:research-status', { state: 'researching' });
    }
  });

  researchManager.on('research-completed', ({ topicsResearched }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:research-status', { state: 'idle', topicsResearched });
    }
    mainLogger.info('Research session completed', { topicsResearched });
  });

  mainLogger.info('Background research manager started');

  // 045-B: Start smart notifications manager
  const notificationsManager = getSmartNotificationsManager();

  // Connect research results to notifications
  researchManager.on('research-result', (result) => {
    notificationsManager.notifyResearchComplete(result.query, result.summary, result.facts);
  });

  // Forward notification events to renderer
  notificationsManager.on('notification', (notification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:smart-notification', notification);
    }
  });

  notificationsManager.on('dismissed', (notification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:notification-dismissed', { id: notification.id });
    }
  });

  mainLogger.info('Smart notifications manager started');

  // 045-C: Start task scheduler
  const taskScheduler = getTaskScheduler();
  taskScheduler.start();

  // Forward task events to renderer
  taskScheduler.on('task-created', (task) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:task-created', task);
    }
  });

  taskScheduler.on('task-due', (task) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:task-due', task);
    }
  });

  taskScheduler.on('reminder-sent', ({ task, reminder }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:reminder-sent', { task, reminder });
    }
  });

  mainLogger.info('Task scheduler started');

  // Initialize Atlas Intelligence Platform (Palantir-style intelligence system)
  try {
    mainLogger.info('Initializing Atlas Intelligence Platform...');
    await initializeIntelligencePlatform();

    // Forward intelligence platform events to renderer
    const platformManager = getIntelligencePlatformManager();
    platformManager.on('module-ready', (moduleName: string) => {
      mainLogger.debug(`Intelligence module ready: ${moduleName}`);
    });
    platformManager.on('initialized', (status) => {
      mainLogger.info('Atlas Intelligence Platform initialized', {
        startupTime: status.startupTime,
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('intelligence:ready', status);
      }
    });
    platformManager.on('error', (error) => {
      mainLogger.error('Intelligence platform error', { error: (error as Error).message });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('intelligence:error', { error: (error as Error).message });
      }
    });

    mainLogger.info('Atlas Intelligence Platform ready');
  } catch (error) {
    // Non-fatal - intelligence platform is optional but reduces functionality
    mainLogger.warn('Failed to initialize Atlas Intelligence Platform', {
      error: (error as Error).message,
    });
  }

  // T4-Phase 8: Initialize GEPA self-improvement system
  try {
    await initializeGEPA();
    mainLogger.info('GEPA self-improvement system initialized');
  } catch (error) {
    mainLogger.warn('Failed to initialize GEPA system', { error: (error as Error).message });
  }

  // T3-Phase 5-6: Register Trading & Finance IPC handlers
  try {
    registerTradingHandlers();
    registerFinanceIPC();
    registerDashboardIPC();
    registerBusinessIPCHandlers();
    mainLogger.info('Trading, Finance, Dashboard & Business IPC handlers registered');
  } catch (error) {
    mainLogger.warn('Failed to register Trading/Finance/Dashboard/Business handlers', {
      error: (error as Error).message,
    });
  }

  // Initialize Business Module (CRM, projects, time tracking, invoicing)
  try {
    mainLogger.info('Initializing Business Module...');
    await initializeBusinessModule();

    // Forward business events to renderer
    const businessModule = getBusinessModule();
    businessModule.followUps.on('reminder', (reminder) => {
      mainWindow?.webContents.send('business:reminder', reminder);
    });
    businessModule.followUps.on('reminders-updated', (reminders) => {
      mainWindow?.webContents.send('business:reminders-updated', reminders);
    });
    businessModule.time.on('timer-started', (timer) => {
      mainWindow?.webContents.send('business:timer-started', timer);
    });
    businessModule.time.on('timer-stopped', (entry) => {
      mainWindow?.webContents.send('business:timer-stopped', entry);
    });
    businessModule.invoices.on('invoice-created', (invoice) => {
      mainWindow?.webContents.send('business:invoice-created', invoice);
    });
    businessModule.invoices.on('payment-received', (data) => {
      mainWindow?.webContents.send('business:payment-received', data);
    });

    mainLogger.info('Business Module initialized successfully');

    // Initialize Business Voice Integration - Wire business context into voice pipeline
    try {
      await initializeBusinessVoiceIntegration();
      mainLogger.info('Business Voice Integration initialized');
    } catch (voiceError) {
      mainLogger.warn('Failed to initialize Business Voice Integration', {
        error: (voiceError as Error).message,
      });
    }
  } catch (error) {
    mainLogger.warn('Failed to initialize Business Module', {
      error: (error as Error).message,
    });
  }

  // Initialize autonomous trading system (connects to Go backend)
  try {
    await initializeTradingSystem();

    // Connect trading proactive messages to voice pipeline
    const voicePipeline = getVoicePipeline();
    voicePipeline.connectTradingProactive();

    // Forward trading events to renderer
    const tradingSystem = getTradingSystem();
    tradingSystem.on('trade', (trade) => {
      mainWindow?.webContents.send('trading:trade', trade);
    });
    tradingSystem.on('position', (position) => {
      mainWindow?.webContents.send('trading:position', position);
    });
    tradingSystem.on('regime-change', (regime) => {
      mainWindow?.webContents.send('trading:regime-change', regime);
    });
    tradingSystem.on('risk-alert', (alert) => {
      mainWindow?.webContents.send('trading:risk-alert', alert);
    });
    tradingSystem.on('ws-connected', () => {
      mainWindow?.webContents.send('trading:ws-status', { connected: true });
    });
    tradingSystem.on('ws-disconnected', () => {
      mainWindow?.webContents.send('trading:ws-status', { connected: false });
    });

    mainLogger.info('Autonomous trading system initialized');

    // Initialize Trading Voice Integration - Wire trading context into voice pipeline
    try {
      await initializeTradingVoiceIntegration();
      mainLogger.info('Trading Voice Integration initialized');
    } catch (voiceError) {
      mainLogger.warn('Failed to initialize Trading Voice Integration', {
        error: (voiceError as Error).message,
      });
    }
  } catch (error) {
    // Non-fatal - trading is optional
    mainLogger.warn('Failed to initialize trading system (Go backend may not be running)', {
      error: (error as Error).message,
    });
  }

  // Initialize Finance Intelligence - Market research, watchlists, alerts
  try {
    const { getFinanceIntelligence, seedFinanceIntelligence } =
      await import('./trading/finance-intelligence');
    const { seedFinanceIntelligence: seedData } = await import('./trading/finance-seed');

    const fi = getFinanceIntelligence();
    await fi.initialize();
    fi.startAlertMonitoring();

    // Seed with initial research data
    await seedData();

    // Forward alert events to renderer
    fi.on('alert-triggered', (alert) => {
      mainWindow?.webContents.send('finance:alert-triggered', alert);
      // Also speak the alert via voice pipeline
      const voicePipeline = getVoicePipeline();
      voicePipeline.speakProactive(
        `Alert: ${alert.ticker} hit ${alert.targetPrice}. ${alert.action}`,
        { priority: 'high' }
      );
    });

    fi.on('watchlist-added', (entry) => {
      mainWindow?.webContents.send('finance:watchlist-updated', { type: 'added', entry });
    });

    mainLogger.info('Finance Intelligence initialized', {
      research: fi.getAllResearch().length,
      watchlist: fi.getWatchlist().length,
      alerts: fi.getActiveAlerts().length,
    });
  } catch (error) {
    mainLogger.warn('Failed to initialize Finance Intelligence', {
      error: (error as Error).message,
    });
  }

  // Register Banking IPC handlers (UK Open Banking)
  try {
    const { registerBankingIPC } = await import('./banking/ipc');
    registerBankingIPC();
    mainLogger.info('Banking IPC handlers registered');
  } catch (error) {
    mainLogger.warn('Failed to register Banking handlers', {
      error: (error as Error).message,
    });
  }

  // Initialize Atlas Core - The autonomous coding brain
  mainLogger.info('Starting Atlas Core initialization...');
  try {
    const { initializeAtlas } = await import('./atlas-core');
    const atlas = await initializeAtlas({
      voiceEnabled: false,
      wakeWord: 'hey atlas',
      screenMonitoring: false, // Disabled - causes memory issues and DirectX crashes
      autonomous: true,
      autoCommit: true,
      crossProjectLearning: true,
      llmProvider: 'fireworks',
      model: 'accounts/fireworks/models/deepseek-v3p2',
      voiceAlerts: false,
    });

    // Forward Atlas events to renderer
    atlas.on('taskStarted', (task) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('atlas:task-started', task);
      }
    });

    atlas.on('taskCompleted', (task) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('atlas:task-completed', task);
      }
    });

    atlas.on('errorDetected', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('atlas:error-detected', error);
      }
    });

    atlas.on('autoCommit', (record) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('atlas:auto-commit', record);
      }
    });

    mainLogger.info('Atlas Core initialized - Autonomous coding agent ready');
  } catch (error) {
    mainLogger.warn('Failed to initialize Atlas Core', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }

  // Initialize Code Intelligence - Enables Atlas to understand and modify its own codebase
  try {
    mainLogger.info('Initializing Code Intelligence...');

    // Register IPC handlers first
    registerCodeIntelligenceHandlers();
    setCodeIntelligenceMainWindow(mainWindow);

    // Initialize with Atlas's own codebase as the workspace root
    // This enables self-coding capabilities
    const workspaceRoot = app.isPackaged
      ? undefined // Use cwd in production
      : process.cwd(); // Dev: use project root

    await initializeCodeIntelligence(workspaceRoot);

    const status = getCodeIntelligenceStatus();
    mainLogger.info('Code Intelligence initialized', {
      workspaceRoot: status.workspaceRoot,
      indexingComplete: status.indexingComplete,
    });

    // Forward code intelligence events to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('code-intelligence:ready', status);
    }
  } catch (error) {
    // Non-fatal - code intelligence is optional but reduces self-coding capability
    mainLogger.warn('Failed to initialize Code Intelligence', {
      error: (error as Error).message,
    });
  }

  // Initialize auto-updater (checks for updates on startup and every 4 hours)
  try {
    const autoUpdateMgr = getAutoUpdateManager();
    autoUpdateMgr.setMainWindow(mainWindow);
    await autoUpdateMgr.start();
    mainLogger.info('Auto-updater initialized');
  } catch (error) {
    mainLogger.warn('Failed to initialize auto-updater', { error: (error as Error).message });
  }

  // Initialize lazy loading for non-critical modules (after window is ready)
  startupTimer.start('lazyLoaderInit');
  const lazyLoader = initializeLazyLoading();

  // Forward lazy loader events to renderer
  lazyLoader.on('module-loaded', (name, loadTimeMs) => {
    mainLogger.debug('Module lazy loaded', { name, loadTimeMs: loadTimeMs.toFixed(2) });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:module-loaded', { name, loadTimeMs });
    }
  });

  lazyLoader.on('all-loaded', (stats: LoadStats) => {
    const improvement = lazyLoader.getStartupImprovement();
    mainLogger.info('All lazy modules loaded', {
      totalModules: stats.totalModules,
      loadedModules: stats.loadedModules,
      failedModules: stats.failedModules,
      totalLoadTimeMs: stats.totalLoadTimeMs.toFixed(2),
      startupSavingsMs: improvement.estimatedSavingsMs,
      savingsPercent: improvement.savingsPercent,
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('atlas:lazy-load-complete', { stats, improvement });
    }
  });

  startupTimer.end('lazyLoaderInit');
  mainLogger.info('Lazy loader initialized', {
    registeredModules: lazyLoader.getStats().totalModules,
  });

  // Preload high-priority modules after initial render (non-blocking)
  // This ensures the UI is responsive first, then loads needed modules
  setTimeout(async () => {
    try {
      mainLogger.debug('Starting high-priority module preload...');
      await lazyLoader.loadByPriority('high');
      mainLogger.info('High-priority modules preloaded');
    } catch (error) {
      mainLogger.warn('High-priority preload failed', { error: (error as Error).message });
    }
  }, 1000); // Wait 1s after startup for UI to stabilize

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) {
        setMainWindow(mainWindow);
        tray?.setMainWindow(mainWindow);
      }
    }
  });
});

/**
 * Setup tray integration with voice pipeline
 */
function setupTrayIntegration(): void {
  if (!tray) return;

  // Handle push-to-talk from tray
  tray.on('push-to-talk', async () => {
    voiceLogger.info('Push-to-talk triggered from tray');
    try {
      if (!fullVoicePipeline) {
        fullVoicePipeline = getVoicePipeline();
        connectPipelineToTray(fullVoicePipeline);
      }
      fullVoicePipeline.triggerWake();
    } catch (error) {
      voiceLogger.error('Push-to-talk failed', { error: (error as Error).message });
    }
  });

  // Handle start pipeline from tray
  tray.on('start-pipeline', async () => {
    voiceLogger.info('Starting pipeline from tray');
    try {
      if (!fullVoicePipeline) {
        fullVoicePipeline = getVoicePipeline();
        connectPipelineToTray(fullVoicePipeline);
      }
      await fullVoicePipeline.start();
      tray?.setRunning(true);
    } catch (error) {
      voiceLogger.error('Failed to start pipeline from tray', { error: (error as Error).message });
    }
  });

  // Handle stop pipeline from tray
  tray.on('stop-pipeline', async () => {
    voiceLogger.info('Stopping pipeline from tray');
    try {
      if (fullVoicePipeline) {
        await fullVoicePipeline.stop();
        tray?.setRunning(false);
      }
    } catch (error) {
      voiceLogger.error('Failed to stop pipeline from tray', { error: (error as Error).message });
    }
  });

  // Handle toggle window from tray
  tray.on('toggle-window', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // Handle settings from tray
  tray.on('settings', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // Send event to renderer to open settings
      mainWindow.webContents.send('atlas:open-settings');
    }
  });

  voiceLogger.info('Tray integration setup complete');
}

/**
 * Connect voice pipeline events to tray state
 */
function connectPipelineToTray(pipeline: VoicePipeline): void {
  if (!tray) return;

  pipeline.on('state-change', (state: VoicePipelineState) => {
    tray?.setState(state);
  });

  pipeline.on('started', () => {
    tray?.setRunning(true);
    tray?.setState('idle');
  });

  pipeline.on('stopped', () => {
    tray?.setRunning(false);
    tray?.setState('idle');
  });

  pipeline.on('error', () => {
    tray?.setState('error');
  });

  voiceLogger.info('Pipeline connected to tray');
}

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    mainLogger.info('All windows closed, quitting app');
    app.quit();
  }
});

// Track if cleanup is in progress to prevent double cleanup
let isCleaningUp = false;

// Handle app before quit - use will-quit with proper async handling
app.on('will-quit', (event) => {
  // Prevent default quit to allow async cleanup
  if (!isCleaningUp) {
    event.preventDefault();
    isCleaningUp = true;

    // Mark logger as shutting down FIRST to prevent EPIPE errors
    markLoggerShuttingDown();

    mainLogger.info('App quitting, cleaning up...');

    // Perform async cleanup then exit
    // First shutdown sync services
    shutdownDevHelper(); // 048-A: Shutdown dev helper
    shutdownBackgroundResearchManager(); // 045-A: Shutdown research manager
    shutdownSmartNotificationsManager(); // 045-B: Shutdown notifications manager
    shutdownTaskScheduler(); // 045-C: Shutdown task scheduler
    shutdownUpdater(); // Shutdown auto-updater
    shutdownSmartProviderManager();
    shutdownConnectivityManager();
    shutdownLazyLoader(); // Shutdown lazy loader (sync)

    // Shutdown Code Intelligence
    try {
      unregisterCodeIntelligenceHandlers();
      shutdownCodeIntelligence();
    } catch (e) {
      mainLogger.error('Code Intelligence cleanup error', { error: (e as Error).message });
    }
    shutdownShortcuts(); // 047-B: Shutdown global shortcuts

    // Shutdown Atlas Intelligence Platform
    shutdownIntelligencePlatform().catch((e) =>
      mainLogger.error('Intelligence platform shutdown error', { error: (e as Error).message })
    );

    // T3-Phase 5-6: Unregister Trading & Finance IPC handlers
    try {
      unregisterTradingHandlers();
      unregisterFinanceIPC();
    } catch (e) {
      mainLogger.error('Trading/Finance cleanup error', { error: (e as Error).message });
    }

    // Unregister Banking IPC handlers
    try {
      const { unregisterBankingIPC } = require('./banking/ipc');
      unregisterBankingIPC();
    } catch (e) {
      mainLogger.error('Banking cleanup error', { error: (e as Error).message });
    }

    // Shutdown Business Module
    try {
      const businessModule = getBusinessModule();
      businessModule
        .shutdown()
        .catch((e) =>
          mainLogger.error('Business module cleanup error', { error: (e as Error).message })
        );
      // Shutdown Business Voice Integration
      shutdownBusinessVoiceIntegration();
      // Shutdown Trading Voice Integration
      shutdownTradingVoiceIntegration();
    } catch (e) {
      mainLogger.error('Business module cleanup error', { error: (e as Error).message });
    }

    // T4-Phase 8: Shutdown GEPA system
    const shutdownGEPA = async (): Promise<void> => {
      try {
        await cleanupGEPA();
      } catch (e) {
        mainLogger.error('GEPA cleanup error', { error: (e as Error).message });
      }
    };

    Promise.all([
      shutdownGEPA(),
      shutdownTray().catch((e) =>
        mainLogger.error('Tray shutdown error', { error: (e as Error).message })
      ),
      cleanupIPC().catch((e) =>
        mainLogger.error('IPC cleanup error', { error: (e as Error).message })
      ),
      Promise.resolve(unregisterTradingIpcHandlers()).catch((e) =>
        mainLogger.error('Trading IPC cleanup error', { error: (e as Error).message })
      ),
      shutdownVoicePipeline().catch((e) =>
        mainLogger.error('Voice pipeline shutdown error', { error: (e as Error).message })
      ),
      shutdownAudioPipeline().catch((e) =>
        mainLogger.error('Audio pipeline shutdown error', { error: (e as Error).message })
      ),
      shutdownWakeWordDetector().catch((e) =>
        mainLogger.error('Wake word shutdown error', { error: (e as Error).message })
      ),
    ])
      .then(() => shutdownLogger())
      .catch((e) => console.error('Logger shutdown error:', e))
      .finally(() => {
        mainLogger.info('Cleanup complete, exiting');
        app.exit(0);
      });
  }
});

/**
 * Voice Pipeline Setup
 */
let wakeWordDetector: WakeWordDetector | null = null;

/**
 * Initialize voice pipeline components
 */
async function initializeVoicePipeline(): Promise<void> {
  if (!isConfigValid()) {
    voiceLogger.warn('Voice pipeline disabled - missing API keys');
    return;
  }

  try {
    voiceLogger.info('Initializing voice pipeline...');
    wakeWordDetector = getWakeWordDetector();

    // Set up wake word event handlers
    wakeWordDetector.on('wake', (event: WakeWordEvent) => {
      voiceLogger.info('Wake word detected!', {
        keyword: event.keyword,
        confidence: event.confidence,
      });
      // Send to renderer
      mainWindow?.webContents.send('atlas:status', {
        type: 'wake-word',
        event,
      });
    });

    // Throttle audio level updates to prevent flooding (~30fps)
    let lastWakeWordAudioLevelTime = 0;
    wakeWordDetector.on('audio-level', (level: number) => {
      const now = Date.now();
      if (now - lastWakeWordAudioLevelTime > 33) {
        lastWakeWordAudioLevelTime = now;
        mainWindow?.webContents.send('atlas:audio-level', level);
      }
    });

    wakeWordDetector.on('error', (error: Error) => {
      voiceLogger.error('Wake word detector error', { error: error.message });
      mainWindow?.webContents.send('atlas:error', {
        type: 'wake-word',
        message: error.message,
      });
    });

    wakeWordDetector.on('started', () => {
      voiceLogger.info('Wake word detection started');
      mainWindow?.webContents.send('atlas:status', {
        type: 'wake-word-started',
      });
    });

    wakeWordDetector.on('stopped', () => {
      voiceLogger.info('Wake word detection stopped');
      mainWindow?.webContents.send('atlas:status', {
        type: 'wake-word-stopped',
      });
    });

    voiceLogger.info('Voice pipeline initialized');
  } catch (error) {
    voiceLogger.error('Failed to initialize voice pipeline', {
      error: (error as Error).message,
    });
  }
}

/**
 * IPC Handlers
 * Communication between main and renderer processes
 */

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get app path
ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

// Check if in development mode
ipcMain.handle('is-dev', () => {
  return isDev;
});

// Get Atlas status
ipcMain.handle('get-atlas-status', () => {
  const validation = getConfigValidation();
  return {
    status: isConfigValid() ? 'ready' : 'missing-config',
    version: app.getVersion(),
    isDev,
    configValid: validation.valid,
    missingKeys: validation.missing,
  };
});

// Get safe config (masked API keys)
ipcMain.handle('get-config', () => {
  return getSafeConfig();
});

/**
 * Renderer Logging IPC
 * Allows renderer to log through main process logger
 */
ipcMain.handle(
  'log',
  (_event, level: string, module: string, message: string, meta?: Record<string, unknown>) => {
    const logger = createModuleLogger(`Renderer:${module}`);
    switch (level) {
      case 'debug':
        logger.debug(message, meta);
        break;
      case 'info':
        logger.info(message, meta);
        break;
      case 'warn':
        logger.warn(message, meta);
        break;
      case 'error':
        logger.error(message, meta);
        break;
      default:
        logger.info(message, meta);
    }
  }
);

/**
 * Security: Prevent new window creation
 */
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});

// Start timing
startupTimer.start('appReady');

// Log startup info
mainLogger.info('Starting Atlas Desktop...', {
  environment: isDev ? 'development' : 'production',
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  configValid: isConfigValid(),
});

if (!isConfigValid()) {
  const validation = getConfigValidation();
  mainLogger.warn('Missing API keys', { missing: validation.missing });
}

ipcLogger.info('IPC handlers registered');

/**
 * Voice Pipeline IPC Handlers
 */

// Start wake word detection
ipcMain.handle('voice:start-wake-word', async () => {
  if (!wakeWordDetector) {
    await initializeVoicePipeline();
  }
  if (wakeWordDetector) {
    await wakeWordDetector.start();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Stop wake word detection
ipcMain.handle('voice:stop-wake-word', async () => {
  if (wakeWordDetector) {
    await wakeWordDetector.stop();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Pause wake word detection
ipcMain.handle('voice:pause-wake-word', () => {
  if (wakeWordDetector) {
    wakeWordDetector.pause();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Resume wake word detection
ipcMain.handle('voice:resume-wake-word', () => {
  if (wakeWordDetector) {
    wakeWordDetector.resume();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Set wake word sensitivity
ipcMain.handle('voice:set-sensitivity', (_event, sensitivity: number) => {
  if (wakeWordDetector) {
    try {
      wakeWordDetector.setSensitivity(sensitivity);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Get audio devices
ipcMain.handle('voice:get-audio-devices', () => {
  return WakeWordDetector.getAudioDevices();
});

// Set audio device
ipcMain.handle('voice:set-audio-device', (_event, deviceIndex: number) => {
  if (wakeWordDetector) {
    wakeWordDetector.setAudioDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Get voice pipeline status
ipcMain.handle('voice:get-status', () => {
  return {
    wakeWordActive: wakeWordDetector?.running ?? false,
    wakeWordPaused: wakeWordDetector?.paused ?? false,
    configValid: isConfigValid(),
  };
});

// Refresh audio devices (036-B: Multiple Audio Sources)
ipcMain.handle('voice:refresh-audio-devices', () => {
  const { getAudioDeviceManager } = require('./voice/audio-device-manager');
  const deviceManager = getAudioDeviceManager();
  const changeEvent = deviceManager.refreshDevices();
  const devices = deviceManager.getInputDevices();
  return {
    success: true,
    devices,
    changed: changeEvent !== null,
  };
});

// Start device monitoring (036-B: Multiple Audio Sources)
ipcMain.handle('voice:start-device-monitoring', () => {
  try {
    const { getAudioDeviceManager } = require('./voice/audio-device-manager');
    const deviceManager = getAudioDeviceManager();
    deviceManager.startMonitoring();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Stop device monitoring (036-B: Multiple Audio Sources)
ipcMain.handle('voice:stop-device-monitoring', () => {
  try {
    const { getAudioDeviceManager } = require('./voice/audio-device-manager');
    const deviceManager = getAudioDeviceManager();
    deviceManager.stopMonitoring();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

voiceLogger.info('Voice IPC handlers registered');

/**
 * Audio Pipeline IPC Handlers
 */
let audioPipeline: AudioPipeline | null = null;

/**
 * Initialize the audio pipeline with event forwarding to renderer
 */
async function initializeAudioPipeline(): Promise<AudioPipeline> {
  if (audioPipeline) {
    return audioPipeline;
  }

  audioPipeline = getAudioPipeline();

  // Forward state changes to renderer
  audioPipeline.on(
    'state-change',
    (state: VoicePipelineState, previousState: VoicePipelineState) => {
      mainWindow?.webContents.send('atlas:pipeline-state', { state, previousState });
    }
  );

  // Forward wake word events
  audioPipeline.on('wake-word', (event: WakeWordEvent) => {
    mainWindow?.webContents.send('atlas:wake-word', event);
  });

  // Forward speech events
  audioPipeline.on('speech-start', (event) => {
    mainWindow?.webContents.send('atlas:speech-start', event);
  });

  audioPipeline.on('speech-segment', (segment: SpeechSegment) => {
    // Convert Float32Array to base64 for IPC (can't send typed arrays directly)
    const audioBase64 = Buffer.from(segment.audio.buffer).toString('base64');
    mainWindow?.webContents.send('atlas:speech-segment', {
      ...segment,
      audio: audioBase64,
    });
  });

  // Forward audio level
  audioPipeline.on('audio-level', (level: number) => {
    mainWindow?.webContents.send('atlas:audio-level', level);
  });

  // Forward errors
  audioPipeline.on('error', (error: Error) => {
    voiceLogger.error('Pipeline error', { error: error.message });
    mainWindow?.webContents.send('atlas:error', {
      type: 'pipeline',
      message: error.message,
    });
  });

  // Forward barge-in
  audioPipeline.on('barge-in', () => {
    mainWindow?.webContents.send('atlas:barge-in');
  });

  // Forward timeouts
  audioPipeline.on('listening-timeout', () => {
    mainWindow?.webContents.send('atlas:listening-timeout');
  });

  audioPipeline.on('processing-timeout', () => {
    mainWindow?.webContents.send('atlas:processing-timeout');
  });

  voiceLogger.info('Audio pipeline initialized with IPC event forwarding');
  return audioPipeline;
}

// Start audio pipeline
ipcMain.handle('pipeline:start', async () => {
  try {
    const pipeline = await initializeAudioPipeline();
    await pipeline.start();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Stop audio pipeline
ipcMain.handle('pipeline:stop', async () => {
  if (audioPipeline) {
    await audioPipeline.stop();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Get pipeline status
ipcMain.handle('pipeline:get-status', () => {
  if (audioPipeline) {
    return audioPipeline.getStatus();
  }
  return {
    state: 'idle' as VoicePipelineState,
    isListening: false,
    isSpeaking: false,
    audioLevel: 0,
  };
});

// Trigger manual wake (push-to-talk)
ipcMain.handle('pipeline:trigger-wake', () => {
  if (audioPipeline) {
    audioPipeline.triggerWake();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Cancel current interaction
ipcMain.handle('pipeline:cancel', () => {
  if (audioPipeline) {
    audioPipeline.cancel();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Pause pipeline
ipcMain.handle('pipeline:pause', () => {
  if (audioPipeline) {
    audioPipeline.pause();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Resume pipeline
ipcMain.handle('pipeline:resume', () => {
  if (audioPipeline) {
    audioPipeline.resume();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Set input device
ipcMain.handle('pipeline:set-input-device', (_event, deviceIndex: number) => {
  if (audioPipeline) {
    audioPipeline.setInputDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Set output device
ipcMain.handle('pipeline:set-output-device', (_event, deviceIndex: number) => {
  if (audioPipeline) {
    audioPipeline.setOutputDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Get pipeline config
ipcMain.handle('pipeline:get-config', () => {
  if (audioPipeline) {
    return audioPipeline.getConfig();
  }
  return null;
});

// Update pipeline config
ipcMain.handle('pipeline:update-config', (_event, config: Record<string, unknown>) => {
  if (audioPipeline) {
    audioPipeline.updateConfig(config);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Signal that processing is complete, start speaking
ipcMain.handle('pipeline:start-speaking', () => {
  if (audioPipeline) {
    audioPipeline.startSpeaking();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Signal that speaking is complete
ipcMain.handle('pipeline:finish-speaking', () => {
  if (audioPipeline) {
    audioPipeline.finishSpeaking();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

voiceLogger.info('Pipeline IPC handlers registered');

/**
 * Warmup Manager IPC Handlers
 * US-002: Connection warmup status
 */

// Get warmup status
ipcMain.handle('warmup:get-status', () => {
  const warmupMgr = getWarmupManager();
  return {
    success: true,
    data: {
      isReady: warmupMgr.isReady(),
      health: warmupMgr.getHealthStatus(),
      avgLatencyMs: warmupMgr.getAverageLatency(),
      services: Object.fromEntries(warmupMgr.getStatus()),
    },
  };
});

mainLogger.info('Warmup IPC handlers registered');

/**
 * Lazy Loader IPC Handlers
 * Module loading status and control
 */

// Get lazy loader statistics
ipcMain.handle('lazy:get-stats', () => {
  const loader = getLazyLoader();
  return {
    success: true,
    data: {
      stats: loader.getStats(),
      improvement: loader.getStartupImprovement(),
    },
  };
});

// Check if a specific module is loaded
ipcMain.handle('lazy:is-loaded', (_event, moduleName: string) => {
  const loader = getLazyLoader();
  return {
    success: true,
    data: loader.isLoaded(moduleName),
  };
});

// Get module status
ipcMain.handle('lazy:get-module-status', (_event, moduleName: string) => {
  const loader = getLazyLoader();
  return {
    success: true,
    data: loader.getModuleStatus(moduleName),
  };
});

// Request to load a specific module
ipcMain.handle('lazy:load-module', async (_event, moduleName: string) => {
  const loader = getLazyLoader();
  try {
    await loader.load(moduleName);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Request to preload modules immediately
ipcMain.handle('lazy:preload-now', async (_event, moduleNames: string[]) => {
  const loader = getLazyLoader();
  try {
    await loader.preloadNow(moduleNames);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Get startup improvement metrics
ipcMain.handle('lazy:get-improvement', () => {
  const loader = getLazyLoader();
  return {
    success: true,
    data: loader.getStartupImprovement(),
  };
});

mainLogger.info('Lazy loader IPC handlers registered');
