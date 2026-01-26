/**
 * Atlas Desktop - GPU Detector
 * Automatic GPU capability detection for adaptive rendering quality
 */

import { createModuleLogger } from './logger';
import {
  GPUVendor,
  GPUTier,
  GPUInfo,
  GPUCapabilities,
  GPURenderingConfig,
  WebGLCapabilities,
  TIER_PARTICLE_COUNTS,
  TIER_RENDER_CONFIGS,
} from '../../shared/types/gpu';

const logger = createModuleLogger('GPUDetector');

// GPU model patterns for tier classification
const GPU_TIER_PATTERNS: Record<GPUTier, RegExp[]> = {
  high: [
    // NVIDIA High-End
    /RTX\s*4\d{2,3}/i, // RTX 4xxx
    /RTX\s*3\d{2,3}/i, // RTX 3xxx
    /RTX\s*A\d{3,4}/i, // RTX Axxxx (workstation)
    /Quadro\s*RTX/i,
    /Tesla\s*[VAT]/i,
    // AMD High-End
    /RX\s*7\d{3}/i, // RX 7xxx
    /RX\s*6[89]\d{2}/i, // RX 6800/6900
    /Radeon\s*Pro\s*W7/i,
    /Instinct/i,
    // Apple Silicon
    /Apple\s*M[234]/i, // M2, M3, M4
    /Apple\s*M\d+\s*(Pro|Max|Ultra)/i,
  ],
  medium: [
    // NVIDIA Mid-Range
    /RTX\s*20[678]\d/i, // RTX 2060-2080
    /GTX\s*16[56]\d/i, // GTX 1650-1660
    /Quadro\s*[PT]\d{3,4}/i,
    // AMD Mid-Range
    /RX\s*6[67]\d{2}/i, // RX 6600/6700
    /RX\s*5[67]\d{2}/i, // RX 5600/5700
    /Radeon\s*Pro\s*W[56]/i,
    // Intel Arc
    /Arc\s*A[57]\d{2}/i, // Arc A580, A770
    // Apple Silicon (base)
    /Apple\s*M[12]$/i, // M1, M2 (base)
  ],
  low: [
    // NVIDIA Entry
    /GTX\s*10[56]\d/i, // GTX 1050/1060
    /GTX\s*9[56]\d/i, // GTX 950/960
    /GT\s*10\d{2}/i, // GT 1030
    /MX\s*\d{3}/i, // MX series
    // AMD Entry
    /RX\s*5[45]\d{2}/i, // RX 5400/5500
    /RX\s*4\d{2}/i, // RX 4xx
    /RX\s*5\d{2}[^0]/i, // RX 5xx (not 5600/5700)
    // Intel Arc Entry
    /Arc\s*A[3]\d{2}/i, // Arc A380
    // Intel Iris Plus/Pro
    /Iris\s*(Plus|Pro)/i,
    /Iris\s*Xe\s*MAX/i,
  ],
  integrated: [
    // Intel Integrated
    /Intel.*UHD/i,
    /Intel.*HD\s*Graphics/i,
    /Iris\s*Xe(?!\s*MAX)/i, // Iris Xe (not MAX)
    /Intel.*Integrated/i,
    // AMD Integrated
    /Radeon\s*Graphics(?!\s*Pro)/i, // AMD APU graphics
    /Vega\s*\d+/i, // Vega integrated
    /AMD\s*Radeon.*\d{3}M/i, // Mobile APU
    // Qualcomm
    /Adreno/i,
    // Generic integrated
    /Integrated/i,
    /Basic\s*Render/i,
    /Microsoft\s*Basic/i,
    /SVGA/i,
  ],
};

// Vendor detection patterns
const VENDOR_PATTERNS: Record<GPUVendor, RegExp[]> = {
  nvidia: [/nvidia/i, /geforce/i, /quadro/i, /tesla/i, /rtx/i, /gtx/i],
  amd: [/amd/i, /radeon/i, /ati/i, /rx\s*\d/i],
  intel: [/intel/i, /iris/i, /uhd/i, /arc\s*a/i],
  apple: [/apple/i, /m[1234]\s*(pro|max|ultra)?/i],
  qualcomm: [/qualcomm/i, /adreno/i, /snapdragon/i],
  unknown: [],
};

