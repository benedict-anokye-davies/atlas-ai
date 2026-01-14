/**
 * Nova Desktop - Attractor Math Tests
 * Tests for strange attractor mathematical functions
 */

import { describe, it, expect } from 'vitest';
import {
  aizawa,
  lorenz,
  thomas,
  halvorsen,
  ATTRACTOR_SETTINGS,
  STATE_COLORS,
  type AttractorFunction,
  type AttractorSettings,
  type StateColors,
  // Optimized functions
  thomasOptimized,
  getOptimizedAttractor,
  // Simplified functions
  lorenzSimplified,
  circularSimplified,
  getSimplifiedAttractor,
  // Batch operations
  batchUpdateLorenz,
  batchUpdateAizawa,
  batchUpdateAttractor,
  // Utilities
  hasComputeShaderSupport,
  getAttractorByMode,
  getAttractor,
} from '../src/renderer/components/orb/attractors';

describe('Strange Attractors', () => {
  describe('Aizawa Attractor', () => {
    it('should return an array of 3 numbers', () => {
      const result = aizawa(1, 0, 0);
      expect(result).toHaveLength(3);
      expect(typeof result[0]).toBe('number');
      expect(typeof result[1]).toBe('number');
      expect(typeof result[2]).toBe('number');
    });

    it('should produce finite values for typical inputs', () => {
      const result = aizawa(0.5, 0.5, 0.5);
      expect(Number.isFinite(result[0])).toBe(true);
      expect(Number.isFinite(result[1])).toBe(true);
      expect(Number.isFinite(result[2])).toBe(true);
    });

    it('should produce different outputs for different inputs', () => {
      const result1 = aizawa(0, 0, 0);
      const result2 = aizawa(1, 1, 1);
      expect(result1).not.toEqual(result2);
    });

    it('should handle zero inputs', () => {
      const result = aizawa(0, 0, 0);
      expect(result).toHaveLength(3);
      expect(Number.isFinite(result[0])).toBe(true);
      expect(Number.isFinite(result[1])).toBe(true);
      expect(Number.isFinite(result[2])).toBe(true);
    });

    it('should be deterministic', () => {
      const input: [number, number, number] = [0.3, -0.2, 0.8];
      const result1 = aizawa(...input);
      const result2 = aizawa(...input);
      expect(result1).toEqual(result2);
    });
  });

  describe('Lorenz Attractor', () => {
    it('should return an array of 3 numbers', () => {
      const result = lorenz(1, 1, 1);
      expect(result).toHaveLength(3);
      expect(typeof result[0]).toBe('number');
      expect(typeof result[1]).toBe('number');
      expect(typeof result[2]).toBe('number');
    });

    it('should produce the classic Lorenz behavior', () => {
      // At origin, x and y derivatives should be related
      const result = lorenz(1, 0, 25);
      // dx = sigma * (y - x) = 10 * (0 - 1) = -10
      expect(result[0]).toBeCloseTo(-10, 5);
    });

    it('should handle typical chaotic regime inputs', () => {
      const result = lorenz(-10, -10, 30);
      expect(Number.isFinite(result[0])).toBe(true);
      expect(Number.isFinite(result[1])).toBe(true);
      expect(Number.isFinite(result[2])).toBe(true);
    });
  });

  describe('Thomas Attractor', () => {
    it('should return an array of 3 numbers', () => {
      const result = thomas(0, 0, 0);
      expect(result).toHaveLength(3);
    });

    it('should use sine functions', () => {
      // dx = sin(y) - b*x
      // At (0, pi/2, 0): dx = sin(pi/2) - 0 = 1
      const result = thomas(0, Math.PI / 2, 0);
      expect(result[0]).toBeCloseTo(1, 5);
    });

    it('should be bounded due to sine functions', () => {
      // The derivatives are bounded by 1 + b*|coord|
      const result = thomas(100, 100, 100);
      expect(Math.abs(result[0])).toBeLessThan(25); // sin(100) - 0.208 * 100
      expect(Math.abs(result[1])).toBeLessThan(25);
      expect(Math.abs(result[2])).toBeLessThan(25);
    });
  });

  describe('Halvorsen Attractor', () => {
    it('should return an array of 3 numbers', () => {
      const result = halvorsen(1, 2, 3);
      expect(result).toHaveLength(3);
    });

    it('should produce nonzero values for nonzero inputs', () => {
      const result = halvorsen(1, 1, 1);
      expect(result.some((v) => v !== 0)).toBe(true);
    });

    it('should include quadratic terms', () => {
      // dx = -a*x - 4*y - 4*z - y^2
      // At (0, 2, 0): dx = 0 - 8 - 0 - 4 = -12
      const result = halvorsen(0, 2, 0);
      expect(result[0]).toBeCloseTo(-12, 5);
    });
  });

  describe('Attractor Type Conformance', () => {
    const attractors: Record<string, AttractorFunction> = {
      aizawa,
      lorenz,
      thomas,
      halvorsen,
    };

    Object.entries(attractors).forEach(([name, fn]) => {
      it(`${name} should conform to AttractorFunction type`, () => {
        expect(typeof fn).toBe('function');
        const result = fn(0, 0, 0);
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(3);
      });
    });
  });
});

