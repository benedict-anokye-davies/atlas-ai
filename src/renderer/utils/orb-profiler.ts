/**
 * Orb Performance Profiler
 *
 * Utility for profiling orb rendering performance across hardware tiers.
 * Measures FPS, frame time, and identifies bottlenecks.
 */

import { getGPUInfo, getTierSettings, type HardwareTier } from './gpu-detection';

/**
 * Performance profile data
 */
export interface PerformanceProfile {
  timestamp: number;
  hardwareTier: HardwareTier;
  gpuRenderer: string;
  particleCount: number;
  measurements: PerformanceMeasurement[];
  summary: PerformanceSummary;
  bottlenecks: string[];
}

/**
 * Single performance measurement
 */
export interface PerformanceMeasurement {
  fps: number;
  frameTime: number;
  memoryUsage: number;
  particleCount: number;
  timestamp: number;
}

/**
 * Performance summary statistics
 */
export interface PerformanceSummary {
  avgFps: number;
  minFps: number;
  maxFps: number;
  stdDevFps: number;
  avgFrameTime: number;
  maxFrameTime: number;
  droppedFrames: number;
  memoryPeak: number;
}

/**
 * Expected baseline FPS by hardware tier
 */
export const EXPECTED_FPS_BASELINES: Record<HardwareTier, { min: number; target: number }> = {
  'high-end': { min: 55, target: 60 },
  'mid-range': { min: 45, target: 60 },
  'low-end': { min: 30, target: 45 },
  unknown: { min: 30, target: 45 },
};

/**
 * Known performance bottlenecks to check
 */
export const BOTTLENECK_CHECKS = {
  /** CPU bottleneck: frame time variance > 5ms indicates CPU-bound work */
  cpuBound: (measurements: PerformanceMeasurement[]): boolean => {
    const times = measurements.map((m) => m.frameTime);
    const variance = calculateVariance(times);
    return variance > 25; // 5ms^2
  },

  /** GPU bottleneck: consistently high frame time with low variance */
  gpuBound: (measurements: PerformanceMeasurement[]): boolean => {
    const times = measurements.map((m) => m.frameTime);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = calculateVariance(times);
    return avg > 20 && variance < 10; // High frame time, consistent
  },

  /** Memory pressure: memory usage steadily increasing */
  memoryPressure: (measurements: PerformanceMeasurement[]): boolean => {
    if (measurements.length < 10) return false;
    const first10 = measurements.slice(0, 10).map((m) => m.memoryUsage);
    const last10 = measurements.slice(-10).map((m) => m.memoryUsage);
    const avgFirst = first10.reduce((a, b) => a + b, 0) / 10;
    const avgLast = last10.reduce((a, b) => a + b, 0) / 10;
    return avgLast > avgFirst * 1.2; // 20% increase
  },

  /** GC spikes: sudden frame time spikes > 50ms */
  gcSpikes: (measurements: PerformanceMeasurement[]): boolean => {
    return measurements.some((m) => m.frameTime > 50);
  },

  /** Particle count too high for tier */
  tooManyParticles: (
    measurements: PerformanceMeasurement[],
    tier: HardwareTier
  ): boolean => {
    const recommended = getTierSettings(tier).particleCount;
    const actual = measurements[0]?.particleCount || 0;
    const avgFps = measurements.reduce((a, m) => a + m.fps, 0) / measurements.length;
    return actual > recommended && avgFps < EXPECTED_FPS_BASELINES[tier].min;
  },
};

/**
 * Calculate variance of a number array
 */
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
  return Math.sqrt(calculateVariance(values));
}

/**
 * Create a performance profile from measurements
 */
export function createPerformanceProfile(
  measurements: PerformanceMeasurement[],
  particleCount: number
): PerformanceProfile {
  const gpuInfo = getGPUInfo();

  // Calculate summary statistics
  const fpsValues = measurements.map((m) => m.fps);
  const frameTimeValues = measurements.map((m) => m.frameTime);
  const memoryValues = measurements.map((m) => m.memoryUsage);

  const summary: PerformanceSummary = {
    avgFps: fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length,
    minFps: Math.min(...fpsValues),
    maxFps: Math.max(...fpsValues),
    stdDevFps: calculateStdDev(fpsValues),
    avgFrameTime: frameTimeValues.reduce((a, b) => a + b, 0) / frameTimeValues.length,
    maxFrameTime: Math.max(...frameTimeValues),
    droppedFrames: frameTimeValues.filter((t) => t > 33.33).length, // > 30fps threshold
    memoryPeak: Math.max(...memoryValues),
  };

  // Identify bottlenecks
  const bottlenecks: string[] = [];

  if (BOTTLENECK_CHECKS.cpuBound(measurements)) {
    bottlenecks.push('CPU-bound: High frame time variance indicates CPU processing spikes');
  }

  if (BOTTLENECK_CHECKS.gpuBound(measurements)) {
    bottlenecks.push('GPU-bound: Consistently high frame time indicates GPU saturation');
  }

  if (BOTTLENECK_CHECKS.memoryPressure(measurements)) {
    bottlenecks.push('Memory pressure: Memory usage is increasing over time');
  }

  if (BOTTLENECK_CHECKS.gcSpikes(measurements)) {
    bottlenecks.push('GC spikes: Frame time spikes indicate garbage collection pauses');
  }

  if (BOTTLENECK_CHECKS.tooManyParticles(measurements, gpuInfo.tier)) {
    bottlenecks.push(`Particle count (${particleCount}) too high for ${gpuInfo.tier} hardware`);
  }

  // Check if meeting targets
  const baseline = EXPECTED_FPS_BASELINES[gpuInfo.tier];
  if (summary.avgFps < baseline.min) {
    bottlenecks.push(
      `Below minimum FPS: ${summary.avgFps.toFixed(1)} < ${baseline.min} expected for ${gpuInfo.tier}`
    );
  }

  return {
    timestamp: Date.now(),
    hardwareTier: gpuInfo.tier,
    gpuRenderer: gpuInfo.renderer,
    particleCount,
    measurements,
    summary,
    bottlenecks,
  };
}

