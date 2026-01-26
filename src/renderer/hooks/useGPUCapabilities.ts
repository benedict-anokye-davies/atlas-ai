/**
 * Atlas Desktop - GPU Capabilities Hook
 * React hook for detecting and accessing GPU capabilities
 * Provides recommended rendering configuration to orb components
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  GPUCapabilities,
  GPUInfo,
  GPURenderingConfig,
  GPUTier,
  GPUVendor,
  WebGLCapabilities,
} from '../../shared/types/gpu';

// Re-export types for convenience
export type { GPUCapabilities, GPUInfo, GPURenderingConfig, GPUTier, GPUVendor };

// Particle count defaults by tier (mirrored from shared types for renderer use)
const PARTICLE_COUNTS: Record<GPUTier, number> = {
  high: 50000,
  medium: 25000,
  low: 10000,
  integrated: 5000,
};

// Render config defaults by tier (mirrored from shared types for renderer use)
const RENDER_CONFIGS: Record<GPUTier, Omit<GPURenderingConfig, 'particleCount'>> = {
  high: {
    maxDpr: 2,
    enablePostProcessing: true,
    enableAntialias: true,
    shadowQuality: 3,
    bloomIntensity: 1.5,
    targetFps: 60,
    maxAnimations: 10,
  },
  medium: {
    maxDpr: 1.5,
    enablePostProcessing: true,
    enableAntialias: true,
    shadowQuality: 2,
    bloomIntensity: 1.0,
    targetFps: 60,
    maxAnimations: 6,
  },
  low: {
    maxDpr: 1,
    enablePostProcessing: false,
    enableAntialias: true,
    shadowQuality: 1,
    bloomIntensity: 0,
    targetFps: 45,
    maxAnimations: 4,
  },
  integrated: {
    maxDpr: 1,
    enablePostProcessing: false,
    enableAntialias: false,
    shadowQuality: 0,
    bloomIntensity: 0,
    targetFps: 30,
    maxAnimations: 2,
  },
};

/**
 * Hook options
 */
export interface UseGPUCapabilitiesOptions {
  /** Skip initial detection (default: false) */
  skipDetection?: boolean;
  /** Custom tier override for testing (default: undefined) */
  tierOverride?: GPUTier;
  /** Callback when detection completes */
  onDetected?: (capabilities: GPUCapabilities) => void;
}

/**
 * Hook result
 */
export interface UseGPUCapabilitiesResult {
  /** GPU capabilities (null until detected) */
  capabilities: GPUCapabilities | null;
  /** Whether detection is in progress */
  isDetecting: boolean;
  /** Whether detection has completed */
  isDetected: boolean;
  /** Detection error (if any) */
  error: string | null;
  /** Recommended particle count */
  particleCount: number;
  /** Recommended rendering configuration */
  renderConfig: GPURenderingConfig;
  /** GPU tier */
  tier: GPUTier;
  /** GPU vendor */
  vendor: GPUVendor;
  /** Manually trigger detection */
  detect: () => Promise<void>;
  /** Check if GPU meets minimum requirements */
  meetsRequirements: boolean;
}

/**
 * Detect GPU vendor from renderer string
 */
function detectVendor(renderer: string, vendor?: string): GPUVendor {
  const searchString = `${renderer} ${vendor || ''}`.toLowerCase();

  if (/nvidia|geforce|quadro|tesla|rtx|gtx/i.test(searchString)) return 'nvidia';
  if (/amd|radeon|ati|rx\s*\d/i.test(searchString)) return 'amd';
  if (/intel|iris|uhd|arc\s*a/i.test(searchString)) return 'intel';
  if (/apple|m[1234]\s*(pro|max|ultra)?/i.test(searchString)) return 'apple';
  if (/qualcomm|adreno|snapdragon/i.test(searchString)) return 'qualcomm';

  return 'unknown';
}

/**
 * Classify GPU tier from renderer string
 */