// Estimated VRAM by tier (in MB)
const ESTIMATED_VRAM: Record<GPUTier, number> = {
  high: 8192, // 8GB
  medium: 4096, // 4GB
  low: 2048, // 2GB
  integrated: 512, // Shared memory
};

/**
 * Detect GPU vendor from renderer string
 */
export function detectGPUVendor(renderer: string, vendor?: string): GPUVendor {
  const searchString = `${renderer} ${vendor || ''}`.toLowerCase();

  for (const [gpuVendor, patterns] of Object.entries(VENDOR_PATTERNS)) {
    if (gpuVendor === 'unknown') continue;
    for (const pattern of patterns) {
      if (pattern.test(searchString)) {
        return gpuVendor as GPUVendor;
      }
    }
  }

  return 'unknown';
}

/**
 * Classify GPU into performance tier based on model
 */
export function classifyGPUTier(renderer: string, vendor: GPUVendor): GPUTier {
  const searchString = renderer.toLowerCase();

  // Check patterns in order from high to integrated
  for (const tier of ['high', 'medium', 'low', 'integrated'] as GPUTier[]) {
    for (const pattern of GPU_TIER_PATTERNS[tier]) {
      if (pattern.test(searchString)) {
        logger.debug('GPU tier classified', { tier, renderer, pattern: pattern.toString() });
        return tier;
      }
    }
  }

  // Default based on vendor if no specific match
  switch (vendor) {
    case 'nvidia':
    case 'amd':
      // Unknown dedicated GPU, assume medium
      return 'medium';
    case 'apple':
      // Apple Silicon is at least medium
      return 'medium';
    case 'intel':
      // Unknown Intel, likely integrated
      return 'integrated';
    case 'qualcomm':
      return 'integrated';
    default:
      return 'integrated';
  }
}

/**
 * Get rendering configuration for a GPU tier
 */
export function getConfigForTier(tier: GPUTier): GPURenderingConfig {
  return {
    particleCount: TIER_PARTICLE_COUNTS[tier],
    ...TIER_RENDER_CONFIGS[tier],
  };
}

/**
 * Cached GPU capabilities
 */
let cachedCapabilities: GPUCapabilities | null = null;

/**
 * Get cached GPU capabilities or null if not detected yet
 */
export function getCachedGPUCapabilities(): GPUCapabilities | null {
  return cachedCapabilities;
}

/**
 * Clear cached GPU capabilities (useful for testing)
 */
export function clearGPUCache(): void {
  cachedCapabilities = null;
  logger.debug('GPU cache cleared');
}

/**
 * Create GPU info from detection results
 */
export function createGPUInfo(
  renderer: string,
  unmaskedVendor?: string,
  unmaskedRenderer?: string,
  webgl?: Partial<WebGLCapabilities>
): GPUInfo {
  const vendor = detectGPUVendor(unmaskedRenderer || renderer, unmaskedVendor);
  const tier = classifyGPUTier(unmaskedRenderer || renderer, vendor);

  const defaultWebGL: WebGLCapabilities = {
    version: 2,
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
    antialias: true,
    floatTextures: true,
    instancedArrays: true,
    vertexArrayObjects: true,
  };

  return {
    vendor,
    renderer: unmaskedRenderer || renderer,
    unmaskedVendor,
    unmaskedRenderer,
    tier,
    estimatedVRAM: ESTIMATED_VRAM[tier],
    webgl: { ...defaultWebGL, ...webgl },
    detectedAt: Date.now(),
  };
}

/**
 * Detect GPU capabilities from WebGL context info provided by renderer
 * This is called from the main process with data collected from renderer
 */
