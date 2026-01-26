/**
 * Atlas Desktop - Accessibility Provider
 * React context provider for accessibility features
 * Follows WCAG 2.1 AA guidelines
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AccessibilityPreferences,
  AccessibilityEvent,
  AnnouncementPriority,
  AnnouncementType,
  HighContrastColors,
} from '../../../shared/types/accessibility';
import {
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  HIGH_CONTRAST_SCHEMES,
} from '../../../shared/types/accessibility';
import { ScreenReader, ScreenReaderAnnouncer } from './ScreenReader';
import { SkipLinks } from './SkipLinks';

/**
 * Accessibility context value
 */
interface AccessibilityContextValue {
  /**
   * Current accessibility preferences
   */
  preferences: AccessibilityPreferences;

  /**
   * Update accessibility preferences
   */
  updatePreferences: (updates: Partial<AccessibilityPreferences>) => void;

  /**
   * Make a screen reader announcement
   */
  announce: (message: string, priority?: AnnouncementPriority, type?: AnnouncementType) => void;

  /**
   * Check if reduced motion is preferred
   */
  prefersReducedMotion: boolean;

  /**
   * Check if high contrast mode is enabled
   */
  isHighContrast: boolean;

  /**
   * Current high contrast colors (if enabled)
   */
  highContrastColors: HighContrastColors | null;

  /**
   * Current font scale multiplier
   */
  fontScale: number;

  /**
   * Whether keyboard navigation mode is active
   */
  isKeyboardNavigation: boolean;

  /**
   * Set keyboard navigation mode
   */
  setKeyboardNavigation: (active: boolean) => void;
}

/**
 * Accessibility context
 */
const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

/**
 * Props for the AccessibilityProvider
 */
interface AccessibilityProviderProps {
  /**
   * Children to render
   */
  children: React.ReactNode;

  /**
   * Initial preferences (optional)
   */
  initialPreferences?: Partial<AccessibilityPreferences>;
}

/**
 * AccessibilityProvider Component
 *
 * Provides accessibility features to the entire application:
 * - Screen reader announcements
 * - High contrast mode
 * - Reduced motion detection
 * - Font scaling
 * - Keyboard navigation support
 */
