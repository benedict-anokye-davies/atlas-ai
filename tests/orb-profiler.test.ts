/**
 * Orb Profiler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PerformanceMeasurement } from '../src/renderer/utils/orb-profiler';

// Mock GPU detection
vi.mock('../src/renderer/utils/gpu-detection', () => ({
  getGPUInfo: vi.fn(() => ({
    vendor: 'Test Vendor',
    renderer: 'Test GPU',
    tier: 'mid-range' as const,
    maxTextureSize: 8192,
    maxVertexUniforms: 256,
    maxFragmentUniforms: 256,
    supportsInstancing: true,
    supportsFloatTextures: true,
    supportsWebGL2: true,
  })),
  getTierSettings: vi.fn((tier: string) => {
    switch (tier) {
      case 'high-end':
        return { particleCount: 15000 };
      case 'mid-range':
        return { particleCount: 8000 };
      case 'low-end':
        return { particleCount: 3000 };
      default:
        return { particleCount: 5000 };
    }
  }),
}));

import {
  createPerformanceProfile,
  generatePerformanceReport,
  EXPECTED_FPS_BASELINES,
  BOTTLENECK_CHECKS,
  PERFORMANCE_BASELINES,
  BOTTLENECK_MITIGATIONS,
} from '../src/renderer/utils/orb-profiler';

// Helper to create test measurements
function createMeasurements(
  options: {
    count?: number;
    avgFps?: number;
    fpsVariance?: number;
    frameTimeVariance?: number;
    memoryGrowth?: boolean;
    hasGcSpike?: boolean;
  } = {}
): PerformanceMeasurement[] {
  const {
    count = 100,
    avgFps = 60,
    fpsVariance = 2,
    frameTimeVariance = 1,
    memoryGrowth = false,
    hasGcSpike = false,
  } = options;

  const measurements: PerformanceMeasurement[] = [];
  const baseMemory = 200;

  for (let i = 0; i < count; i++) {
    const fps = avgFps + (Math.random() * 2 - 1) * fpsVariance;
    const baseFrameTime = 1000 / fps;
    const frameTime = baseFrameTime + (Math.random() * 2 - 1) * frameTimeVariance;

    // Add GC spike at the middle if requested
    const actualFrameTime = hasGcSpike && i === Math.floor(count / 2) ? 60 : frameTime;

    measurements.push({
      fps: Math.round(fps),
      frameTime: actualFrameTime,
      memoryUsage: memoryGrowth ? baseMemory + i * 0.5 : baseMemory + Math.random() * 10,
      particleCount: 8000,
      timestamp: Date.now() + i * 16,
    });
  }

  return measurements;
}

describe('Orb Profiler', () => {
  describe('EXPECTED_FPS_BASELINES', () => {
    it('should have correct baselines for high-end', () => {
      expect(EXPECTED_FPS_BASELINES['high-end'].min).toBe(55);
      expect(EXPECTED_FPS_BASELINES['high-end'].target).toBe(60);
    });

    it('should have correct baselines for mid-range', () => {
      expect(EXPECTED_FPS_BASELINES['mid-range'].min).toBe(45);
      expect(EXPECTED_FPS_BASELINES['mid-range'].target).toBe(60);
    });

    it('should have correct baselines for low-end', () => {
      expect(EXPECTED_FPS_BASELINES['low-end'].min).toBe(30);
      expect(EXPECTED_FPS_BASELINES['low-end'].target).toBe(45);
    });

    it('should have conservative baselines for unknown', () => {
      expect(EXPECTED_FPS_BASELINES['unknown'].min).toBe(30);
      expect(EXPECTED_FPS_BASELINES['unknown'].target).toBe(45);
    });
  });

  describe('BOTTLENECK_CHECKS', () => {
    describe('cpuBound', () => {
      it('should detect CPU-bound when frame time variance is high', () => {
        const measurements = createMeasurements({ frameTimeVariance: 10 });
        expect(BOTTLENECK_CHECKS.cpuBound(measurements)).toBe(true);
      });

      it('should not flag as CPU-bound with low variance', () => {
        const measurements = createMeasurements({ frameTimeVariance: 1 });
        expect(BOTTLENECK_CHECKS.cpuBound(measurements)).toBe(false);
      });
    });

    describe('gpuBound', () => {
      it('should detect GPU-bound with high consistent frame times', () => {
        const measurements: PerformanceMeasurement[] = [];
        for (let i = 0; i < 100; i++) {
          measurements.push({
            fps: 40,
            frameTime: 25 + Math.random() * 2, // High and consistent
            memoryUsage: 200,
            particleCount: 8000,
            timestamp: Date.now() + i * 16,
          });
        }
        expect(BOTTLENECK_CHECKS.gpuBound(measurements)).toBe(true);
      });

      it('should not flag as GPU-bound with low frame times', () => {
        const measurements = createMeasurements({ avgFps: 60, frameTimeVariance: 1 });
        expect(BOTTLENECK_CHECKS.gpuBound(measurements)).toBe(false);
      });
    });

    describe('memoryPressure', () => {
      it('should detect memory pressure when usage grows', () => {
        const measurements = createMeasurements({ count: 100, memoryGrowth: true });
        expect(BOTTLENECK_CHECKS.memoryPressure(measurements)).toBe(true);
      });

      it('should not flag when memory is stable', () => {
        const measurements = createMeasurements({ count: 100, memoryGrowth: false });
        expect(BOTTLENECK_CHECKS.memoryPressure(measurements)).toBe(false);
      });

      it('should return false with insufficient samples', () => {
        const measurements = createMeasurements({ count: 5 });
        expect(BOTTLENECK_CHECKS.memoryPressure(measurements)).toBe(false);
      });
    });

    describe('gcSpikes', () => {
      it('should detect GC spikes', () => {
        const measurements = createMeasurements({ hasGcSpike: true });
        expect(BOTTLENECK_CHECKS.gcSpikes(measurements)).toBe(true);
      });

      it('should not flag without spikes', () => {
        const measurements = createMeasurements({ hasGcSpike: false });
        expect(BOTTLENECK_CHECKS.gcSpikes(measurements)).toBe(false);
      });
    });

    describe('tooManyParticles', () => {
      it('should detect when particle count exceeds tier recommendation with low FPS', () => {
        const measurements: PerformanceMeasurement[] = [];
        for (let i = 0; i < 10; i++) {
          measurements.push({
            fps: 30, // Below mid-range minimum of 45
            frameTime: 33,
            memoryUsage: 200,
            particleCount: 12000, // Above 8000 recommended for mid-range
            timestamp: Date.now() + i * 16,
          });
        }
        expect(BOTTLENECK_CHECKS.tooManyParticles(measurements, 'mid-range')).toBe(true);
      });

      it('should not flag when within recommended limits', () => {
        const measurements = createMeasurements({ avgFps: 60 });
        expect(BOTTLENECK_CHECKS.tooManyParticles(measurements, 'mid-range')).toBe(false);
      });
    });
  });

  describe('createPerformanceProfile', () => {
    it('should create a valid profile', () => {
      const measurements = createMeasurements({ avgFps: 60 });
      const profile = createPerformanceProfile(measurements, 8000);

      expect(profile.hardwareTier).toBe('mid-range');
      expect(profile.gpuRenderer).toBe('Test GPU');
      expect(profile.particleCount).toBe(8000);
      expect(profile.measurements).toBe(measurements);
      expect(profile.summary).toBeDefined();
      expect(profile.timestamp).toBeGreaterThan(0);
    });

    it('should calculate correct summary statistics', () => {
      // Create measurements with known values
      const measurements: PerformanceMeasurement[] = [
        { fps: 55, frameTime: 18, memoryUsage: 200, particleCount: 8000, timestamp: 1 },
        { fps: 60, frameTime: 16, memoryUsage: 210, particleCount: 8000, timestamp: 2 },
        { fps: 65, frameTime: 15, memoryUsage: 220, particleCount: 8000, timestamp: 3 },
      ];

      const profile = createPerformanceProfile(measurements, 8000);

      expect(profile.summary.avgFps).toBe(60);
      expect(profile.summary.minFps).toBe(55);
      expect(profile.summary.maxFps).toBe(65);
      expect(profile.summary.memoryPeak).toBe(220);
    });

    it('should count dropped frames correctly', () => {
      const measurements: PerformanceMeasurement[] = [
        { fps: 60, frameTime: 16, memoryUsage: 200, particleCount: 8000, timestamp: 1 },
        { fps: 25, frameTime: 40, memoryUsage: 200, particleCount: 8000, timestamp: 2 }, // Dropped
        { fps: 60, frameTime: 16, memoryUsage: 200, particleCount: 8000, timestamp: 3 },
        { fps: 20, frameTime: 50, memoryUsage: 200, particleCount: 8000, timestamp: 4 }, // Dropped
      ];

      const profile = createPerformanceProfile(measurements, 8000);

      expect(profile.summary.droppedFrames).toBe(2);
    });

    it('should identify bottlenecks', () => {
      // Create measurements that trigger bottleneck detection
      const measurements: PerformanceMeasurement[] = [];
      for (let i = 0; i < 100; i++) {
        measurements.push({
          fps: 30, // Below target
          frameTime: 33,
          memoryUsage: 200,
          particleCount: 8000,
          timestamp: Date.now() + i * 16,
        });
      }

      const profile = createPerformanceProfile(measurements, 8000);

      expect(profile.bottlenecks.length).toBeGreaterThan(0);
      expect(profile.bottlenecks.some((b) => b.includes('Below minimum FPS'))).toBe(true);
    });
  });

  describe('generatePerformanceReport', () => {
    it('should generate a readable report', () => {
      const measurements = createMeasurements({ avgFps: 60 });
      const profile = createPerformanceProfile(measurements, 8000);
      const report = generatePerformanceReport(profile);

      expect(report).toContain('ORB PERFORMANCE PROFILE REPORT');
      expect(report).toContain('GPU:');
      expect(report).toContain('Hardware Tier:');
      expect(report).toContain('Particle Count:');
      expect(report).toContain('FPS STATISTICS');
      expect(report).toContain('FRAME TIME STATS');
      expect(report).toContain('MEMORY USAGE');
    });

    it('should show target comparison', () => {
      const measurements = createMeasurements({ avgFps: 60 });
      const profile = createPerformanceProfile(measurements, 8000);
      const report = generatePerformanceReport(profile);

      expect(report).toContain('TARGET COMPARISON');
      expect(report).toContain('Expected Min:');
      expect(report).toContain('Expected Target:');
    });

    it('should show bottlenecks when present', () => {
      const measurements: PerformanceMeasurement[] = [];
      for (let i = 0; i < 100; i++) {
        measurements.push({
          fps: 25,
          frameTime: 40,
          memoryUsage: 200,
          particleCount: 8000,
          timestamp: Date.now() + i * 16,
        });
      }

      const profile = createPerformanceProfile(measurements, 8000);
      const report = generatePerformanceReport(profile);

      expect(report).toContain('IDENTIFIED BOTTLENECKS');
    });

    it('should indicate when meeting targets', () => {
      const measurements = createMeasurements({ avgFps: 60 });
      const profile = createPerformanceProfile(measurements, 8000);
      const report = generatePerformanceReport(profile);

      expect(report).toContain('MEETING TARGETS');
    });
  });

  describe('PERFORMANCE_BASELINES', () => {
    it('should have all tier configurations', () => {
      expect(PERFORMANCE_BASELINES['high-end']).toBeDefined();
      expect(PERFORMANCE_BASELINES['mid-range']).toBeDefined();
      expect(PERFORMANCE_BASELINES['low-end']).toBeDefined();
      expect(PERFORMANCE_BASELINES['unknown']).toBeDefined();
    });

    it('should have decreasing particle counts by tier', () => {
      expect(PERFORMANCE_BASELINES['high-end'].particleCount).toBeGreaterThan(
        PERFORMANCE_BASELINES['mid-range'].particleCount
      );
      expect(PERFORMANCE_BASELINES['mid-range'].particleCount).toBeGreaterThan(
        PERFORMANCE_BASELINES['low-end'].particleCount
      );
    });

    it('should have correct feature settings for low-end', () => {
      const lowEnd = PERFORMANCE_BASELINES['low-end'];
      expect(lowEnd.features.postProcessing).toBe(false);
      expect(lowEnd.features.shadowQuality).toBe('none');
      expect(lowEnd.features.simplifiedAttractor).toBe(true);
    });

    it('should have full features for high-end', () => {
      const highEnd = PERFORMANCE_BASELINES['high-end'];
      expect(highEnd.features.postProcessing).toBe(true);
      expect(highEnd.features.shadowQuality).toBe('high');
      expect(highEnd.features.simplifiedAttractor).toBe(false);
    });
  });

  describe('BOTTLENECK_MITIGATIONS', () => {
    it('should have mitigations for all bottleneck types', () => {
      expect(BOTTLENECK_MITIGATIONS['CPU-bound']).toBeDefined();
      expect(BOTTLENECK_MITIGATIONS['GPU-bound']).toBeDefined();
      expect(BOTTLENECK_MITIGATIONS['Memory pressure']).toBeDefined();
      expect(BOTTLENECK_MITIGATIONS['GC spikes']).toBeDefined();
    });

    it('should have multiple mitigations per bottleneck', () => {
      Object.values(BOTTLENECK_MITIGATIONS).forEach((mitigations) => {
        expect(mitigations.length).toBeGreaterThan(0);
      });
    });
  });
});
