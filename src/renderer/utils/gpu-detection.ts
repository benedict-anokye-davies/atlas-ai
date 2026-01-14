/**
 * GPU Detection Utility
 *
 * Detects GPU capabilities via WebGL renderer info and classifies
 * hardware into tiers for adaptive orb rendering.
 */

/**
 * Hardware tier classification
 */
export type HardwareTier = 'high-end' | 'mid-range' | 'low-end' | 'unknown';

/**
 * GPU information
 */
export interface GPUInfo {
  vendor: string;
  renderer: string;
  tier: HardwareTier;
  maxTextureSize: number;
  maxVertexUniforms: number;
  maxFragmentUniforms: number;
  supportsInstancing: boolean;
  supportsFloatTextures: boolean;
  supportsWebGL2: boolean;
}

/**
 * Recommended settings based on hardware tier
 */
export interface TierSettings {
  particleCount: number;
  useInstancing: boolean;
  useSimplifiedAttractor: boolean;
  shadowQuality: 'high' | 'medium' | 'low' | 'none';
  postProcessing: boolean;
}

/**
 * Known high-end GPU patterns
 */
const HIGH_END_PATTERNS = [
  /nvidia.*rtx\s*(30|40|50)/i,
  /nvidia.*gtx\s*(1080|1070|2080|2070)/i,
  /radeon\s*rx\s*(6[789]00|7[0-9]00)/i,
  /radeon\s*pro\s*w/i,
  /apple\s*m[234]/i,
  /quadro\s*rtx/i,
];

/**
 * Known mid-range GPU patterns
 */
const MID_RANGE_PATTERNS = [
  /nvidia.*gtx\s*(1060|1050|1660|2060)/i,
  /nvidia.*rtx\s*(20)/i,
  /radeon\s*rx\s*(5[567]00|6[0-5]00)/i,
  /radeon\s*vega/i,
  /apple\s*m1/i,
  /intel.*iris\s*(plus|xe|pro)/i,
  /intel.*uhd\s*(6[2-9]0|7[0-9]0)/i,
];

/**
 * Known low-end GPU patterns
 */
const LOW_END_PATTERNS = [
  /intel.*hd.*(4000|4600|5[0-9]00|6[01]0)/i,
  /intel.*uhd\s*(5|6[01])/i,
  /radeon\s*r[57]\s*[23]/i,
  /nvidia.*gt\s*(7|8|9|10)/i,
  /mali/i,
  /adreno/i,
  /powervr/i,
  /angle/i, // Software rendering
];

/**
 * Detect GPU information using WebGL
 */
export function detectGPU(): GPUInfo {
  // Create a temporary canvas for WebGL context
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

  if (!gl) {
    return {
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
  }

  // Get debug info extension
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

  const vendor = debugInfo
    ? (gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string)
    : (gl.getParameter(gl.VENDOR) as string);

  const renderer = debugInfo
    ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
    : (gl.getParameter(gl.RENDERER) as string);

  // Get WebGL capabilities
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number;
  const maxFragmentUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;

  // Check for WebGL2
  const supportsWebGL2 = gl instanceof WebGL2RenderingContext;

  // Check for instancing support
  const supportsInstancing =
    supportsWebGL2 || gl.getExtension('ANGLE_instanced_arrays') !== null;

  // Check for float textures
  const supportsFloatTextures =
    supportsWebGL2 ||
    gl.getExtension('OES_texture_float') !== null ||
    gl.getExtension('OES_texture_half_float') !== null;

  // Classify hardware tier
  const tier = classifyHardwareTier(renderer, maxTextureSize);

  // Clean up
  canvas.remove();

  return {
    vendor,
    renderer,
    tier,
    maxTextureSize,
    maxVertexUniforms,
    maxFragmentUniforms,
    supportsInstancing,
    supportsFloatTextures,
    supportsWebGL2,
  };
}

/**
 * Classify hardware tier based on GPU renderer string
 */
function classifyHardwareTier(renderer: string, maxTextureSize: number): HardwareTier {
  // Check high-end patterns first
  for (const pattern of HIGH_END_PATTERNS) {
    if (pattern.test(renderer)) {
      return 'high-end';
    }
  }

  // Check mid-range patterns
  for (const pattern of MID_RANGE_PATTERNS) {
    if (pattern.test(renderer)) {
      return 'mid-range';
    }
  }

  // Check low-end patterns
  for (const pattern of LOW_END_PATTERNS) {
    if (pattern.test(renderer)) {
      return 'low-end';
    }
  }

  // Fall back to texture size heuristic
  if (maxTextureSize >= 16384) {
    return 'high-end';
  } else if (maxTextureSize >= 8192) {
    return 'mid-range';
  } else if (maxTextureSize >= 4096) {
    return 'low-end';
  }

  return 'unknown';
}

/**
 * Get recommended settings for a hardware tier
 */
export function getTierSettings(tier: HardwareTier): TierSettings {
  switch (tier) {
    case 'high-end':
      return {
        particleCount: 15000,
        useInstancing: true,
        useSimplifiedAttractor: false,
        shadowQuality: 'high',
        postProcessing: true,
      };

    case 'mid-range':
      return {
        particleCount: 8000,
        useInstancing: true,
        useSimplifiedAttractor: false,
        shadowQuality: 'medium',
        postProcessing: true,
      };

    case 'low-end':
      return {
        particleCount: 3000,
        useInstancing: true,
        useSimplifiedAttractor: true,
        shadowQuality: 'none',
        postProcessing: false,
      };

    case 'unknown':
    default:
      // Conservative defaults
      return {
        particleCount: 5000,
        useInstancing: false,
        useSimplifiedAttractor: true,
        shadowQuality: 'low',
        postProcessing: false,
      };
  }
}

/**
 * Get a human-readable description of the GPU
 */
export function getGPUDescription(info: GPUInfo): string {
  const tierLabel = {
    'high-end': 'High-End',
    'mid-range': 'Mid-Range',
    'low-end': 'Low-End',
    unknown: 'Unknown',
  }[info.tier];

  return `${info.renderer} (${tierLabel})`;
}

/**
 * Singleton cached GPU info
 */
let cachedGPUInfo: GPUInfo | null = null;

/**
 * Get GPU info (cached)
 */
export function getGPUInfo(): GPUInfo {
  if (!cachedGPUInfo) {
    cachedGPUInfo = detectGPU();
  }
  return cachedGPUInfo;
}

/**
 * Reset cached GPU info (for testing)
 */
export function resetGPUInfoCache(): void {
  cachedGPUInfo = null;
}