export const AccessibilityProvider: React.FC<AccessibilityProviderProps> = ({
  children,
  initialPreferences,
}) => {
  // State
  const [preferences, setPreferences] = useState<AccessibilityPreferences>({
    ...DEFAULT_ACCESSIBILITY_PREFERENCES,
    ...initialPreferences,
  });
  const [isKeyboardNavigation, setKeyboardNavigation] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [systemHighContrast, setSystemHighContrast] = useState(false);

  /**
   * Detect system preferences on mount
   */
  useEffect(() => {
    // Detect reduced motion preference
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReducedMotion(motionQuery.matches);

    const handleMotionChange = (e: MediaQueryListEvent) => {
      setSystemReducedMotion(e.matches);
      if (preferences.useSystemPreferences) {
        setPreferences((prev) => ({ ...prev, reducedMotion: e.matches }));
      }
    };

    motionQuery.addEventListener('change', handleMotionChange);

    // Detect high contrast preference (forced-colors for Windows)
    const contrastQuery = window.matchMedia('(forced-colors: active)');
    setSystemHighContrast(contrastQuery.matches);

    const handleContrastChange = (e: MediaQueryListEvent) => {
      setSystemHighContrast(e.matches);
      if (preferences.useSystemPreferences) {
        setPreferences((prev) => ({ ...prev, highContrastMode: e.matches }));
      }
    };

    contrastQuery.addEventListener('change', handleContrastChange);

    // Apply initial system preferences
    if (preferences.useSystemPreferences) {
      setPreferences((prev) => ({
        ...prev,
        reducedMotion: motionQuery.matches,
        highContrastMode: contrastQuery.matches,
      }));
    }

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      contrastQuery.removeEventListener('change', handleContrastChange);
    };
  }, [preferences.useSystemPreferences]);

  /**
   * Detect keyboard vs mouse navigation
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        setKeyboardNavigation(true);
      }
    };

    const handleMouseDown = () => {
      setKeyboardNavigation(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  /**
   * Listen for accessibility events from main process
   */
  useEffect(() => {
    const handleAccessibilityEvent = (event: AccessibilityEvent) => {
      if (event.type === 'preferences-changed') {
        setPreferences(event.data as AccessibilityPreferences);
      } else if (event.type === 'high-contrast-change') {
        if (preferences.useSystemPreferences) {
          setPreferences((prev) => ({
            ...prev,
            highContrastMode: event.data as boolean,
          }));
        }
      } else if (event.type === 'reduced-motion-change') {
        if (preferences.useSystemPreferences) {
          setPreferences((prev) => ({
            ...prev,
            reducedMotion: event.data as boolean,
          }));
        }
      }
    };

    const unsubscribe = window.atlas?.on(
      'atlas:accessibility',
      handleAccessibilityEvent as (...args: unknown[]) => void
    );

    return () => {
      unsubscribe?.();
    };
  }, [preferences.useSystemPreferences]);

  /**
   * Apply accessibility styles to document
   */
  useEffect(() => {
    const root = document.documentElement;

    // Font scale
    root.style.setProperty('--a11y-font-scale', String(preferences.fontScale));
    root.style.fontSize = `${preferences.fontScale * 100}%`;

    // Reduced motion
    if (preferences.reducedMotion) {
      root.classList.add('reduced-motion');
    } else {
      root.classList.remove('reduced-motion');
    }

    // High contrast mode
    if (preferences.highContrastMode) {
      root.classList.add('high-contrast');
      root.setAttribute('data-high-contrast', 'true');
    } else {
      root.classList.remove('high-contrast');
      root.removeAttribute('data-high-contrast');
    }

    // Enhanced focus indicators
    if (preferences.enhancedFocusIndicators) {
      root.classList.add('enhanced-focus');
    } else {
      root.classList.remove('enhanced-focus');
    }

    // Keyboard navigation mode
    if (isKeyboardNavigation) {
      root.classList.add('keyboard-navigation');
    } else {
      root.classList.remove('keyboard-navigation');
    }
  }, [preferences, isKeyboardNavigation]);

  /**
   * Update preferences
   */
  const updatePreferences = useCallback((updates: Partial<AccessibilityPreferences>) => {
    setPreferences((prev) => {
      const newPrefs = { ...prev, ...updates };

      // Persist to localStorage
      try {
        localStorage.setItem('atlas-accessibility', JSON.stringify(newPrefs));
      } catch (e) {
        console.warn('[Accessibility] Failed to save preferences:', e);
      }

      return newPrefs;
    });
  }, []);

  /**
   * Make announcement
   */
  const announce = useCallback(
    (
      message: string,
      priority: AnnouncementPriority = 'polite',
      type: AnnouncementType = 'info'
    ) => {
      if (!preferences.screenReaderEnabled) return;

      // Dispatch custom event for local ScreenReaderAnnouncer
      window.dispatchEvent(
        new CustomEvent('atlas:announce', {
          detail: {
            message,
            priority,
            type,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
          },
        })
      );
    },
    [preferences.screenReaderEnabled]
  );

  /**
   * Computed values
   */
  const prefersReducedMotion = useMemo(
    () => (preferences.useSystemPreferences ? systemReducedMotion : preferences.reducedMotion),
    [preferences.useSystemPreferences, preferences.reducedMotion, systemReducedMotion]
  );

  const isHighContrast = useMemo(
    () => (preferences.useSystemPreferences ? systemHighContrast : preferences.highContrastMode),
    [preferences.useSystemPreferences, preferences.highContrastMode, systemHighContrast]
  );

  const highContrastColors = useMemo(() => {
    if (!isHighContrast) return null;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return HIGH_CONTRAST_SCHEMES[isDark ? 'dark' : 'light'];
  }, [isHighContrast]);

  /**
   * Context value
   */
  const contextValue = useMemo<AccessibilityContextValue>(
    () => ({
      preferences,
      updatePreferences,
      announce,
      prefersReducedMotion,
      isHighContrast,
      highContrastColors,
      fontScale: preferences.fontScale,
      isKeyboardNavigation,
      setKeyboardNavigation,
    }),
    [
      preferences,
      updatePreferences,
      announce,
      prefersReducedMotion,
      isHighContrast,
      highContrastColors,
      isKeyboardNavigation,
    ]
  );

  /**
   * Load saved preferences on mount
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atlas-accessibility');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AccessibilityPreferences>;
        setPreferences((prev) => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      console.warn('[Accessibility] Failed to load preferences:', e);
    }
  }, []);

  return (
    <AccessibilityContext.Provider value={contextValue}>
      {/* Skip links for keyboard navigation */}
      <SkipLinks enabled={preferences.enhancedFocusIndicators} />

      {/* Screen reader live regions */}
      <ScreenReader enabled={preferences.screenReaderEnabled} />
      <ScreenReaderAnnouncer />

      {/* Main content */}
      {children}
    </AccessibilityContext.Provider>
  );
};

/**
 * Hook to access accessibility context
 */
export function useAccessibility(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider');
  }
  return context;
}

/**
 * Hook to check if reduced motion is preferred
 */
export function usePrefersReducedMotion(): boolean {
  const context = useContext(AccessibilityContext);

  // Fallback state for when no provider exists
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Only run if no context provider
    if (context) return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(query.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [context]);

  // Use context value if available, otherwise use local state
  if (context) {
    return context.prefersReducedMotion;
  }
  return prefersReducedMotion;
}

/**
 * Hook to check if high contrast mode is enabled
 */
export function useHighContrast(): boolean {
  const context = useContext(AccessibilityContext);

  // Fallback state for when no provider exists
  const [isHighContrast, setIsHighContrast] = useState(false);

  useEffect(() => {
    // Only run if no context provider
    if (context) return;

    const query = window.matchMedia('(forced-colors: active)');
    setIsHighContrast(query.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsHighContrast(e.matches);
    };

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [context]);

  // Use context value if available, otherwise use local state
  if (context) {
    return context.isHighContrast;
  }
  return isHighContrast;
}

export default AccessibilityProvider;
