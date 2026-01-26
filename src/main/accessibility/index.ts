/**
 * Atlas Desktop - Accessibility Manager
 * Main process accessibility features following WCAG 2.1 AA guidelines
 *
 * Provides:
 * - System accessibility preference detection
 * - High contrast mode management
 * - Reduced motion preference handling
 * - Screen reader announcement coordination
 * - Keyboard navigation support
 */

import { EventEmitter } from 'events';
import { BrowserWindow, nativeTheme } from 'electron';
import { createModuleLogger } from '../utils/logger';
import type {
  AccessibilityPreferences,
  Announcement,
  AccessibilityEvent,
  AccessibilityEventType,
  AnnouncementPriority,
  AnnouncementType,
  ATLAS_STATE_DESCRIPTIONS,
} from '../../shared/types/accessibility';

const logger = createModuleLogger('Accessibility');

/**
 * Default preferences
 */
const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  screenReaderEnabled: true,
  highContrastMode: false,
  reducedMotion: false,
  fontScale: 1.0,
  enhancedFocusIndicators: true,
  audioDescriptions: false,
  keyboardNavigationMode: 'default',
  captionsEnabled: true,
  useSystemPreferences: true,
};

/**
 * Accessibility Manager - Singleton
 * Manages accessibility features for the Atlas desktop application
 */
export class AccessibilityManager extends EventEmitter {
  private static instance: AccessibilityManager | null = null;

  private preferences: AccessibilityPreferences;
  private mainWindow: BrowserWindow | null = null;
  private announcementQueue: Announcement[] = [];
  private isProcessingAnnouncements = false;
  private systemPreferencesListeners: (() => void)[] = [];

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    super();
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.detectSystemPreferences();
    this.setupSystemPreferenceListeners();
    logger.info('AccessibilityManager initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AccessibilityManager {
    if (!AccessibilityManager.instance) {
      AccessibilityManager.instance = new AccessibilityManager();
    }
    return AccessibilityManager.instance;
  }