export function detectGPUCapabilities(webglInfo: {
  vendor: string;
  renderer: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  version?: 1 | 2;
  maxTextureSize?: number;
  maxViewportDims?: [number, number];
  maxRenderbufferSize?: number;
  maxVertexAttribs?: number;
  maxVertexUniformVectors?: number;
  maxVaryingVectors?: number;
  maxFragmentUniformVectors?: number;
  maxTextureImageUnits?: number;
  maxVertexTextureImageUnits?: number;
  maxCombinedTextureImageUnits?: number;
  extensions?: string[];
  antialias?: boolean;
  floatTextures?: boolean;
  instancedArrays?: boolean;
  vertexArrayObjects?: boolean;
}): GPUCapabilities {
  try {
    logger.info('Detecting GPU capabilities', {
      vendor: webglInfo.vendor,
      renderer: webglInfo.renderer,
      unmaskedRenderer: webglInfo.unmaskedRenderer,
    });

    const webglCapabilities: Partial<WebGLCapabilities> = {
      version: webglInfo.version || 2,
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

    const gpuInfo = createGPUInfo(
      webglInfo.renderer,
      webglInfo.unmaskedVendor,
      webglInfo.unmaskedRenderer,
      webglCapabilities
    );

    const config = getConfigForTier(gpuInfo.tier);

    const capabilities: GPUCapabilities = {
      gpu: gpuInfo,
      config,
      success: true,
    };

    // Cache the result
    cachedCapabilities = capabilities;

    logger.info('GPU capabilities detected', {
      vendor: gpuInfo.vendor,
      tier: gpuInfo.tier,
      renderer: gpuInfo.renderer,
      particleCount: config.particleCount,
      estimatedVRAM: gpuInfo.estimatedVRAM,
    });

    return capabilities;
  } catch (error) {
    logger.error('Failed to detect GPU capabilities', {
      error: (error as Error).message,
    });

    // Return fallback configuration
    const fallbackCapabilities: GPUCapabilities = {
      gpu: createGPUInfo('Unknown GPU'),
      config: getConfigForTier('integrated'),
      success: false,
      error: (error as Error).message,
    };

    cachedCapabilities = fallbackCapabilities;
    return fallbackCapabilities;
  }
}

/**
 * Get recommended particle count for the detected GPU
 * Returns cached value or default for integrated if not detected
 */
export function getRecommendedParticleCount(): number {
  if (cachedCapabilities) {
    return cachedCapabilities.config.particleCount;
  }
  return TIER_PARTICLE_COUNTS.integrated;
}

/**
 * Get rendering config for detected GPU
 * Returns cached value or default for integrated if not detected
 */
export function getRecommendedRenderConfig(): GPURenderingConfig {
  if (cachedCapabilities) {
    return cachedCapabilities.config;
  }
  return getConfigForTier('integrated');
}

/**
 * Check if GPU meets minimum requirements
 */
export function meetsMinimumRequirements(): boolean {
  if (!cachedCapabilities) {
    return true; // Assume it does if not detected yet
  }

  const { webgl } = cachedCapabilities.gpu;

  // Minimum requirements for Atlas orb rendering
  const minRequirements = {
    maxTextureSize: 2048,
    maxVertexAttribs: 8,
    maxTextureImageUnits: 8,
  };

  return (
    webgl.maxTextureSize >= minRequirements.maxTextureSize &&
    webgl.maxVertexAttribs >= minRequirements.maxVertexAttribs &&
    webgl.maxTextureImageUnits >= minRequirements.maxTextureImageUnits
  );
}

/**
 * Export type for IPC
 */
export type { GPUCapabilities, GPUInfo, GPURenderingConfig, GPUTier, GPUVendor };

export default {
  detectGPUCapabilities,
  getCachedGPUCapabilities,
  clearGPUCache,
  getRecommendedParticleCount,
  getRecommendedRenderConfig,
  meetsMinimumRequirements,
  detectGPUVendor,
  classifyGPUTier,
  getConfigForTier,
};
