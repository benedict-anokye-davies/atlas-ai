/**
 * Atlas Window Mode Manager
 * Handles window display modes with smooth transitions
 */

import { BrowserWindow, globalShortcut, screen } from 'electron';
import { EventEmitter } from 'events';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import type {
  WindowMode,
  WindowModeConfig,
  WindowBounds,
  WindowModeChangeEvent,
  WindowModeState,
} from '../../shared/types/window';
import { DEFAULT_WINDOW_MODE_CONFIG, WINDOW_MODE_PROPERTIES } from '../../shared/types/window';

const logger = createModuleLogger('WindowModeManager');

/**
 * Config file path for window mode persistence
 */
const CONFIG_DIR = join(homedir(), '.atlas');
const CONFIG_FILE = join(CONFIG_DIR, 'window-mode.json');

/**
 * Window Mode Manager Events
 */
export interface WindowModeManagerEvents {
  'mode-change': (event: WindowModeChangeEvent) => void;
  'transition-start': (from: WindowMode, to: WindowMode) => void;
  'transition-end': (mode: WindowMode) => void;
  'bounds-change': (bounds: WindowBounds, mode: WindowMode) => void;
  error: (error: Error) => void;
}

/**
 * Animation frame for smooth transitions
 */
interface TransitionFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

/**
 * Window Mode Manager
 * Manages multiple window display modes with smooth transitions
 */
