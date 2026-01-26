/**
 * Atlas Desktop - Keyboard Shortcuts Manager
 * Global and local keyboard shortcut registration and management
 */

import { app, globalShortcut, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  handlePushToTalkStart,
  handlePushToTalkEnd,
  handleToggleWindow,
  handleToggleMute,
  handleOpenSettings,
  handleCancelAction,
  handleCommandPalette,
  isPushToTalkEngaged,
  resetHandlerState,
} from './handlers';

const logger = createModuleLogger('Shortcuts');

// ============================================================================
// Types
// ============================================================================

/**
 * Shortcut action identifiers
 */
export type ShortcutAction =
  | 'push-to-talk'
  | 'toggle-window'
  | 'toggle-mute'
  | 'open-settings'
  | 'cancel-action'
  | 'command-palette'
  | 'focus-input'
  | 'clear-conversation';

/**
 * Shortcut scope
 */
export type ShortcutScope = 'global' | 'local';

/**
 * Platform-aware shortcut definition
 */
export interface ShortcutBinding {
  /** Action identifier */
  action: ShortcutAction;
  /** Default accelerator (Electron format) */
  accelerator: string;
  /** macOS-specific accelerator (optional) */
  acceleratorMac?: string;
  /** Whether this is a global shortcut */
  scope: ShortcutScope;
  /** Human-readable description */
  description: string;
  /** Whether this shortcut can be customized */
  customizable: boolean;
  /** Whether this is a hold (key-down/key-up) shortcut */
  isHold?: boolean;
}

/**
 * Shortcut configuration (user preferences)
 */
export interface ShortcutConfig {
  /** Custom keybindings (action -> accelerator) */
  bindings: Partial<Record<ShortcutAction, string>>;
  /** Disabled shortcuts */
  disabled: ShortcutAction[];
  /** Whether global shortcuts are enabled */
  globalEnabled: boolean;
}

/**
 * Shortcut registration status
 */
export interface ShortcutStatus {
  action: ShortcutAction;
  accelerator: string;
  registered: boolean;
  scope: ShortcutScope;
  error?: string;
}

// ============================================================================
// Default Shortcut Bindings
// ============================================================================

/**
 * Default shortcut bindings
 * Windows uses Ctrl, macOS uses Cmd (automatically handled by Electron with 'CommandOrControl')
 */
export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  // Global shortcuts (work even when app not focused)
  {
    action: 'push-to-talk',
    accelerator: 'CommandOrControl+Space',
    scope: 'global',
    description: 'Hold to speak to Atlas',
    customizable: true,
    isHold: true,
  },
  {
    action: 'toggle-window',
    accelerator: 'CommandOrControl+Shift+A',
    scope: 'global',
    description: 'Show/hide Atlas window',
    customizable: true,
  },
  {
    action: 'toggle-mute',
    accelerator: 'CommandOrControl+Shift+M',
    scope: 'global',
    description: 'Mute/unmute microphone',
    customizable: true,
  },

  // Local shortcuts (when app focused)
  {
    action: 'open-settings',
    accelerator: 'CommandOrControl+,',
    scope: 'local',
    description: 'Open settings',
    customizable: true,
  },
  {
    action: 'cancel-action',
    accelerator: 'Escape',
    scope: 'local',
    description: 'Cancel current action',
    customizable: false,
  },
  {
    action: 'command-palette',
    accelerator: 'CommandOrControl+Shift+P',
    scope: 'local',
    description: 'Open command palette',
    customizable: true,
  },
  {
    action: 'focus-input',
    accelerator: 'CommandOrControl+K',
    scope: 'local',
    description: 'Focus text input',
    customizable: true,
  },
  {
    action: 'clear-conversation',
    accelerator: 'CommandOrControl+Shift+Delete',
    acceleratorMac: 'CommandOrControl+Shift+Backspace',
    scope: 'local',
    description: 'Clear conversation history',
    customizable: true,
  },
];

/**
 * Default shortcut configuration
 */
export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  bindings: {},
  disabled: [],
  globalEnabled: true,
};

// ============================================================================
// Shortcut Manager Class
// ============================================================================

