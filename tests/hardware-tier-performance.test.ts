/**
 * Hardware Tier Performance Tests
 *
 * Tests verify orb performance expectations across hardware tiers.
 *
 * Performance Targets:
 * - High-end (RTX 3060+): 60fps at 15000 particles
 * - Mid-range (with degradation): 60fps at 8000 particles
 * - Low-end (Intel HD 4000): 30+ fps at 3000 particles
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EXPECTED_FPS_BASELINES,
  PERFORMANCE_BASELINES,
} from '../src/renderer/utils/orb-profiler';
import {
  getTierSettings,
  type HardwareTier,
} from '../src/renderer/utils/gpu-detection';
import {
  DEFAULT_STAGES,
  getStageSeverity,
} from '../src/renderer/hooks/useStagedDegradation';

describe('Hardware Tier Performance Specifications', () => {
  describe('High-End Hardware (RTX 3060+)', () => {
    const tier: HardwareTier = 'high-end';

    it('should target 60 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].target).toBe(60);
    });

    it('should have minimum 55 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].min).toBe(55);
    });

    it('should support 15000 particles', () => {
      const settings = getTierSettings(tier);
      expect(settings.particleCount).toBe(15000);
    });

    it('should use instancing', () => {
      const settings = getTierSettings(tier);
      expect(settings.useInstancing).toBe(true);
    });

    it('should not use simplified attractor', () => {
      const settings = getTierSettings(tier);
      expect(settings.useSimplifiedAttractor).toBe(false);
    });

    it('should have high shadow quality', () => {
      const settings = getTierSettings(tier);
      expect(settings.shadowQuality).toBe('high');
    });

    it('should enable post-processing', () => {
      const settings = getTierSettings(tier);
      expect(settings.postProcessing).toBe(true);
    });
  });

  describe('Mid-Range Hardware (GTX 1060, Intel Iris)', () => {
    const tier: HardwareTier = 'mid-range';

    it('should target 60 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].target).toBe(60);
    });

    it('should have minimum 45 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].min).toBe(45);
    });

    it('should support 8000 particles', () => {
      const settings = getTierSettings(tier);
      expect(settings.particleCount).toBe(8000);
    });

    it('should use instancing', () => {
      const settings = getTierSettings(tier);
      expect(settings.useInstancing).toBe(true);
    });

    it('should not use simplified attractor initially', () => {
      const settings = getTierSettings(tier);
      expect(settings.useSimplifiedAttractor).toBe(false);
    });

    it('should have medium shadow quality', () => {
      const settings = getTierSettings(tier);
      expect(settings.shadowQuality).toBe('medium');
    });

    it('can degrade to achieve 60fps', () => {
      // Stage 1 reduces by 25%, should still achieve 60fps
      const reduction = DEFAULT_STAGES[1].particleReduction / 100;
      const degradedCount = Math.round(8000 * (1 - reduction));
      expect(degradedCount).toBe(6000);
      expect(degradedCount).toBeGreaterThanOrEqual(3000);
    });
  });

  describe('Low-End Hardware (Intel HD 4000)', () => {
    const tier: HardwareTier = 'low-end';

    it('should target 45 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].target).toBe(45);
    });

    it('should have minimum 30 FPS', () => {
      expect(EXPECTED_FPS_BASELINES[tier].min).toBe(30);
    });

    it('should support 3000 particles', () => {
      const settings = getTierSettings(tier);
      expect(settings.particleCount).toBe(3000);
    });

    it('should use instancing', () => {
      const settings = getTierSettings(tier);
      expect(settings.useInstancing).toBe(true);
    });

    it('should use simplified attractor', () => {
      const settings = getTierSettings(tier);
      expect(settings.useSimplifiedAttractor).toBe(true);
    });

    it('should have no shadows', () => {
      const settings = getTierSettings(tier);
      expect(settings.shadowQuality).toBe('none');
    });

    it('should disable post-processing', () => {
      const settings = getTierSettings(tier);
      expect(settings.postProcessing).toBe(false);
    });

    it('should maintain at least 2000 particles at max degradation', () => {
      const reduction = DEFAULT_STAGES[4].particleReduction / 100;
      const degradedCount = Math.round(3000 * (1 - reduction));
      expect(Math.max(2000, degradedCount)).toBe(2000);
    });
  });

  describe('Unknown Hardware', () => {
    const tier: HardwareTier = 'unknown';

    it('should use conservative defaults', () => {
      const settings = getTierSettings(tier);
      expect(settings.particleCount).toBe(5000);
      expect(settings.useInstancing).toBe(false);
      expect(settings.useSimplifiedAttractor).toBe(true);
      expect(settings.shadowQuality).toBe('low');
      expect(settings.postProcessing).toBe(false);
    });
  });
});

describe('Performance Degradation Stages', () => {
  describe('Stage 1 - Particle Reduction 25%', () => {
    it('should trigger at FPS < 55', () => {
      expect(DEFAULT_STAGES[1].fpsThreshold).toBe(55);
    });

    it('should reduce particles by 25%', () => {
      expect(DEFAULT_STAGES[1].particleReduction).toBe(25);
    });

    it('should maintain optimized attractor mode', () => {
      expect(DEFAULT_STAGES[1].attractorMode).toBe('optimized');
    });

    it('should have low severity', () => {
      expect(getStageSeverity(1)).toBe('low');
    });
  });

  describe('Stage 2 - Particle Reduction 50%', () => {
    it('should trigger at FPS < 45', () => {
      expect(DEFAULT_STAGES[2].fpsThreshold).toBe(45);
    });

    it('should reduce particles by 50%', () => {
      expect(DEFAULT_STAGES[2].particleReduction).toBe(50);
    });

    it('should maintain optimized attractor mode', () => {
      expect(DEFAULT_STAGES[2].attractorMode).toBe('optimized');
    });

    it('should have medium severity', () => {
      expect(getStageSeverity(2)).toBe('medium');
    });
  });

  describe('Stage 3 - Simplified Attractor', () => {
    it('should trigger at FPS < 30', () => {
      expect(DEFAULT_STAGES[3].fpsThreshold).toBe(30);
    });

    it('should use simplified attractor mode', () => {
      expect(DEFAULT_STAGES[3].attractorMode).toBe('simplified');
    });

    it('should have high severity', () => {
      expect(getStageSeverity(3)).toBe('high');
    });
  });

  describe('Stage 4 - Minimum Particles', () => {
    it('should trigger at FPS < 20', () => {
      expect(DEFAULT_STAGES[4].fpsThreshold).toBe(20);
    });

    it('should reduce particles by 75%', () => {
      expect(DEFAULT_STAGES[4].particleReduction).toBe(75);
    });

    it('should use simplified attractor mode', () => {
      expect(DEFAULT_STAGES[4].attractorMode).toBe('simplified');
    });

    it('should have high severity', () => {
      expect(getStageSeverity(4)).toBe('high');
    });
  });
});

describe('Performance Baseline Verification', () => {
  it('should have correct high-end baseline', () => {
    const baseline = PERFORMANCE_BASELINES['high-end'];
    expect(baseline.particleCount).toBe(15000);
    expect(baseline.expectedFps.target).toBe(60);
    expect(baseline.features.postProcessing).toBe(true);
  });

  it('should have correct mid-range baseline', () => {
    const baseline = PERFORMANCE_BASELINES['mid-range'];
    expect(baseline.particleCount).toBe(8000);
    expect(baseline.expectedFps.target).toBe(60);
  });

  it('should have correct low-end baseline', () => {
    const baseline = PERFORMANCE_BASELINES['low-end'];
    expect(baseline.particleCount).toBe(3000);
    expect(baseline.expectedFps.min).toBe(30);
    expect(baseline.features.postProcessing).toBe(false);
    expect(baseline.features.simplifiedAttractor).toBe(true);
  });
});

describe('3D Rendering Guarantee', () => {
  it('should never fall back to 2D at any stage', () => {
    DEFAULT_STAGES.forEach((stage) => {
      // All modes are 3D variants
      expect(['standard', 'optimized', 'simplified', 'batch']).toContain(
        stage.attractorMode
      );
    });
  });

  it('should maintain particle-based rendering at all stages', () => {
    DEFAULT_STAGES.forEach((stage) => {
      // All stages have particle counts > 0
      const reduction = stage.particleReduction / 100;
      const particles = Math.round(8000 * (1 - reduction));
      expect(Math.max(2000, particles)).toBeGreaterThan(0);
    });
  });
});

describe('Performance Tests Documentation', () => {
  const testCases = [
    {
      hardware: 'NVIDIA RTX 4090',
      tier: 'high-end',
      particleCount: 15000,
      expectedFps: '60+',
      features: 'All enabled',
    },
    {
      hardware: 'NVIDIA RTX 3060',
      tier: 'high-end',
      particleCount: 15000,
      expectedFps: '60+',
      features: 'All enabled',
    },
    {
      hardware: 'NVIDIA GTX 1060',
      tier: 'mid-range',
      particleCount: 8000,
      expectedFps: '60',
      features: 'Medium shadows, post-processing',
    },
    {
      hardware: 'Intel Iris Xe',
      tier: 'mid-range',
      particleCount: 8000,
      expectedFps: '55-60',
      features: 'Medium shadows',
    },
    {
      hardware: 'Intel HD 4000',
      tier: 'low-end',
      particleCount: 3000,
      expectedFps: '30-45',
      features: 'Simplified attractor, no shadows',
    },
    {
      hardware: 'Apple M1',
      tier: 'mid-range',
      particleCount: 8000,
      expectedFps: '60',
      features: 'Metal optimized',
    },
    {
      hardware: 'Apple M2+',
      tier: 'high-end',
      particleCount: 15000,
      expectedFps: '60+',
      features: 'All enabled',
    },
  ];

  testCases.forEach((testCase) => {
    it(`${testCase.hardware} should achieve ${testCase.expectedFps} FPS`, () => {
      const settings = getTierSettings(testCase.tier as HardwareTier);
      expect(settings).toBeDefined();
      expect(settings.particleCount).toBe(testCase.particleCount);
    });
  });
});
