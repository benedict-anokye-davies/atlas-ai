/**
 * Atlas Desktop - Theme Hook
 * React hook for managing theme state with system detection and persistence
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  type ThemeMode,
  type ResolvedTheme,
  type Theme,
  getTheme,
  getSystemTheme,
  applyTheme,
  getStoredThemeMode,
  storeThemeMode,
  enableThemeTransition,
  disableThemeTransition,
  THEME_TRANSITION_DURATION,
} from '../themes';

/**
 * Theme hook options
 */
export interface UseThemeOptions {
  /**
   * Initial theme mode (defaults to stored preference or 'system')
   */
  initialMode?: ThemeMode;

  /**
   * Whether to automatically detect and respond to system theme changes
   * @default true
   */
  detectSystemTheme?: boolean;

  /**
   * Whether to persist theme choice to localStorage
   * @default true
   */
  persist?: boolean;

  /**
   * Whether to enable smooth transitions when theme changes
   * @default true
   */
  enableTransitions?: boolean;
}

/**
 * Theme hook result
 */
export interface UseThemeResult {
  /**
   * Current theme mode setting (dark, light, or system)
   */
  mode: ThemeMode;

  /**
   * Resolved theme (what's actually applied - dark or light)
   */
  resolvedTheme: ResolvedTheme;

  /**
   * Full theme object with all colors and settings
   */
  theme: Theme;

  /**
   * Whether dark mode is currently active
   */
  isDark: boolean;

  /**
   * Whether light mode is currently active
   */
  isLight: boolean;

  /**
   * Whether system theme detection is being used
   */
  isSystem: boolean;

  /**
   * Set the theme mode
   */
  setMode: (mode: ThemeMode) => void;

  /**
   * Toggle between dark and light (exits system mode)
   */
  toggle: () => void;

  /**
   * Set to dark mode
   */
  setDark: () => void;

  /**
   * Set to light mode
   */
  setLight: () => void;

  /**
   * Set to system mode (auto-detect)
   */
  setSystem: () => void;
}

/**
 * Hook for managing theme state with system detection and persistence
 *
 * @example
 * ```tsx
 * function App() {
 *   const { theme, isDark, toggle, setMode } = useTheme();
 *
 *   return (
 *     <div style={{ background: theme.colors.bgPrimary }}>
 *       <button onClick={toggle}>
 *         {isDark ? 'Switch to Light' : 'Switch to Dark'}
 *       </button>
 *       <select value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
 *         <option value="dark">Dark</option>
 *         <option value="light">Light</option>
 *         <option value="system">System</option>
 *       </select>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTheme(options: UseThemeOptions = {}): UseThemeResult {
  const {
    initialMode,
    detectSystemTheme = true,
    persist = true,
    enableTransitions = true,
  } = options;

  // Initialize mode from stored preference, initial option, or default to 'system'
  const getInitialMode = useCallback((): ThemeMode => {
    if (persist) {
      const stored = getStoredThemeMode();
      if (stored) {
        return stored;
      }
    }
    return initialMode ?? 'dark';
  }, [persist, initialMode]);

  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Resolved theme based on mode and system preference
  const resolvedTheme = useMemo((): ResolvedTheme => {
    if (mode === 'system') {
      return systemTheme;
    }
    return mode;
  }, [mode, systemTheme]);

  // Full theme object
  const theme = useMemo(() => getTheme(resolvedTheme), [resolvedTheme]);

  // Derived boolean states
  const isDark = resolvedTheme === 'dark';
  const isLight = resolvedTheme === 'light';
  const isSystem = mode === 'system';

  // Apply theme to document
  useEffect(() => {
    // Disable transitions on initial load to prevent flash
    disableThemeTransition();
    applyTheme(theme);

    // Enable transitions after initial apply (with small delay)
    if (enableTransitions) {
      const timer = setTimeout(() => {
        enableThemeTransition();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [theme, enableTransitions]);

  // Listen for system theme changes
  useEffect(() => {
    if (!detectSystemTheme || typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    // Legacy browsers (Safari < 14)
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [detectSystemTheme]);

  // Set mode with persistence
  const setMode = useCallback(
    (newMode: ThemeMode) => {
      // Enable transitions for user-initiated changes
      if (enableTransitions) {
        enableThemeTransition();
      }

      setModeState(newMode);

      if (persist) {
        storeThemeMode(newMode);
      }

      // Disable transitions after change completes
      if (enableTransitions) {
        setTimeout(() => {
          // Transitions will be re-enabled on next change
        }, THEME_TRANSITION_DURATION);
      }
    },
    [persist, enableTransitions]
  );

  // Toggle between dark and light
  const toggle = useCallback(() => {
    const newMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setMode(newMode);
  }, [resolvedTheme, setMode]);

  // Convenience methods
  const setDark = useCallback(() => setMode('dark'), [setMode]);
  const setLight = useCallback(() => setMode('light'), [setMode]);
  const setSystem = useCallback(() => setMode('system'), [setMode]);

  return {
    mode,
    resolvedTheme,
    theme,
    isDark,
    isLight,
    isSystem,
    setMode,
    toggle,
    setDark,
    setLight,
    setSystem,
  };
}

export default useTheme;