  /**
   * Set the main window reference for sending events
   */
  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
    if (window) {
      // Send current preferences to renderer
      this.sendToRenderer('preferences-changed', this.preferences);
    }
  }

  /**
   * Detect system accessibility preferences
   */
  private detectSystemPreferences(): void {
    try {
      // Detect reduced motion preference
      // On Windows, check for animation settings
      if (process.platform === 'win32') {
        // Windows has accessibility settings we can try to detect
        // For now, we'll rely on CSS media query in renderer
        this.preferences.reducedMotion = false;
      } else if (process.platform === 'darwin') {
        // macOS has NSWorkspaceAccessibilityDisplayOptionsDidChange
        // Note: getMediaAccessStatus checks camera/mic access, not motion preferences
        this.preferences.reducedMotion = false;
      }

      // Detect high contrast mode
      if (process.platform === 'win32') {
        // Windows high contrast detection
        this.preferences.highContrastMode = nativeTheme.shouldUseHighContrastColors ?? false;
      }

      // Detect color scheme preference
      const isDarkMode = nativeTheme.shouldUseDarkColors;
      logger.debug('System preferences detected', {
        reducedMotion: this.preferences.reducedMotion,
        highContrastMode: this.preferences.highContrastMode,
        isDarkMode,
      });
    } catch (error) {
      logger.warn('Failed to detect system preferences', { error });
    }
  }

  /**
   * Setup listeners for system preference changes
   */
  private setupSystemPreferenceListeners(): void {
    // Listen for high contrast changes
    const handleHighContrastChange = () => {
      const highContrast = nativeTheme.shouldUseHighContrastColors ?? false;
      if (
        this.preferences.useSystemPreferences &&
        highContrast !== this.preferences.highContrastMode
      ) {
        this.preferences.highContrastMode = highContrast;
        this.sendToRenderer('high-contrast-change', highContrast);
        this.emit('high-contrast-change', highContrast);
        logger.info('High contrast mode changed', { enabled: highContrast });
      }
    };

    nativeTheme.on('updated', handleHighContrastChange);
    this.systemPreferencesListeners.push(() => {
      nativeTheme.removeListener('updated', handleHighContrastChange);
    });
  }

  /**
   * Get current accessibility preferences
   */
  public getPreferences(): AccessibilityPreferences {
    return { ...this.preferences };
  }

  /**
   * Update accessibility preferences
   */
  public updatePreferences(updates: Partial<AccessibilityPreferences>): void {
    const oldPreferences = { ...this.preferences };
    this.preferences = { ...this.preferences, ...updates };

    // If useSystemPreferences changed, re-detect
    if (
      updates.useSystemPreferences &&
      updates.useSystemPreferences !== oldPreferences.useSystemPreferences
    ) {
      this.detectSystemPreferences();
    }

    // Emit changes
    this.emit('preferences-changed', this.preferences);
    this.sendToRenderer('preferences-changed', this.preferences);

    // Log significant changes
    if (
      updates.highContrastMode !== undefined &&
      updates.highContrastMode !== oldPreferences.highContrastMode
    ) {
      logger.info('High contrast mode updated', { enabled: updates.highContrastMode });
    }
    if (
      updates.reducedMotion !== undefined &&
      updates.reducedMotion !== oldPreferences.reducedMotion
    ) {
      logger.info('Reduced motion updated', { enabled: updates.reducedMotion });
    }
    if (updates.fontScale !== undefined && updates.fontScale !== oldPreferences.fontScale) {
      logger.info('Font scale updated', { scale: updates.fontScale });
    }
  }

  /**
   * Queue an announcement for screen readers
   */
  public announce(
    message: string,
    priority: AnnouncementPriority = 'polite',
    type: AnnouncementType = 'info'
  ): void {
    if (!this.preferences.screenReaderEnabled) {
      return;
    }

    const announcement: Announcement = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      message,
      priority,
      type,
      timestamp: Date.now(),
      clearAfter: priority === 'assertive' ? 0 : 5000,
    };

    // For assertive announcements, clear the queue and announce immediately
    if (priority === 'assertive') {
      this.announcementQueue = [announcement];
    } else {
      this.announcementQueue.push(announcement);
    }

    this.processAnnouncementQueue();
  }

  /**
   * Announce an Atlas state change
   */
  public async announceStateChange(
    state: keyof typeof ATLAS_STATE_DESCRIPTIONS,
    details?: string
  ): Promise<void> {
    // Import state descriptions at runtime to avoid circular dependency
    const accessibilityModule = await import('../../shared/types/accessibility');
    const stateInfo = accessibilityModule.ATLAS_STATE_DESCRIPTIONS[state];

    if (!stateInfo) {
      logger.warn('Unknown state for announcement', { state });
      return;
    }

    let message = `${stateInfo.label}. ${stateInfo.description}`;
    if (details) {
      message += ` ${details}`;
    }
    if (stateInfo.instructions) {
      message += ` ${stateInfo.instructions}`;
    }

    const priority: AnnouncementPriority =
      state === 'error' ? 'assertive' : state === 'listening' ? 'assertive' : 'polite';

    const type: AnnouncementType = state === 'error' ? 'error' : 'state-change';

    this.announce(message, priority, type);
  }

  /**
   * Process queued announcements
   */
  private processAnnouncementQueue(): void {
    if (this.isProcessingAnnouncements || this.announcementQueue.length === 0) {
      return;
    }

    this.isProcessingAnnouncements = true;
    const announcement = this.announcementQueue.shift();

    if (announcement) {
      this.sendToRenderer('announcement', announcement);
      this.emit('announcement', announcement);

      // Process next announcement after a brief delay
      setTimeout(() => {
        this.isProcessingAnnouncements = false;
        this.processAnnouncementQueue();
      }, 100);
    } else {
      this.isProcessingAnnouncements = false;
    }
  }

  /**
   * Clear all pending announcements
   */
  public clearAnnouncements(): void {
    this.announcementQueue = [];
    this.isProcessingAnnouncements = false;
  }

  /**
   * Check if reduced motion is preferred
   */
  public prefersReducedMotion(): boolean {
    return this.preferences.reducedMotion;
  }

  /**
   * Check if high contrast mode is enabled
   */
  public isHighContrastEnabled(): boolean {
    return this.preferences.highContrastMode;
  }

  /**
   * Get the current font scale
   */
  public getFontScale(): number {
    return this.preferences.fontScale;
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(eventType: AccessibilityEventType, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const event: AccessibilityEvent = {
        type: eventType,
        data,
        timestamp: Date.now(),
      };
      this.mainWindow.webContents.send('atlas:accessibility', event);
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    // Remove system preference listeners
    this.systemPreferencesListeners.forEach((unsubscribe) => unsubscribe());
    this.systemPreferencesListeners = [];

    // Clear announcement queue
    this.clearAnnouncements();

    // Remove all event listeners
    this.removeAllListeners();

    // Clear instance
    this.mainWindow = null;
    AccessibilityManager.instance = null;

    logger.info('AccessibilityManager destroyed');
  }
}

/**
 * Get the accessibility manager singleton
 */
export function getAccessibilityManager(): AccessibilityManager {
  return AccessibilityManager.getInstance();
}

/**
 * Convenience function to make an announcement
 */
export function announce(
  message: string,
  priority: AnnouncementPriority = 'polite',
  type: AnnouncementType = 'info'
): void {
  getAccessibilityManager().announce(message, priority, type);
}

/**
 * Convenience function to announce state change
 */
export async function announceStateChange(state: string, details?: string): Promise<void> {
  await getAccessibilityManager().announceStateChange(
    state as keyof typeof ATLAS_STATE_DESCRIPTIONS,
    details
  );
}

export default AccessibilityManager;
