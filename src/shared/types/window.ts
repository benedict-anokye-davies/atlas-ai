/**
 * Atlas Window Mode Types
 * Defines types for multi-window display modes
 */

/**
 * Available window display modes
 */
export type WindowMode = 'normal' | 'compact' | 'overlay' | 'tray';

/**
 * Window mode configuration
 */
export interface WindowModeConfig {
  /** Current window mode */
  mode: WindowMode;
  /** Last used mode (for restoration) */
  lastMode: WindowMode;
  /** Remember mode between sessions */
  rememberMode: boolean;
  /** Window bounds for each mode */
  modeBounds: Record<WindowMode, WindowBounds | null>;
  /** Keyboard shortcuts for mode switching */
  shortcuts: WindowModeShortcuts;
  /** Transition settings */
  transition: WindowTransitionConfig;
}

/**
 * Window bounds configuration
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Keyboard shortcuts for window modes
 */
export interface WindowModeShortcuts {
  /** Toggle between normal and compact mode */
  toggleCompact: string;
  /** Toggle overlay mode */
  toggleOverlay: string;
  /** Minimize to tray */
  minimizeToTray: string;
  /** Cycle through all modes */
  cycleMode: string;
  /** Restore to normal mode */
  restoreNormal: string;
}

/**
 * Transition animation configuration
 */
export interface WindowTransitionConfig {
  /** Enable smooth transitions */
  enabled: boolean;
  /** Transition duration in milliseconds */
  duration: number;
  /** Easing function type */
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

/**
 * Default window mode shortcuts
 */
export const DEFAULT_WINDOW_MODE_SHORTCUTS: WindowModeShortcuts = {
  toggleCompact: 'CommandOrControl+Shift+C',
  toggleOverlay: 'CommandOrControl+Shift+O',
  minimizeToTray: 'CommandOrControl+Shift+M',
  cycleMode: 'CommandOrControl+Shift+Tab',
  restoreNormal: 'CommandOrControl+Shift+N',
};

/**
 * Default window mode configuration
 */
export const DEFAULT_WINDOW_MODE_CONFIG: WindowModeConfig = {
  mode: 'normal',
  lastMode: 'normal',
  rememberMode: true,
  modeBounds: {
    normal: null,
    compact: null,
    overlay: null,
    tray: null,
  },
  shortcuts: DEFAULT_WINDOW_MODE_SHORTCUTS,
  transition: {
    enabled: true,
    duration: 200,
    easing: 'ease-out',
  },
};

/**
 * Mode-specific window properties
 */
export interface WindowModeProperties {
  /** Window dimensions */
  width: number;
  height: number;
  /** Minimum dimensions */
  minWidth: number;
  minHeight: number;
  /** Maximum dimensions (null = no limit) */
  maxWidth: number | null;
  maxHeight: number | null;
  /** Window frame */
  frame: boolean;
  /** Resizable */
  resizable: boolean;
  /** Always on top */
  alwaysOnTop: boolean;
  /** Transparent background */
  transparent: boolean;
  /** Skip taskbar */
  skipTaskbar: boolean;
  /** Focusable */
  focusable: boolean;
  /** Background color */
  backgroundColor: string;
}

/**
 * Window mode properties definitions
 */
export const WINDOW_MODE_PROPERTIES: Record<WindowMode, WindowModeProperties> = {
  normal: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    maxWidth: null,
    maxHeight: null,
    frame: true,
    resizable: true,
    alwaysOnTop: false,
    transparent: false,
    skipTaskbar: false,
    focusable: true,
    backgroundColor: '#0a0a0f',
  },
  compact: {
    width: 200,
    height: 200,
    minWidth: 150,
    minHeight: 150,
    maxWidth: 300,
    maxHeight: 300,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: false,
    focusable: true,
    backgroundColor: '#00000000',
  },
  overlay: {
    width: 400,
    height: 400,
    minWidth: 200,
    minHeight: 200,
    maxWidth: 600,
    maxHeight: 600,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#00000000',
  },
  tray: {
    width: 0,
    height: 0,
    minWidth: 0,
    minHeight: 0,
    maxWidth: null,
    maxHeight: null,
    frame: true,
    resizable: true,
    alwaysOnTop: false,
    transparent: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#0a0a0f',
  },
};

/**
 * Window mode change event
 */
export interface WindowModeChangeEvent {
  previousMode: WindowMode;
  currentMode: WindowMode;
  timestamp: number;
  triggeredBy: 'shortcut' | 'tray' | 'api' | 'startup';
}

/**
 * Window mode state for renderer
 */
export interface WindowModeState {
  mode: WindowMode;
  isTransitioning: boolean;
  isAlwaysOnTop: boolean;
  isTransparent: boolean;
  bounds: WindowBounds | null;
}
