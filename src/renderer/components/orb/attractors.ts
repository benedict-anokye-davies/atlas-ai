/**
 * Atlas Desktop - Strange Attractor Mathematics
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
 * Aizawa Attractor - Primary attractor for Atlas
 * Creates flowing ribbon-like structures
 */
export const aizawa: AttractorFunction = (x, y, z) => {
  const a = 0.95,
    b = 0.7,
    c = 0.6,
    d = 3.5,
    e = 0.25,
    f = 0.1;
  return [
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
  ];
};

/**
 * Lorenz Attractor - Classic butterfly attractor
 */
export const lorenz: AttractorFunction = (x, y, z) => {
  const sigma = 10,
    rho = 28,
    beta = 8 / 3;
  return [sigma * (y - x), x * (rho - z) - y, x * y - beta * z];
};

/**
 * Thomas Attractor - Smooth, spiraling curves
 */
export const thomas: AttractorFunction = (x, y, z) => {
  const b = 0.208186;
  return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z];
};

/**
 * Halvorsen Attractor - Complex 3D spirals
 */
export const halvorsen: AttractorFunction = (x, y, z) => {
  const a = 1.89;
  return [
    -a * x - 4 * y - 4 * z - y * y,
    -a * y - 4 * z - 4 * x - z * z,
    -a * z - 4 * x - 4 * y - x * x,
  ];
};

/**
 * Arneodo Attractor - Chaotic, agitated movements for error states
 */
export const arneodo: AttractorFunction = (x, y, z) => {
  const a = -5.5,
    b = 3.5,
    c = -1;
  return [y, z, -a * x - b * y - z + c * x * x * x];
};

/**
 * Chen Attractor - Smooth flowing curves with dual scroll behavior
 * Good for calm, contemplative states
 */
export const chen: AttractorFunction = (x, y, z) => {
  const a = 40,
    b = 3,
    c = 28;
  return [a * (y - x), (c - a) * x - x * z + c * y, x * y - b * z];
};

/**
 * Dadras Attractor - Four-wing butterfly pattern
 * Elegant, symmetric motion suitable for balanced states
 */
export const dadras: AttractorFunction = (x, y, z) => {
  const a = 3,
    b = 2.7,
    c = 1.7,
    d = 2,
    e = 9;
  return [y - a * x + b * y * z, c * y - x * z + z, d * x * y - e * z];
};

/**
 * Rossler Attractor - Simple spiral pattern with occasional large excursions
 * Good for periodic, rhythmic animations
 */
export const rossler: AttractorFunction = (x, y, z) => {
  const a = 0.2,
    b = 0.2,
    c = 5.7;
  return [-y - z, x + a * y, b + z * (x - c)];
};

/**
 * Three-Scroll Unified Chaotic System (TSUCS)
 * Complex three-scroll pattern, good for thinking/processing states
 */
export const threeScroll: AttractorFunction = (x, y, z) => {
  const a = 40,
    b = 0.833,
    c = 20,
    d = 0.5,
    e = 0.65;
  return [a * (y - x) + d * x * z, c * y - x * z, b * z + x * y - e * x * x];
};

/**
 * Sprott Attractor - Minimal chaotic attractor
 * Clean, simple curves with unpredictable behavior
 */
