/**
 * Atlas Desktop - Color Theme System for Orb Visualization
 * Provides customizable color schemes with preset themes and state-specific colors
 */

import type { AtlasState } from './AtlasParticles';

/**
 * RGB color value (0-1 normalized)
 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * HSL color value (h: 0-1, s: 0-1, l: 0-1)
 */
export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

/**
 * State-specific colors for all Atlas states
 */
export interface StateColors {
  idle: RGBColor;
  listening: RGBColor;
  thinking: RGBColor;
  speaking: RGBColor;
  error: RGBColor;
}

/**
 * Layer colors for nucleus and shell
 */
export interface LayerColors {
  nucleus: RGBColor;
  shell: RGBColor;
}

/**
 * Complete color theme definition
 */
export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  stateColors: StateColors;
  layerColors: LayerColors;
  colorVariance: number;
}

/**
 * Color theme preset identifier
 */
export type ColorThemePreset = 'default' | 'ocean' | 'fire' | 'forest' | 'cosmic' | 'aurora' | 'sunset' | 'monochrome' | 'jarvis' | 'ultron' | 'friday' | 'edith';

/**
 * Convert HSL to RGB (all values 0-1)
 */
export function hslToRgb(h: number, s: number, l: number): RGBColor {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return { r, g, b };
}

/**
 * Convert RGB to HSL (all values 0-1)
 */
export function rgbToHsl(r: number, g: number, b: number): HSLColor {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h, s, l };
}

/**
 * Interpolate between two RGB colors
 */
export function lerpColor(from: RGBColor, to: RGBColor, t: number): RGBColor {
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    r: from.r + (to.r - from.r) * clampedT,
    g: from.g + (to.g - from.g) * clampedT,
    b: from.b + (to.b - from.b) * clampedT,
  };
}

/**
 * Interpolate between two colors in HSL space (better for gradients)
 */
export function lerpColorHsl(from: RGBColor, to: RGBColor, t: number): RGBColor {
  const fromHsl = rgbToHsl(from.r, from.g, from.b);
  const toHsl = rgbToHsl(to.r, to.g, to.b);
  const clampedT = Math.max(0, Math.min(1, t));

  // Handle hue wrapping for shortest path
  let hDiff = toHsl.h - fromHsl.h;
  if (Math.abs(hDiff) > 0.5) {
    hDiff = hDiff > 0 ? hDiff - 1 : hDiff + 1;
  }

  const h = (fromHsl.h + hDiff * clampedT + 1) % 1;
  const s = fromHsl.s + (toHsl.s - fromHsl.s) * clampedT;
  const l = fromHsl.l + (toHsl.l - fromHsl.l) * clampedT;

  return hslToRgb(h, s, l);
}

/**
 * Adjust color brightness
 */
export function adjustBrightness(color: RGBColor, factor: number): RGBColor {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newL = Math.max(0, Math.min(1, hsl.l * factor));
  return hslToRgb(hsl.h, hsl.s, newL);
}

/**
 * Adjust color saturation
 */
export function adjustSaturation(color: RGBColor, factor: number): RGBColor {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newS = Math.max(0, Math.min(1, hsl.s * factor));
  return hslToRgb(hsl.h, newS, hsl.l);
}

/**
 * Shift hue of a color
 */
export function shiftHue(color: RGBColor, hueOffset: number): RGBColor {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const newH = (hsl.h + hueOffset + 1) % 1;
  return hslToRgb(newH, hsl.s, hsl.l);
}

/**
 * Create a custom color from hue (0-1)
 */
export function colorFromHue(hue: number, saturation: number = 1.0, lightness: number = 0.5): RGBColor {
  return hslToRgb(hue, saturation, lightness);
}

/**
 * Default theme - Cyan/Gold classic Atlas
 */
export const DEFAULT_THEME: ColorTheme = {
  id: 'default',
  name: 'Default',
  description: 'Classic Atlas cyan and gold color scheme',
  stateColors: {
    idle: { r: 0.0, g: 0.83, b: 1.0 },     // Cyan #00D4FF
    listening: { r: 0.0, g: 1.0, b: 0.53 }, // Green #00FF88
    thinking: { r: 0.67, g: 0.33, b: 1.0 }, // Purple #AA55FF
    speaking: { r: 1.0, g: 0.84, b: 0.0 },  // Gold #FFD700
    error: { r: 1.0, g: 0.2, b: 0.2 },      // Red #FF3333
  },
  layerColors: {
    nucleus: { r: 0.8, g: 1.0, b: 1.0 },    // Bright cyan-white
    shell: { r: 1.0, g: 0.84, b: 0.0 },     // Gold
  },
  colorVariance: 0.1,
};

