/**
 * Atlas Desktop - Theme System
 * Dark and Light theme definitions with CSS variables
 */

/**
 * Theme mode options
 */
export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * Resolved theme (what's actually applied)
 */
export type ResolvedTheme = 'dark' | 'light';

/**
 * Color definition for a theme
 */
export interface ThemeColors {
  // Background colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // Accent colors
  accent: string;
  accentLight: string;
  accentDark: string;

  // Semantic colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Border colors
  border: string;
  borderLight: string;

  // Overlay colors
  overlayBg: string;
  modalBg: string;

  // Scrollbar
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;

  // Selection
  selectionBg: string;
  selectionText: string;

  // Focus
  focusRing: string;
}

/**
 * Orb color configuration per theme
 */
export interface OrbColors {
  idle: string;
  listening: string;
  thinking: string;
  speaking: string;
  error: string;
}

/**
 * Shadow definitions for a theme
 */
export interface ThemeShadows {
  small: string;
  medium: string;
  large: string;
  glow: string;
}

/**
 * Complete theme definition
 */
export interface Theme {
  name: string;
  mode: ResolvedTheme;
  colors: ThemeColors;
  orb: OrbColors;
  shadows: ThemeShadows;
}

/**
 * Dark theme definition
 */
export const darkTheme: Theme = {
  name: 'Dark',
  mode: 'dark',
  colors: {
    // Background colors - deep blacks and grays
    bgPrimary: '#000000',
    bgSecondary: '#0a0a0f',
    bgTertiary: '#12121a',

    // Text colors - light grays to white
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textTertiary: '#64748b',

    // Accent colors - indigo/purple
    accent: '#6366f1',
    accentLight: '#818cf8',
    accentDark: '#4f46e5',

    // Semantic colors
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',

    // Border colors
    border: 'rgba(99, 102, 241, 0.2)',
    borderLight: 'rgba(99, 102, 241, 0.1)',

    // Overlay colors
    overlayBg: 'rgba(0, 0, 0, 0.8)',
    modalBg: 'rgba(18, 18, 26, 0.95)',

    // Scrollbar
    scrollbarTrack: '#0a0a0f',
    scrollbarThumb: '#6366f1',
    scrollbarThumbHover: '#818cf8',

    // Selection
    selectionBg: '#6366f1',
    selectionText: '#f1f5f9',

    // Focus
    focusRing: '#6366f1',
  },
  orb: {
    idle: '#6366f1',
    listening: '#10b981',
    thinking: '#f59e0b',
    speaking: '#818cf8',
    error: '#ef4444',
  },
  shadows: {
    small: '0 2px 4px rgba(0, 0, 0, 0.3)',
    medium: '0 4px 12px rgba(0, 0, 0, 0.4)',
    large: '0 8px 32px rgba(0, 0, 0, 0.5)',
    glow: '0 0 20px rgba(99, 102, 241, 0.5)',
  },
};

/**
 * Light theme definition
 */
export const lightTheme: Theme = {
  name: 'Light',
  mode: 'light',
  colors: {
    // Background colors - whites and light grays
    bgPrimary: '#ffffff',
    bgSecondary: '#f8fafc',
    bgTertiary: '#f1f5f9',

    // Text colors - dark grays to black
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textTertiary: '#64748b',

    // Accent colors - slightly darker indigo for better contrast
    accent: '#4f46e5',
    accentLight: '#6366f1',
    accentDark: '#4338ca',

    // Semantic colors - slightly adjusted for light backgrounds
    success: '#059669',
    warning: '#d97706',
    error: '#dc2626',
    info: '#2563eb',

    // Border colors
    border: 'rgba(79, 70, 229, 0.2)',
    borderLight: 'rgba(79, 70, 229, 0.1)',

    // Overlay colors
    overlayBg: 'rgba(0, 0, 0, 0.5)',
    modalBg: 'rgba(255, 255, 255, 0.95)',

    // Scrollbar
    scrollbarTrack: '#f1f5f9',
    scrollbarThumb: '#4f46e5',
    scrollbarThumbHover: '#6366f1',

    // Selection
    selectionBg: '#4f46e5',
    selectionText: '#ffffff',

    // Focus
    focusRing: '#4f46e5',
  },
  orb: {
    // Slightly darker colors for better visibility on light backgrounds
    idle: '#4f46e5',
    listening: '#059669',
    thinking: '#d97706',
    speaking: '#6366f1',
    error: '#dc2626',
  },
  shadows: {
    small: '0 2px 4px rgba(0, 0, 0, 0.1)',
    medium: '0 4px 12px rgba(0, 0, 0, 0.15)',
    large: '0 8px 32px rgba(0, 0, 0, 0.2)',
    glow: '0 0 20px rgba(79, 70, 229, 0.3)',
  },
};

/**
 * Get theme by mode
 */
export function getTheme(mode: ResolvedTheme): Theme {
  return mode === 'dark' ? darkTheme : lightTheme;
}

/**
 * Detect system theme preference
 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolve theme mode to actual theme
 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

/**
 * Apply theme to document as CSS variables
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  // Set theme attribute for CSS selectors
  root.setAttribute('data-theme', theme.mode);

  // Apply color variables
  root.style.setProperty('--atlas-bg-primary', theme.colors.bgPrimary);
  root.style.setProperty('--atlas-bg-secondary', theme.colors.bgSecondary);
  root.style.setProperty('--atlas-bg-tertiary', theme.colors.bgTertiary);

  root.style.setProperty('--atlas-text-primary', theme.colors.textPrimary);
  root.style.setProperty('--atlas-text-secondary', theme.colors.textSecondary);
  root.style.setProperty('--atlas-text-tertiary', theme.colors.textTertiary);

  root.style.setProperty('--atlas-accent', theme.colors.accent);
  root.style.setProperty('--atlas-accent-light', theme.colors.accentLight);
  root.style.setProperty('--atlas-accent-dark', theme.colors.accentDark);

  root.style.setProperty('--atlas-success', theme.colors.success);
  root.style.setProperty('--atlas-warning', theme.colors.warning);
  root.style.setProperty('--atlas-error', theme.colors.error);
  root.style.setProperty('--atlas-info', theme.colors.info);

  root.style.setProperty('--atlas-border', theme.colors.border);
  root.style.setProperty('--atlas-border-light', theme.colors.borderLight);

  root.style.setProperty('--atlas-overlay-bg', theme.colors.overlayBg);
  root.style.setProperty('--atlas-modal-bg', theme.colors.modalBg);

  root.style.setProperty('--atlas-scrollbar-track', theme.colors.scrollbarTrack);
  root.style.setProperty('--atlas-scrollbar-thumb', theme.colors.scrollbarThumb);
  root.style.setProperty('--atlas-scrollbar-thumb-hover', theme.colors.scrollbarThumbHover);

  root.style.setProperty('--atlas-selection-bg', theme.colors.selectionBg);
  root.style.setProperty('--atlas-selection-text', theme.colors.selectionText);

  root.style.setProperty('--atlas-focus-ring', theme.colors.focusRing);

  // Apply orb colors
  root.style.setProperty('--orb-idle', theme.orb.idle);
  root.style.setProperty('--orb-listening', theme.orb.listening);
  root.style.setProperty('--orb-thinking', theme.orb.thinking);
  root.style.setProperty('--orb-speaking', theme.orb.speaking);
  root.style.setProperty('--orb-error', theme.orb.error);

  // Apply shadows
  root.style.setProperty('--atlas-shadow-small', theme.shadows.small);
  root.style.setProperty('--atlas-shadow-medium', theme.shadows.medium);
  root.style.setProperty('--atlas-shadow-large', theme.shadows.large);
  root.style.setProperty('--atlas-shadow-glow', theme.shadows.glow);

  // Apply special color variants for light theme adjustments
  root.style.setProperty('--color-success', theme.colors.success);
  root.style.setProperty('--color-warning', theme.colors.warning);
  root.style.setProperty('--color-error', theme.colors.error);
}

/**
 * Storage key for theme preference
 */
export const THEME_STORAGE_KEY = 'atlas-theme-mode';

/**
 * Get stored theme mode from localStorage
 */
export function getStoredThemeMode(): ThemeMode | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored;
  }
  return null;
}

/**
 * Store theme mode to localStorage
 */
export function storeThemeMode(mode: ThemeMode): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

/**
 * CSS transition duration for theme changes (in ms)
 */
export const THEME_TRANSITION_DURATION = 200;

/**
 * Apply smooth theme transition
 */
export function enableThemeTransition(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.style.setProperty('--theme-transition', `${THEME_TRANSITION_DURATION}ms ease`);
}

/**
 * Disable theme transition (for initial load)
 */
export function disableThemeTransition(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.style.setProperty('--theme-transition', 'none');
}