export const sprott: AttractorFunction = (x, y, z) => {
  return [y + 2.07 * x * y + x * z, 1 - 1.79 * x * x + y * z, x - x * x - y * y];
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
    hueRange: 0.15,
  },
  lorenz: {
    scale: 0.4,
    dt: 0.005,
    camDistance: 30,
    offset: [0, 0, 25],
    baseHue: 0.6, // Blue
    hueRange: 0.1,
  },
  thomas: {
    scale: 4,
    dt: 0.05,
    camDistance: 12,
    offset: [0, 0, 0],
    baseHue: 0.7, // Purple
    hueRange: 0.15,
  },
  halvorsen: {
    scale: 1.5,
    dt: 0.008,
    camDistance: 18,
    offset: [0, 0, 0],
    baseHue: 0.08, // Gold
    hueRange: 0.08,
  },
  arneodo: {
    scale: 2.5,
    dt: 0.01,
    camDistance: 20,
    offset: [0, 0, 0],
    baseHue: 0.0, // Red
    hueRange: 0.05,
  },
  chen: {
    scale: 0.25,
    dt: 0.002,
    camDistance: 25,
    offset: [0, 0, 0],
    baseHue: 0.45, // Teal
    hueRange: 0.12,
  },
  dadras: {
    scale: 2.5,
    dt: 0.008,
    camDistance: 20,
    offset: [0, 0, 0],
    baseHue: 0.85, // Magenta
    hueRange: 0.1,
  },
  rossler: {
    scale: 0.8,
    dt: 0.01,
    camDistance: 18,
    offset: [0, 0, 0],
    baseHue: 0.15, // Orange
    hueRange: 0.08,
  },
  threeScroll: {
    scale: 0.2,
    dt: 0.003,
    camDistance: 22,
    offset: [0, 0, 0],
    baseHue: 0.58, // Cyan-Blue
    hueRange: 0.12,
  },
  sprott: {
    scale: 5,
    dt: 0.02,
    camDistance: 15,
    offset: [0, 0, 0],
    baseHue: 0.35, // Green
    hueRange: 0.1,
  },
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
    hue: 0.55, // Cyan/Teal
    saturation: 0.7,
    lightness: 0.5,
    hueRange: 0.1,
  },
  listening: {
    hue: 0.35, // Green
    saturation: 0.8,
    lightness: 0.55,
    hueRange: 0.15,
  },
  thinking: {
    hue: 0.75, // Purple/Violet
    saturation: 0.85,
    lightness: 0.6,
    hueRange: 0.1,
  },
  speaking: {
    hue: 0.08, // Orange/Gold
    saturation: 0.9,
    lightness: 0.55,
    hueRange: 0.08,
  },
  error: {
    hue: 0.0, // Red
    saturation: 0.9,
    lightness: 0.5,
    hueRange: 0.05,
  },
};

/**
 * Map AI states to strange attractors
 */
export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export const STATE_TO_ATTRACTOR: Record<AtlasState, keyof typeof ATTRACTOR_SETTINGS> = {
  idle: 'lorenz', // Calm, balanced butterfly shape
  listening: 'thomas', // Compact, attentive listening pose
  thinking: 'aizawa', // Dense, concentrated processing
  speaking: 'halvorsen', // Expansive, warm speaking energy
  error: 'arneodo', // Agitated, alert error state
};

/**
 * All available attractor names
 */
export type AttractorName =
  | 'aizawa'
  | 'lorenz'
  | 'thomas'
  | 'halvorsen'
  | 'arneodo'
  | 'chen'
  | 'dadras'
  | 'rossler'
  | 'threeScroll'
  | 'sprott';

/**
 * Registry of all available attractors
 */
export const ATTRACTOR_REGISTRY: Record<AttractorName, AttractorFunction> = {
  aizawa,
  lorenz,
  thomas,
  halvorsen,
  arneodo,
  chen,
  dadras,
  rossler,
  threeScroll,
  sprott,
};

/**
 * Human-readable names for attractors (for UI)
 */
export const ATTRACTOR_DISPLAY_NAMES: Record<AttractorName, string> = {
  aizawa: 'Aizawa',
  lorenz: 'Lorenz (Butterfly)',
  thomas: 'Thomas',
  halvorsen: 'Halvorsen',
  arneodo: 'Arneodo',
  chen: 'Chen',
  dadras: 'Dadras (Four-Wing)',
  rossler: 'Rossler',
  threeScroll: 'Three-Scroll',
  sprott: 'Sprott',
};

/**
 * Attractor descriptions for preview/selection UI
 */
