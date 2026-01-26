/**
 * Atlas Desktop - Accessibility Types
 * Type definitions for accessibility features following WCAG 2.1 AA guidelines
 */

/**
 * Accessibility preferences for the application
 */
export interface AccessibilityPreferences {
  /**
   * Enable screen reader announcements for state changes
   */
  screenReaderEnabled: boolean;

  /**
   * Enable high contrast mode for better visibility
   */
  highContrastMode: boolean;

  /**
   * Enable reduced motion for animations (respects prefers-reduced-motion)
   */
  reducedMotion: boolean;

  /**
   * Font size scale multiplier (1.0 = 100%, 1.5 = 150%, etc.)
   * Range: 0.75 - 2.0
   */
  fontScale: number;

  /**
   * Enable enhanced focus indicators for keyboard navigation
   */
  enhancedFocusIndicators: boolean;

  /**
   * Enable audio descriptions for visual elements
   */
  audioDescriptions: boolean;

  /**
   * Keyboard navigation mode (tab order optimization)
   */
  keyboardNavigationMode: 'default' | 'enhanced' | 'simplified';

  /**
   * Enable captions/subtitles for audio content
   */
  captionsEnabled: boolean;

  /**
   * Auto-detect system accessibility preferences
   */
  useSystemPreferences: boolean;
}

/**
 * Screen reader announcement priority levels
 */
export type AnnouncementPriority = 'polite' | 'assertive' | 'off';

/**
 * Screen reader announcement types
 */
export type AnnouncementType =
  | 'state-change'
  | 'navigation'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'
  | 'action';

/**
 * Screen reader announcement configuration
 */
export interface Announcement {
  /**
   * The message to announce
   */
  message: string;

  /**
   * Priority level (polite waits, assertive interrupts)
   */
  priority: AnnouncementPriority;

  /**
   * Type of announcement for semantic context
   */
  type: AnnouncementType;

  /**
   * Unique identifier for the announcement
   */
  id?: string;

  /**
   * Timestamp when the announcement was created
   */
  timestamp?: number;

  /**
   * Duration in ms before the announcement is cleared (0 = no auto-clear)
   */
  clearAfter?: number;
}

/**
 * Atlas state descriptions for screen readers
 */
export interface StateDescription {
  /**
   * Short label for the state
   */
  label: string;

  /**
   * Longer description of what the state means
   */
  description: string;

  /**
   * Instructions on how to proceed
   */
  instructions?: string;
}

/**
 * State descriptions for each Atlas state
 */
export const ATLAS_STATE_DESCRIPTIONS: Record<string, StateDescription> = {
  idle: {
    label: 'Ready',
    description: 'Atlas is ready and waiting for input.',
    instructions: 'Say "Hey Atlas" or press Space to start.',
  },
  listening: {
    label: 'Listening',
    description: 'Atlas is listening to your voice.',
    instructions: 'Speak your question or command. Press Escape to cancel.',
  },
  thinking: {
    label: 'Processing',
    description: 'Atlas is processing your request.',
    instructions: 'Please wait while Atlas prepares a response.',
  },
  speaking: {
    label: 'Speaking',
    description: 'Atlas is speaking the response.',
    instructions: 'Press Escape to stop or speak to interrupt.',
  },
  error: {
    label: 'Error',
    description: 'An error occurred.',
    instructions: 'Check the error message and try again.',
  },
};

/**
 * Focus trap configuration for modal dialogs
 */
export interface FocusTrapConfig {
  /**
   * Container element ID for the focus trap
   */
  containerId: string;

  /**
   * Initial focus target selector
   */
  initialFocus?: string;

  /**
   * Return focus to this element when trap is released
   */
  returnFocus?: HTMLElement | null;

  /**
   * Allow escape key to release the trap
   */
  escapeDeactivates?: boolean;

  /**
   * Click outside to release the trap
   */
  clickOutsideDeactivates?: boolean;
}

/**
 * Skip link configuration
 */
export interface SkipLink {
  /**
   * Display label for the skip link
   */
  label: string;

  /**
   * Target element ID to skip to
   */
  targetId: string;

  /**
   * Order in which skip links appear
   */
  order: number;
}

/**
 * Default skip links for the application
 */
export const DEFAULT_SKIP_LINKS: SkipLink[] = [
  { label: 'Skip to main content', targetId: 'main-content', order: 1 },
  { label: 'Skip to orb visualization', targetId: 'atlas-orb', order: 2 },
  { label: 'Skip to transcript', targetId: 'atlas-transcript', order: 3 },
  { label: 'Skip to settings', targetId: 'settings-trigger', order: 4 },
];

/**
 * Keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  /**
   * Display name for the shortcut
   */
  name: string;

  /**
   * Key combination (e.g., 'Space', 'Ctrl+,', 'Escape')
   */
  keys: string;

  /**
   * Description of what the shortcut does
   */
  description: string;

  /**
   * Action identifier
   */
  action: string;
}

/**
 * Default keyboard shortcuts
 */
export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    name: 'Activate',
    keys: 'Space',
    description: 'Trigger wake word and start listening',
    action: 'trigger-wake',
  },
  {
    name: 'Cancel',
    keys: 'Escape',
    description: 'Stop current action or close dialogs',
    action: 'cancel',
  },
  {
    name: 'Settings',
    keys: 'Ctrl+,',
    description: 'Open settings panel',
    action: 'open-settings',
  },
  {
    name: 'Debug',
    keys: 'Ctrl+D',
    description: 'Toggle debug overlay',
    action: 'toggle-debug',
  },
  {
    name: 'Help',
    keys: 'F1',
    description: 'Show keyboard shortcuts help',
    action: 'show-help',
  },
];

/**
 * Color contrast configuration for high contrast mode
 */
export interface HighContrastColors {
  /**
   * Primary foreground color
   */
  foreground: string;

  /**
   * Primary background color
   */
  background: string;

  /**
   * Accent/highlight color
   */
  accent: string;

  /**
   * Focus indicator color
   */
  focus: string;

  /**
   * Error state color
   */
  error: string;

  /**
   * Success state color
   */
  success: string;

  /**
   * Warning state color
   */
  warning: string;
}

/**
 * Default high contrast color schemes
 */
export const HIGH_CONTRAST_SCHEMES: Record<'dark' | 'light', HighContrastColors> = {
  dark: {
    foreground: '#FFFFFF',
    background: '#000000',
    accent: '#00FFFF',
    focus: '#FFFF00',
    error: '#FF6B6B',
    success: '#00FF00',
    warning: '#FFD700',
  },
  light: {
    foreground: '#000000',
    background: '#FFFFFF',
    accent: '#0066CC',
    focus: '#000080',
    error: '#CC0000',
    success: '#006600',
    warning: '#996600',
  },
};

/**
 * Default accessibility preferences
 */
export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  screenReaderEnabled: true,
  highContrastMode: false,
  reducedMotion: false, // Will be auto-detected from system
  fontScale: 1.0,
  enhancedFocusIndicators: true,
  audioDescriptions: false,
  keyboardNavigationMode: 'default',
  captionsEnabled: true,
  useSystemPreferences: true,
};

/**
 * Accessibility event types emitted by the main process
 */
export type AccessibilityEventType =
  | 'preferences-changed'
  | 'announcement'
  | 'focus-change'
  | 'high-contrast-change'
  | 'reduced-motion-change';

/**
 * Accessibility event payload
 */
export interface AccessibilityEvent {
  type: AccessibilityEventType;
  data: unknown;
  timestamp: number;
}