/**
 * Ocean theme - Deep blues and teals
 */
export const OCEAN_THEME: ColorTheme = {
  id: 'ocean',
  name: 'Ocean',
  description: 'Deep sea blues and aquatic teals',
  stateColors: {
    idle: { r: 0.0, g: 0.5, b: 0.8 },       // Deep ocean blue
    listening: { r: 0.0, g: 0.7, b: 0.7 },   // Teal
    thinking: { r: 0.2, g: 0.3, b: 0.8 },    // Deep blue
    speaking: { r: 0.0, g: 0.8, b: 0.9 },    // Bright aqua
    error: { r: 0.8, g: 0.2, b: 0.3 },       // Deep red-coral
  },
  layerColors: {
    nucleus: { r: 0.6, g: 0.9, b: 1.0 },     // Light aqua
    shell: { r: 0.0, g: 0.4, b: 0.6 },       // Deep teal
  },
  colorVariance: 0.12,
};

/**
 * Fire theme - Warm oranges and reds
 */
export const FIRE_THEME: ColorTheme = {
  id: 'fire',
  name: 'Fire',
  description: 'Fiery oranges, reds, and warm yellows',
  stateColors: {
    idle: { r: 1.0, g: 0.5, b: 0.0 },       // Orange
    listening: { r: 1.0, g: 0.8, b: 0.0 },   // Amber
    thinking: { r: 1.0, g: 0.3, b: 0.1 },    // Deep red-orange
    speaking: { r: 1.0, g: 0.9, b: 0.4 },    // Bright yellow
    error: { r: 0.8, g: 0.0, b: 0.0 },       // Deep red
  },
  layerColors: {
    nucleus: { r: 1.0, g: 0.95, b: 0.7 },    // Hot white-yellow
    shell: { r: 1.0, g: 0.4, b: 0.0 },       // Deep orange
  },
  colorVariance: 0.15,
};

/**
 * Forest theme - Natural greens and earth tones
 */
export const FOREST_THEME: ColorTheme = {
  id: 'forest',
  name: 'Forest',
  description: 'Natural greens with earthy undertones',
  stateColors: {
    idle: { r: 0.2, g: 0.7, b: 0.3 },       // Forest green
    listening: { r: 0.4, g: 0.9, b: 0.4 },   // Bright green
    thinking: { r: 0.3, g: 0.5, b: 0.2 },    // Dark moss
    speaking: { r: 0.6, g: 0.85, b: 0.3 },   // Lime green
    error: { r: 0.7, g: 0.3, b: 0.2 },       // Rust brown
  },
  layerColors: {
    nucleus: { r: 0.7, g: 1.0, b: 0.6 },     // Light leaf
    shell: { r: 0.3, g: 0.5, b: 0.2 },       // Deep forest
  },
  colorVariance: 0.1,
};

/**
 * Cosmic theme - Deep purples and nebula colors
 */
export const COSMIC_THEME: ColorTheme = {
  id: 'cosmic',
  name: 'Cosmic',
  description: 'Deep space purples and nebula pinks',
  stateColors: {
    idle: { r: 0.5, g: 0.2, b: 0.8 },       // Deep purple
    listening: { r: 0.8, g: 0.3, b: 0.7 },   // Pink-purple
    thinking: { r: 0.3, g: 0.1, b: 0.6 },    // Dark violet
    speaking: { r: 0.9, g: 0.5, b: 0.9 },    // Bright magenta
    error: { r: 0.9, g: 0.1, b: 0.3 },       // Crimson
  },
  layerColors: {
    nucleus: { r: 0.9, g: 0.7, b: 1.0 },     // Light lavender
    shell: { r: 0.4, g: 0.1, b: 0.5 },       // Deep space purple
  },
  colorVariance: 0.15,
};

/**
 * Aurora theme - Northern lights colors
 */
