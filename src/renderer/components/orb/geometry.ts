/**
 * Nova Desktop - Geometry Generation
 * High-quality point distributions for the AI Core particle system
 */

import type { AttractorFunction, AttractorSettings } from './attractors';

/**
 * Generate points by evolving a strange attractor
 * Creates organic, chaotic particle distributions
 */
export function generateAttractorPoints(
  count: number,
  attractorFn: AttractorFunction,
  settings: AttractorSettings
): Float32Array {
  const positions = new Float32Array(count * 3);

  // Initial position (small random offset from origin)
  let x = 0.1 + Math.random() * 0.1;
  let y = 0.1 + Math.random() * 0.1;
  let z = 0.1 + Math.random() * 0.1;

  // Skip initial transient iterations for stability
  for (let i = 0; i < 100; i++) {
    const [dx, dy, dz] = attractorFn(x, y, z);
    x += dx * settings.dt;
    y += dy * settings.dt;
    z += dz * settings.dt;
  }

  // Generate particle positions along attractor path
  for (let i = 0; i < count; i++) {
    const [dx, dy, dz] = attractorFn(x, y, z);
    x += dx * settings.dt;
    y += dy * settings.dt;
    z += dz * settings.dt;

    // Apply scaling and offset
    positions[i * 3] = (x + settings.offset[0]) * settings.scale;
    positions[i * 3 + 1] = (y + settings.offset[1]) * settings.scale;
    positions[i * 3 + 2] = (z + settings.offset[2]) * settings.scale;
  }

  return positions;
}

/**
 * Generate evenly distributed points on a sphere using Fibonacci algorithm
 * Creates a more natural distribution than random placement
 */
export function generateSpherePoints(
  count: number,
  radius: number,
  variance: number = 0
): Float32Array {
  const positions = new Float32Array(count * 3);
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    // Fibonacci sphere distribution for even coverage
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = (Math.PI * 2 * i) / goldenRatio;

    // Apply radius with optional variance
    const r = radius + (Math.random() - 0.5) * 2 * variance;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  return positions;
}

/**
 * Generate points distributed along a ring/torus
 * Creates orbital ring patterns around the core
 */
export function generateRingPoints(count: number, radius: number, thickness: number): Float32Array {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Distribute evenly around the ring
    const angle = (i / count) * Math.PI * 2;

    // Add variance to radius for natural look
    const r = radius + (Math.random() - 0.5) * thickness;

    // Small vertical spread for thickness
    const y = (Math.random() - 0.5) * thickness * 0.3;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * r;
  }

  return positions;
}

/**
 * Generate initial velocities for sphere particles
 * Creates slow orbital motion around the center
 */
export function generateSphereVelocities(count: number, speed: number = 0.1): Float32Array {
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Tangential velocity for orbital motion
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;

    velocities[i * 3] = Math.sin(theta) * Math.cos(phi) * speed;
    velocities[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * speed;
    velocities[i * 3 + 2] = Math.cos(theta) * speed;
  }

  return velocities;
}

/**
 * Generate random sizes for particles with specified range
 */
export function generateParticleSizes(
  count: number,
  minSize: number,
  maxSize: number
): Float32Array {
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    sizes[i] = minSize + Math.random() * (maxSize - minSize);
  }

  return sizes;
}

/**
 * Generate alpha values for particles
 */
export function generateParticleAlphas(
  count: number,
  minAlpha: number = 0.5,
  maxAlpha: number = 1.0
): Float32Array {
  const alphas = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    alphas[i] = minAlpha + Math.random() * (maxAlpha - minAlpha);
  }

  return alphas;
}

/**
 * Generate colors for particles based on base color with variance
 */
export function generateParticleColors(
  count: number,
  baseColor: { r: number; g: number; b: number },
  variance: number = 0.1
): Float32Array {
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    colors[i * 3] = Math.max(0, Math.min(1, baseColor.r + (Math.random() - 0.5) * 2 * variance));
    colors[i * 3 + 1] = Math.max(
      0,
      Math.min(1, baseColor.g + (Math.random() - 0.5) * 2 * variance)
    );
    colors[i * 3 + 2] = Math.max(
      0,
      Math.min(1, baseColor.b + (Math.random() - 0.5) * 2 * variance)
    );
  }

  return colors;
}

/**
 * Rotate positions around X axis
 */
export function rotatePointsX(positions: Float32Array, angle: number): Float32Array {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const result = new Float32Array(positions.length);

  for (let i = 0; i < positions.length / 3; i++) {
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    result[i * 3] = positions[i * 3];
    result[i * 3 + 1] = y * cos - z * sin;
    result[i * 3 + 2] = y * sin + z * cos;
  }

  return result;
}

/**
 * Rotate positions around Z axis
 */
export function rotatePointsZ(positions: Float32Array, angle: number): Float32Array {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const result = new Float32Array(positions.length);

  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];

    result[i * 3] = x * cos - y * sin;
    result[i * 3 + 1] = x * sin + y * cos;
    result[i * 3 + 2] = positions[i * 3 + 2];
  }

  return result;
}