/**
 * Generate a human-readable performance report
 */
export function generatePerformanceReport(profile: PerformanceProfile): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════',
    '           ORB PERFORMANCE PROFILE REPORT              ',
    '═══════════════════════════════════════════════════════',
    '',
    `Timestamp: ${new Date(profile.timestamp).toISOString()}`,
    `GPU: ${profile.gpuRenderer}`,
    `Hardware Tier: ${profile.hardwareTier}`,
    `Particle Count: ${profile.particleCount.toLocaleString()}`,
    '',
    '───────────────────────────────────────────────────────',
    '                    FPS STATISTICS                     ',
    '───────────────────────────────────────────────────────',
    `  Average FPS:     ${profile.summary.avgFps.toFixed(1)}`,
    `  Minimum FPS:     ${profile.summary.minFps}`,
    `  Maximum FPS:     ${profile.summary.maxFps}`,
    `  Std Deviation:   ${profile.summary.stdDevFps.toFixed(2)}`,
    '',
    '───────────────────────────────────────────────────────',
    '                  FRAME TIME STATS                     ',
    '───────────────────────────────────────────────────────',
    `  Average:         ${profile.summary.avgFrameTime.toFixed(2)}ms`,
    `  Maximum:         ${profile.summary.maxFrameTime.toFixed(2)}ms`,
    `  Dropped Frames:  ${profile.summary.droppedFrames}`,
    '',
    '───────────────────────────────────────────────────────',
    '                   MEMORY USAGE                        ',
    '───────────────────────────────────────────────────────',
    `  Peak Usage:      ${profile.summary.memoryPeak}MB`,
    '',
  ];

  const baseline = EXPECTED_FPS_BASELINES[profile.hardwareTier];
  lines.push('───────────────────────────────────────────────────────');
  lines.push('                 TARGET COMPARISON                     ');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(`  Expected Min:    ${baseline.min} FPS`);
  lines.push(`  Expected Target: ${baseline.target} FPS`);
  lines.push(
    `  Status:          ${
      profile.summary.avgFps >= baseline.min
        ? '✓ MEETING TARGETS'
        : '✗ BELOW TARGETS'
    }`
  );
  lines.push('');

  if (profile.bottlenecks.length > 0) {
    lines.push('───────────────────────────────────────────────────────');
    lines.push('              IDENTIFIED BOTTLENECKS                   ');
    lines.push('───────────────────────────────────────────────────────');
    profile.bottlenecks.forEach((bottleneck) => {
      lines.push(`  ⚠ ${bottleneck}`);
    });
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Expected performance baselines documentation
 */
export const PERFORMANCE_BASELINES = {
  'high-end': {
    description: 'NVIDIA RTX 30/40 series, AMD RX 6800+, Apple M2+',
    particleCount: 15000,
    expectedFps: { min: 55, target: 60 },
    features: {
      postProcessing: true,
      shadowQuality: 'high',
      instancing: true,
      simplifiedAttractor: false,
    },
  },
  'mid-range': {
    description: 'NVIDIA GTX 1060+, Intel Iris Xe, Apple M1',
    particleCount: 8000,
    expectedFps: { min: 45, target: 60 },
    features: {
      postProcessing: true,
      shadowQuality: 'medium',
      instancing: true,
      simplifiedAttractor: false,
    },
  },
  'low-end': {
    description: 'Intel HD 4000-6000, integrated graphics, mobile GPUs',
    particleCount: 3000,
    expectedFps: { min: 30, target: 45 },
    features: {
      postProcessing: false,
      shadowQuality: 'none',
      instancing: true,
      simplifiedAttractor: true,
    },
  },
  unknown: {
    description: 'Unidentified GPU, conservative defaults',
    particleCount: 5000,
    expectedFps: { min: 30, target: 45 },
    features: {
      postProcessing: false,
      shadowQuality: 'low',
      instancing: false,
      simplifiedAttractor: true,
    },
  },
};

/**
 * Known bottleneck causes and mitigations
 */
export const BOTTLENECK_MITIGATIONS = {
  'CPU-bound': [
    'Reduce particle count',
    'Simplify attractor calculations',
    'Use pre-computed lookup tables',
    'Reduce update frequency for distant particles',
  ],
  'GPU-bound': [
    'Reduce particle count',
    'Lower shadow quality or disable',
    'Disable post-processing effects',
    'Use simpler shaders',
  ],
  'Memory pressure': [
    'Object pooling for particles',
    'Reduce texture sizes',
    'Avoid creating new objects in render loop',
    'Use Float32Array for positions',
  ],
  'GC spikes': [
    'Pre-allocate all buffers',
    'Use object pooling',
    'Avoid array creation in hot paths',
    'Use TypedArrays instead of regular arrays',
  ],
};