export class ShortcutManager extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private config: ShortcutConfig;
  private registeredGlobal: Map<string, ShortcutAction> = new Map();
  private shortcuts: ShortcutBinding[];
  private isInitialized = false;
  private platform: NodeJS.Platform;

  constructor(config: Partial<ShortcutConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SHORTCUT_CONFIG, ...config };
    this.shortcuts = [...DEFAULT_SHORTCUTS];
    this.platform = process.platform;
    logger.info('ShortcutManager created', { platform: this.platform });
  }

  /**
   * Initialize the shortcut manager
   */
  initialize(mainWindow: BrowserWindow): void {
    if (this.isInitialized) {
      logger.warn('ShortcutManager already initialized');
      return;
    }

    this.mainWindow = mainWindow;
    this.isInitialized = true;

    // Register global shortcuts
    if (this.config.globalEnabled) {
      this.registerGlobalShortcuts();
    }

    // Setup local shortcuts via IPC (handled in renderer)
    this.setupLocalShortcutForwarding();

    logger.info('ShortcutManager initialized', {
      globalEnabled: this.config.globalEnabled,
      globalCount: this.registeredGlobal.size,
    });
  }

  /**
   * Get the effective accelerator for a shortcut
   */
  private getEffectiveAccelerator(binding: ShortcutBinding): string {
    // Check for user custom binding
    const custom = this.config.bindings[binding.action];
    if (custom) {
      return custom;
    }

    // Use platform-specific default if available
    if (this.platform === 'darwin' && binding.acceleratorMac) {
      return binding.acceleratorMac;
    }

    return binding.accelerator;
  }

  /**
   * Check if an accelerator conflicts with system shortcuts
   */
  private checkForConflicts(accelerator: string): boolean {
    // Known problematic system shortcuts
    const systemShortcuts = [
      'CommandOrControl+C',
      'CommandOrControl+V',
      'CommandOrControl+X',
      'CommandOrControl+A',
      'CommandOrControl+Z',
      'CommandOrControl+Y',
      'CommandOrControl+S',
      'CommandOrControl+O',
      'CommandOrControl+N',
      'CommandOrControl+W',
      'CommandOrControl+Q',
      'CommandOrControl+Tab',
      'Alt+Tab',
      'Alt+F4',
    ];

    const normalized = accelerator.replace(/\s+/g, '');
    return systemShortcuts.some(
      (sys) => sys.replace(/\s+/g, '').toLowerCase() === normalized.toLowerCase()
    );
  }

  /**
   * Register all global shortcuts
   */
  private registerGlobalShortcuts(): void {
    const globalBindings = this.shortcuts.filter((s) => s.scope === 'global');

    for (const binding of globalBindings) {
      if (this.config.disabled.includes(binding.action)) {
        logger.debug('Shortcut disabled by user', { action: binding.action });
        continue;
      }

      const accelerator = this.getEffectiveAccelerator(binding);

      // Check for conflicts
      if (this.checkForConflicts(accelerator)) {
        logger.warn('Shortcut conflicts with system shortcut', {
          action: binding.action,
          accelerator,
        });
        this.emit('conflict', {
          action: binding.action,
          accelerator,
          message: 'Conflicts with system shortcut',
        });
        continue;
      }

      this.registerGlobalShortcut(binding, accelerator);
    }
  }

  /**
   * Register a single global shortcut
   */
  private registerGlobalShortcut(binding: ShortcutBinding, accelerator: string): boolean {
    try {
      // Ensure app is ready before registering
      if (!app.isReady()) {
        logger.warn('Cannot register shortcut - app not ready', { action: binding.action });
        return false;
      }

      // Unregister first to handle hot-reload scenarios in dev mode
      if (globalShortcut.isRegistered(accelerator)) {
        globalShortcut.unregister(accelerator);
        logger.debug('Unregistered existing shortcut before re-registering', { accelerator });
      }

      // For hold shortcuts, we need key-down/key-up handling
      // Electron globalShortcut doesn't support key-up events natively
      // For push-to-talk, we'll use the key-down as toggle
      const success = globalShortcut.register(accelerator, () => {
        this.handleShortcutTriggered(binding);
      });

      if (success) {
        this.registeredGlobal.set(accelerator, binding.action);
        logger.debug('Global shortcut registered', {
          action: binding.action,
          accelerator,
        });
        this.emit('registered', {
          action: binding.action,
          accelerator,
          scope: 'global',
        });
        return true;
      } else {
        logger.warn('Failed to register global shortcut', {
          action: binding.action,
          accelerator,
        });
        this.emit('registration-failed', {
          action: binding.action,
          accelerator,
          error: 'Registration failed - shortcut may be in use by another application',
        });
        return false;
      }
    } catch (error) {
      logger.error('Error registering global shortcut', {
        action: binding.action,
        accelerator,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Handle shortcut triggered
   */
  private handleShortcutTriggered(binding: ShortcutBinding): void {
    logger.debug('Shortcut triggered', { action: binding.action });

    switch (binding.action) {
      case 'push-to-talk':
        // Toggle behavior since we can't detect key-up in global shortcuts
        if (isPushToTalkEngaged()) {
          handlePushToTalkEnd();
        } else {
          handlePushToTalkStart();
        }
        break;

      case 'toggle-window':
        handleToggleWindow(this.mainWindow);
        break;

      case 'toggle-mute':
        handleToggleMute();
        break;

      case 'open-settings':
        handleOpenSettings(this.mainWindow);
        break;

      case 'cancel-action':
        handleCancelAction();
        break;

      case 'command-palette':
        handleCommandPalette(this.mainWindow);
        break;

      default:
        // Forward to renderer for handling
        this.forwardToRenderer(binding.action);
    }

    this.emit('shortcut-activated', binding.action);
  }

  /**
   * Forward shortcut action to renderer
   */
  private forwardToRenderer(action: ShortcutAction): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('atlas:shortcut', { action });
    }
  }

  /**
   * Setup local shortcut forwarding via window events
   */
  private setupLocalShortcutForwarding(): void {
    if (!this.mainWindow) return;

    // Send local shortcut definitions to renderer on ready
    this.mainWindow.webContents.on('did-finish-load', () => {
      const localShortcuts = this.shortcuts
        .filter((s) => s.scope === 'local')
        .filter((s) => !this.config.disabled.includes(s.action))
        .map((s) => ({
          action: s.action,
          accelerator: this.getEffectiveAccelerator(s),
          description: s.description,
        }));

      this.mainWindow?.webContents.send('atlas:shortcuts-config', {
        shortcuts: localShortcuts,
      });
    });
  }

  /**
   * Update shortcut configuration
   */
  updateConfig(config: Partial<ShortcutConfig>): void {
    const wasGlobalEnabled = this.config.globalEnabled;
    this.config = { ...this.config, ...config };

    // Re-register if global state changed
    if (wasGlobalEnabled !== this.config.globalEnabled) {
      if (this.config.globalEnabled) {
        this.registerGlobalShortcuts();
      } else {
        this.unregisterAllGlobal();
      }
    }

    // Refresh local shortcuts
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const localShortcuts = this.shortcuts
        .filter((s) => s.scope === 'local')
        .filter((s) => !this.config.disabled.includes(s.action))
        .map((s) => ({
          action: s.action,
          accelerator: this.getEffectiveAccelerator(s),
          description: s.description,
        }));

      this.mainWindow.webContents.send('atlas:shortcuts-config', {
        shortcuts: localShortcuts,
      });
    }

    this.emit('config-updated', this.config);
    logger.info('Shortcut config updated');
  }

  /**
   * Set custom binding for an action
   */
  setBinding(action: ShortcutAction, accelerator: string): boolean {
    const binding = this.shortcuts.find((s) => s.action === action);

    if (!binding) {
      logger.warn('Unknown shortcut action', { action });
      return false;
    }

    if (!binding.customizable) {
      logger.warn('Shortcut is not customizable', { action });
      return false;
    }

    // Check for conflicts
    if (this.checkForConflicts(accelerator)) {
      logger.warn('Custom binding conflicts with system shortcut', { action, accelerator });
      this.emit('conflict', {
        action,
        accelerator,
        message: 'Conflicts with system shortcut',
      });
      return false;
    }

    // Unregister old global shortcut if exists
    if (binding.scope === 'global') {
      const oldAccelerator = this.getEffectiveAccelerator(binding);
      if (this.registeredGlobal.has(oldAccelerator)) {
        globalShortcut.unregister(oldAccelerator);
        this.registeredGlobal.delete(oldAccelerator);
      }
    }

    // Update config
    this.config.bindings[action] = accelerator;

    // Re-register global shortcut with new binding
    if (binding.scope === 'global' && this.config.globalEnabled) {
      this.registerGlobalShortcut(binding, accelerator);
    }

    this.emit('binding-changed', { action, accelerator });
    logger.info('Custom binding set', { action, accelerator });
    return true;
  }

  /**
   * Reset binding to default
   */
  resetBinding(action: ShortcutAction): void {
    delete this.config.bindings[action];
    const binding = this.shortcuts.find((s) => s.action === action);

    if (binding?.scope === 'global' && this.config.globalEnabled) {
      // Re-register with default
      const accelerator = this.getEffectiveAccelerator(binding);

      // Unregister any existing
      const entries = Array.from(this.registeredGlobal.entries());
      for (const [acc, act] of entries) {
        if (act === action) {
          globalShortcut.unregister(acc);
          this.registeredGlobal.delete(acc);
          break;
        }
      }

      this.registerGlobalShortcut(binding, accelerator);
    }

    logger.info('Binding reset to default', { action });
  }

  /**
   * Enable/disable a shortcut
   */
  setEnabled(action: ShortcutAction, enabled: boolean): void {
    if (enabled) {
      this.config.disabled = this.config.disabled.filter((a) => a !== action);
    } else if (!this.config.disabled.includes(action)) {
      this.config.disabled.push(action);
    }

    const binding = this.shortcuts.find((s) => s.action === action);
    if (binding?.scope === 'global') {
      const accelerator = this.getEffectiveAccelerator(binding);

      if (enabled) {
        this.registerGlobalShortcut(binding, accelerator);
      } else if (this.registeredGlobal.has(accelerator)) {
        globalShortcut.unregister(accelerator);
        this.registeredGlobal.delete(accelerator);
      }
    }

    logger.info('Shortcut enabled state changed', { action, enabled });
  }

  /**
   * Enable/disable all global shortcuts
   */
  setGlobalEnabled(enabled: boolean): void {
    this.config.globalEnabled = enabled;

    if (enabled) {
      this.registerGlobalShortcuts();
    } else {
      this.unregisterAllGlobal();
    }

    logger.info('Global shortcuts', { enabled });
  }

  /**
   * Unregister all global shortcuts
   */
  private unregisterAllGlobal(): void {
    const keys = Array.from(this.registeredGlobal.keys());
    for (const accelerator of keys) {
      globalShortcut.unregister(accelerator);
    }
    this.registeredGlobal.clear();
    logger.debug('All global shortcuts unregistered');
  }

  /**
   * Get current shortcut status
   */
  getStatus(): ShortcutStatus[] {
    return this.shortcuts.map((binding) => {
      const accelerator = this.getEffectiveAccelerator(binding);
      const isDisabled = this.config.disabled.includes(binding.action);

      let registered = false;
      if (binding.scope === 'global') {
        registered = this.registeredGlobal.has(accelerator) && !isDisabled;
      } else {
        registered = !isDisabled;
      }

      return {
        action: binding.action,
        accelerator,
        registered,
        scope: binding.scope,
      };
    });
  }

  /**
   * Get all shortcut bindings
   */
  getBindings(): ShortcutBinding[] {
    return this.shortcuts.map((binding) => ({
      ...binding,
      accelerator: this.getEffectiveAccelerator(binding),
    }));
  }

  /**
   * Get current configuration
   */
  getConfig(): ShortcutConfig {
    return { ...this.config };
  }

  /**
   * Update main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;

    if (window) {
      this.setupLocalShortcutForwarding();
    }
  }

  /**
   * Shutdown the shortcut manager
   */
  shutdown(): void {
    this.unregisterAllGlobal();
    resetHandlerState();
    this.isInitialized = false;
    this.mainWindow = null;
    this.removeAllListeners();
    logger.info('ShortcutManager shutdown');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let shortcutManagerInstance: ShortcutManager | null = null;

/**
 * Get or create the shortcut manager singleton
 */
export function getShortcutManager(config?: Partial<ShortcutConfig>): ShortcutManager {
  if (!shortcutManagerInstance) {
    shortcutManagerInstance = new ShortcutManager(config);
  }
  return shortcutManagerInstance;
}

/**
 * Initialize shortcut manager with main window
 */
export function initializeShortcuts(
  mainWindow: BrowserWindow,
  config?: Partial<ShortcutConfig>
): ShortcutManager {
  const manager = getShortcutManager(config);
  manager.initialize(mainWindow);
  return manager;
}

/**
 * Shutdown the shortcut manager
 */
export function shutdownShortcuts(): void {
  if (shortcutManagerInstance) {
    shortcutManagerInstance.shutdown();
    shortcutManagerInstance = null;
  }
}

export default {
  getShortcutManager,
  initializeShortcuts,
  shutdownShortcuts,
  DEFAULT_SHORTCUTS,
  DEFAULT_SHORTCUT_CONFIG,
};