describe('Attractor Settings', () => {
  const requiredSettings: Array<keyof AttractorSettings> = [
    'scale',
    'dt',
    'camDistance',
    'offset',
    'baseHue',
    'hueRange',
  ];

  const attractorNames = ['aizawa', 'lorenz', 'thomas', 'halvorsen'];

  attractorNames.forEach((name) => {
    describe(`${name} settings`, () => {
      it('should have all required properties', () => {
        const settings = ATTRACTOR_SETTINGS[name];
        expect(settings).toBeDefined();
        requiredSettings.forEach((prop) => {
          expect(settings).toHaveProperty(prop);
        });
      });

      it('should have positive scale', () => {
        expect(ATTRACTOR_SETTINGS[name].scale).toBeGreaterThan(0);
      });

      it('should have positive dt (time step)', () => {
        expect(ATTRACTOR_SETTINGS[name].dt).toBeGreaterThan(0);
        expect(ATTRACTOR_SETTINGS[name].dt).toBeLessThan(1); // Should be small
      });

      it('should have positive camera distance', () => {
        expect(ATTRACTOR_SETTINGS[name].camDistance).toBeGreaterThan(0);
      });

      it('should have 3D offset array', () => {
        const offset = ATTRACTOR_SETTINGS[name].offset;
        expect(Array.isArray(offset)).toBe(true);
        expect(offset).toHaveLength(3);
      });

      it('should have hue in valid range [0, 1]', () => {
        const hue = ATTRACTOR_SETTINGS[name].baseHue;
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(1);
      });

      it('should have hueRange in valid range', () => {
        const range = ATTRACTOR_SETTINGS[name].hueRange;
        expect(range).toBeGreaterThanOrEqual(0);
        expect(range).toBeLessThanOrEqual(0.5);
      });
    });
  });
});

describe('State Colors', () => {
  const requiredColorProps: Array<keyof StateColors> = [
    'hue',
    'saturation',
    'lightness',
    'hueRange',
  ];

  const stateNames = ['idle', 'listening', 'thinking', 'speaking', 'error'];

  stateNames.forEach((state) => {
    describe(`${state} color`, () => {
      it('should have all required properties', () => {
        const color = STATE_COLORS[state];
        expect(color).toBeDefined();
        requiredColorProps.forEach((prop) => {
          expect(color).toHaveProperty(prop);
        });
      });

      it('should have hue in valid range [0, 1]', () => {
        const hue = STATE_COLORS[state].hue;
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(1);
      });

      it('should have saturation in valid range [0, 1]', () => {
        const sat = STATE_COLORS[state].saturation;
        expect(sat).toBeGreaterThanOrEqual(0);
        expect(sat).toBeLessThanOrEqual(1);
      });

      it('should have lightness in valid range [0, 1]', () => {
        const light = STATE_COLORS[state].lightness;
        expect(light).toBeGreaterThanOrEqual(0);
        expect(light).toBeLessThanOrEqual(1);
      });

      it('should have hueRange in valid range', () => {
        const range = STATE_COLORS[state].hueRange;
        expect(range).toBeGreaterThanOrEqual(0);
        expect(range).toBeLessThanOrEqual(0.5);
      });
    });
  });

  it('should have distinct hues for different states', () => {
    const hues = stateNames.map((state) => STATE_COLORS[state].hue);
    const uniqueHues = new Set(hues);
    expect(uniqueHues.size).toBe(stateNames.length);
  });

  it('should have error state with red hue (near 0 or 1)', () => {
    const errorHue = STATE_COLORS.error.hue;
    // Red is at hue 0 (or 1)
    expect(errorHue).toBeLessThan(0.1);
  });

  it('should have high saturation for active states', () => {
    expect(STATE_COLORS.listening.saturation).toBeGreaterThan(0.7);
    expect(STATE_COLORS.thinking.saturation).toBeGreaterThan(0.7);
    expect(STATE_COLORS.speaking.saturation).toBeGreaterThan(0.7);
  });
});