function classifyTier(renderer: string, vendor: GPUVendor): GPUTier {
  const r = renderer.toLowerCase();

  // High tier patterns
  const highPatterns = [
    /rtx\s*4\d{2,3}/i,
    /rtx\s*3\d{2,3}/i,
    /rx\s*7\d{3}/i,
    /rx\s*6[89]\d{2}/i,
    /apple\s*m[234]/i,
    /apple\s*m\d+\s*(pro|max|ultra)/i,
  ];

  // Medium tier patterns
  const mediumPatterns = [
    /rtx\s*20[678]\d/i,
    /gtx\s*16[56]\d/i,
    /rx\s*6[67]\d{2}/i,
    /rx\s*5[67]\d{2}/i,
    /arc\s*a[57]\d{2}/i,
    /apple\s*m[12]$/i,
  ];

  // Low tier patterns
  const lowPatterns = [
    /gtx\s*10[56]\d/i,
    /gtx\s*9[56]\d/i,
    /gt\s*10\d{2}/i,
    /mx\s*\d{3}/i,
    /rx\s*5[45]\d{2}/i,
    /rx\s*4\d{2}/i,
    /arc\s*a[3]\d{2}/i,
    /iris\s*(plus|pro)/i,
    /iris\s*xe\s*max/i,
  ];

  // Check patterns
  for (const pattern of highPatterns) {
    if (pattern.test(r)) return 'high';
  }
  for (const pattern of mediumPatterns) {
    if (pattern.test(r)) return 'medium';
  }
  for (const pattern of lowPatterns) {
    if (pattern.test(r)) return 'low';
  }

  // Integrated tier patterns
  const integratedPatterns = [
    /intel.*uhd/i,
    /intel.*hd\s*graphics/i,
    /iris\s*xe(?!\s*max)/i,
    /radeon\s*graphics(?!\s*pro)/i,
    /vega\s*\d+/i,
    /adreno/i,
    /integrated/i,
    /basic\s*render/i,
    /microsoft\s*basic/i,
    /svga/i,
  ];

  for (const pattern of integratedPatterns) {
    if (pattern.test(r)) return 'integrated';
  }

  // Default based on vendor
  switch (vendor) {
    case 'nvidia':
    case 'amd':
      return 'medium';
    case 'apple':
      return 'medium';
    case 'intel':
    case 'qualcomm':
    default:
      return 'integrated';
  }
}

/**
 * Collect WebGL information from context
 */
function collectWebGLInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  vendor: string;
  renderer: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  version: 1 | 2;
  maxTextureSize: number;
  maxViewportDims: [number, number];
  maxRenderbufferSize: number;
  maxVertexAttribs: number;
  maxVertexUniformVectors: number;
  maxVaryingVectors: number;
  maxFragmentUniformVectors: number;
  maxTextureImageUnits: number;
  maxVertexTextureImageUnits: number;
  maxCombinedTextureImageUnits: number;
  extensions: string[];
  antialias: boolean;
  floatTextures: boolean;
  instancedArrays: boolean;
  vertexArrayObjects: boolean;
} {
  // Get basic vendor/renderer
  const vendor = gl.getParameter(gl.VENDOR) as string;
  const renderer = gl.getParameter(gl.RENDERER) as string;

  // Try to get unmasked vendor/renderer (more detailed GPU info)
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const unmaskedVendor = debugInfo
    ? (gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string)
    : undefined;
  const unmaskedRenderer = debugInfo
    ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
    : undefined;

  // Determine WebGL version
  const version: 1 | 2 = gl instanceof WebGL2RenderingContext ? 2 : 1;

  // Get capability parameters
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  const maxVertexUniformVectors = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number;
  const maxVaryingVectors = gl.getParameter(gl.MAX_VARYING_VECTORS) as number;
  const maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
  const maxTextureImageUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  const maxVertexTextureImageUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
  const maxCombinedTextureImageUnits = gl.getParameter(
    gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS
  ) as number;

  // Get supported extensions
  const extensions = gl.getSupportedExtensions() || [];

  // Check specific capabilities
  const antialias = gl.getContextAttributes()?.antialias ?? false;
  const floatTextures =
    version === 2 ||
    extensions.includes('OES_texture_float') ||
    extensions.includes('OES_texture_half_float');
  const instancedArrays = version === 2 || extensions.includes('ANGLE_instanced_arrays');
  const vertexArrayObjects = version === 2 || extensions.includes('OES_vertex_array_object');

  return {
    vendor,
    renderer,
    unmaskedVendor,
    unmaskedRenderer,
    version,
    maxTextureSize,
    maxViewportDims: [maxViewportDims[0], maxViewportDims[1]],
    maxRenderbufferSize,
    maxVertexAttribs,
    maxVertexUniformVectors,
    maxVaryingVectors,
    maxFragmentUniformVectors,
    maxTextureImageUnits,
    maxVertexTextureImageUnits,
    maxCombinedTextureImageUnits,
    extensions,
    antialias,
    floatTextures,
    instancedArrays,
    vertexArrayObjects,
  };
}

