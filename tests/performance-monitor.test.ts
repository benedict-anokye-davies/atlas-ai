/**
 * Performance Monitor Hook Tests
 *
 * Tests for FPS monitoring utilities used by the orb visualization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the hook's DOM dependencies
vi.mock('react', () => ({
  useEffect: vi.fn(),
  useRef: vi.fn((val) => ({ current: val })),
  useState: vi.fn((val) => [val, vi.fn()]),
  useCallback: vi.fn((fn) => fn),
}));

// Import the utility functions (not the hook itself since it needs React)
import {
  getPerformanceRating,
  getSuggestedParticleCount,
} from '../src/renderer/hooks/usePerformanceMonitor';

describe('Performance Monitor Utilities', () => {
  describe('getPerformanceRating', () => {
    describe('excellent rating (55+ FPS)', () => {
      it('should return excellent for 60 FPS', () => {
        expect(getPerformanceRating(60)).toBe('excellent');
      });

      it('should return excellent for 55 FPS', () => {
        expect(getPerformanceRating(55)).toBe('excellent');
      });

      it('should return excellent for 120 FPS', () => {
        expect(getPerformanceRating(120)).toBe('excellent');
      });
    });

    describe('good rating (45-54 FPS)', () => {
      it('should return good for 54 FPS', () => {
        expect(getPerformanceRating(54)).toBe('good');
      });

      it('should return good for 50 FPS', () => {
        expect(getPerformanceRating(50)).toBe('good');
      });

      it('should return good for 45 FPS', () => {
        expect(getPerformanceRating(45)).toBe('good');
      });
    });

    describe('fair rating (30-44 FPS)', () => {
      it('should return fair for 44 FPS', () => {
        expect(getPerformanceRating(44)).toBe('fair');
      });

      it('should return fair for 35 FPS', () => {
        expect(getPerformanceRating(35)).toBe('fair');
      });

      it('should return fair for 30 FPS', () => {
        expect(getPerformanceRating(30)).toBe('fair');
      });
    });

    describe('poor rating (<30 FPS)', () => {
      it('should return poor for 29 FPS', () => {
        expect(getPerformanceRating(29)).toBe('poor');
      });

      it('should return poor for 15 FPS', () => {
        expect(getPerformanceRating(15)).toBe('poor');
      });

      it('should return poor for 0 FPS', () => {
        expect(getPerformanceRating(0)).toBe('poor');
      });
    });
  });

  describe('getSuggestedParticleCount', () => {
    describe('excellent performance', () => {
      it('should increase particles by 500 when FPS is excellent', () => {
        const current = 8000;
        const suggested = getSuggestedParticleCount(60, current);
        expect(suggested).toBe(8500);
      });

      it('should cap at 15000 particles', () => {
        const current = 14800;
        const suggested = getSuggestedParticleCount(60, current);
        expect(suggested).toBe(15000);
      });

      it('should not exceed 15000 even when far below', () => {
        const suggested = getSuggestedParticleCount(60, 14700);
        expect(suggested).toBe(15000);
      });
    });

    describe('good performance', () => {
      it('should maintain current count when FPS is good', () => {
        const current = 8000;
        const suggested = getSuggestedParticleCount(50, current);
        expect(suggested).toBe(8000);
      });

      it('should maintain low count when FPS is good', () => {
        const current = 3000;
        const suggested = getSuggestedParticleCount(45, current);
        expect(suggested).toBe(3000);
      });
    });

    describe('fair performance', () => {
      it('should reduce particles by 1000 when FPS is fair', () => {
        const current = 8000;
        const suggested = getSuggestedParticleCount(35, current);
        expect(suggested).toBe(7000);
      });

      it('should not go below 3000 particles', () => {
        const current = 3500;
        const suggested = getSuggestedParticleCount(30, current);
        expect(suggested).toBe(3000);
      });
    });

    describe('poor performance', () => {
      it('should reduce particles by 2000 when FPS is poor', () => {
        const current = 8000;
        const suggested = getSuggestedParticleCount(20, current);
        expect(suggested).toBe(6000);
      });

      it('should not go below 2000 particles', () => {
        const current = 3000;
        const suggested = getSuggestedParticleCount(15, current);
        expect(suggested).toBe(2000);
      });

      it('should clamp at minimum when performance is very poor', () => {
        const suggested = getSuggestedParticleCount(5, 2500);
        expect(suggested).toBe(2000);
      });
    });

    describe('edge cases', () => {
      it('should handle boundary FPS values correctly', () => {
        // Exactly at boundary between excellent and good
        expect(getSuggestedParticleCount(55, 5000)).toBe(5500); // excellent
        expect(getSuggestedParticleCount(54, 5000)).toBe(5000); // good

        // Exactly at boundary between good and fair
        expect(getSuggestedParticleCount(45, 5000)).toBe(5000); // good
        expect(getSuggestedParticleCount(44, 5000)).toBe(4000); // fair

        // Exactly at boundary between fair and poor
        expect(getSuggestedParticleCount(30, 5000)).toBe(4000); // fair
        expect(getSuggestedParticleCount(29, 5000)).toBe(3000); // poor
      });
    });
  });

  describe('Performance Rating to Particle Count Consistency', () => {
    it('should follow a logical progression from poor to excellent', () => {
      const startCount = 8000;

      // Simulate degradation
      let count = startCount;
      count = getSuggestedParticleCount(25, count); // poor
      expect(count).toBeLessThan(startCount);

      const afterPoor = count;
      count = getSuggestedParticleCount(35, count); // fair
      expect(count).toBeLessThan(afterPoor);

      // Simulate improvement
      count = getSuggestedParticleCount(50, count); // good - maintains
      const goodCount = count;

      count = getSuggestedParticleCount(60, count); // excellent - increases
      expect(count).toBeGreaterThan(goodCount);
    });
  });

  describe('Performance Targets', () => {
    it('should target 60 FPS as excellent', () => {
      expect(getPerformanceRating(60)).toBe('excellent');
    });

    it('should consider 30 FPS as minimum acceptable', () => {
      expect(getPerformanceRating(30)).toBe('fair');
      expect(getPerformanceRating(29)).toBe('poor');
    });
  });
});