export const AURORA_THEME: ColorTheme = {
  id: 'aurora',
  name: 'Aurora',
  description: 'Northern lights with shifting greens and pinks',
  stateColors: {
    idle: { r: 0.0, g: 0.9, b: 0.6 },       // Aurora green
    listening: { r: 0.3, g: 0.9, b: 0.9 },   // Cyan-green
    thinking: { r: 0.6, g: 0.2, b: 0.8 },    // Purple
    speaking: { r: 0.9, g: 0.4, b: 0.7 },    // Pink
    error: { r: 0.9, g: 0.2, b: 0.4 },       // Red-pink
  },
  layerColors: {
    nucleus: { r: 0.6, g: 1.0, b: 0.8 },     // Light green
    shell: { r: 0.4, g: 0.2, b: 0.6 },       // Purple haze
  },
  colorVariance: 0.18,
};

/**
 * Sunset theme - Warm gradient from orange to purple
 */
export const SUNSET_THEME: ColorTheme = {
  id: 'sunset',
  name: 'Sunset',
  description: 'Warm sunset gradient from orange to violet',
  stateColors: {
    idle: { r: 1.0, g: 0.6, b: 0.3 },       // Orange sunset
    listening: { r: 1.0, g: 0.4, b: 0.5 },   // Coral
    thinking: { r: 0.7, g: 0.3, b: 0.6 },    // Dusk purple
    speaking: { r: 1.0, g: 0.7, b: 0.2 },    // Golden hour
    error: { r: 0.8, g: 0.1, b: 0.2 },       // Deep red
  },
  layerColors: {
    nucleus: { r: 1.0, g: 0.85, b: 0.6 },    // Warm light
    shell: { r: 0.6, g: 0.2, b: 0.4 },       // Twilight purple
  },
  colorVariance: 0.12,
};

/**
 * Monochrome theme - Elegant grayscale with white accents
 */
export const MONOCHROME_THEME: ColorTheme = {
  id: 'monochrome',
  name: 'Monochrome',
  description: 'Elegant grayscale with subtle variations',
  stateColors: {
    idle: { r: 0.7, g: 0.7, b: 0.7 },       // Silver
    listening: { r: 0.9, g: 0.9, b: 0.95 },  // Bright white-blue
    thinking: { r: 0.5, g: 0.5, b: 0.55 },   // Cool gray
    speaking: { r: 1.0, g: 1.0, b: 1.0 },    // Pure white
    error: { r: 0.6, g: 0.3, b: 0.3 },       // Muted red
  },
  layerColors: {
    nucleus: { r: 1.0, g: 1.0, b: 1.0 },     // White
    shell: { r: 0.4, g: 0.4, b: 0.45 },      // Dark gray
  },
  colorVariance: 0.05,
};

/**
 * JARVIS theme - MCU Iron Man AI (Gold/Amber with electric blue highlights)
 */
export const JARVIS_THEME: ColorTheme = {
  id: 'jarvis',
  name: 'J.A.R.V.I.S.',
  description: 'MCU-style holographic gold and amber interface',
  stateColors: {
    idle: { r: 1.0, g: 0.76, b: 0.15 },      // Amber gold #FFC226
    listening: { r: 0.0, g: 0.85, b: 1.0 },   // Electric blue (arc reactor)
    thinking: { r: 1.0, g: 0.6, b: 0.0 },     // Processing orange
    speaking: { r: 1.0, g: 0.84, b: 0.4 },    // Bright gold
    error: { r: 1.0, g: 0.25, b: 0.15 },      // Warning red-orange
  },
  layerColors: {
    nucleus: { r: 1.0, g: 0.95, b: 0.8 },     // Hot white-gold center
    shell: { r: 0.9, g: 0.65, b: 0.1 },       // Amber shell
  },
  colorVariance: 0.08,
};

/**
 * ULTRON theme - MCU Ultron AI (Menacing red with silver)
 */
