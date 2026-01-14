/**
 * Adaptive Particles Hook Tests
 *
 * Tests for particle count reduction utilities
 */

import { describe, it, expect, vi } from 'vitest';

// Mock React hooks
vi.mock('react', () => ({
  useEffect: vi.fn(),
  useRef: vi.fn((val) => ({ current: val })),
  useState: vi.fn((val) => [val, vi.fn()]),
  useCallback: vi.fn((fn) => fn),
}));

// Mock performance monitor
vi.mock('../src/renderer/hooks/usePerformanceMonitor', () => ({
  usePerformanceMonitor: vi.fn(() => ({
    fps: 60,
    avgFps: 60,
    memoryUsage: 200,
    frameTime: 16.67,
  })),
  getPerformanceRating: vi.fn(() => 'excellent'),
}));

import {
  calculateReducedParticleCount,
  calculateReductionPercent,
  REDUCTION_LEVELS,
  applyReductionLevel,
} from '../src/renderer/hooks/useAdaptiveParticles';

describe('Particle Reduction Utilities', () => {
  describe('calculateReducedParticleCount', () => {
    it('should reduce by 25%', () => {
      expect(calculateReducedParticleCount(8000, 25)).toBe(6000);
    });

    it('should reduce by 50%', () => {
      expect(calculateReducedParticleCount(8000, 50)).toBe(4000);
    });

    it('should reduce by 75%', () => {
      expect(calculateReducedParticleCount(8000, 75)).toBe(2000);
    });

    it('should respect minimum particle count', () => {
      expect(calculateReducedParticleCount(8000, 90)).toBe(2000); // Default min
      expect(calculateReducedParticleCount(8000, 90, 1000)).toBe(1000); // Custom min
    });

    it('should handle 0% reduction', () => {
      expect(calculateReducedParticleCount(8000, 0)).toBe(8000);
    });

    it('should clamp reduction to 100%', () => {
      expect(calculateReducedParticleCount(8000, 150)).toBe(2000); // Clamps to min
    });

    it('should handle negative reduction as 0%', () => {
      expect(calculateReducedParticleCount(8000, -25)).toBe(8000);
    });

    it('should round to whole numbers', () => {
      expect(calculateReducedParticleCount(10000, 33)).toBe(6700);
    });
  });

  describe('calculateReductionPercent', () => {
    it('should calculate correct percentage', () => {
      expect(calculateReductionPercent(8000, 6000)).toBe(25);
      expect(calculateReductionPercent(8000, 4000)).toBe(50);
      expect(calculateReductionPercent(8000, 2000)).toBe(75);
    });

    it('should return 0 if target >= current', () => {
      expect(calculateReductionPercent(8000, 8000)).toBe(0);
      expect(calculateReductionPercent(8000, 10000)).toBe(0);
    });

    it('should round to whole numbers', () => {
      expect(calculateReductionPercent(10000, 6667)).toBe(33);
    });
  });

  describe('REDUCTION_LEVELS', () => {
    it('should have Stage 1 at 25%', () => {
      expect(REDUCTION_LEVELS.STAGE_1).toBe(25);
    });

    it('should have Stage 2 at 50%', () => {
      expect(REDUCTION_LEVELS.STAGE_2).toBe(50);
    });

    it('should have Stage 3 at 75%', () => {
      expect(REDUCTION_LEVELS.STAGE_3).toBe(75);
    });

    it('should have MINIMUM at 90%', () => {
      expect(REDUCTION_LEVELS.MINIMUM).toBe(90);
    });
  });

  describe('applyReductionLevel', () => {
    const originalCount = 12000;

    it('should apply Stage 1 reduction', () => {
      const reduced = applyReductionLevel(originalCount, 'STAGE_1');
      expect(reduced).toBe(9000); // 12000 * 0.75
    });

    it('should apply Stage 2 reduction', () => {
      const reduced = applyReductionLevel(originalCount, 'STAGE_2');
      expect(reduced).toBe(6000); // 12000 * 0.5
    });

    it('should apply Stage 3 reduction', () => {
      const reduced = applyReductionLevel(originalCount, 'STAGE_3');
      expect(reduced).toBe(3000); // 12000 * 0.25
    });

    it('should apply MINIMUM reduction', () => {
      const reduced = applyReductionLevel(originalCount, 'MINIMUM');
      expect(reduced).toBe(2000); // Clamps to min
    });

    it('should respect custom minimum', () => {
      const reduced = applyReductionLevel(originalCount, 'MINIMUM', 1500);
      expect(reduced).toBe(1500);
    });
  });

  describe('Staged Degradation Sequence', () => {
    it('should provide progressively lower counts through stages', () => {
      const original = 15000;

      const stage1 = applyReductionLevel(original, 'STAGE_1');
      const stage2 = applyReductionLevel(original, 'STAGE_2');
      const stage3 = applyReductionLevel(original, 'STAGE_3');
      const minimum = applyReductionLevel(original, 'MINIMUM');

      expect(original).toBeGreaterThan(stage1);
      expect(stage1).toBeGreaterThan(stage2);
      expect(stage2).toBeGreaterThan(stage3);
      expect(stage3).toBeGreaterThanOrEqual(minimum);
    });

    it('should halve count at Stage 2 from original', () => {
      const original = 16000;
      const stage2 = applyReductionLevel(original, 'STAGE_2');
      expect(stage2).toBe(original / 2);
    });

    it('should reach minimum at MINIMUM level', () => {
      const original = 15000;
      const minimum = applyReductionLevel(original, 'MINIMUM');
      expect(minimum).toBe(2000); // Default minimum
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small particle counts', () => {
      expect(calculateReducedParticleCount(2500, 25)).toBe(2000);
      expect(calculateReducedParticleCount(2500, 50)).toBe(2000);
    });

    it('should handle already at minimum', () => {
      expect(calculateReducedParticleCount(2000, 25)).toBe(2000);
    });

    it('should handle large particle counts', () => {
      expect(calculateReducedParticleCount(100000, 25)).toBe(75000);
      expect(calculateReducedParticleCount(100000, 50)).toBe(50000);
    });
  });

  describe('Visual Smoothness Verification', () => {
    it('should provide reasonable step sizes for smooth transitions', () => {
      const original = 8000;

      // Stage 1: 2000 particle reduction - should be smooth
      const stage1Reduction = original - applyReductionLevel(original, 'STAGE_1');
      expect(stage1Reduction).toBe(2000);

      // Stage 2 from Stage 1: another 2000 reduction
      const stage1Count = applyReductionLevel(original, 'STAGE_1');
      const stage2Count = applyReductionLevel(original, 'STAGE_2');
      const stage2Reduction = stage1Count - stage2Count;
      expect(stage2Reduction).toBe(2000);
    });

    it('should not reduce by more than 3000 in any single step', () => {
      // For 8000 particles:
      // Stage 1: 8000 -> 6000 (2000 reduction)
      // Stage 2: 8000 -> 4000 (4000 from original, but would be 2000 from Stage 1)
      // Stage 3: 8000 -> 2000 (6000 from original, but would be 2000 from Stage 2)

      const original = 8000;
      const stages = [
        original,
        applyReductionLevel(original, 'STAGE_1'),
        applyReductionLevel(original, 'STAGE_2'),
        applyReductionLevel(original, 'STAGE_3'),
      ];

      for (let i = 1; i < stages.length; i++) {
        const reduction = stages[i - 1] - stages[i];
        expect(reduction).toBeLessThanOrEqual(3000);
      }
    });
  });
});
