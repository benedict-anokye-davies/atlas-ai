/**
 * Nova Desktop - Strange Attractor Mathematics
 * Mathematical formulas for various chaotic attractors
 */

export type AttractorFunction = (x: number, y: number, z: number) => [number, number, number];

/**
 * Aizawa Attractor - Primary attractor for Nova
 * Creates flowing ribbon-like structures
 */
export const aizawa: AttractorFunction = (x, y, z) => {
  const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
  return [
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x
  ];
};

/**
 * Lorenz Attractor - Classic butterfly attractor
 */
export const lorenz: AttractorFunction = (x, y, z) => {
  const sigma = 10, rho = 28, beta = 8 / 3;
  return [
    sigma * (y - x),
    x * (rho - z) - y,
    x * y - beta * z
  ];
};

/**
 * Thomas Attractor - Smooth, spiraling curves
 */
export const thomas: AttractorFunction = (x, y, z) => {
  const b = 0.208186;
  return [
    Math.sin(y) - b * x,
    Math.sin(z) - b * y,
    Math.sin(x) - b * z
  ];
};

/**
 * Halvorsen Attractor - Complex 3D spirals
 */
export const halvorsen: AttractorFunction = (x, y, z) => {
  const a = 1.89;
  return [
    -a * x - 4 * y - 4 * z - y * y,
    -a * y - 4 * z - 4 * x - z * z,
    -a * z - 4 * x - 4 * y - x * x
  ];
};

/**
 * Arneodo Attractor - Chaotic, agitated movements for error states
 */
export const arneodo: AttractorFunction = (x, y, z) => {
  const a = -5.5, b = 3.5, c = -1;
  return [
    y,
    z,
    -a * x - b * y - z + c * x * x * x
  ];
};

/**
 * Attractor settings for scaling and animation
 */
export interface AttractorSettings {
  scale: number;
  dt: number;
  camDistance: number;
  offset: [number, number, number];
  baseHue: number;
  hueRange: number;
}

export const ATTRACTOR_SETTINGS: Record<string, AttractorSettings> = {
  aizawa: {
    scale: 8,
    dt: 0.01,
    camDistance: 20,
    offset: [0, 0, 0],
    baseHue: 0.55, // Cyan
    hueRange: 0.15
  },
  lorenz: {
    scale: 0.4,
    dt: 0.005,
    camDistance: 30,
    offset: [0, 0, 25],
    baseHue: 0.6, // Blue
    hueRange: 0.1
  },
  thomas: {
    scale: 4,
    dt: 0.05,
    camDistance: 12,
    offset: [0, 0, 0],
    baseHue: 0.7, // Purple
    hueRange: 0.15
  },
  halvorsen: {
    scale: 1.5,
    dt: 0.008,
    camDistance: 18,
    offset: [0, 0, 0],
    baseHue: 0.08, // Gold
    hueRange: 0.08
  },
  arneodo: {
    scale: 2.5,
    dt: 0.01,
    camDistance: 20,
    offset: [0, 0, 0],
    baseHue: 0.0, // Red
    hueRange: 0.05
  }
};

/**
 * State-based color configurations
 */
export interface StateColors {
  hue: number;
  saturation: number;
  lightness: number;
  hueRange: number;
}

export const STATE_COLORS: Record<string, StateColors> = {
  idle: {
    hue: 0.55,      // Cyan/Teal
    saturation: 0.7,
    lightness: 0.5,
    hueRange: 0.1
  },
  listening: {
    hue: 0.35,      // Green
    saturation: 0.8,
    lightness: 0.55,
    hueRange: 0.15
  },
  thinking: {
    hue: 0.75,      // Purple/Violet
    saturation: 0.85,
    lightness: 0.6,
    hueRange: 0.1
  },
  speaking: {
    hue: 0.08,      // Orange/Gold
    saturation: 0.9,
    lightness: 0.55,
    hueRange: 0.08
  },
  error: {
    hue: 0.0,       // Red
    saturation: 0.9,
    lightness: 0.5,
    hueRange: 0.05
  }
};

/**
 * Map AI states to strange attractors
 */
export type NovaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export const STATE_TO_ATTRACTOR: Record<NovaState, keyof typeof ATTRACTOR_SETTINGS> = {
  idle: 'lorenz',       // Calm, balanced butterfly shape
  listening: 'thomas',   // Compact, attentive listening pose
  thinking: 'aizawa',    // Dense, concentrated processing
  speaking: 'halvorsen', // Expansive, warm speaking energy
  error: 'arneodo'       // Agitated, alert error state
};

/**
 * Get attractor function by name
 */
export function getAttractor(name: string): AttractorFunction {
  switch (name) {
    case 'lorenz': return lorenz;
    case 'thomas': return thomas;
    case 'aizawa': return aizawa;
    case 'halvorsen': return halvorsen;
    case 'arneodo': return arneodo;
    default: return lorenz;
  }
}