export const ULTRON_THEME: ColorTheme = {
  id: 'ultron',
  name: 'Ultron',
  description: 'Menacing crimson red with cold silver accents',
  stateColors: {
    idle: { r: 0.85, g: 0.1, b: 0.1 },       // Crimson red
    listening: { r: 1.0, g: 0.2, b: 0.2 },    // Bright red (alert)
    thinking: { r: 0.6, g: 0.6, b: 0.65 },    // Cold silver processing
    speaking: { r: 1.0, g: 0.15, b: 0.1 },    // Intense red
    error: { r: 0.3, g: 0.0, b: 0.0 },        // Deep blood red
  },
  layerColors: {
    nucleus: { r: 1.0, g: 0.3, b: 0.2 },      // Hot red-orange core
    shell: { r: 0.5, g: 0.5, b: 0.55 },       // Metallic silver shell
  },
  colorVariance: 0.1,
};

/**
 * F.R.I.D.A.Y. theme - MCU replacement AI (Cooler blue-green with teal)
 */
export const FRIDAY_THEME: ColorTheme = {
  id: 'friday',
  name: 'F.R.I.D.A.Y.',
  description: 'Cool blue-green interface with Irish teal accents',
  stateColors: {
    idle: { r: 0.0, g: 0.7, b: 0.75 },       // Teal
    listening: { r: 0.2, g: 0.9, b: 0.8 },    // Bright aqua
    thinking: { r: 0.0, g: 0.5, b: 0.6 },     // Deep teal
    speaking: { r: 0.4, g: 1.0, b: 0.9 },     // Bright cyan-teal
    error: { r: 0.9, g: 0.3, b: 0.2 },        // Coral red
  },
  layerColors: {
    nucleus: { r: 0.7, g: 1.0, b: 0.95 },     // Light aqua center
    shell: { r: 0.0, g: 0.55, b: 0.6 },       // Deep teal shell
  },
  colorVariance: 0.1,
};

/**
 * E.D.I.T.H. theme - MCU Spider-Man AI (Pink-magenta with tech blue)
 */
export const EDITH_THEME: ColorTheme = {
  id: 'edith',
  name: 'E.D.I.T.H.',
  description: 'Magenta-pink defense system with tactical blue',
  stateColors: {
    idle: { r: 0.9, g: 0.3, b: 0.6 },        // Magenta pink
    listening: { r: 0.2, g: 0.6, b: 1.0 },    // Tactical blue (targeting)
    thinking: { r: 0.7, g: 0.2, b: 0.5 },     // Deep magenta
    speaking: { r: 1.0, g: 0.5, b: 0.7 },     // Bright pink
    error: { r: 1.0, g: 0.1, b: 0.1 },        // Alert red
  },
  layerColors: {
    nucleus: { r: 1.0, g: 0.7, b: 0.85 },     // Light pink center
    shell: { r: 0.6, g: 0.15, b: 0.4 },       // Deep magenta shell
  },
  colorVariance: 0.12,
};

/**
 * All available preset themes
 */
export const COLOR_THEMES: Record<ColorThemePreset, ColorTheme> = {
  default: DEFAULT_THEME,
  ocean: OCEAN_THEME,
  fire: FIRE_THEME,
  forest: FOREST_THEME,
  cosmic: COSMIC_THEME,
  aurora: AURORA_THEME,
  sunset: SUNSET_THEME,
  monochrome: MONOCHROME_THEME,
  jarvis: JARVIS_THEME,
  ultron: ULTRON_THEME,
  friday: FRIDAY_THEME,
  edith: EDITH_THEME,
};

/**
 * Get theme by ID or return default
 */
export function getTheme(themeId: ColorThemePreset | string): ColorTheme {
  return COLOR_THEMES[themeId as ColorThemePreset] || DEFAULT_THEME;
}

/**
 * Get all available theme presets
 */
export function getAvailableThemes(): ColorTheme[] {
  return Object.values(COLOR_THEMES);
}

/**
 * Create a custom theme from base hue
 */
