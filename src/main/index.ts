/**
 * Nova Desktop - Electron Main Process
 * Entry point for the Electron application
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getConfig, isConfigValid, getSafeConfig, getConfigValidation } from './config';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Create the main application window
 */
function createWindow(): void {
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
    console.log('[Nova] Main window ready');
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Nova] Failed to load: ${errorCode} - ${errorDescription}`);
  });
}

/**
 * App lifecycle events
 */

// Create window when Electron is ready
app.whenReady().then(() => {
  console.log('[Nova] App ready, creating window...');
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
    app.quit();
  }
});

// Handle app before quit
app.on('before-quit', () => {
  console.log('[Nova] App quitting...');
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

// Placeholder for Nova status
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
 * Security: Prevent new window creation
 */
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});

// Log startup info
const config = getConfig();
console.log('[Nova] Starting Nova Desktop...');
console.log(`[Nova] Environment: ${isDev ? 'development' : 'production'}`);
console.log(`[Nova] Electron: ${process.versions.electron}`);
console.log(`[Nova] Node: ${process.versions.node}`);
console.log(`[Nova] Platform: ${process.platform}`);
console.log(`[Nova] Config valid: ${isConfigValid()}`);
if (!isConfigValid()) {
  const validation = getConfigValidation();
  console.warn(`[Nova] Missing API keys: ${validation.missing.join(', ')}`);
}
