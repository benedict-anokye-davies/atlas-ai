/**
 * Atlas Desktop - GPU Types
 * Type definitions for GPU detection and rendering configuration
 */

/**
 * GPU vendor identification
 */
export type GPUVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'qualcomm' | 'unknown';

/**
 * GPU performance tier classification
 * - high: Dedicated high-end GPUs (RTX 30xx/40xx, RX 6xxx/7xxx)
 * - medium: Mid-range dedicated GPUs (RTX 20xx, GTX 16xx, RX 5xxx)
 * - low: Entry-level dedicated or high-end integrated (GTX 10xx, Intel Arc)
 * - integrated: Basic integrated graphics (Intel UHD, AMD Radeon Graphics)
 */
export type GPUTier = 'high' | 'medium' | 'low' | 'integrated';

/**
 * WebGL capability information
 */
export interface WebGLCapabilities {
  /** WebGL version supported (1 or 2) */
  version: 1 | 2;
  /** Maximum texture size */
  maxTextureSize: number;
  /** Maximum viewport dimensions */
  maxViewportDims: [number, number];
  /** Maximum renderbuffer size */
  maxRenderbufferSize: number;
  /** Maximum vertex attributes */
  maxVertexAttribs: number;
  /** Maximum vertex uniform vectors */
  maxVertexUniformVectors: number;
  /** Maximum varying vectors */
  maxVaryingVectors: number;
  /** Maximum fragment uniform vectors */
  maxFragmentUniformVectors: number;
  /** Maximum texture image units */
  maxTextureImageUnits: number;
  /** Maximum vertex texture image units */
  maxVertexTextureImageUnits: number;
  /** Maximum combined texture image units */
  maxCombinedTextureImageUnits: number;
  /** Supported extensions */
  extensions: string[];
  /** Hardware antialiasing support */
  antialias: boolean;
  /** Supports float textures */
  floatTextures: boolean;
  /** Supports instanced rendering */
  instancedArrays: boolean;
  /** Supports vertex array objects */
  vertexArrayObjects: boolean;
}

/**
 * GPU information from system
 */
export interface GPUInfo {
  /** GPU vendor */
  vendor: GPUVendor;
  /** GPU renderer string (full name) */
  renderer: string;
  /** Unmasked vendor string (if available) */
  unmaskedVendor?: string;
  /** Unmasked renderer string (if available) */
  unmaskedRenderer?: string;
  /** Detected GPU tier */
  tier: GPUTier;
  /** Estimated VRAM in MB (0 if unknown) */
  estimatedVRAM: number;
  /** WebGL capabilities */
  webgl: WebGLCapabilities;
  /** Detection timestamp */
  detectedAt: number;
}

/**
 * Rendering configuration based on GPU tier
 */
export interface GPURenderingConfig {
  /** Recommended particle count */
  particleCount: number;
  /** Device pixel ratio limit */
  maxDpr: number;
  /** Enable post-processing effects */
  enablePostProcessing: boolean;
  /** Enable anti-aliasing */
  enableAntialias: boolean;
  /** Shadow map quality (0 = disabled, 1 = low, 2 = medium, 3 = high) */
  shadowQuality: 0 | 1 | 2 | 3;
  /** Bloom effect intensity (0 = disabled) */
  bloomIntensity: number;
  /** Target framerate */
  targetFps: number;
  /** Maximum concurrent animations */
  maxAnimations: number;
}

/**
 * Full GPU capabilities result
 */
export interface GPUCapabilities {
  /** Detected GPU information */
  gpu: GPUInfo;
  /** Recommended rendering configuration */
  config: GPURenderingConfig;
  /** Whether detection was successful */
  success: boolean;
  /** Error message if detection failed */
  error?: string;
}

/**
 * Particle count configuration by tier
 */
export const TIER_PARTICLE_COUNTS: Record<GPUTier, number> = {
  high: 50000,
  medium: 25000,
  low: 10000,
  integrated: 5000,
};

/**
 * Rendering configuration presets by tier
 */
export const TIER_RENDER_CONFIGS: Record<GPUTier, Omit<GPURenderingConfig, 'particleCount'>> = {
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
