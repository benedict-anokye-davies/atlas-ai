/**
 * Nova Desktop - Electron Main Process
 * Entry point for the Electron application
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getConfig, isConfigValid, getSafeConfig, getConfigValidation } from './config';
import { 
  mainLogger, 
  ipcLogger, 
  createModuleLogger, 
  shutdownLogger,
  PerformanceTimer 
} from './utils/logger';

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
  await shutdownLogger();
});

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
ipcMain.handle('log', (_event, level: string, module: string, message: string, meta?: Record<string, unknown>) => {
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
});

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
const config = getConfig();
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
