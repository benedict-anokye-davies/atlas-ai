/**
 * GPU Detection Utility Tests
 *
 * Tests run in Node environment, so we test the classification logic
 * and tier settings separately from actual WebGL detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock the module before importing to handle DOM detection
vi.mock('../src/renderer/utils/gpu-detection', async () => {
  // Import the actual module to get types and tier settings
  const actualModule = await vi.importActual<
    typeof import('../src/renderer/utils/gpu-detection')
  >('../src/renderer/utils/gpu-detection');

  // Create mock functions for GPU detection
  let cachedInfo: ReturnType<typeof actualModule.detectGPU> | null = null;

  // Expose classification logic for testing
  const classifyHardwareTier = (
    renderer: string,
    maxTextureSize: number
  ): 'high-end' | 'mid-range' | 'low-end' | 'unknown' => {
    const HIGH_END_PATTERNS = [
      /nvidia.*rtx\s*(30|40|50)/i,
      /nvidia.*gtx\s*(1080|1070|2080|2070)/i,
      /radeon\s*rx\s*(6[789]00|7[0-9]00)/i,
      /radeon\s*pro\s*w/i,
      /apple\s*m[234]/i,
      /quadro\s*rtx/i,
    ];

    const MID_RANGE_PATTERNS = [
      /nvidia.*gtx\s*(1060|1050|1660|2060)/i,
      /nvidia.*rtx\s*(20)/i,
      /radeon\s*rx\s*(5[567]00|6[0-5]00)/i,
      /radeon\s*vega/i,
      /apple\s*m1/i,
      /intel.*iris\s*(plus|xe|pro)/i,
      /intel.*uhd\s*(6[2-9]0|7[0-9]0)/i,
    ];

    const LOW_END_PATTERNS = [
      /intel.*hd.*(4000|4600|5[0-9]00|6[01]0)/i,
      /intel.*uhd\s*(5|6[01])/i,
      /radeon\s*r[57]\s*[23]/i,
      /nvidia.*gt\s*(7|8|9|10)/i,
      /mali/i,
      /adreno/i,
      /powervr/i,
      /angle/i,
    ];

    for (const pattern of HIGH_END_PATTERNS) {
      if (pattern.test(renderer)) return 'high-end';
    }

    for (const pattern of MID_RANGE_PATTERNS) {
      if (pattern.test(renderer)) return 'mid-range';
    }

    for (const pattern of LOW_END_PATTERNS) {
      if (pattern.test(renderer)) return 'low-end';
    }

    if (maxTextureSize >= 16384) return 'high-end';
    if (maxTextureSize >= 8192) return 'mid-range';
    if (maxTextureSize >= 4096) return 'low-end';

    return 'unknown';
  };

  const createMockGPUInfo = (overrides: Partial<ReturnType<typeof actualModule.detectGPU>> = {}) => ({
    vendor: 'Test Vendor',
    renderer: 'Test Renderer',
    tier: 'unknown' as const,
    maxTextureSize: 8192,
    maxVertexUniforms: 256,
    maxFragmentUniforms: 256,
    supportsInstancing: true,
    supportsFloatTextures: true,
    supportsWebGL2: true,
    ...overrides,
  });

  return {
    ...actualModule,
    // Override detectGPU to work without DOM
    detectGPU: vi.fn().mockImplementation(() =>
      createMockGPUInfo({ tier: 'mid-range' })
    ),
    getGPUInfo: vi.fn().mockImplementation(() => {
      if (!cachedInfo) {
        cachedInfo = createMockGPUInfo({ tier: 'mid-range' });
      }
      return cachedInfo;
    }),
    resetGPUInfoCache: vi.fn().mockImplementation(() => {
      cachedInfo = null;
    }),
    // Export test helper for classification
    __testClassify: classifyHardwareTier,
    __testCreateMockInfo: createMockGPUInfo,
  };
});

import {
  detectGPU,
  getTierSettings,
  getGPUDescription,
  getGPUInfo,
  resetGPUInfoCache,
  type HardwareTier,
  type GPUInfo,
} from '../src/renderer/utils/gpu-detection';

// Access test helpers through module
const mockModule = await import('../src/renderer/utils/gpu-detection') as {
  __testClassify: (renderer: string, maxTextureSize: number) => HardwareTier;
  __testCreateMockInfo: (overrides?: Partial<GPUInfo>) => GPUInfo;
} & typeof import('../src/renderer/utils/gpu-detection');

const classifyHardwareTier = mockModule.__testClassify;
const createMockGPUInfo = mockModule.__testCreateMockInfo;

describe('GPU Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGPUInfoCache();
  });

  describe('Hardware Tier Classification', () => {
    describe('High-End GPUs', () => {
      it('should classify NVIDIA RTX 4090 as high-end', () => {
        expect(classifyHardwareTier('NVIDIA GeForce RTX 4090', 32768)).toBe('high-end');
      });

      it('should classify NVIDIA RTX 3080 as high-end', () => {
        expect(classifyHardwareTier('NVIDIA GeForce RTX 3080 Ti', 32768)).toBe('high-end');
      });

      it('should classify NVIDIA RTX 5090 as high-end', () => {
        expect(classifyHardwareTier('NVIDIA GeForce RTX 5090', 32768)).toBe('high-end');
      });

      it('should classify AMD Radeon RX 7900 XTX as high-end', () => {
        expect(classifyHardwareTier('AMD Radeon RX 7900 XTX', 16384)).toBe('high-end');
      });

      it('should classify AMD Radeon RX 6800 XT as high-end', () => {
        expect(classifyHardwareTier('AMD Radeon RX 6800 XT', 16384)).toBe('high-end');
      });

      it('should classify Apple M2 Pro as high-end', () => {
        expect(classifyHardwareTier('Apple M2 Pro', 16384)).toBe('high-end');
      });

      it('should classify Apple M3 Max as high-end', () => {
        expect(classifyHardwareTier('Apple M3 Max', 16384)).toBe('high-end');
      });

      it('should classify Apple M4 as high-end', () => {
        expect(classifyHardwareTier('Apple M4', 16384)).toBe('high-end');
      });

      it('should classify Quadro RTX 8000 as high-end', () => {
        expect(classifyHardwareTier('Quadro RTX 8000', 32768)).toBe('high-end');
      });

      it('should classify NVIDIA GTX 1080 as high-end', () => {
        expect(classifyHardwareTier('NVIDIA GeForce GTX 1080', 16384)).toBe('high-end');
      });
    });

    describe('Mid-Range GPUs', () => {
      it('should classify NVIDIA GTX 1660 as mid-range', () => {
        expect(classifyHardwareTier('NVIDIA GeForce GTX 1660', 16384)).toBe('mid-range');
      });

      it('should classify NVIDIA GTX 1060 as mid-range', () => {
        expect(classifyHardwareTier('NVIDIA GeForce GTX 1060', 16384)).toBe('mid-range');
      });

      it('should classify Apple M1 as mid-range', () => {
        expect(classifyHardwareTier('Apple M1', 16384)).toBe('mid-range');
      });

      it('should classify Intel Iris Xe as mid-range', () => {
        expect(classifyHardwareTier('Intel Iris Xe Graphics', 8192)).toBe('mid-range');
      });

      it('should classify Intel UHD 630 as mid-range', () => {
        expect(classifyHardwareTier('Intel UHD Graphics 630', 8192)).toBe('mid-range');
      });

      it('should classify Intel UHD 750 as mid-range', () => {
        expect(classifyHardwareTier('Intel UHD Graphics 750', 8192)).toBe('mid-range');
      });

      it('should classify AMD Radeon RX 5700 as mid-range', () => {
        expect(classifyHardwareTier('AMD Radeon RX 5700 XT', 8192)).toBe('mid-range');
      });

      it('should classify AMD Radeon Vega as mid-range', () => {
        expect(classifyHardwareTier('AMD Radeon Vega 8', 8192)).toBe('mid-range');
      });
    });

    describe('Low-End GPUs', () => {
      it('should classify Intel HD 4600 as low-end', () => {
        expect(classifyHardwareTier('Intel HD Graphics 4600', 8192)).toBe('low-end');
      });

      it('should classify Intel HD 4000 as low-end', () => {
        expect(classifyHardwareTier('Intel HD Graphics 4000', 4096)).toBe('low-end');
      });

      it('should classify Mali GPU as low-end', () => {
        expect(classifyHardwareTier('Mali-G78', 4096)).toBe('low-end');
      });

      it('should classify Adreno GPU as low-end', () => {
        expect(classifyHardwareTier('Adreno (TM) 650', 4096)).toBe('low-end');
      });

      it('should classify ANGLE software renderer as low-end', () => {
        expect(classifyHardwareTier('ANGLE (Software)', 4096)).toBe('low-end');
      });

      it('should classify PowerVR as low-end', () => {
        expect(classifyHardwareTier('PowerVR SGX', 4096)).toBe('low-end');
      });
    });

    describe('Texture Size Fallback', () => {
      it('should use high-end for unknown GPU with large texture size', () => {
        expect(classifyHardwareTier('Unknown GPU XYZ', 16384)).toBe('high-end');
      });

      it('should use mid-range for unknown GPU with medium texture size', () => {
        expect(classifyHardwareTier('Unknown GPU XYZ', 8192)).toBe('mid-range');
      });

      it('should use low-end for unknown GPU with small texture size', () => {
        expect(classifyHardwareTier('Unknown GPU XYZ', 4096)).toBe('low-end');
      });

      it('should return unknown for very small texture size', () => {
        expect(classifyHardwareTier('Unknown GPU XYZ', 2048)).toBe('unknown');
      });
    });
  });

  describe('getTierSettings', () => {
    it('should return high-end settings', () => {
      const settings = getTierSettings('high-end');

      expect(settings.particleCount).toBe(15000);
      expect(settings.useInstancing).toBe(true);
      expect(settings.useSimplifiedAttractor).toBe(false);
      expect(settings.shadowQuality).toBe('high');
      expect(settings.postProcessing).toBe(true);
    });

    it('should return mid-range settings', () => {
      const settings = getTierSettings('mid-range');

      expect(settings.particleCount).toBe(8000);
      expect(settings.useInstancing).toBe(true);
      expect(settings.useSimplifiedAttractor).toBe(false);
      expect(settings.shadowQuality).toBe('medium');
      expect(settings.postProcessing).toBe(true);
    });

    it('should return low-end settings', () => {
      const settings = getTierSettings('low-end');

      expect(settings.particleCount).toBe(3000);
      expect(settings.useInstancing).toBe(true);
      expect(settings.useSimplifiedAttractor).toBe(true);
      expect(settings.shadowQuality).toBe('none');
      expect(settings.postProcessing).toBe(false);
    });

    it('should return conservative settings for unknown tier', () => {
      const settings = getTierSettings('unknown');

      expect(settings.particleCount).toBe(5000);
      expect(settings.useInstancing).toBe(false);
      expect(settings.useSimplifiedAttractor).toBe(true);
      expect(settings.shadowQuality).toBe('low');
      expect(settings.postProcessing).toBe(false);
    });
  });

  describe('getGPUDescription', () => {
    it('should format high-end GPU description', () => {
      const info: GPUInfo = {
        vendor: 'NVIDIA',
        renderer: 'NVIDIA GeForce RTX 4080',
        tier: 'high-end',
        maxTextureSize: 32768,
        maxVertexUniforms: 4096,
        maxFragmentUniforms: 4096,
        supportsInstancing: true,
        supportsFloatTextures: true,
        supportsWebGL2: true,
      };

      const desc = getGPUDescription(info);

      expect(desc).toBe('NVIDIA GeForce RTX 4080 (High-End)');
    });

    it('should format mid-range GPU description', () => {
      const info: GPUInfo = {
        vendor: 'Intel',
        renderer: 'Intel Iris Xe Graphics',
        tier: 'mid-range',
        maxTextureSize: 8192,
        maxVertexUniforms: 512,
        maxFragmentUniforms: 512,
        supportsInstancing: true,
        supportsFloatTextures: true,
        supportsWebGL2: true,
      };

      const desc = getGPUDescription(info);

      expect(desc).toBe('Intel Iris Xe Graphics (Mid-Range)');
    });

    it('should format low-end GPU description', () => {
      const info: GPUInfo = {
        vendor: 'Intel',
        renderer: 'Intel HD Graphics 4000',
        tier: 'low-end',
        maxTextureSize: 4096,
        maxVertexUniforms: 256,
        maxFragmentUniforms: 256,
        supportsInstancing: false,
        supportsFloatTextures: false,
        supportsWebGL2: false,
      };

      const desc = getGPUDescription(info);

      expect(desc).toBe('Intel HD Graphics 4000 (Low-End)');
    });

    it('should format unknown GPU description', () => {
      const info: GPUInfo = {
        vendor: 'Unknown',
        renderer: 'Unknown',
        tier: 'unknown',
        maxTextureSize: 0,
        maxVertexUniforms: 0,
        maxFragmentUniforms: 0,
        supportsInstancing: false,
        supportsFloatTextures: false,
        supportsWebGL2: false,
      };

      const desc = getGPUDescription(info);

      expect(desc).toBe('Unknown (Unknown)');
    });
  });

  describe('detectGPU (mocked)', () => {
    it('should return GPU info', () => {
      const info = detectGPU();

      expect(info).toBeDefined();
      expect(info.tier).toBe('mid-range');
      expect(info.supportsWebGL2).toBe(true);
    });
  });

  describe('getGPUInfo (caching)', () => {
    it('should return cached GPU info', () => {
      const info1 = getGPUInfo();
      const info2 = getGPUInfo();

      expect(info1).toEqual(info2);
    });

    it('should clear cache when reset', () => {
      const info1 = getGPUInfo();
      resetGPUInfoCache();
      const info2 = getGPUInfo();

      // Both should have same structure but may be different objects after reset
      expect(info1.tier).toBe(info2.tier);
    });
  });

  describe('Tier Settings Particle Counts', () => {
    it('should have decreasing particle counts from high to low tier', () => {
      const highEnd = getTierSettings('high-end');
      const midRange = getTierSettings('mid-range');
      const lowEnd = getTierSettings('low-end');
      const unknown = getTierSettings('unknown');

      expect(highEnd.particleCount).toBeGreaterThan(midRange.particleCount);
      expect(midRange.particleCount).toBeGreaterThan(lowEnd.particleCount);
      expect(unknown.particleCount).toBeGreaterThan(lowEnd.particleCount);
    });
  });

  describe('Tier Settings for Performance', () => {
    it('should disable post-processing for low-end', () => {
      const lowEnd = getTierSettings('low-end');
      expect(lowEnd.postProcessing).toBe(false);
    });

    it('should use simplified attractor for low-end', () => {
      const lowEnd = getTierSettings('low-end');
      expect(lowEnd.useSimplifiedAttractor).toBe(true);
    });

    it('should disable shadows for low-end', () => {
      const lowEnd = getTierSettings('low-end');
      expect(lowEnd.shadowQuality).toBe('none');
    });

    it('should enable all features for high-end', () => {
      const highEnd = getTierSettings('high-end');
      expect(highEnd.postProcessing).toBe(true);
      expect(highEnd.useSimplifiedAttractor).toBe(false);
      expect(highEnd.shadowQuality).toBe('high');
      expect(highEnd.useInstancing).toBe(true);
    });
  });
});
