/* eslint-disable no-console */
/**
 * Atlas Desktop - Development State Persistence
 * Preserves application state across main process restarts (048-A)
 *
 * Features:
 * - Window position and size persistence
 * - Voice pipeline state preservation
 * - Settings state preservation
 * - Quick state save/restore for HMR
 *
 * @module dev/state-persistence
 */

import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';

/**
 * Persisted window state
 */
export interface PersistedWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
  isDevToolsOpen: boolean;
}

/**
 * Persisted voice state
 */
export interface PersistedVoiceState {
  pipelineActive: boolean;
  wakeWordActive: boolean;
  inputDeviceIndex: number;
  outputDeviceIndex: number;
}

/**
 * Full persisted state
 */
export interface PersistedDevState {
  timestamp: number;
  window?: PersistedWindowState;
  voice?: PersistedVoiceState;
  lastUrl?: string;
  devServerPort: number;
}

/**
 * Default state
 */
const DEFAULT_STATE: PersistedDevState = {
  timestamp: Date.now(),
  window: {
    width: 1200,
    height: 800,
    isMaximized: false,
    isFullScreen: false,
    isDevToolsOpen: false,
  },
  devServerPort: 5173,
};

/**
 * State persistence manager for development mode
 */
export class DevStatePersistence {
  private stateFilePath: string;
  private state: PersistedDevState;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Store in .atlas/dev-state.json
    const atlasDir = path.join(homedir(), '.atlas');
    if (!fs.existsSync(atlasDir)) {
      fs.mkdirSync(atlasDir, { recursive: true });
    }
    this.stateFilePath = path.join(atlasDir, 'dev-state.json');
    this.state = this.loadState();
  }

  /**
   * Load state from disk
   */
  private loadState(): PersistedDevState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(data) as PersistedDevState;

        // Check if state is fresh (less than 30 seconds old)
        // Stale state means it was from a previous session, not a HMR reload
        const age = Date.now() - parsed.timestamp;
        if (age < 30000) {
          console.log('[DevState] Loaded fresh state from', age, 'ms ago');
          return parsed;
        } else {
          console.log('[DevState] State too old (' + Math.round(age / 1000) + 's), using defaults');
        }
      }
    } catch (error) {
      console.warn('[DevState] Failed to load state:', error);
    }
    return { ...DEFAULT_STATE, timestamp: Date.now() };
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      this.state.timestamp = Date.now();
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.warn('[DevState] Failed to save state:', error);
    }
  }

  /**
   * Debounced save to avoid excessive disk writes
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveState();
      this.saveDebounceTimer = null;
    }, 100);
  }

  /**
   * Save window state
   */
  saveWindowState(window: BrowserWindow): void {
    const bounds = window.getBounds();
    this.state.window = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
      isDevToolsOpen: window.webContents.isDevToolsOpened(),
    };
    this.debouncedSave();
  }

  /**
   * Get window state for restoration
   */
  getWindowState(): PersistedWindowState {
    return this.state.window || DEFAULT_STATE.window!;
  }

  /**
   * Save voice pipeline state
   */
  saveVoiceState(state: Partial<PersistedVoiceState>): void {
    this.state.voice = {
      pipelineActive: state.pipelineActive ?? this.state.voice?.pipelineActive ?? false,
      wakeWordActive: state.wakeWordActive ?? this.state.voice?.wakeWordActive ?? false,
      inputDeviceIndex: state.inputDeviceIndex ?? this.state.voice?.inputDeviceIndex ?? 0,
      outputDeviceIndex: state.outputDeviceIndex ?? this.state.voice?.outputDeviceIndex ?? 0,
    };
    this.debouncedSave();
  }

  /**
   * Get voice state for restoration
   */
  getVoiceState(): PersistedVoiceState | undefined {
    return this.state.voice;
  }

  /**
   * Save the current URL (for WebSocket reconnection)
   */
  saveLastUrl(url: string): void {
    this.state.lastUrl = url;
    this.debouncedSave();
  }

  /**
   * Get last URL
   */
  getLastUrl(): string | undefined {
    return this.state.lastUrl;
  }

  /**
   * Get dev server port
   */
  getDevServerPort(): number {
    return this.state.devServerPort;
  }

  /**
   * Force save state immediately
   */
  forceSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.saveState();
  }

  /**
   * Clear persisted state
   */
  clear(): void {
    this.state = { ...DEFAULT_STATE, timestamp: Date.now() };
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if this is a fresh restart (HMR reload)
   */
  isFreshRestart(): boolean {
    // State is fresh if less than 30 seconds old
    return Date.now() - this.state.timestamp < 30000;
  }
}

// Singleton instance
let devStatePersistence: DevStatePersistence | null = null;

/**
 * Get the singleton DevStatePersistence instance
 */
export function getDevStatePersistence(): DevStatePersistence {
  if (!devStatePersistence) {
    devStatePersistence = new DevStatePersistence();
  }
  return devStatePersistence;
}

/**
 * Apply saved window state to a new window
 */
export function applyWindowState(window: BrowserWindow): void {
  const persistence = getDevStatePersistence();
  const state = persistence.getWindowState();

  // Set bounds
  if (state.x !== undefined && state.y !== undefined) {
    window.setBounds({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    });
  } else {
    window.setSize(state.width, state.height);
    window.center();
  }

  // Apply state
  if (state.isMaximized) {
    window.maximize();
  }
  if (state.isFullScreen) {
    window.setFullScreen(true);
  }
  if (state.isDevToolsOpen) {
    window.webContents.openDevTools();
  }
}

/**
 * Setup window state tracking
 */
export function trackWindowState(window: BrowserWindow): void {
  const persistence = getDevStatePersistence();

  // Track window movements and resizes
  const saveState = () => persistence.saveWindowState(window);

  window.on('resize', saveState);
  window.on('move', saveState);
  window.on('maximize', saveState);
  window.on('unmaximize', saveState);
  window.on('enter-full-screen', saveState);
  window.on('leave-full-screen', saveState);

  // Track DevTools state
  window.webContents.on('devtools-opened', saveState);
  window.webContents.on('devtools-closed', saveState);

  // Force save on close
  window.on('close', () => {
    persistence.forceSave();
  });
}

export default DevStatePersistence;
