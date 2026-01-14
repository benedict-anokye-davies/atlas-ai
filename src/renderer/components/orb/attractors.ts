/**
 * Nova Desktop - Strange Attractor Mathematics
 * Mathematical formulas for various chaotic attractors
 *
 * Optimizations:
 * - Pre-computed lookup tables for trigonometric functions
 * - Simplified attractor mode for low-end hardware
 * - Inline constants for better JIT optimization
 */

export type AttractorFunction = (x: number, y: number, z: number) => [number, number, number];

// Pre-computed sin/cos lookup table for performance
const LUT_SIZE = 4096;
const LUT_SCALE = LUT_SIZE / (Math.PI * 2);
const SIN_LUT = new Float32Array(LUT_SIZE);
const COS_LUT = new Float32Array(LUT_SIZE);

// Initialize lookup tables
for (let i = 0; i < LUT_SIZE; i++) {
  const angle = (i / LUT_SIZE) * Math.PI * 2;
  SIN_LUT[i] = Math.sin(angle);
  COS_LUT[i] = Math.cos(angle);
}

/**
 * Fast sine using lookup table
 */
export function fastSin(x: number): number {
  // Normalize to [0, 2π)
  let normalized = x % (Math.PI * 2);
  if (normalized < 0) normalized += Math.PI * 2;
  const index = (normalized * LUT_SCALE) | 0;
  return SIN_LUT[index];
}

/**
 * Fast cosine using lookup table
 */
export function fastCos(x: number): number {
  let normalized = x % (Math.PI * 2);
  if (normalized < 0) normalized += Math.PI * 2;
  const index = (normalized * LUT_SCALE) | 0;
  return COS_LUT[index];
}

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

// ============================================================================
// OPTIMIZED ATTRACTORS - Using lookup tables for better performance
// ============================================================================

/**
 * Optimized Thomas Attractor using fast trig
 */
export const thomasOptimized: AttractorFunction = (x, y, z) => {
  const b = 0.208186;
  return [
    fastSin(y) - b * x,
    fastSin(z) - b * y,
    fastSin(x) - b * z
  ];
};

/**
 * Get optimized attractor function by name
 */
export function getOptimizedAttractor(name: string): AttractorFunction {
  switch (name) {
    case 'lorenz': return lorenz;
    case 'thomas': return thomasOptimized;
    case 'aizawa': return aizawa;
    case 'halvorsen': return halvorsen;
    case 'arneodo': return arneodo;
    default: return lorenz;
  }
}

// ============================================================================
// SIMPLIFIED ATTRACTORS - For low-end hardware
// ============================================================================

/**
 * Simplified Lorenz - fewer operations, still recognizable shape
 */
export const lorenzSimplified: AttractorFunction = (x, y, z) => {
  // Reduced precision constants, fewer multiplications
  const s = 10, r = 28, b = 2.667;
  return [
    s * (y - x),
    r * x - y - x * z,
    x * y - b * z
  ];
};

/**
 * Simplified attractor that approximates a circular orbit with perturbation
 * Extremely lightweight for very low-end hardware
 */
export const circularSimplified: AttractorFunction = (x, y, z) => {
  const k = 0.1;
  return [
    -y * k,
    x * k,
    (x * y - z) * 0.05
  ];
};

/**
 * Get simplified attractor for low-end mode
 * Maps all attractors to simpler variants
 */
export function getSimplifiedAttractor(name: string): AttractorFunction {
  switch (name) {
    case 'lorenz':
    case 'thomas':
    case 'aizawa':
      return lorenzSimplified;
    case 'halvorsen':
    case 'arneodo':
      return circularSimplified;
    default:
      return lorenzSimplified;
  }
}

// ============================================================================
// GPU-FRIENDLY BATCH OPERATIONS - For potential compute shader use
// ============================================================================

/**
 * Batch update positions using Lorenz attractor
 * Optimized for GPU-style parallel processing
 */
export function batchUpdateLorenz(
  positions: Float32Array,
  dt: number,
  scale: number
): void {
  const sigma = 10, rho = 28, beta = 2.667;
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    // Inline Lorenz calculation for minimal overhead
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;

    positions[idx] = x + dx * dt * scale;
    positions[idx + 1] = y + dy * dt * scale;
    positions[idx + 2] = z + dz * dt * scale;
  }
}

/**
 * Batch update positions using Aizawa attractor
 */
export function batchUpdateAizawa(
  positions: Float32Array,
  dt: number,
  scale: number
): void {
  const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    const zb = z - b;
    const dx = zb * x - d * y;
    const dy = d * x + zb * y;
    const r2 = x * x + y * y;
    const dz = c + a * z - (z * z * z) / 3 - r2 * (1 + e * z) + f * z * x * x * x;

    positions[idx] = x + dx * dt * scale;
    positions[idx + 1] = y + dy * dt * scale;
    positions[idx + 2] = z + dz * dt * scale;
  }
}

/**
 * Batch update dispatcher
 */
export function batchUpdateAttractor(
  positions: Float32Array,
  attractorName: string,
  dt: number,
  scale: number
): void {
  switch (attractorName) {
    case 'lorenz':
      batchUpdateLorenz(positions, dt, scale);
      break;
    case 'aizawa':
      batchUpdateAizawa(positions, dt, scale);
      break;
    default:
      // Fallback: use standard function-based update
      const fn = getOptimizedAttractor(attractorName);
      const count = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const [dx, dy, dz] = fn(positions[idx], positions[idx + 1], positions[idx + 2]);
        positions[idx] += dx * dt * scale;
        positions[idx + 1] += dy * dt * scale;
        positions[idx + 2] += dz * dt * scale;
      }
  }
}

/**
 * Check if WebGL2 compute shaders are available
 * (Currently returns false as WebGL compute is not widely supported)
 */
export function hasComputeShaderSupport(): boolean {
  // WebGL2 compute shaders are not standard
  // Future: Check for WebGPU compute shader availability
  return false;
}

/**
 * Attractor mode for performance optimization
 */
export type AttractorMode = 'standard' | 'optimized' | 'simplified' | 'batch';

/**
 * Get attractor function based on mode
 */
export function getAttractorByMode(
  name: string,
  mode: AttractorMode
): AttractorFunction {
  switch (mode) {
    case 'simplified':
      return getSimplifiedAttractor(name);
    case 'optimized':
      return getOptimizedAttractor(name);
    case 'standard':
    default:
      return getAttractor(name);
  }
}