/**
 * Morph between two position arrays with smooth interpolation
 * @param from Source positions
 * @param to Target positions
 * @param progress Interpolation factor (0-1)
 * @param result Output array (optional, will be created if not provided)
 */
export function morphPositions(
  from: Float32Array,
  to: Float32Array,
  progress: number,
  result?: Float32Array
): Float32Array {
  const output = result || new Float32Array(from.length);
  const t = Math.max(0, Math.min(1, progress)); // Clamp to 0-1

  // Smooth interpolation using ease-in-out cubic
  const smoothProgress = t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;

  for (let i = 0; i < from.length; i++) {
    output[i] = from[i] + (to[i] - from[i]) * smoothProgress;
  }

  return output;
}

/**
 * Layer configuration for the AI Core visualization
 */
export interface LayerConfig {
  name: string;
  particleCount: number;
  radius: number;
  variance: number;
  baseColor: { r: number; g: number; b: number };
  colorVariance: number;
  minSize: number;
  maxSize: number;
  minAlpha: number;
  maxAlpha: number;
  rotationSpeed: number;
  rotationAxis: [number, number, number];
  tiltAngleX?: number;
  tiltAngleZ?: number;
}

/**
 * Default layer configurations for the AI Core
 * Tuned for airy dust-like particles with visible gaps
 */
export const DEFAULT_LAYERS: LayerConfig[] = [
  // Inner Nucleus - Dense, bright white/cyan particles
  {
    name: 'nucleus',
    particleCount: 3000,
    radius: 0.8,
    variance: 0.2,
    baseColor: { r: 0.8, g: 1.0, b: 1.0 }, // Bright cyan-white
    colorVariance: 0.1,
    minSize: 0.02,
    maxSize: 0.05,
    minAlpha: 0.7,
    maxAlpha: 1.0,
    rotationSpeed: 0.4,
    rotationAxis: [0, 1, 0],
  },
  // Outer Shell - Sparse, golden/amber particles
  {
    name: 'shell',
    particleCount: 4000,
    radius: 1.8,
    variance: 0.5,
    baseColor: { r: 1.0, g: 0.84, b: 0.0 }, // Gold #FFD700
    colorVariance: 0.15,
    minSize: 0.03,
    maxSize: 0.06,
    minAlpha: 0.4,
    maxAlpha: 0.8,
    rotationSpeed: 0.15,
    rotationAxis: [0, 1, 0],
  },
  // Cyan Orbital Ring
  {
    name: 'ringCyan',
    particleCount: 2000,
    radius: 1.3,
    variance: 0.15,
    baseColor: { r: 0.0, g: 0.83, b: 1.0 }, // Cyan #00D4FF
    colorVariance: 0.08,
    minSize: 0.02,
    maxSize: 0.04,
    minAlpha: 0.6,
    maxAlpha: 0.95,
    rotationSpeed: 0.6,
    rotationAxis: [0, 1, 0],
    tiltAngleX: Math.PI / 6, // 30 degrees
    tiltAngleZ: Math.PI / 12,
  },
  // Gold Orbital Ring
  {
    name: 'ringGold',
    particleCount: 2000,
    radius: 1.5,
    variance: 0.18,
    baseColor: { r: 1.0, g: 0.7, b: 0.2 }, // Orange-gold
    colorVariance: 0.1,
    minSize: 0.02,
    maxSize: 0.04,
    minAlpha: 0.55,
    maxAlpha: 0.9,
    rotationSpeed: -0.45, // Opposite direction
    rotationAxis: [0, 1, 0],
    tiltAngleX: -Math.PI / 9, // -20 degrees
    tiltAngleZ: -Math.PI / 8,
  },
];

/**
 * State colors for the AI Core
 */
export const STATE_COLORS = {
  idle: { r: 1.0, g: 0.65, b: 0.0 }, // Orange #FFA500 (Jarvis Core)
  listening: { r: 0.0, g: 0.83, b: 1.0 }, // Cyan #00D4FF (Active Input)
  thinking: { r: 1.0, g: 0.27, b: 0.0 }, // Red-Orange #FF4500 (Processing)
  speaking: { r: 1.0, g: 0.9, b: 0.4 }, // Bright Gold/White (Output)
  error: { r: 1.0, g: 0.0, b: 0.0 }, // Red #FF0000
};

export type AtlasState = keyof typeof STATE_COLORS;

/**
 * State animation parameters
 */
export const STATE_PARAMS = {
  idle: { speedMultiplier: 0.2, glowIntensity: 1.2, turbulence: 0.05 },
  listening: { speedMultiplier: 0.8, glowIntensity: 1.5, turbulence: 0.2 },
  thinking: { speedMultiplier: 2.0, glowIntensity: 1.8, turbulence: 0.5 },
  speaking: { speedMultiplier: 1.0, glowIntensity: 1.6, turbulence: 0.1 },
  error: { speedMultiplier: 0.5, glowIntensity: 2.0, turbulence: 0.8 },
};
