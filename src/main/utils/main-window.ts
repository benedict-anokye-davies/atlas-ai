/**
 * Atlas Desktop - Main Window Manager
 * Centralized access to the main BrowserWindow instance
 * 
 * Eliminates repeated pattern:
 *   BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
 */

import { BrowserWindow } from 'electron';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('MainWindow');

// ============================================================================
// Main Window Reference
// ============================================================================

let mainWindowRef: BrowserWindow | null = null;

/**
 * Set the main window reference
 * Should be called in main/index.ts after creating the BrowserWindow
 * 
 * @param window - The main BrowserWindow instance
 */
export function setMainWindow(window: BrowserWindow): void {
  mainWindowRef = window;
  
  // Clear reference when window is closed
  window.on('closed', () => {
    mainWindowRef = null;
  });
  
  logger.debug('Main window reference set');
}

/**
 * Get the main window reference
 * Falls back to focused window or first available window
 * 
 * @returns The main BrowserWindow or null if none available
 */
export function getMainWindow(): BrowserWindow | null {
  // Try stored reference first
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    return mainWindowRef;
  }
  
  // Fallback to focused window
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  
  // Fallback to first available window
  const all = BrowserWindow.getAllWindows();
  if (all.length > 0 && !all[0].isDestroyed()) {
    return all[0];
  }
  
  return null;
}

/**
 * Get the main window's webContents
 * 
 * @returns WebContents or null if no window available
 */
export function getMainWebContents(): Electron.WebContents | null {
  const window = getMainWindow();
  return window?.webContents ?? null;
}

/**
 * Send a message to the main window
 * Safe wrapper that checks for window existence
 * 
 * @param channel - IPC channel name
 * @param args - Arguments to send
 * @returns true if message was sent, false if no window available
 */
export function sendToMainWindow(channel: string, ...args: unknown[]): boolean {
  const webContents = getMainWebContents();
  if (!webContents || webContents.isDestroyed()) {
    logger.debug('Cannot send to main window - not available', { channel });
    return false;
  }
  
  webContents.send(channel, ...args);
  return true;
}

/**
 * Focus the main window
 * 
 * @returns true if window was focused, false if not available
 */
export function focusMainWindow(): boolean {
  const window = getMainWindow();
  if (!window) return false;
  
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
  return true;
}

/**
 * Show the main window
 * 
 * @returns true if window was shown, false if not available
 */
export function showMainWindow(): boolean {
  const window = getMainWindow();
  if (!window) return false;
  
  window.show();
  return true;
}

/**
 * Hide the main window
 * 
 * @returns true if window was hidden, false if not available
 */
export function hideMainWindow(): boolean {
  const window = getMainWindow();
  if (!window) return false;
  
  window.hide();
  return true;
}

/**
 * Check if main window is available and not destroyed
 */
export function isMainWindowAvailable(): boolean {
  const window = getMainWindow();
  return window !== null && !window.isDestroyed();
}

/**
 * Check if main window is focused
 */
export function isMainWindowFocused(): boolean {
  const window = getMainWindow();
  return window !== null && window.isFocused();
}

/**
 * Check if main window is visible
 */
export function isMainWindowVisible(): boolean {
  const window = getMainWindow();
  return window !== null && window.isVisible();
}