describe('Attractor Evolution', () => {
  it('should evolve particles along aizawa attractor without divergence', () => {
    let x = 0.1,
      y = 0.1,
      z = 0.1;
    const dt = ATTRACTOR_SETTINGS.aizawa.dt;

    // Evolve for 1000 steps
    for (let i = 0; i < 1000; i++) {
      const [dx, dy, dz] = aizawa(x, y, z);
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;

      // Check for divergence
      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeLessThan(100);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
    }
  });

  it('should evolve particles along lorenz attractor', () => {
    let x = 1,
      y = 1,
      z = 1;
    const dt = ATTRACTOR_SETTINGS.lorenz.dt;

    for (let i = 0; i < 1000; i++) {
      const [dx, dy, dz] = lorenz(x, y, z);
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;

      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeLessThan(200);
      expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('should evolve particles along thomas attractor', () => {
    let x = 1,
      y = 1,
      z = 1;
    const dt = ATTRACTOR_SETTINGS.thomas.dt;

    for (let i = 0; i < 1000; i++) {
      const [dx, dy, dz] = thomas(x, y, z);
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;

      // Thomas attractor is bounded
      expect(Math.abs(x)).toBeLessThan(10);
      expect(Math.abs(y)).toBeLessThan(10);
      expect(Math.abs(z)).toBeLessThan(10);
    }
  });
});

describe('Optimized Attractors', () => {
  describe('thomasOptimized', () => {
    it('should produce similar results to standard thomas', () => {
      const x = 1, y = 0.5, z = -0.5;
      const standard = thomas(x, y, z);
      const optimized = thomasOptimized(x, y, z);
      // Should be close (LUT precision)
      expect(optimized[0]).toBeCloseTo(standard[0], 2);
      expect(optimized[1]).toBeCloseTo(standard[1], 2);
      expect(optimized[2]).toBeCloseTo(standard[2], 2);
    });
  });

  describe('getOptimizedAttractor', () => {
    it('should return optimized thomas', () => {
      expect(getOptimizedAttractor('thomas')).toBe(thomasOptimized);
    });

    it('should return standard for other attractors', () => {
      expect(getOptimizedAttractor('lorenz')).toBe(lorenz);
      expect(getOptimizedAttractor('aizawa')).toBe(aizawa);
    });
  });
});

describe('Simplified Attractors', () => {
  describe('lorenzSimplified', () => {
    it('should produce same x derivative as standard', () => {
      const result = lorenzSimplified(1, 1, 1);
      const standard = lorenz(1, 1, 1);
      expect(result[0]).toBe(standard[0]);
    });
  });

  describe('circularSimplified', () => {
    it('should produce circular motion', () => {
      const result = circularSimplified(1, 0, 0);
      expect(result[1]).toBeGreaterThan(0);
      expect(result[0]).toBeCloseTo(0, 10);
    });
  });

  describe('getSimplifiedAttractor', () => {
    it('should map lorenz to lorenzSimplified', () => {
      expect(getSimplifiedAttractor('lorenz')).toBe(lorenzSimplified);
    });

    it('should map halvorsen to circularSimplified', () => {
      expect(getSimplifiedAttractor('halvorsen')).toBe(circularSimplified);
    });
  });
});

describe('Batch Operations', () => {
  describe('batchUpdateLorenz', () => {
    it('should update all positions', () => {
      const positions = new Float32Array([1, 0, 0, 0, 1, 0]);
      const original = new Float32Array(positions);
      batchUpdateLorenz(positions, 0.01, 1);
      expect(positions[0]).not.toBe(original[0]);
      expect(positions[3]).not.toBe(original[3]);
    });
  });

  describe('batchUpdateAizawa', () => {
    it('should update positions', () => {
      const positions = new Float32Array([0.5, 0.5, 0.5]);
      const original = positions[0];
      batchUpdateAizawa(positions, 0.01, 1);
      expect(positions[0]).not.toBe(original);
    });
  });

  describe('batchUpdateAttractor', () => {
    it('should dispatch correctly', () => {
      const positions = new Float32Array([1, 1, 1]);
      expect(() => batchUpdateAttractor(positions, 'lorenz', 0.01, 1)).not.toThrow();
      expect(() => batchUpdateAttractor(positions, 'thomas', 0.01, 1)).not.toThrow();
    });
  });
});

describe('Utility Functions', () => {
  describe('hasComputeShaderSupport', () => {
    it('should return false', () => {
      expect(hasComputeShaderSupport()).toBe(false);
    });
  });

  describe('getAttractorByMode', () => {
    it('should return standard for standard mode', () => {
      expect(getAttractorByMode('lorenz', 'standard')).toBe(lorenz);
    });

    it('should return optimized for optimized mode', () => {
      expect(getAttractorByMode('thomas', 'optimized')).toBe(thomasOptimized);
    });

    it('should return simplified for simplified mode', () => {
      expect(getAttractorByMode('lorenz', 'simplified')).toBe(lorenzSimplified);
    });
  });

  describe('getAttractor', () => {
    it('should return correct attractor', () => {
      expect(getAttractor('lorenz')).toBe(lorenz);
      expect(getAttractor('aizawa')).toBe(aizawa);
    });

    it('should default to lorenz', () => {
      expect(getAttractor('unknown')).toBe(lorenz);
    });
  });
});

describe('Performance', () => {
  it('should handle batch updates efficiently', () => {
    const positions = new Float32Array(10000 * 3);
    for (let i = 0; i < positions.length; i++) {
      positions[i] = Math.random() * 2 - 1;
    }
    const start = performance.now();
    batchUpdateLorenz(positions, 0.01, 1);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