/**
 * Hook for accessing GPU capabilities in renderer components
 * Detects GPU on mount and provides recommended rendering configuration
 */
export function useGPUCapabilities(
  options: UseGPUCapabilitiesOptions = {}
): UseGPUCapabilitiesResult {
  const { skipDetection = false, tierOverride, onDetected } = options;

  const [capabilities, setCapabilities] = useState<GPUCapabilities | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Perform GPU detection
   */
  const detect = useCallback(async () => {
    if (isDetecting) return;

    setIsDetecting(true);
    setError(null);

    try {
      // Create offscreen canvas for WebGL context
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;

      // Try WebGL2 first, fall back to WebGL1
      let gl: WebGLRenderingContext | WebGL2RenderingContext | null =
        canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;

      if (!gl) {
        gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) as WebGLRenderingContext | null;
      }

      if (!gl) {
        throw new Error('WebGL not supported');
      }

      // Collect WebGL information
      const webglInfo = collectWebGLInfo(gl);

      // Detect vendor and tier
      const vendor = detectVendor(
        webglInfo.unmaskedRenderer || webglInfo.renderer,
        webglInfo.unmaskedVendor
      );
      const tier = tierOverride || classifyTier(webglInfo.unmaskedRenderer || webglInfo.renderer, vendor);

      // Build WebGL capabilities
      const webglCapabilities: WebGLCapabilities = {
        version: webglInfo.version,
        maxTextureSize: webglInfo.maxTextureSize,
        maxViewportDims: webglInfo.maxViewportDims,
        maxRenderbufferSize: webglInfo.maxRenderbufferSize,
        maxVertexAttribs: webglInfo.maxVertexAttribs,
        maxVertexUniformVectors: webglInfo.maxVertexUniformVectors,
        maxVaryingVectors: webglInfo.maxVaryingVectors,
        maxFragmentUniformVectors: webglInfo.maxFragmentUniformVectors,
        maxTextureImageUnits: webglInfo.maxTextureImageUnits,
        maxVertexTextureImageUnits: webglInfo.maxVertexTextureImageUnits,
        maxCombinedTextureImageUnits: webglInfo.maxCombinedTextureImageUnits,
        extensions: webglInfo.extensions,
        antialias: webglInfo.antialias,
        floatTextures: webglInfo.floatTextures,
        instancedArrays: webglInfo.instancedArrays,
        vertexArrayObjects: webglInfo.vertexArrayObjects,
      };

      // Build GPU info
      const gpuInfo: GPUInfo = {
        vendor,
        renderer: webglInfo.unmaskedRenderer || webglInfo.renderer,
        unmaskedVendor: webglInfo.unmaskedVendor,
        unmaskedRenderer: webglInfo.unmaskedRenderer,
        tier,
        estimatedVRAM: tier === 'high' ? 8192 : tier === 'medium' ? 4096 : tier === 'low' ? 2048 : 512,
        webgl: webglCapabilities,
        detectedAt: Date.now(),
      };

      // Build render config
      const renderConfig: GPURenderingConfig = {
        particleCount: PARTICLE_COUNTS[tier],
        ...RENDER_CONFIGS[tier],
      };

      // Build capabilities result
      const result: GPUCapabilities = {
        gpu: gpuInfo,
        config: renderConfig,
        success: true,
      };

      setCapabilities(result);

      // Send to main process for caching (if IPC available)
      if (window.atlas?.invoke) {
        try {
          await window.atlas.invoke('atlas:set-gpu-info', webglInfo);
        } catch {
          // IPC not available or handler not registered, ignore
          // eslint-disable-next-line no-console
          console.debug('[useGPUCapabilities] IPC not available for GPU caching');
        }
      }

      // Call onDetected callback
      if (onDetected) {
        onDetected(result);
      }

      // eslint-disable-next-line no-console
      console.log('[useGPUCapabilities] GPU detected:', {
        vendor,
        tier,
        renderer: gpuInfo.renderer,
        particleCount: renderConfig.particleCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      // eslint-disable-next-line no-console
      console.error('[useGPUCapabilities] Detection failed:', errorMessage);

      // Create fallback capabilities
      const fallbackTier: GPUTier = tierOverride || 'integrated';
      const fallbackConfig: GPURenderingConfig = {
        particleCount: PARTICLE_COUNTS[fallbackTier],
        ...RENDER_CONFIGS[fallbackTier],
      };

      setCapabilities({
        gpu: {
          vendor: 'unknown',
          renderer: 'Unknown GPU',
          tier: fallbackTier,
          estimatedVRAM: 512,
          webgl: {
            version: 1,
            maxTextureSize: 4096,
            maxViewportDims: [4096, 4096],
            maxRenderbufferSize: 4096,
            maxVertexAttribs: 16,
            maxVertexUniformVectors: 256,
            maxVaryingVectors: 15,
            maxFragmentUniformVectors: 256,
            maxTextureImageUnits: 16,
            maxVertexTextureImageUnits: 8,
            maxCombinedTextureImageUnits: 32,
            extensions: [],
            antialias: false,
            floatTextures: false,
            instancedArrays: false,
            vertexArrayObjects: false,
          },
          detectedAt: Date.now(),
        },
        config: fallbackConfig,
        success: false,
        error: errorMessage,
      });
    } finally {
      setIsDetecting(false);
    }
  }, [isDetecting, tierOverride, onDetected]);

  // Run detection on mount
  useEffect(() => {
    if (!skipDetection && !capabilities && !isDetecting) {
      detect();
    }
  }, [skipDetection, capabilities, isDetecting, detect]);

  // Computed values
  const tier = useMemo(() => capabilities?.gpu.tier || 'integrated', [capabilities]);
  const vendor = useMemo(() => capabilities?.gpu.vendor || 'unknown', [capabilities]);
  const particleCount = useMemo(
    () => capabilities?.config.particleCount || PARTICLE_COUNTS.integrated,
    [capabilities]
  );
  const renderConfig = useMemo<GPURenderingConfig>(
    () =>
      capabilities?.config || {
        particleCount: PARTICLE_COUNTS.integrated,
        ...RENDER_CONFIGS.integrated,
      },
    [capabilities]
  );

  const meetsRequirements = useMemo(() => {
    if (!capabilities) return true; // Assume true until detected
    const { webgl } = capabilities.gpu;
    return (
      webgl.maxTextureSize >= 2048 &&
      webgl.maxVertexAttribs >= 8 &&
      webgl.maxTextureImageUnits >= 8
    );
  }, [capabilities]);

  return {
    capabilities,
    isDetecting,
    isDetected: capabilities !== null,
    error,
    particleCount,
    renderConfig,
    tier,
    vendor,
    detect,
    meetsRequirements,
  };
}

/**
 * Get recommended particle count based on current FPS
 * Useful for dynamic quality adjustment
 */
export function getAdaptiveParticleCount(
  currentFps: number,
  currentCount: number,
  tier: GPUTier
): number {
  const maxCount = PARTICLE_COUNTS[tier];
  const minCount = Math.floor(maxCount * 0.2); // 20% of max

  if (currentFps >= 55) {
    // Can increase if below max
    return Math.min(maxCount, currentCount + Math.floor(maxCount * 0.1));
  } else if (currentFps >= 45) {
    // Maintain current
    return currentCount;
  } else if (currentFps >= 30) {
    // Reduce slightly
    return Math.max(minCount, currentCount - Math.floor(maxCount * 0.15));
  } else {
    // Reduce significantly
    return Math.max(minCount, currentCount - Math.floor(maxCount * 0.3));
  }
}

export default useGPUCapabilities;