export class WindowModeManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private config: WindowModeConfig;
  private currentMode: WindowMode = 'normal';
  private isTransitioning = false;
  private transitionTimer: NodeJS.Timeout | null = null;
  private shortcutsRegistered = false;
  private savedBounds: Record<WindowMode, WindowBounds | null> = {
    normal: null,
    compact: null,
    overlay: null,
    tray: null,
  };

  constructor(config: Partial<WindowModeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WINDOW_MODE_CONFIG, ...config };
    this.loadPersistedConfig();
  }

  /**
   * Initialize the window mode manager with a BrowserWindow
   */
  async initialize(window: BrowserWindow): Promise<void> {
    this.window = window;

    // Store initial bounds for normal mode
    if (!this.savedBounds.normal) {
      this.savedBounds.normal = this.window.getBounds();
    }

    // Set up window event listeners
    this.setupWindowListeners();

    // Register keyboard shortcuts
    this.registerShortcuts();

    // Restore last mode if configured
    if (this.config.rememberMode && this.config.lastMode !== 'normal') {
      // Delay mode restoration to allow window to fully initialize
      setTimeout(() => {
        this.setMode(this.config.lastMode, 'startup');
      }, 500);
    }

    logger.info('Window mode manager initialized', {
      mode: this.currentMode,
      rememberMode: this.config.rememberMode,
    });
  }

  /**
   * Set up window event listeners
   */
  private setupWindowListeners(): void {
    if (!this.window) return;

    // Track bounds changes for current mode
    this.window.on('move', () => this.onBoundsChange());
    this.window.on('resize', () => this.onBoundsChange());

    // Handle window close
    this.window.on('closed', () => {
      this.window = null;
      this.unregisterShortcuts();
    });

    // Handle minimize
    this.window.on('minimize', () => {
      if (this.currentMode !== 'tray') {
        // Store current bounds before minimize
        this.savedBounds[this.currentMode] = this.window?.getBounds() || null;
      }
    });
  }

  /**
   * Handle bounds change
   */
  private onBoundsChange(): void {
    if (!this.window || this.isTransitioning) return;

    const bounds = this.window.getBounds();
    this.savedBounds[this.currentMode] = bounds;

    this.emit('bounds-change', bounds, this.currentMode);
  }

  /**
   * Register global keyboard shortcuts
   */
  private registerShortcuts(): void {
    if (this.shortcutsRegistered) return;

    const { shortcuts } = this.config;
    const registrations: Array<[string, () => void]> = [
      [shortcuts.toggleCompact, () => this.toggleMode('compact')],
      [shortcuts.toggleOverlay, () => this.toggleMode('overlay')],
      [shortcuts.minimizeToTray, () => this.setMode('tray', 'shortcut')],
      [shortcuts.cycleMode, () => this.cycleMode()],
      [shortcuts.restoreNormal, () => this.setMode('normal', 'shortcut')],
    ];

    for (const [shortcut, handler] of registrations) {
      try {
        const registered = globalShortcut.register(shortcut, handler);
        if (registered) {
          logger.debug('Registered shortcut', { shortcut });
        } else {
          logger.warn('Failed to register shortcut', { shortcut });
        }
      } catch (error) {
        logger.error('Error registering shortcut', {
          shortcut,
          error: (error as Error).message,
        });
      }
    }

    this.shortcutsRegistered = true;
    logger.info('Window mode shortcuts registered');
  }

  /**
   * Unregister all keyboard shortcuts
   */
  private unregisterShortcuts(): void {
    if (!this.shortcutsRegistered) return;

    const { shortcuts } = this.config;
    const shortcutKeys = Object.values(shortcuts);

    for (const shortcut of shortcutKeys) {
      try {
        globalShortcut.unregister(shortcut);
      } catch (error) {
        logger.error('Error unregistering shortcut', {
          shortcut,
          error: (error as Error).message,
        });
      }
    }

    this.shortcutsRegistered = false;
    logger.info('Window mode shortcuts unregistered');
  }

  /**
   * Set the window mode
   */
  async setMode(
    mode: WindowMode,
    triggeredBy: WindowModeChangeEvent['triggeredBy'] = 'api'
  ): Promise<void> {
    if (!this.window || this.isTransitioning) {
      logger.warn('Cannot change mode: window not available or transition in progress');
      return;
    }

    if (mode === this.currentMode) {
      logger.debug('Mode already set', { mode });
      return;
    }

    const previousMode = this.currentMode;

    logger.info('Changing window mode', { from: previousMode, to: mode, triggeredBy });

    // Save current bounds before transition
    if (previousMode !== 'tray') {
      this.savedBounds[previousMode] = this.window.getBounds();
    }

    // Handle special case for tray mode
    if (mode === 'tray') {
      await this.minimizeToTray();
      this.currentMode = mode;
      this.emitModeChange(previousMode, mode, triggeredBy);
      return;
    }

    // Handle restoring from tray mode
    if (previousMode === 'tray') {
      await this.restoreFromTray(mode);
      this.currentMode = mode;
      this.emitModeChange(previousMode, mode, triggeredBy);
      return;
    }

    // Perform transition between visible modes
    if (this.config.transition.enabled) {
      await this.transitionToMode(mode);
    } else {
      this.applyModeProperties(mode);
    }

    this.currentMode = mode;
    this.emitModeChange(previousMode, mode, triggeredBy);

    // Persist mode if configured
    if (this.config.rememberMode) {
      this.persistConfig();
    }

    // Notify renderer of mode change
    this.notifyRenderer();
  }

  /**
   * Toggle between current mode and target mode
   */
  toggleMode(targetMode: WindowMode): void {
    if (this.currentMode === targetMode) {
      this.setMode('normal', 'shortcut');
    } else {
      this.setMode(targetMode, 'shortcut');
    }
  }

  /**
   * Cycle through available modes
   */
  cycleMode(): void {
    const modes: WindowMode[] = ['normal', 'compact', 'overlay', 'tray'];
    const currentIndex = modes.indexOf(this.currentMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.setMode(modes[nextIndex], 'shortcut');
  }

  /**
   * Minimize window to system tray
   */
  private async minimizeToTray(): Promise<void> {
    if (!this.window) return;

    this.window.hide();
    logger.info('Window minimized to tray');
  }

  /**
   * Restore window from system tray
   */
  private async restoreFromTray(targetMode: WindowMode): Promise<void> {
    if (!this.window) return;

    // Apply target mode properties
    this.applyModeProperties(targetMode);

    // Restore saved bounds or use default position
    const bounds = this.savedBounds[targetMode];
    if (bounds) {
      this.window.setBounds(bounds);
    } else {
      this.centerWindow(targetMode);
    }

    this.window.show();
    this.window.focus();

    logger.info('Window restored from tray', { mode: targetMode });
  }

  /**
   * Perform smooth transition to target mode
   */
  private async transitionToMode(targetMode: WindowMode): Promise<void> {
    if (!this.window) return;

    this.isTransitioning = true;
    this.emit('transition-start', this.currentMode, targetMode);

    const startBounds = this.window.getBounds();
    const endBounds = this.calculateTargetBounds(targetMode);
    const { duration } = this.config.transition;
    const steps = Math.max(10, Math.floor(duration / 16)); // ~60fps
    const stepDuration = duration / steps;

    // Apply mode properties that can be set before animation
    const props = WINDOW_MODE_PROPERTIES[targetMode];
    this.window.setAlwaysOnTop(props.alwaysOnTop);
    this.window.setSkipTaskbar(props.skipTaskbar);
    this.window.setResizable(props.resizable);

    // Animate bounds
    for (let i = 1; i <= steps; i++) {
      const progress = this.easeProgress(i / steps);
      const frame = this.interpolateBounds(startBounds, endBounds, progress);

      this.window.setBounds({
        x: Math.round(frame.x),
        y: Math.round(frame.y),
        width: Math.round(frame.width),
        height: Math.round(frame.height),
      });

      await this.sleep(stepDuration);
    }

    // Apply final mode properties
    this.applyModeProperties(targetMode);

    this.isTransitioning = false;
    this.emit('transition-end', targetMode);

    logger.debug('Transition complete', { mode: targetMode });
  }

  /**
   * Apply mode-specific window properties
   */
  private applyModeProperties(mode: WindowMode): void {
    if (!this.window) return;

    const props = WINDOW_MODE_PROPERTIES[mode];

    // Set window properties
    this.window.setAlwaysOnTop(props.alwaysOnTop);
    this.window.setSkipTaskbar(props.skipTaskbar);
    this.window.setResizable(props.resizable);
    this.window.setMinimumSize(props.minWidth, props.minHeight);

    if (props.maxWidth && props.maxHeight) {
      this.window.setMaximumSize(props.maxWidth, props.maxHeight);
    } else {
      // Remove max size constraint
      this.window.setMaximumSize(0, 0);
    }

    // Handle transparency (requires window recreation for full effect)
    // For now, we handle it via CSS in renderer
    this.window.setBackgroundColor(props.backgroundColor);

    // Set bounds if not transitioning
    if (!this.isTransitioning) {
      const bounds = this.savedBounds[mode] || this.calculateTargetBounds(mode);
      this.window.setBounds(bounds);
    }

    logger.debug('Applied mode properties', {
      mode,
      props: {
        alwaysOnTop: props.alwaysOnTop,
        transparent: props.transparent,
        skipTaskbar: props.skipTaskbar,
      },
    });
  }

  /**
   * Calculate target bounds for a mode
   */
  private calculateTargetBounds(mode: WindowMode): WindowBounds {
    // Use saved bounds if available
    const saved = this.savedBounds[mode];
    if (saved) {
      return saved;
    }

    // Calculate default bounds for mode
    const props = WINDOW_MODE_PROPERTIES[mode];
    const display = screen.getPrimaryDisplay();
    const { workArea } = display;

    let x: number;
    let y: number;

    switch (mode) {
      case 'compact':
        // Position in bottom-right corner
        x = workArea.x + workArea.width - props.width - 20;
        y = workArea.y + workArea.height - props.height - 20;
        break;

      case 'overlay':
        // Center on screen
        x = workArea.x + Math.floor((workArea.width - props.width) / 2);
        y = workArea.y + Math.floor((workArea.height - props.height) / 2);
        break;

      case 'normal':
      default:
        // Center on screen
        x = workArea.x + Math.floor((workArea.width - props.width) / 2);
        y = workArea.y + Math.floor((workArea.height - props.height) / 2);
        break;
    }

    return {
      x,
      y,
      width: props.width,
      height: props.height,
    };
  }

  /**
   * Center window for a specific mode
   */
  private centerWindow(mode: WindowMode): void {
    if (!this.window) return;

    const props = WINDOW_MODE_PROPERTIES[mode];
    const display = screen.getPrimaryDisplay();
    const { workArea } = display;

    const x = workArea.x + Math.floor((workArea.width - props.width) / 2);
    const y = workArea.y + Math.floor((workArea.height - props.height) / 2);

    this.window.setBounds({
      x,
      y,
      width: props.width,
      height: props.height,
    });
  }

  /**
   * Interpolate between two bounds
   */
  private interpolateBounds(
    start: WindowBounds,
    end: WindowBounds,
    progress: number
  ): TransitionFrame {
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
      width: start.width + (end.width - start.width) * progress,
      height: start.height + (end.height - start.height) * progress,
      opacity: 1,
    };
  }

  /**
   * Apply easing to progress value
   */
  private easeProgress(t: number): number {
    switch (this.config.transition.easing) {
      case 'linear':
        return t;
      case 'ease':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'ease-in':
        return t * t * t;
      case 'ease-out':
        return 1 - Math.pow(1 - t, 3);
      case 'ease-in-out':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      default:
        return t;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Emit mode change event
   */
  private emitModeChange(
    previousMode: WindowMode,
    currentMode: WindowMode,
    triggeredBy: WindowModeChangeEvent['triggeredBy']
  ): void {
    const event: WindowModeChangeEvent = {
      previousMode,
      currentMode,
      timestamp: Date.now(),
      triggeredBy,
    };

    this.emit('mode-change', event);

    // Update config
    this.config.mode = currentMode;
    this.config.lastMode = currentMode;
  }

  /**
   * Notify renderer of current state
   */
  private notifyRenderer(): void {
    if (!this.window || this.window.isDestroyed()) return;

    const state = this.getState();
    this.window.webContents.send('atlas:window-mode-change', state);
  }

  /**
   * Get current window mode state
   */
  getState(): WindowModeState {
    const props = WINDOW_MODE_PROPERTIES[this.currentMode];
    return {
      mode: this.currentMode,
      isTransitioning: this.isTransitioning,
      isAlwaysOnTop: props.alwaysOnTop,
      isTransparent: props.transparent,
      bounds: this.window?.getBounds() || null,
    };
  }

  /**
   * Get current mode
   */
  getMode(): WindowMode {
    return this.currentMode;
  }

  /**
   * Get current configuration
   */
  getConfig(): WindowModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WindowModeConfig>): void {
    // Handle shortcut changes
    if (config.shortcuts) {
      this.unregisterShortcuts();
    }

    this.config = { ...this.config, ...config };

    // Re-register shortcuts if changed
    if (config.shortcuts) {
      this.registerShortcuts();
    }

    // Persist changes
    this.persistConfig();

    logger.info('Window mode configuration updated');
  }

  /**
   * Load persisted configuration
   */
  private loadPersistedConfig(): void {
    try {
      if (existsSync(CONFIG_FILE)) {
        const data = readFileSync(CONFIG_FILE, 'utf-8');
        const saved = JSON.parse(data);

        // Merge with defaults
        this.config = {
          ...this.config,
          ...saved,
          shortcuts: { ...this.config.shortcuts, ...saved.shortcuts },
          transition: { ...this.config.transition, ...saved.transition },
        };

        // Restore saved bounds
        if (saved.modeBounds) {
          this.savedBounds = { ...this.savedBounds, ...saved.modeBounds };
        }

        logger.debug('Loaded persisted window mode config', { mode: this.config.lastMode });
      }
    } catch (error) {
      logger.warn('Failed to load window mode config', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Persist configuration to disk
   */
  private persistConfig(): void {
    try {
      // Ensure config directory exists
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }

      const data = {
        mode: this.config.mode,
        lastMode: this.config.lastMode,
        rememberMode: this.config.rememberMode,
        modeBounds: this.savedBounds,
        shortcuts: this.config.shortcuts,
        transition: this.config.transition,
      };

      writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
      logger.debug('Persisted window mode config');
    } catch (error) {
      logger.error('Failed to persist window mode config', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    // Clear any pending transitions
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    // Unregister shortcuts
    this.unregisterShortcuts();

    // Persist final state
    this.persistConfig();

    this.window = null;
    this.removeAllListeners();

    logger.info('Window mode manager destroyed');
  }
}

// Singleton instance
let managerInstance: WindowModeManager | null = null;

/**
 * Get or create the window mode manager singleton
 */
export function getWindowModeManager(config?: Partial<WindowModeConfig>): WindowModeManager {
  if (!managerInstance) {
    managerInstance = new WindowModeManager(config);
  }
  return managerInstance;
}

/**
 * Initialize the window mode manager with a BrowserWindow
 */
export async function initializeWindowModeManager(
  window: BrowserWindow,
  config?: Partial<WindowModeConfig>
): Promise<WindowModeManager> {
  const manager = getWindowModeManager(config);
  await manager.initialize(window);
  return manager;
}

/**
 * Shutdown the window mode manager
 */
export async function shutdownWindowModeManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.destroy();
    managerInstance = null;
  }
}

export default WindowModeManager;
