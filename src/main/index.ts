/**
 * Nova Desktop - Electron Main Process
 * Entry point for the Electron application
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { isConfigValid, getSafeConfig, getConfigValidation } from './config';
import {
  mainLogger,
  ipcLogger,
  voiceLogger,
  createModuleLogger,
  shutdownLogger,
  PerformanceTimer,
} from './utils/logger';
import { WakeWordDetector, getWakeWordDetector, shutdownWakeWordDetector } from './voice/wake-word';
import type { WakeWordEvent } from '../shared/types/voice';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
      sandbox: false, // Required for some native modules
    },
    frame: true,
    show: false, // Don't show until ready
    backgroundColor: '#0a0a0f', // Dark background matching Nova theme
    title: 'Nova',
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    startupTimer.end('createWindow');
    mainLogger.info('Main window ready');
  });

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
app.whenReady().then(() => {
  startupTimer.end('appReady');
  mainLogger.info('App ready, creating window...');
  createWindow();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    mainLogger.info('All windows closed, quitting app');
    app.quit();
  }
});

// Handle app before quit
app.on('before-quit', async () => {
  mainLogger.info('App quitting, cleaning up...');
  await shutdownWakeWordDetector();
  await shutdownLogger();
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
      mainWindow?.webContents.send('nova:status', {
        type: 'wake-word',
        event,
      });
    });

    wakeWordDetector.on('audio-level', (level: number) => {
      // Throttle audio level updates to prevent flooding
      mainWindow?.webContents.send('nova:audio-level', level);
    });

    wakeWordDetector.on('error', (error: Error) => {
      voiceLogger.error('Wake word detector error', { error: error.message });
      mainWindow?.webContents.send('nova:error', {
        type: 'wake-word',
        message: error.message,
      });
    });

    wakeWordDetector.on('started', () => {
      voiceLogger.info('Wake word detection started');
      mainWindow?.webContents.send('nova:status', {
        type: 'wake-word-started',
      });
    });

    wakeWordDetector.on('stopped', () => {
      voiceLogger.info('Wake word detection stopped');
      mainWindow?.webContents.send('nova:status', {
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

// Get Nova status
ipcMain.handle('get-nova-status', () => {
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
mainLogger.info('Starting Nova Desktop...', {
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

voiceLogger.info('Voice IPC handlers registered');
