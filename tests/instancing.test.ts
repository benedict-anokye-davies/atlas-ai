/**
 * Instanced Rendering Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Float32ArrayPool,
  arrayPool,
  interpolatePositions,
  easeInOutCubic,
  PARTICLE_COUNT_TIERS,
  getParticleRenderSettings,
} from '../src/renderer/components/orb/instancing';

describe('Float32ArrayPool', () => {
  let pool: Float32ArrayPool;

  beforeEach(() => {
    pool = new Float32ArrayPool();
  });

  afterEach(() => {
    pool.clear();
  });

  describe('borrow', () => {
    it('should return a Float32Array of the requested size', () => {
      const arr = pool.borrow(100);
      expect(arr).toBeInstanceOf(Float32Array);
      expect(arr.length).toBe(100);
    });

    it('should return different arrays for different sizes', () => {
      const arr1 = pool.borrow(100);
      const arr2 = pool.borrow(200);
      expect(arr1.length).toBe(100);
      expect(arr2.length).toBe(200);
    });

    it('should return new arrays when pool is empty', () => {
      const arr1 = pool.borrow(100);
      const arr2 = pool.borrow(100);
      expect(arr1).not.toBe(arr2);
    });
  });

  describe('return', () => {
    it('should allow reuse of returned arrays', () => {
      const arr1 = pool.borrow(100);
      arr1[0] = 42;
      pool.return(arr1);

      const arr2 = pool.borrow(100);
      expect(arr2).toBe(arr1);
      expect(arr2[0]).toBe(0); // Should be zeroed
    });

    it('should zero out returned arrays', () => {
      const arr = pool.borrow(10);
      arr.fill(99);
      pool.return(arr);

      const borrowed = pool.borrow(10);
      expect(borrowed.every((v) => v === 0)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should track borrowed arrays', () => {
      pool.borrow(100);
      pool.borrow(200);
      const stats = pool.getStats();
      expect(stats.borrowedCount).toBe(2);
    });

    it('should track pooled arrays', () => {
      const arr = pool.borrow(100);
      pool.return(arr);
      const stats = pool.getStats();
      expect(stats.pooledCount).toBe(1);
    });

    it('should track pool sizes', () => {
      pool.borrow(100);
      pool.borrow(200);
      const stats = pool.getStats();
      expect(stats.poolSizes).toContain(100);
      expect(stats.poolSizes).toContain(200);
    });
  });

  describe('clear', () => {
    it('should clear all pools', () => {
      pool.borrow(100);
      pool.borrow(200);
      pool.clear();
      const stats = pool.getStats();
      expect(stats.borrowedCount).toBe(0);
      expect(stats.pooledCount).toBe(0);
    });
  });
});

describe('Global arrayPool', () => {
  it('should be a Float32ArrayPool instance', () => {
    expect(arrayPool).toBeInstanceOf(Float32ArrayPool);
  });

  it('should work for borrowing', () => {
    const arr = arrayPool.borrow(50);
    expect(arr.length).toBe(50);
    arrayPool.return(arr);
  });
});

describe('interpolatePositions', () => {
  it('should interpolate at t=0 to source', () => {
    const source = new Float32Array([0, 0, 0]);
    const target = new Float32Array([10, 10, 10]);
    const result = new Float32Array(3);

    interpolatePositions(source, target, result, 0);

    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('should interpolate at t=1 to target', () => {
    const source = new Float32Array([0, 0, 0]);
    const target = new Float32Array([10, 10, 10]);
    const result = new Float32Array(3);

    interpolatePositions(source, target, result, 1);

    expect(result[0]).toBe(10);
    expect(result[1]).toBe(10);
    expect(result[2]).toBe(10);
  });

  it('should interpolate at t=0.5 to midpoint', () => {
    const source = new Float32Array([0, 0, 0]);
    const target = new Float32Array([10, 10, 10]);
    const result = new Float32Array(3);

    interpolatePositions(source, target, result, 0.5);

    expect(result[0]).toBe(5);
    expect(result[1]).toBe(5);
    expect(result[2]).toBe(5);
  });

  it('should handle different values per component', () => {
    const source = new Float32Array([0, 10, 20]);
    const target = new Float32Array([100, 50, 0]);
    const result = new Float32Array(3);

    interpolatePositions(source, target, result, 0.25);

    expect(result[0]).toBe(25);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(15);
  });

  it('should handle large arrays efficiently', () => {
    const size = 30000; // 10000 particles * 3 components
    const source = new Float32Array(size).fill(0);
    const target = new Float32Array(size).fill(100);
    const result = new Float32Array(size);

    const start = performance.now();
    interpolatePositions(source, target, result, 0.5);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10); // Should be very fast
    expect(result[0]).toBe(50);
    expect(result[size - 1]).toBe(50);
  });
});

describe('easeInOutCubic', () => {
  it('should return 0 at t=0', () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  it('should return 1 at t=1', () => {
    expect(easeInOutCubic(1)).toBe(1);
  });

  it('should return 0.5 at t=0.5', () => {
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it('should ease in slowly at start', () => {
    const early = easeInOutCubic(0.1);
    const linear = 0.1;
    expect(early).toBeLessThan(linear);
  });

  it('should ease out slowly at end', () => {
    const late = easeInOutCubic(0.9);
    const linear = 0.9;
    expect(late).toBeGreaterThan(linear);
  });

  it('should be symmetric around 0.5', () => {
    const early = easeInOutCubic(0.25);
    const late = easeInOutCubic(0.75);
    expect(early + late).toBeCloseTo(1, 10);
  });
});

describe('PARTICLE_COUNT_TIERS', () => {
  it('should have increasing tier values', () => {
    expect(PARTICLE_COUNT_TIERS.minimal).toBeLessThan(PARTICLE_COUNT_TIERS.low);
    expect(PARTICLE_COUNT_TIERS.low).toBeLessThan(PARTICLE_COUNT_TIERS.medium);
    expect(PARTICLE_COUNT_TIERS.medium).toBeLessThan(PARTICLE_COUNT_TIERS.high);
    expect(PARTICLE_COUNT_TIERS.high).toBeLessThan(PARTICLE_COUNT_TIERS.ultra);
    expect(PARTICLE_COUNT_TIERS.ultra).toBeLessThan(PARTICLE_COUNT_TIERS.maximum);
  });

  it('should have expected minimum values', () => {
    expect(PARTICLE_COUNT_TIERS.minimal).toBe(2000);
    expect(PARTICLE_COUNT_TIERS.maximum).toBe(20000);
  });
});

describe('getParticleRenderSettings', () => {
  it('should return simple settings for low counts', () => {
    const settings = getParticleRenderSettings(2000);
    expect(settings.useInstancing).toBe(false);
    expect(settings.batchUpdates).toBe(false);
    expect(settings.updateFrequency).toBe(60);
  });

  it('should enable instancing for medium counts', () => {
    const settings = getParticleRenderSettings(4000);
    expect(settings.useInstancing).toBe(true);
  });

  it('should enable batch updates for high counts', () => {
    const settings = getParticleRenderSettings(8000);
    expect(settings.useInstancing).toBe(true);
    expect(settings.batchUpdates).toBe(true);
  });

  it('should reduce update frequency for ultra counts', () => {
    const settings = getParticleRenderSettings(15000);
    expect(settings.updateFrequency).toBe(30);
  });

  it('should handle edge cases at tier boundaries', () => {
    // At exactly the low threshold
    const atLow = getParticleRenderSettings(PARTICLE_COUNT_TIERS.low);
    expect(atLow.useInstancing).toBe(false);

    // Just above low threshold
    const aboveLow = getParticleRenderSettings(PARTICLE_COUNT_TIERS.low + 1);
    expect(aboveLow.useInstancing).toBe(true);
  });
});

describe('Object Pooling Benefits', () => {
  it('should reduce allocations when reusing arrays', () => {
    const pool = new Float32ArrayPool();
    const allocations: Float32Array[] = [];

    // First pass: borrow and return
    for (let i = 0; i < 10; i++) {
      const arr = pool.borrow(1000);
      pool.return(arr);
    }

    // Second pass: should reuse same array
    for (let i = 0; i < 10; i++) {
      const arr = pool.borrow(1000);
      allocations.push(arr);
      pool.return(arr);
    }

    // All should be the same array (reused)
    const unique = new Set(allocations);
    expect(unique.size).toBe(1);

    pool.clear();
  });

  it('should handle mixed sizes efficiently', () => {
    const pool = new Float32ArrayPool();

    // Borrow various sizes
    const sizes = [100, 200, 300, 100, 200, 100];
    const arrays = sizes.map((s) => pool.borrow(s));

    // Return all
    arrays.forEach((arr) => pool.return(arr));

    const stats = pool.getStats();
    expect(stats.pooledCount).toBe(6);
    expect(stats.borrowedCount).toBe(0);

    pool.clear();
  });
});
