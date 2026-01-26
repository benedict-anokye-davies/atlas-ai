/**
 * Atlas Desktop - Keyboard Shortcut Types
 * Shared type definitions for keyboard shortcuts
 */

// ============================================================================
// Action Types
// ============================================================================

/**
 * Shortcut action identifiers
 */
export type ShortcutAction =
  // Voice actions
  | 'push-to-talk'
  | 'toggle-listening'
  | 'cancel-speech'
  | 'repeat-last-response'
  | 'toggle-mute'
  // Window actions
  | 'toggle-window'
  | 'show-window'
  | 'hide-window'
  | 'toggle-compact-mode'
  | 'toggle-overlay-mode'
  // App actions
  | 'open-settings'
  | 'quit-app'
  | 'cancel-action'
  | 'command-palette'
  | 'focus-input'
  | 'clear-conversation'
  // Quick commands (Session 047-B)
  | 'quick-command-1'
  | 'quick-command-2'
  | 'quick-command-3'
  | 'quick-command-4'
  | 'quick-command-5';

/**
 * Shortcut scope
 */
export type ShortcutScope = 'global' | 'local';

// ============================================================================
// Binding Types
// ============================================================================

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
 * Shortcut definition sent to renderer
 */
export interface ShortcutDefinition {
  /** Action identifier */
  action: ShortcutAction;
  /** Current accelerator */
  accelerator: string;
  /** Human-readable description */
  description: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

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
  /** Action identifier */
  action: ShortcutAction;
  /** Current accelerator */
  accelerator: string;
  /** Whether successfully registered */
  registered: boolean;
  /** Shortcut scope */
  scope: ShortcutScope;
  /** Error message if registration failed */
  error?: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Shortcut triggered event
 */
export interface ShortcutTriggeredEvent {
  /** Action that was triggered */
  action: ShortcutAction;
  /** Timestamp */
  timestamp: number;
}

/**
 * Shortcut conflict event
 */
export interface ShortcutConflictEvent {
  /** Action that has conflict */
  action: ShortcutAction;
  /** Conflicting accelerator */
  accelerator: string;
  /** Description of conflict */
  message: string;
}

/**
 * Shortcut registration event
 */
export interface ShortcutRegistrationEvent {
  /** Action being registered */
  action: ShortcutAction;
  /** Accelerator being registered */
  accelerator: string;
  /** Scope of the shortcut */
  scope: ShortcutScope;
}

/**
 * Shortcut registration failed event
 */
export interface ShortcutRegistrationFailedEvent extends ShortcutRegistrationEvent {
  /** Error message */
  error: string;
}

// ============================================================================
// IPC Types
// ============================================================================

/**
 * Shortcut IPC channel names
 */
export const SHORTCUT_IPC_CHANNELS = {
  /** Get current shortcut status */
  GET_STATUS: 'shortcuts:get-status',
  /** Get current shortcut config */
  GET_CONFIG: 'shortcuts:get-config',
  /** Update shortcut config */
  UPDATE_CONFIG: 'shortcuts:update-config',
  /** Set custom binding */
  SET_BINDING: 'shortcuts:set-binding',
  /** Reset binding to default */
  RESET_BINDING: 'shortcuts:reset-binding',
  /** Enable/disable a shortcut */
  SET_ENABLED: 'shortcuts:set-enabled',
  /** Enable/disable all global shortcuts */
  SET_GLOBAL_ENABLED: 'shortcuts:set-global-enabled',
  /** Shortcut triggered event (main -> renderer) */
  TRIGGERED: 'atlas:shortcut',
  /** Shortcut config update event (main -> renderer) */
  CONFIG_UPDATE: 'atlas:shortcuts-config',
  /** Open command palette event */
  COMMAND_PALETTE: 'atlas:open-command-palette',
  /** Focus input event */
  FOCUS_INPUT: 'atlas:focus-input',
} as const;

/**
 * IPC Result for shortcut operations
 */
export interface ShortcutIPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default shortcut configuration
 */
export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  bindings: {},
  disabled: [],
  globalEnabled: true,
};

/**
 * List of all shortcut actions
 */
export const ALL_SHORTCUT_ACTIONS: ShortcutAction[] = [
  'push-to-talk',
  'toggle-window',
  'toggle-mute',
  'open-settings',
  'cancel-action',
  'command-palette',
  'focus-input',
  'clear-conversation',
];

/**
 * Get human-readable label for a shortcut action
 */
export function getShortcutLabel(action: ShortcutAction): string {
  const labels: Partial<Record<ShortcutAction, string>> = {
    'push-to-talk': 'Push to Talk',
    'toggle-listening': 'Toggle Listening',
    'cancel-speech': 'Cancel Speech',
    'repeat-last-response': 'Repeat Last Response',
    'toggle-mute': 'Toggle Mute',
    'toggle-window': 'Toggle Window',
    'show-window': 'Show Window',
    'hide-window': 'Hide Window',
    'toggle-compact-mode': 'Toggle Compact Mode',
    'toggle-overlay-mode': 'Toggle Overlay Mode',
    'open-settings': 'Open Settings',
    'quit-app': 'Quit App',
    'cancel-action': 'Cancel Action',
    'command-palette': 'Command Palette',
    'focus-input': 'Focus Input',
    'clear-conversation': 'Clear Conversation',
    'quick-command-1': 'Quick Command 1',
    'quick-command-2': 'Quick Command 2',
    'quick-command-3': 'Quick Command 3',
    'quick-command-4': 'Quick Command 4',
    'quick-command-5': 'Quick Command 5',
  };
  return labels[action] || action.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get category for a shortcut action
 */
export function getShortcutCategory(action: ShortcutAction): 'voice' | 'navigation' | 'general' {
  switch (action) {
    case 'push-to-talk':
    case 'toggle-listening':
    case 'cancel-speech':
    case 'repeat-last-response':
    case 'toggle-mute':
      return 'voice';
    case 'toggle-window':
    case 'show-window':
    case 'hide-window':
    case 'toggle-compact-mode':
    case 'toggle-overlay-mode':
    case 'open-settings':
    case 'command-palette':
    case 'focus-input':
      return 'navigation';
    case 'cancel-action':
    case 'clear-conversation':
    case 'quit-app':
    case 'quick-command-1':
    case 'quick-command-2':
    case 'quick-command-3':
    case 'quick-command-4':
    case 'quick-command-5':
    default:
      return 'general';
  }
}