export const ATTRACTOR_DESCRIPTIONS: Record<AttractorName, string> = {
  aizawa: 'Dense, ribbon-like flowing structures. Good for processing states.',
  lorenz: 'Classic butterfly pattern. Calm, balanced dual-lobe shape.',
  thomas: 'Smooth spiraling curves. Compact, attentive appearance.',
  halvorsen: 'Complex 3D spirals. Expansive, expressive energy.',
  arneodo: 'Chaotic, agitated motion. Alert, error-like behavior.',
  chen: 'Dual scroll curves. Smooth, contemplative flow.',
  dadras: 'Four-wing butterfly. Elegant, symmetric motion.',
  rossler: 'Simple spiral with excursions. Rhythmic, periodic feel.',
  threeScroll: 'Complex triple scroll. Dense, intricate processing.',
  sprott: 'Minimal chaos. Clean curves with unpredictable behavior.',
};

/**
 * Get attractor function by name
 */
export function getAttractor(name: string): AttractorFunction {
  if (name in ATTRACTOR_REGISTRY) {
    return ATTRACTOR_REGISTRY[name as AttractorName];
  }
  return lorenz; // Default fallback
}

// ============================================================================
// OPTIMIZED ATTRACTORS - Using lookup tables for better performance
// ============================================================================

/**
 * Optimized Thomas Attractor using fast trig
 */
export const thomasOptimized: AttractorFunction = (x, y, z) => {
  const b = 0.208186;
  return [fastSin(y) - b * x, fastSin(z) - b * y, fastSin(x) - b * z];
};

/**
 * Optimized Rossler using lookup tables
 */
export const rosslerOptimized: AttractorFunction = (x, y, z) => {
  const a = 0.2,
    b = 0.2,
    c = 5.7;
  return [-y - z, x + a * y, b + z * (x - c)];
};

/**
 * Get optimized attractor function by name
 */
