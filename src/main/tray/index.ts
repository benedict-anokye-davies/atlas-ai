/**
 * Nova Desktop - System Tray Module
 * Manages the system tray icon, menu, and global shortcuts
 */

import {
  Tray,
  Menu,
  nativeImage,
  app,
  globalShortcut,
  BrowserWindow,
  NativeImage,
  MenuItemConstructorOptions,
} from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { VoicePipelineState } from '../../shared/types/voice';

const logger = createModuleLogger('Tray');

/**
 * Tray icon states matching VoicePipelineState
 */
export type TrayState = VoicePipelineState | 'disabled';

/**
 * Tray configuration
 */
export interface TrayConfig {
  /** Global shortcut for push-to-talk (default: CommandOrControl+Shift+Space) */
  pushToTalkShortcut: string;
  /** Whether to show notifications */
  showNotifications: boolean;
  /** Whether to start minimized to tray */
  startMinimized: boolean;
  /** Whether to minimize to tray instead of closing */
  minimizeToTray: boolean;
}

/**
 * Default tray configuration
 */
export const DEFAULT_TRAY_CONFIG: TrayConfig = {
  pushToTalkShortcut: 'CommandOrControl+Shift+Space',
  showNotifications: true,
  startMinimized: false,
  minimizeToTray: true,
};

/**
 * Tray events
 */
export interface TrayEvents {
  'push-to-talk': () => void;
  'toggle-window': () => void;
  quit: () => void;
  settings: () => void;
  'start-pipeline': () => void;
  'stop-pipeline': () => void;
}

/**
 * Color schemes for different states
 */
const STATE_COLORS: Record<TrayState, { primary: string; secondary: string }> = {
  idle: { primary: '#6366f1', secondary: '#4f46e5' }, // Indigo
  listening: { primary: '#22c55e', secondary: '#16a34a' }, // Green
  processing: { primary: '#f59e0b', secondary: '#d97706' }, // Amber
  speaking: { primary: '#3b82f6', secondary: '#2563eb' }, // Blue
  error: { primary: '#ef4444', secondary: '#dc2626' }, // Red
  disabled: { primary: '#6b7280', secondary: '#4b5563' }, // Gray
};

/**
 * Nova System Tray Manager
 */
export class NovaTray extends EventEmitter {
  private tray: Tray | null = null;
  private config: TrayConfig;
  private state: TrayState = 'idle';
  private isRunning = false;
  private mainWindow: BrowserWindow | null = null;
  private iconCache: Map<TrayState, NativeImage> = new Map();
  private animationInterval: NodeJS.Timeout | null = null;
  private animationFrame = 0;

