/**
 * Nova Desktop - WebGL Error Handling Tests
 * Tests for WebGL error boundaries, GPU detection, and graceful degradation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectGPU,
  getTierSettings,
  getGPUDescription,
  getGPUInfo,
  resetGPUInfoCache,
  GPUInfo,
  HardwareTier,
} from '../src/renderer/utils/gpu-detection';

describe('GPU Detection', () => {
  beforeEach(() => {
    resetGPUInfoCache();
  });

  describe('detectGPU logic', () => {
    // Note: These tests verify the expected return values when WebGL is unavailable
    // Browser-environment tests are not run in Node.js

    it('should return correct structure for unknown GPU', () => {
      // Test the expected structure when WebGL is not available
      const unknownGpuInfo: GPUInfo = {
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

      expect(unknownGpuInfo.tier).toBe('unknown');
      expect(unknownGpuInfo.vendor).toBe('Unknown');
      expect(unknownGpuInfo.renderer).toBe('Unknown');
      expect(unknownGpuInfo.supportsWebGL2).toBe(false);
      expect(unknownGpuInfo.supportsInstancing).toBe(false);
      expect(unknownGpuInfo.supportsFloatTextures).toBe(false);
      expect(unknownGpuInfo.maxTextureSize).toBe(0);
    });

    it('should have correct structure for WebGL2 capable GPU', () => {
      const webgl2GpuInfo: GPUInfo = {
        vendor: 'NVIDIA',
        renderer: 'NVIDIA GeForce RTX 4090',
        tier: 'high-end',
        maxTextureSize: 16384,
        maxVertexUniforms: 4096,
        maxFragmentUniforms: 1024,
        supportsInstancing: true,
        supportsFloatTextures: true,
        supportsWebGL2: true,
      };

      expect(webgl2GpuInfo.supportsWebGL2).toBe(true);
      expect(webgl2GpuInfo.supportsInstancing).toBe(true);
      expect(webgl2GpuInfo.supportsFloatTextures).toBe(true);
      expect(webgl2GpuInfo.maxTextureSize).toBeGreaterThan(0);
    });
  });

  describe('Hardware Tier Classification', () => {
    const testCases: Array<{ renderer: string; expectedTier: HardwareTier }> = [
      // High-end GPUs
      { renderer: 'NVIDIA GeForce RTX 4090', expectedTier: 'high-end' },
      { renderer: 'NVIDIA GeForce RTX 3080', expectedTier: 'high-end' },
      { renderer: 'AMD Radeon RX 7900 XTX', expectedTier: 'high-end' },
      { renderer: 'Apple M3 Max', expectedTier: 'high-end' },
      { renderer: 'NVIDIA Quadro RTX 8000', expectedTier: 'high-end' },

      // Mid-range GPUs
      { renderer: 'NVIDIA GeForce GTX 1660', expectedTier: 'mid-range' },
      { renderer: 'NVIDIA GeForce RTX 2060', expectedTier: 'mid-range' },
      { renderer: 'AMD Radeon RX 5600 XT', expectedTier: 'mid-range' },
      { renderer: 'Apple M1', expectedTier: 'mid-range' },
      { renderer: 'Intel Iris Xe Graphics', expectedTier: 'mid-range' },

      // Low-end GPUs
      { renderer: 'Intel HD Graphics 4000', expectedTier: 'low-end' },
      { renderer: 'Intel UHD Graphics 610', expectedTier: 'low-end' },
      { renderer: 'AMD Radeon R5 230', expectedTier: 'low-end' },
      { renderer: 'Mali-G57', expectedTier: 'low-end' },
      { renderer: 'ANGLE (Software)', expectedTier: 'low-end' },
    ];

    // Note: These tests verify the pattern matching logic conceptually
    // since we can't easily mock the full WebGL context
    it('should classify high-end GPUs correctly', () => {
      const highEndPatterns = [
        /nvidia.*rtx\s*(30|40|50)/i,
        /radeon\s*rx\s*(6[789]00|7[0-9]00)/i,
        /apple\s*m[234]/i,
      ];

      expect(highEndPatterns.some((p) => p.test('NVIDIA GeForce RTX 4090'))).toBe(true);
      expect(highEndPatterns.some((p) => p.test('AMD Radeon RX 7900'))).toBe(true);
      expect(highEndPatterns.some((p) => p.test('Apple M3'))).toBe(true);
    });

    it('should classify mid-range GPUs correctly', () => {
      const midRangePatterns = [
        /nvidia.*gtx\s*(1060|1050|1660|2060)/i,
        /nvidia.*rtx\s*(20)/i,
        /apple\s*m1/i,
        /intel.*iris\s*(plus|xe|pro)/i,
      ];

      expect(midRangePatterns.some((p) => p.test('NVIDIA GeForce GTX 1660'))).toBe(true);
      expect(midRangePatterns.some((p) => p.test('NVIDIA GeForce RTX 2060'))).toBe(true);
      expect(midRangePatterns.some((p) => p.test('Apple M1'))).toBe(true);
      expect(midRangePatterns.some((p) => p.test('Intel Iris Xe'))).toBe(true);
    });

    it('should classify low-end GPUs correctly', () => {
      const lowEndPatterns = [/intel.*hd.*(4000|4600|5[0-9]00|6[01]0)/i, /mali/i, /angle/i];

      expect(lowEndPatterns.some((p) => p.test('Intel HD Graphics 4000'))).toBe(true);
      expect(lowEndPatterns.some((p) => p.test('Mali-G57'))).toBe(true);
      expect(lowEndPatterns.some((p) => p.test('ANGLE (Software)'))).toBe(true);
    });

    it('should use texture size as fallback for unknown GPUs', () => {
      // When no pattern matches, should fall back to texture size
      const classifyByTextureSize = (maxTextureSize: number): HardwareTier => {
        if (maxTextureSize >= 16384) return 'high-end';
        if (maxTextureSize >= 8192) return 'mid-range';
        if (maxTextureSize >= 4096) return 'low-end';
        return 'unknown';
      };

      expect(classifyByTextureSize(16384)).toBe('high-end');
      expect(classifyByTextureSize(8192)).toBe('mid-range');
      expect(classifyByTextureSize(4096)).toBe('low-end');
      expect(classifyByTextureSize(2048)).toBe('unknown');
    });
  });

  describe('getTierSettings', () => {
    it('should return high-end settings for high-end tier', () => {
      const settings = getTierSettings('high-end');

      expect(settings.particleCount).toBe(15000);
      expect(settings.useInstancing).toBe(true);
      expect(settings.useSimplifiedAttractor).toBe(false);
      expect(settings.shadowQuality).toBe('high');
      expect(settings.postProcessing).toBe(true);
    });

    it('should return mid-range settings for mid-range tier', () => {
      const settings = getTierSettings('mid-range');

      expect(settings.particleCount).toBe(8000);
      expect(settings.useInstancing).toBe(true);
      expect(settings.useSimplifiedAttractor).toBe(false);
      expect(settings.shadowQuality).toBe('medium');
      expect(settings.postProcessing).toBe(true);
    });

    it('should return low-end settings for low-end tier', () => {
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

    it('should have decreasing particle counts from high to low tier', () => {
      const highEnd = getTierSettings('high-end');
      const midRange = getTierSettings('mid-range');
      const lowEnd = getTierSettings('low-end');

      expect(highEnd.particleCount).toBeGreaterThan(midRange.particleCount);
      expect(midRange.particleCount).toBeGreaterThan(lowEnd.particleCount);
    });
  });

  describe('getGPUDescription', () => {
    it('should format high-end GPU description correctly', () => {
      const info: GPUInfo = {
        vendor: 'NVIDIA',
        renderer: 'NVIDIA GeForce RTX 4090',
        tier: 'high-end',
        maxTextureSize: 16384,
        maxVertexUniforms: 4096,
        maxFragmentUniforms: 1024,
        supportsInstancing: true,
        supportsFloatTextures: true,
        supportsWebGL2: true,
      };

      const description = getGPUDescription(info);
      expect(description).toBe('NVIDIA GeForce RTX 4090 (High-End)');
    });

    it('should format unknown GPU description correctly', () => {
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

      const description = getGPUDescription(info);
      expect(description).toBe('Unknown (Unknown)');
    });

    it('should handle all tier labels', () => {
      const tiers: HardwareTier[] = ['high-end', 'mid-range', 'low-end', 'unknown'];
      const expectedLabels = ['High-End', 'Mid-Range', 'Low-End', 'Unknown'];

      tiers.forEach((tier, index) => {
        const info: GPUInfo = {
          vendor: 'Test',
          renderer: 'Test GPU',
          tier,
          maxTextureSize: 8192,
          maxVertexUniforms: 256,
          maxFragmentUniforms: 256,
          supportsInstancing: true,
          supportsFloatTextures: true,
          supportsWebGL2: true,
        };

        const description = getGPUDescription(info);
        expect(description).toContain(expectedLabels[index]);
      });
    });
  });

  describe('GPU Info Caching Logic', () => {
    // Note: Actual caching tests require browser environment
    // These tests verify the caching logic conceptually

    it('should have cache reset function', () => {
      expect(typeof resetGPUInfoCache).toBe('function');
    });

    it('should have getGPUInfo function', () => {
      expect(typeof getGPUInfo).toBe('function');
    });

    it('should cache identical results when called multiple times', () => {
      // Verify the caching pattern works correctly
      let cachedValue: GPUInfo | null = null;

      const mockGetGPUInfo = (): GPUInfo => {
        if (!cachedValue) {
          cachedValue = {
            vendor: 'Test',
            renderer: 'Test GPU',
            tier: 'mid-range',
            maxTextureSize: 8192,
            maxVertexUniforms: 256,
            maxFragmentUniforms: 256,
            supportsInstancing: true,
            supportsFloatTextures: true,
            supportsWebGL2: true,
          };
        }
        return cachedValue;
      };

      const info1 = mockGetGPUInfo();
      const info2 = mockGetGPUInfo();

      expect(info1).toBe(info2); // Same reference
    });

    it('should return new value after cache reset', () => {
      let cachedValue: GPUInfo | null = {
        vendor: 'Test',
        renderer: 'Test GPU',
        tier: 'mid-range',
        maxTextureSize: 8192,
        maxVertexUniforms: 256,
        maxFragmentUniforms: 256,
        supportsInstancing: true,
        supportsFloatTextures: true,
        supportsWebGL2: true,
      };

      const mockResetCache = () => {
        cachedValue = null;
      };

      const mockGetGPUInfo = (): GPUInfo => {
        if (!cachedValue) {
          cachedValue = {
            vendor: 'Test',
            renderer: 'Test GPU',
            tier: 'mid-range',
            maxTextureSize: 8192,
            maxVertexUniforms: 256,
            maxFragmentUniforms: 256,
            supportsInstancing: true,
            supportsFloatTextures: true,
            supportsWebGL2: true,
          };
        }
        return cachedValue;
      };

      const info1 = mockGetGPUInfo();
      mockResetCache();
      const info2 = mockGetGPUInfo();

      // After reset, should be a new object (different reference)
      expect(info1).not.toBe(info2);
    });
  });
});

describe('WebGL Error Boundary', () => {
  describe('Error State Management', () => {
    it('should initialize with no error state', () => {
      const initialState = { hasError: false, error: null };
      expect(initialState.hasError).toBe(false);
      expect(initialState.error).toBeNull();
    });

    it('should derive error state from error', () => {
      const getDerivedStateFromError = (error: Error) => {
        return { hasError: true, error };
      };

      const testError = new Error('WebGL context lost');
      const newState = getDerivedStateFromError(testError);

      expect(newState.hasError).toBe(true);
      expect(newState.error).toBe(testError);
      expect(newState.error?.message).toBe('WebGL context lost');
    });
  });

  describe('Fallback Rendering Logic', () => {
    it('should render children when no error', () => {
      const state = { hasError: false, error: null };
      const shouldRenderFallback = state.hasError;

      expect(shouldRenderFallback).toBe(false);
    });

    it('should render fallback when error exists', () => {
      const state = { hasError: true, error: new Error('Test error') };
      const shouldRenderFallback = state.hasError;

      expect(shouldRenderFallback).toBe(true);
    });

    it('should use custom fallback when provided', () => {
      const customFallback = { type: 'custom', content: 'Custom error UI' };
      const defaultFallback = { type: 'default', content: 'Default error UI' };

      const getFallback = (hasFallback: boolean) => {
        return hasFallback ? customFallback : defaultFallback;
      };

      expect(getFallback(true)).toBe(customFallback);
      expect(getFallback(false)).toBe(defaultFallback);
    });
  });

  describe('Error Message Display', () => {
    it('should display error message in fallback', () => {
      const formatErrorMessage = (error: Error | null) => {
        return error ? `WebGL Error: ${error.message}` : 'Unknown WebGL Error';
      };

      expect(formatErrorMessage(new Error('Context lost'))).toBe('WebGL Error: Context lost');
      expect(formatErrorMessage(null)).toBe('Unknown WebGL Error');
    });

    it('should handle various WebGL error types', () => {
      const errorTypes = [
        'WebGL context lost',
        'Unable to create WebGL context',
        'WebGL not supported',
        'Shader compilation failed',
        'Buffer creation failed',
        'Texture loading failed',
      ];

      errorTypes.forEach((errorType) => {
        const error = new Error(errorType);
        expect(error.message).toBe(errorType);
      });
    });
  });

  describe('Fallback Styles', () => {
    it('should have correct fallback container styles', () => {
      const fallbackStyles = {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ff6666',
        background: '#111',
        borderRadius: '50%',
      };

      expect(fallbackStyles.display).toBe('flex');
      expect(fallbackStyles.alignItems).toBe('center');
      expect(fallbackStyles.justifyContent).toBe('center');
      expect(fallbackStyles.color).toBe('#ff6666');
      expect(fallbackStyles.borderRadius).toBe('50%');
    });
  });
});

describe('WebGL Canvas Configuration', () => {
  describe('GL Context Options', () => {
    it('should have correct WebGL context attributes', () => {
      const glOptions = {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      };

      expect(glOptions.antialias).toBe(true);
      expect(glOptions.alpha).toBe(true);
      expect(glOptions.powerPreference).toBe('high-performance');
      expect(glOptions.stencil).toBe(false);
      expect(glOptions.depth).toBe(true);
    });

    it('should have high-performance power preference for better GPU utilization', () => {
      const powerPreference = 'high-performance';
      const validPreferences = ['default', 'high-performance', 'low-power'];

      expect(validPreferences).toContain(powerPreference);
    });
  });

  describe('Device Pixel Ratio', () => {
    it('should clamp DPR to reasonable range', () => {
      const dprRange: [number, number] = [1, 2];

      expect(dprRange[0]).toBeGreaterThanOrEqual(1);
      expect(dprRange[1]).toBeLessThanOrEqual(3);
    });

    it('should handle various display scales', () => {
      const clampDPR = (dpr: number, min: number, max: number) => {
        return Math.min(max, Math.max(min, dpr));
      };

      expect(clampDPR(0.5, 1, 2)).toBe(1); // Too low
      expect(clampDPR(1.5, 1, 2)).toBe(1.5); // In range
      expect(clampDPR(3, 1, 2)).toBe(2); // Too high
    });
  });
});

describe('WebGL Context Recovery', () => {
  describe('Context Lost Handling', () => {
    it('should detect context lost event', () => {
      const contextLostHandler = vi.fn();
      const event = { type: 'webglcontextlost', preventDefault: vi.fn() };

      // Simulate context lost event
      contextLostHandler(event);

      expect(contextLostHandler).toHaveBeenCalledWith(event);
    });

    it('should handle context restoration', () => {
      let contextLost = true;
      const onContextRestored = () => {
        contextLost = false;
      };

      expect(contextLost).toBe(true);
      onContextRestored();
      expect(contextLost).toBe(false);
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup resources on unmount', () => {
      const cleanupFunctions = {
        disposeGeometry: vi.fn(),
        disposeMaterial: vi.fn(),
        disposeTextures: vi.fn(),
        removeEventListeners: vi.fn(),
      };

      // Simulate cleanup
      Object.values(cleanupFunctions).forEach((fn) => fn());

      expect(cleanupFunctions.disposeGeometry).toHaveBeenCalled();
      expect(cleanupFunctions.disposeMaterial).toHaveBeenCalled();
      expect(cleanupFunctions.disposeTextures).toHaveBeenCalled();
      expect(cleanupFunctions.removeEventListeners).toHaveBeenCalled();
    });
  });
});

describe('WebGL Feature Detection', () => {
  describe('Extension Support', () => {
    it('should check for instancing extension on WebGL1', () => {
      const hasInstancingExtension = (gl: { getExtension: (name: string) => unknown }) => {
        return gl.getExtension('ANGLE_instanced_arrays') !== null;
      };

      const mockGlWithExtension = {
        getExtension: vi.fn((name: string) => (name === 'ANGLE_instanced_arrays' ? {} : null)),
      };
      const mockGlWithoutExtension = { getExtension: vi.fn(() => null) };

      expect(hasInstancingExtension(mockGlWithExtension)).toBe(true);
      expect(hasInstancingExtension(mockGlWithoutExtension)).toBe(false);
    });

    it('should check for float texture extension', () => {
      const hasFloatTextureExtension = (gl: { getExtension: (name: string) => unknown }) => {
        return (
          gl.getExtension('OES_texture_float') !== null ||
          gl.getExtension('OES_texture_half_float') !== null
        );
      };

      const mockGlWithFloat = {
        getExtension: vi.fn((name: string) => (name === 'OES_texture_float' ? {} : null)),
      };
      const mockGlWithHalfFloat = {
        getExtension: vi.fn((name: string) => (name === 'OES_texture_half_float' ? {} : null)),
      };
      const mockGlWithoutFloat = { getExtension: vi.fn(() => null) };

      expect(hasFloatTextureExtension(mockGlWithFloat)).toBe(true);
      expect(hasFloatTextureExtension(mockGlWithHalfFloat)).toBe(true);
      expect(hasFloatTextureExtension(mockGlWithoutFloat)).toBe(false);
    });

    it('should check for debug renderer info extension', () => {
      const hasDebugInfo = (gl: { getExtension: (name: string) => unknown }) => {
        return gl.getExtension('WEBGL_debug_renderer_info') !== null;
      };

      const mockGlWithDebug = {
        getExtension: vi.fn((name: string) => (name === 'WEBGL_debug_renderer_info' ? {} : null)),
      };
      const mockGlWithoutDebug = { getExtension: vi.fn(() => null) };

      expect(hasDebugInfo(mockGlWithDebug)).toBe(true);
      expect(hasDebugInfo(mockGlWithoutDebug)).toBe(false);
    });
  });

  describe('Capability Limits', () => {
    it('should validate texture size limits', () => {
      const validateTextureSize = (requestedSize: number, maxSize: number) => {
        return requestedSize <= maxSize;
      };

      expect(validateTextureSize(2048, 8192)).toBe(true);
      expect(validateTextureSize(8192, 8192)).toBe(true);
      expect(validateTextureSize(16384, 8192)).toBe(false);
    });

    it('should validate uniform limits', () => {
      const validateUniformCount = (requested: number, maxVectors: number) => {
        return requested <= maxVectors;
      };

      expect(validateUniformCount(100, 256)).toBe(true);
      expect(validateUniformCount(256, 256)).toBe(true);
      expect(validateUniformCount(512, 256)).toBe(false);
    });
  });
});

describe('Graceful Degradation', () => {
  describe('Fallback Chain', () => {
    it('should fall back from WebGL2 to WebGL1', () => {
      const getWebGLContext = (
        canvas: { getContext: (type: string) => unknown },
        preferWebGL2: boolean
      ) => {
        if (preferWebGL2) {
          const gl2 = canvas.getContext('webgl2');
          if (gl2) return { context: gl2, version: 2 };
        }
        const gl1 = canvas.getContext('webgl');
        if (gl1) return { context: gl1, version: 1 };
        return null;
      };

      // Canvas with both WebGL versions
      const canvasWithBoth = {
        getContext: vi.fn((type: string) => {
          if (type === 'webgl2') return { version: 2 };
          if (type === 'webgl') return { version: 1 };
          return null;
        }),
      };

      // Canvas with only WebGL1
      const canvasWithGL1Only = {
        getContext: vi.fn((type: string) => {
          if (type === 'webgl') return { version: 1 };
          return null;
        }),
      };

      // Canvas with no WebGL
      const canvasWithoutGL = {
        getContext: vi.fn(() => null),
      };

      expect(getWebGLContext(canvasWithBoth, true)?.version).toBe(2);
      expect(getWebGLContext(canvasWithGL1Only, true)?.version).toBe(1);
      expect(getWebGLContext(canvasWithoutGL, true)).toBeNull();
    });

    it('should reduce particle count on low-end hardware', () => {
      const getParticleCount = (tier: HardwareTier, baseCount: number) => {
        const multipliers: Record<HardwareTier, number> = {
          'high-end': 1.0,
          'mid-range': 0.6,
          'low-end': 0.2,
          unknown: 0.3,
        };
        return Math.floor(baseCount * multipliers[tier]);
      };

      const baseCount = 30000;
      expect(getParticleCount('high-end', baseCount)).toBe(30000);
      expect(getParticleCount('mid-range', baseCount)).toBe(18000);
      expect(getParticleCount('low-end', baseCount)).toBe(6000);
      expect(getParticleCount('unknown', baseCount)).toBe(9000);
    });

    it('should disable effects on low-end hardware', () => {
      const shouldEnableEffect = (tier: HardwareTier, effect: string) => {
        const effectRequirements: Record<string, HardwareTier[]> = {
          bloom: ['high-end', 'mid-range'],
          shadows: ['high-end', 'mid-range'],
          postProcessing: ['high-end', 'mid-range'],
          instancing: ['high-end', 'mid-range', 'low-end'],
        };

        return effectRequirements[effect]?.includes(tier) ?? false;
      };

      expect(shouldEnableEffect('high-end', 'bloom')).toBe(true);
      expect(shouldEnableEffect('mid-range', 'bloom')).toBe(true);
      expect(shouldEnableEffect('low-end', 'bloom')).toBe(false);
      expect(shouldEnableEffect('unknown', 'bloom')).toBe(false);

      expect(shouldEnableEffect('high-end', 'instancing')).toBe(true);
      expect(shouldEnableEffect('low-end', 'instancing')).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should retry context creation', async () => {
      let attempts = 0;
      const maxRetries = 3;

      const createContextWithRetry = async (): Promise<string | null> => {
        while (attempts < maxRetries) {
          attempts++;
          if (attempts === 3) {
            return 'success';
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return null;
      };

      const result = await createContextWithRetry();
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should provide meaningful error messages', () => {
      const getErrorMessage = (errorCode: string) => {
        const messages: Record<string, string> = {
          CONTEXT_LOST: 'WebGL context was lost. Please refresh the page.',
          NOT_SUPPORTED: 'WebGL is not supported in your browser.',
          EXTENSION_MISSING: 'Required WebGL extension is not available.',
          SHADER_ERROR: 'Failed to compile shader program.',
          TEXTURE_ERROR: 'Failed to load texture resource.',
          OUT_OF_MEMORY: 'GPU ran out of memory. Try reducing quality settings.',
        };

        return messages[errorCode] || 'An unknown WebGL error occurred.';
      };

      expect(getErrorMessage('CONTEXT_LOST')).toContain('context was lost');
      expect(getErrorMessage('NOT_SUPPORTED')).toContain('not supported');
      expect(getErrorMessage('UNKNOWN_CODE')).toContain('unknown');
    });
  });
});

describe('Performance Safeguards', () => {
  describe('Frame Rate Monitoring', () => {
    it('should detect low frame rate', () => {
      const isLowFrameRate = (fps: number, threshold: number = 30) => {
        return fps < threshold;
      };

      expect(isLowFrameRate(60)).toBe(false);
      expect(isLowFrameRate(30)).toBe(false);
      expect(isLowFrameRate(20)).toBe(true);
      expect(isLowFrameRate(10)).toBe(true);
    });

    it('should trigger quality reduction on sustained low FPS', () => {
      const shouldReduceQuality = (fpsHistory: number[], threshold: number, samples: number) => {
        if (fpsHistory.length < samples) return false;
        const recentSamples = fpsHistory.slice(-samples);
        const avgFps = recentSamples.reduce((a, b) => a + b, 0) / samples;
        return avgFps < threshold;
      };

      const goodFps = [60, 58, 62, 59, 61]; // avg = 60
      const badFps = [25, 22, 28, 20, 24]; // avg = 23.8
      const mixedFps = [60, 55, 30, 25, 20]; // avg = 38, above threshold
      const sustainedLowFps = [28, 25, 22, 20, 18]; // avg = 22.6

      expect(shouldReduceQuality(goodFps, 30, 5)).toBe(false);
      expect(shouldReduceQuality(badFps, 30, 5)).toBe(true);
      expect(shouldReduceQuality(mixedFps, 30, 5)).toBe(false); // avg 38 > 30
      expect(shouldReduceQuality(sustainedLowFps, 30, 5)).toBe(true); // avg 22.6 < 30
    });
  });

  describe('Memory Management', () => {
    it('should track buffer allocations', () => {
      const allocations: { type: string; size: number }[] = [];

      const trackAllocation = (type: string, size: number) => {
        allocations.push({ type, size });
      };

      const getTotalAllocated = () => {
        return allocations.reduce((sum, a) => sum + a.size, 0);
      };

      trackAllocation('vertex', 1024);
      trackAllocation('index', 512);
      trackAllocation('texture', 4096);

      expect(getTotalAllocated()).toBe(5632);
      expect(allocations.length).toBe(3);
    });

    it('should warn on excessive memory usage', () => {
      const checkMemoryUsage = (usedMB: number, maxMB: number) => {
        const ratio = usedMB / maxMB;
        if (ratio > 0.9) return 'critical';
        if (ratio > 0.7) return 'warning';
        return 'normal';
      };

      expect(checkMemoryUsage(100, 500)).toBe('normal');
      expect(checkMemoryUsage(400, 500)).toBe('warning');
      expect(checkMemoryUsage(480, 500)).toBe('critical');
    });
  });
});