export function getOptimizedAttractor(name: string): AttractorFunction {
  switch (name) {
    case 'lorenz':
      return lorenz;
    case 'thomas':
      return thomasOptimized;
    case 'aizawa':
      return aizawa;
    case 'halvorsen':
      return halvorsen;
    case 'arneodo':
      return arneodo;
    case 'chen':
      return chen;
    case 'dadras':
      return dadras;
    case 'rossler':
      return rosslerOptimized;
    case 'threeScroll':
      return threeScroll;
    case 'sprott':
      return sprott;
    default:
      return lorenz;
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
  const s = 10,
    r = 28,
    b = 2.667;
  return [s * (y - x), r * x - y - x * z, x * y - b * z];
};

/**
 * Simplified attractor that approximates a circular orbit with perturbation
 * Extremely lightweight for very low-end hardware
 */
export const circularSimplified: AttractorFunction = (x, y, z) => {
  const k = 0.1;
  return [-y * k, x * k, (x * y - z) * 0.05];
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
export function batchUpdateLorenz(positions: Float32Array, dt: number, scale: number): void {
  const sigma = 10,
    rho = 28,
    beta = 2.667;
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
export function batchUpdateAizawa(positions: Float32Array, dt: number, scale: number): void {
  const a = 0.95,
    b = 0.7,
    c = 0.6,
    d = 3.5,
    e = 0.25,
    f = 0.1;
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
    default: {
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
export function getAttractorByMode(name: string, mode: AttractorMode): AttractorFunction {
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

// ============================================================================
// SMOOTH TRANSITION EASING FUNCTIONS
// ============================================================================

/**
 * Easing function types for attractor transitions
 */
export type EasingFunction = (t: number) => number;

/**
 * Linear interpolation (no easing)
 */
export const easeLinear: EasingFunction = (t) => t;

/**
 * Ease in quadratic - slow start
 */
export const easeInQuad: EasingFunction = (t) => t * t;

/**
 * Ease out quadratic - slow end
 */
export const easeOutQuad: EasingFunction = (t) => t * (2 - t);

/**
 * Ease in-out quadratic - slow start and end
 */
export const easeInOutQuad: EasingFunction = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

/**
 * Ease in cubic - slower start
 */
export const easeInCubic: EasingFunction = (t) => t * t * t;

/**
 * Ease out cubic - slower end
 */
export const easeOutCubic: EasingFunction = (t) => {
  const t1 = t - 1;
  return t1 * t1 * t1 + 1;
};

/**
 * Ease in-out cubic - smooth start and end (default for morphing)
 */
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Ease out elastic - bouncy overshoot
 */
export const easeOutElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/**
 * Ease out back - slight overshoot then settle
 */
export const easeOutBack: EasingFunction = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Registry of easing functions by name
 */
export const EASING_FUNCTIONS: Record<string, EasingFunction> = {
  linear: easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeOutElastic,
  easeOutBack,
};

// ============================================================================
// ATTRACTOR TRANSITION MANAGER
// ============================================================================

/**
 * Configuration for attractor transitions
 */
export interface TransitionConfig {
  /** Duration of the transition in milliseconds */
  duration: number;
  /** Easing function to use */
  easing: EasingFunction;
  /** Whether to blend colors during transition */
  blendColors: boolean;
  /** Whether to interpolate scale/settings */
  interpolateSettings: boolean;
}

/**
 * Default transition configuration
 */
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  duration: 1200,
  easing: easeInOutCubic,
  blendColors: true,
  interpolateSettings: true,
};

/**
 * State-specific transition configs (faster/slower based on context)
 */
export const STATE_TRANSITION_CONFIGS: Record<AtlasState, Partial<TransitionConfig>> = {
  idle: { duration: 1500, easing: easeOutCubic }, // Slow, smooth transition to calm
  listening: { duration: 800, easing: easeOutQuad }, // Quick response to user
  thinking: { duration: 1000, easing: easeInOutQuad }, // Balanced transition
  speaking: { duration: 600, easing: easeOutBack }, // Quick with slight bounce
  error: { duration: 400, easing: easeOutQuad }, // Fast alert transition
};

/**
 * Get transition config for a state change
 */
export function getTransitionConfig(_fromState: AtlasState, toState: AtlasState): TransitionConfig {
  const baseConfig = { ...DEFAULT_TRANSITION_CONFIG };
  const stateConfig = STATE_TRANSITION_CONFIGS[toState];
  return { ...baseConfig, ...stateConfig };
}

/**
 * Transition state for tracking morphing progress
 */
export interface AttractorTransitionState {
  /** Source attractor name */
  from: AttractorName;
  /** Target attractor name */
  to: AttractorName;
  /** Progress (0-1) */
  progress: number;
  /** Start timestamp */
  startTime: number;
  /** Transition configuration */
  config: TransitionConfig;
  /** Whether transition is active */
  isActive: boolean;
}

/**
 * Create initial transition state
 */
export function createTransitionState(
  initialAttractor: AttractorName = 'lorenz'
): AttractorTransitionState {
  return {
    from: initialAttractor,
    to: initialAttractor,
    progress: 1.0,
    startTime: 0,
    config: DEFAULT_TRANSITION_CONFIG,
    isActive: false,
  };
}

/**
 * Start a new attractor transition
 */
export function startTransition(
  state: AttractorTransitionState,
  targetAttractor: AttractorName,
  config: Partial<TransitionConfig> = {}
): AttractorTransitionState {
  // If already transitioning, use current interpolated position as source
  const from = state.isActive ? state.to : state.from;

  return {
    from,
    to: targetAttractor,
    progress: 0,
    startTime: performance.now(),
    config: { ...DEFAULT_TRANSITION_CONFIG, ...config },
    isActive: true,
  };
}

/**
 * Update transition progress
 */
export function updateTransition(
  state: AttractorTransitionState,
  currentTime: number
): AttractorTransitionState {
  if (!state.isActive) return state;

  const elapsed = currentTime - state.startTime;
  const rawProgress = Math.min(1, elapsed / state.config.duration);
  const easedProgress = state.config.easing(rawProgress);

  if (rawProgress >= 1) {
    return {
      ...state,
      from: state.to,
      progress: 1.0,
      isActive: false,
    };
  }

  return {
    ...state,
    progress: easedProgress,
  };
}

/**
 * Interpolate attractor settings during transition
 */
export function interpolateSettings(
  from: AttractorSettings,
  to: AttractorSettings,
  progress: number
): AttractorSettings {
  const lerp = (a: number, b: number) => a + (b - a) * progress;

  return {
    scale: lerp(from.scale, to.scale),
    dt: lerp(from.dt, to.dt),
    camDistance: lerp(from.camDistance, to.camDistance),
    offset: [
      lerp(from.offset[0], to.offset[0]),
      lerp(from.offset[1], to.offset[1]),
      lerp(from.offset[2], to.offset[2]),
    ],
    baseHue: lerp(from.baseHue, to.baseHue),
    hueRange: lerp(from.hueRange, to.hueRange),
  };
}

// ============================================================================
// PREVIEW MODE SUPPORT
// ============================================================================

/**
 * Preview state for attractor selection UI
 */
export interface AttractorPreviewState {
  /** Whether preview mode is active */
  isActive: boolean;
  /** Attractor being previewed */
  previewAttractor: AttractorName | null;
  /** Preview start time */
  startTime: number;
  /** Original attractor to restore */
  originalAttractor: AttractorName;
  /** Auto-cycle through attractors */
  isAutoCycling: boolean;
  /** Current index in auto-cycle */
  cycleIndex: number;
}

/**
 * Create initial preview state
 */
export function createPreviewState(
  currentAttractor: AttractorName = 'lorenz'
): AttractorPreviewState {
  return {
    isActive: false,
    previewAttractor: null,
    startTime: 0,
    originalAttractor: currentAttractor,
    isAutoCycling: false,
    cycleIndex: 0,
  };
}

/**
 * List of all attractor names for cycling
 */
export const ALL_ATTRACTOR_NAMES: AttractorName[] = [
  'lorenz',
  'aizawa',
  'thomas',
  'halvorsen',
  'chen',
  'dadras',
  'rossler',
  'threeScroll',
  'sprott',
  'arneodo', // Last since it's chaotic/error-like
];

/**
 * Start previewing an attractor
 */
export function startPreview(
  state: AttractorPreviewState,
  attractor: AttractorName
): AttractorPreviewState {
  return {
    ...state,
    isActive: true,
    previewAttractor: attractor,
    startTime: performance.now(),
    isAutoCycling: false,
  };
}

/**
 * Start auto-cycling through attractors
 */
export function startAutoCycle(state: AttractorPreviewState): AttractorPreviewState {
  return {
    ...state,
    isActive: true,
    previewAttractor: ALL_ATTRACTOR_NAMES[0],
    startTime: performance.now(),
    isAutoCycling: true,
    cycleIndex: 0,
  };
}

/**
 * Advance to next attractor in auto-cycle
 */
export function advanceCycle(state: AttractorPreviewState): AttractorPreviewState {
  if (!state.isAutoCycling) return state;

  const nextIndex = (state.cycleIndex + 1) % ALL_ATTRACTOR_NAMES.length;
  return {
    ...state,
    previewAttractor: ALL_ATTRACTOR_NAMES[nextIndex],
    cycleIndex: nextIndex,
    startTime: performance.now(),
  };
}

/**
 * Cancel preview and restore original
 */
export function cancelPreview(state: AttractorPreviewState): AttractorPreviewState {
  return {
    ...state,
    isActive: false,
    previewAttractor: null,
    isAutoCycling: false,
  };
}

/**
 * Apply previewed attractor as new selection
 */
export function applyPreview(state: AttractorPreviewState): {
  newState: AttractorPreviewState;
  selectedAttractor: AttractorName;
} {
  const selected = state.previewAttractor || state.originalAttractor;
  return {
    newState: {
      ...state,
      isActive: false,
      previewAttractor: null,
      originalAttractor: selected,
      isAutoCycling: false,
    },
    selectedAttractor: selected,
  };
}

/**
 * Get the effective attractor based on preview/user preference/state
 */
export function getEffectiveAttractor(
  userPreference: 'auto' | AttractorName,
  currentState: AtlasState,
  previewState: AttractorPreviewState
): AttractorName {
  // Preview mode takes highest priority
  if (previewState.isActive && previewState.previewAttractor) {
    return previewState.previewAttractor;
  }

  // User preference (if not 'auto')
  if (userPreference !== 'auto') {
    return userPreference;
  }

  // State-based selection
  return STATE_TO_ATTRACTOR[currentState] as AttractorName;
}