export function createCustomTheme(
  baseHue: number,
  saturation: number = 1.0,
  brightness: number = 1.0
): ColorTheme {
  // Generate complementary and analogous colors
  const base = hslToRgb(baseHue, saturation * 0.8, 0.5 * brightness);
  // Complementary color reserved for future use
  // const complementary = hslToRgb((baseHue + 0.5) % 1, saturation * 0.9, 0.55 * brightness);
  const analogous1 = hslToRgb((baseHue + 0.1) % 1, saturation * 0.85, 0.6 * brightness);
  const analogous2 = hslToRgb((baseHue - 0.1 + 1) % 1, saturation * 0.9, 0.45 * brightness);
  const accent = hslToRgb((baseHue + 0.33) % 1, saturation * 0.75, 0.65 * brightness);
  const error = { r: Math.min(1, 0.9 * brightness), g: 0.2, b: 0.2 };

  // Nucleus is lighter version of base
  const nucleus = hslToRgb(baseHue, saturation * 0.5, 0.85 * brightness);
  // Shell is darker/deeper version
  const shell = hslToRgb((baseHue + 0.05) % 1, saturation * 0.7, 0.4 * brightness);

  return {
    id: 'custom',
    name: 'Custom',
    description: 'User-defined custom color theme',
    stateColors: {
      idle: base,
      listening: analogous1,
      thinking: analogous2,
      speaking: accent,
      error: error,
    },
    layerColors: {
      nucleus,
      shell,
    },
    colorVariance: 0.12,
  };
}

/**
 * Apply brightness and saturation adjustments to a theme
 */
export function applyThemeAdjustments(
  theme: ColorTheme,
  brightness: number = 1.0,
  saturation: number = 1.0
): ColorTheme {
  const adjustColor = (color: RGBColor): RGBColor => {
    let adjusted = adjustBrightness(color, brightness);
    adjusted = adjustSaturation(adjusted, saturation);
    return adjusted;
  };

  return {
    ...theme,
    stateColors: {
      idle: adjustColor(theme.stateColors.idle),
      listening: adjustColor(theme.stateColors.listening),
      thinking: adjustColor(theme.stateColors.thinking),
      speaking: adjustColor(theme.stateColors.speaking),
      error: adjustColor(theme.stateColors.error),
    },
    layerColors: {
      nucleus: adjustColor(theme.layerColors.nucleus),
      shell: adjustColor(theme.layerColors.shell),
    },
  };
}

/**
 * Get state color from theme with optional adjustments
 */
export function getStateColor(
  theme: ColorTheme,
  state: AtlasState,
  brightness: number = 1.0,
  saturation: number = 1.0
): RGBColor {
  let color = theme.stateColors[state];
  if (brightness !== 1.0) {
    color = adjustBrightness(color, brightness);
  }
  if (saturation !== 1.0) {
    color = adjustSaturation(color, saturation);
  }
  return color;
}

/**
 * Get layer colors from theme with optional adjustments
 */
export function getLayerColors(
  theme: ColorTheme,
  brightness: number = 1.0,
  saturation: number = 1.0
): LayerColors {
  return {
    nucleus: adjustSaturation(adjustBrightness(theme.layerColors.nucleus, brightness), saturation),
    shell: adjustSaturation(adjustBrightness(theme.layerColors.shell, brightness), saturation),
  };
}

/**
 * Generate gradient colors between two states
 */
export function generateGradientColors(
  theme: ColorTheme,
  fromState: AtlasState,
  toState: AtlasState,
  steps: number
): RGBColor[] {
  const from = theme.stateColors[fromState];
  const to = theme.stateColors[toState];
  const colors: RGBColor[] = [];

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    colors.push(lerpColorHsl(from, to, t));
  }

  return colors;
}

/**
 * Preview configuration for theme preview
 */
export interface ThemePreview {
  themeId: string;
  isPreview: boolean;
  previewStartTime: number;
}

/**
 * Theme persistence key for localStorage
 */
export const THEME_STORAGE_KEY = 'atlas-color-theme';

/**
 * Save theme preference to localStorage
 */
export function saveThemePreference(
  themeId: string,
  customHue?: number,
  brightness?: number,
  saturation?: number
): void {
  try {
    const preference = {
      themeId,
      customHue,
      brightness,
      saturation,
      savedAt: Date.now(),
    };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch (e) {
    console.warn('[ColorThemes] Failed to save theme preference:', e);
  }
}

/**
 * Load theme preference from localStorage
 */
export function loadThemePreference(): {
  themeId: string;
  customHue?: number;
  brightness?: number;
  saturation?: number;
} | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[ColorThemes] Failed to load theme preference:', e);
  }
  return null;
}

/**
 * Reset theme to default
 */
export function resetThemePreference(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch (e) {
    console.warn('[ColorThemes] Failed to reset theme preference:', e);
  }
}