  constructor(config: Partial<TrayConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TRAY_CONFIG, ...config };
  }

  /**
   * Initialize the system tray
   */
  async initialize(mainWindow?: BrowserWindow): Promise<void> {
    if (this.tray) {
      logger.warn('Tray already initialized');
      return;
    }

    this.mainWindow = mainWindow || null;

    // Pre-generate icons for all states
    this.generateIcons();

    // Create tray with idle icon
    const icon = this.iconCache.get('idle') || this.createIcon('idle');
    this.tray = new Tray(icon);
    this.tray.setToolTip('Nova - Voice Assistant');

    // Build and set context menu
    this.updateContextMenu();

    // Handle tray click
    this.tray.on('click', () => {
      this.emit('toggle-window');
      this.toggleWindow();
    });

    // Handle double-click (Windows)
    this.tray.on('double-click', () => {
      this.emit('toggle-window');
      this.toggleWindow();
    });

    // Register global shortcuts
    this.registerShortcuts();

    logger.info('System tray initialized');
  }

  /**
   * Generate icons for all states
   */
  private generateIcons(): void {
    const states: TrayState[] = [
      'idle',
      'listening',
      'processing',
      'speaking',
      'error',
      'disabled',
    ];
    for (const state of states) {
      this.iconCache.set(state, this.createIcon(state));
    }
  }

  /**
   * Create a tray icon for a specific state
   * Uses nativeImage to create a simple circular icon
   */
  private createIcon(state: TrayState, frame = 0): NativeImage {
    const size = 16; // Standard tray icon size
    const colors = STATE_COLORS[state];

    // Create a simple SVG icon
    const svg = this.generateSVGIcon(size, colors, state, frame);

    // Convert SVG to data URL
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    return nativeImage.createFromDataURL(dataUrl);
  }

  /**
   * Generate SVG icon for tray
   */
  private generateSVGIcon(
    size: number,
    colors: { primary: string; secondary: string },
    state: TrayState,
    frame = 0
  ): string {
    const center = size / 2;
    const radius = size / 2 - 1;

    // Base circle
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;

    // Background circle
    svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="${colors.primary}" />`;

    // State-specific decorations
    switch (state) {
      case 'listening':
        // Pulsing inner circle for listening
        const pulseRadius = radius * 0.6 * (0.8 + 0.2 * Math.sin(frame * 0.5));
        svg += `<circle cx="${center}" cy="${center}" r="${pulseRadius}" fill="${colors.secondary}" opacity="0.8" />`;
        // Microphone-like shape
        svg += `<rect x="${center - 1.5}" y="${center - 3}" width="3" height="4" rx="1" fill="white" />`;
        svg += `<path d="M${center - 2.5} ${center + 1} Q${center - 2.5} ${center + 3} ${center} ${center + 3} Q${center + 2.5} ${center + 3} ${center + 2.5} ${center + 1}" stroke="white" stroke-width="1" fill="none" />`;
        break;

      case 'processing':
        // Spinning indicator for processing
        const angle = (frame * 30) % 360;
        const rad = (angle * Math.PI) / 180;
        const dotX = center + Math.cos(rad) * (radius * 0.5);
        const dotY = center + Math.sin(rad) * (radius * 0.5);
        svg += `<circle cx="${dotX}" cy="${dotY}" r="2" fill="white" />`;
        // Trail dots
        for (let i = 1; i <= 3; i++) {
          const trailAngle = (angle - i * 30) % 360;
          const trailRad = (trailAngle * Math.PI) / 180;
          const trailX = center + Math.cos(trailRad) * (radius * 0.5);
          const trailY = center + Math.sin(trailRad) * (radius * 0.5);
          svg += `<circle cx="${trailX}" cy="${trailY}" r="${2 - i * 0.4}" fill="white" opacity="${1 - i * 0.25}" />`;
        }
        break;

      case 'speaking':
        // Sound waves for speaking
        const waveOffset = (frame % 3) * 0.5;
        svg += `<path d="M${center - 1} ${center - 2} L${center - 1} ${center + 2}" stroke="white" stroke-width="1.5" stroke-linecap="round" />`;
        svg += `<path d="M${center + 1} ${center - 3 + waveOffset} Q${center + 3} ${center} ${center + 1} ${center + 3 - waveOffset}" stroke="white" stroke-width="1" fill="none" opacity="0.8" />`;
        svg += `<path d="M${center + 2.5} ${center - 4 + waveOffset} Q${center + 5} ${center} ${center + 2.5} ${center + 4 - waveOffset}" stroke="white" stroke-width="1" fill="none" opacity="0.5" />`;
        break;

      case 'error':
        // X mark for error
        svg += `<line x1="${center - 2}" y1="${center - 2}" x2="${center + 2}" y2="${center + 2}" stroke="white" stroke-width="2" stroke-linecap="round" />`;
        svg += `<line x1="${center + 2}" y1="${center - 2}" x2="${center - 2}" y2="${center + 2}" stroke="white" stroke-width="2" stroke-linecap="round" />`;
        break;

      case 'disabled':
        // Slash for disabled
        svg += `<line x1="${center - 3}" y1="${center + 3}" x2="${center + 3}" y2="${center - 3}" stroke="white" stroke-width="1.5" stroke-linecap="round" />`;
        break;

      case 'idle':
      default:
        // Simple Nova "N" or dot for idle
        svg += `<circle cx="${center}" cy="${center}" r="${radius * 0.4}" fill="white" />`;
        break;
    }

    svg += '</svg>';
    return svg;
  }

  /**
   * Update the tray icon state
   */
  setState(state: TrayState): void {
    if (this.state === state) return;

    const previousState = this.state;
    this.state = state;

    // Stop any existing animation
    this.stopAnimation();

    // Start animation for dynamic states
    if (state === 'listening' || state === 'processing' || state === 'speaking') {
      this.startAnimation();
    } else {
      // Set static icon
      const icon = this.iconCache.get(state) || this.createIcon(state);
      this.tray?.setImage(icon);
    }

    // Update tooltip
    this.updateTooltip();

    // Update context menu
    this.updateContextMenu();

    logger.debug('Tray state changed', { from: previousState, to: state });
  }

  /**
   * Start icon animation
   */
  private startAnimation(): void {
    if (this.animationInterval) return;

    this.animationFrame = 0;
    this.animationInterval = setInterval(() => {
      this.animationFrame++;
      const icon = this.createIcon(this.state, this.animationFrame);
      this.tray?.setImage(icon);
    }, 100); // 10 fps animation
  }

  /**
   * Stop icon animation
   */
  private stopAnimation(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
      this.animationFrame = 0;
    }
  }

  /**
   * Update the tray tooltip
   */
  private updateTooltip(): void {
    const tooltips: Record<TrayState, string> = {
      idle: 'Nova - Ready',
      listening: 'Nova - Listening...',
      processing: 'Nova - Processing...',
      speaking: 'Nova - Speaking...',
      error: 'Nova - Error',
      disabled: 'Nova - Disabled',
    };

    this.tray?.setToolTip(tooltips[this.state]);
  }

  /**
   * Update the context menu
   */
  private updateContextMenu(): void {
    if (!this.tray) return;

    // Note: isActive can be used for future menu item states
    // const isActive = this.state !== 'disabled' && this.state !== 'idle';

    const menuTemplate: MenuItemConstructorOptions[] = [
      {
        label: 'Nova Voice Assistant',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => {
          this.emit('toggle-window');
          this.toggleWindow();
        },
      },
      { type: 'separator' },
      {
        label: this.isRunning ? 'Stop Listening' : 'Start Listening',
        click: () => {
          if (this.isRunning) {
            this.emit('stop-pipeline');
          } else {
            this.emit('start-pipeline');
          }
        },
      },
      {
        label: 'Push to Talk',
        accelerator: this.config.pushToTalkShortcut,
        click: () => {
          this.emit('push-to-talk');
        },
      },
      { type: 'separator' },
      {
        label: 'Settings...',
        click: () => {
          this.emit('settings');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Nova',
        click: () => {
          this.emit('quit');
          app.quit();
        },
      },
    ];

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Register global keyboard shortcuts
   */
  private registerShortcuts(): void {
    // Push-to-talk shortcut
    const registered = globalShortcut.register(this.config.pushToTalkShortcut, () => {
      logger.debug('Push-to-talk shortcut triggered');
      this.emit('push-to-talk');
    });

    if (registered) {
      logger.info('Global shortcut registered', { shortcut: this.config.pushToTalkShortcut });
    } else {
      logger.warn('Failed to register global shortcut', {
        shortcut: this.config.pushToTalkShortcut,
      });
    }
  }

  /**
   * Unregister global shortcuts
   */
  private unregisterShortcuts(): void {
    globalShortcut.unregister(this.config.pushToTalkShortcut);
    logger.info('Global shortcuts unregistered');
  }

  /**
   * Toggle the main window visibility
   */
  private toggleWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.focus();
      }
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Set pipeline running state (for menu label)
   */
  setRunning(running: boolean): void {
    this.isRunning = running;
    this.updateContextMenu();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TrayConfig>): void {
    const oldShortcut = this.config.pushToTalkShortcut;
    this.config = { ...this.config, ...config };

    // Re-register shortcut if changed
    if (config.pushToTalkShortcut && config.pushToTalkShortcut !== oldShortcut) {
      globalShortcut.unregister(oldShortcut);
      this.registerShortcuts();
    }

    this.updateContextMenu();
    logger.info('Tray configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): TrayConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): TrayState {
    return this.state;
  }

  /**
   * Show a balloon notification (Windows) or notification
   */
  showNotification(title: string, content: string): void {
    if (!this.config.showNotifications) return;

    // Use tray balloon on Windows
    if (process.platform === 'win32' && this.tray) {
      this.tray.displayBalloon({
        title,
        content,
        iconType: 'info',
      });
    }
    // For macOS/Linux, use Notification API (handled by renderer)
  }

  /**
   * Destroy the tray
   */
  async destroy(): Promise<void> {
    this.stopAnimation();
    this.unregisterShortcuts();

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    this.iconCache.clear();
    this.mainWindow = null;

    logger.info('System tray destroyed');
  }
}

// Singleton instance
let trayInstance: NovaTray | null = null;

/**
 * Get or create the tray singleton
 */
export function getTray(config?: Partial<TrayConfig>): NovaTray {
  if (!trayInstance) {
    trayInstance = new NovaTray(config);
  }
  return trayInstance;
}

/**
 * Initialize the tray with a main window
 */
export async function initializeTray(
  mainWindow?: BrowserWindow,
  config?: Partial<TrayConfig>
): Promise<NovaTray> {
  const tray = getTray(config);
  await tray.initialize(mainWindow);
  return tray;
}

/**
 * Shutdown the tray
 */
export async function shutdownTray(): Promise<void> {
  if (trayInstance) {
    await trayInstance.destroy();
    trayInstance = null;
  }
}

export default NovaTray;
