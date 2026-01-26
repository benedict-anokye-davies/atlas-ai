/**
 * Atlas Desktop - AI Core Particle System with GPU Memory Management
 * Production-quality 2-layer particle visualization with bloom effects
 *
 * Features:
 * - GPU memory monitoring and adaptive quality
 * - LOD (Level of Detail) system for particles
 * - Texture atlas for efficient rendering
 * - Graceful degradation under GPU pressure
 * - Performance mode toggle
 * - Proper disposal of GPU resources
 *
 * Layers:
 * 1. Inner Nucleus - Dense, bright white/cyan particles
 * 2. Outer Shell - Sparse, golden/amber particles
 */

import { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  generateSpherePoints,
  generateParticleSizes,
  generateParticleAlphas,
  generateParticleColors,
  DEFAULT_LAYERS,
  STATE_COLORS,
  STATE_PARAMS,
  type LayerConfig,
} from './geometry';
import { particleVertexShader, particleFragmentShader, createShaderUniforms } from './shaders';
import type { ColorThemePreset } from './colorThemes';
import type { ParticleTrailConfig, TrailStyle } from '../../stores/atlasStore';
import { DEFAULT_TRAIL_CONFIG } from '../../stores/atlasStore';

// Type definitions
export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/** GPU memory status thresholds in MB */
export interface GPUMemoryThresholds {
  warning: number; // Start reducing quality
  critical: number; // Maximum degradation
  target: number; // Target memory usage
}

/** Performance mode configuration */
export interface PerformanceConfig {
  mode: 'high' | 'balanced' | 'power-saver';
  maxParticles: number;
  lodBias: number;
  textureResolution: number;
}

/** LOD level configuration */
export interface LODLevel {
  distance: number;
  particleMultiplier: number;
  sizeMultiplier: number;
}

interface AtlasParticlesProps {
  state?: AtlasState;
  audioLevel?: number;
  particleCount?: number;
  /** Performance mode: 'high' | 'balanced' | 'power-saver' */
  performanceMode?: PerformanceConfig['mode'];
  /** Enable GPU memory monitoring */
  enableMemoryMonitoring?: boolean;
  /** Custom GPU memory thresholds */
  memoryThresholds?: Partial<GPUMemoryThresholds>;
  /** Callback when performance degrades */
  onPerformanceChange?: (level: 'normal' | 'degraded' | 'minimal') => void;
  /** Color theme preset or 'custom' for custom colors */
  colorTheme?: ColorThemePreset | 'auto' | 'custom';
  /** Custom hue for custom color theme (0-1) */
  customHue?: number;
  /** Brightness multiplier (0.2-2.0) */
  brightness?: number;
  /** Saturation multiplier (0-2.0) */
  saturation?: number;
  /** Enable smooth color transitions between states */
  enableColorTransitions?: boolean;
  /** Color transition duration in seconds */
  colorTransitionDuration?: number;
  /** Particle trail configuration */
  trailConfig?: ParticleTrailConfig;
}

interface ParticleLayerData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  velocities: Float32Array;
  config: LayerConfig;
}

/** GPU memory information from WebGL extension */
interface GPUMemoryInfo {
  totalMemoryMB: number;
  usedMemoryMB: number;
  availableMemoryMB: number;
  percentUsed: number;
}

// State to numeric value for shader
const STATE_MAP: Record<AtlasState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
};

// Default GPU memory thresholds (in MB)
const DEFAULT_MEMORY_THRESHOLDS: GPUMemoryThresholds = {
  warning: 256, // Start reducing quality at 256MB available
  critical: 128, // Maximum degradation at 128MB available
  target: 384, // Target to maintain 384MB available
};

// Performance mode configurations
// Optimized for modern GPUs (RTX 3060+)
const PERFORMANCE_CONFIGS: Record<PerformanceConfig['mode'], PerformanceConfig> = {
  high: {
    mode: 'high',
    maxParticles: 100000,  // RTX 3060 can handle 100k easily
    lodBias: 1.0,
    textureResolution: 256,
  },
  balanced: {
    mode: 'balanced',
    maxParticles: 60000,
    lodBias: 0.8,
    textureResolution: 128,
  },
  'power-saver': {
    mode: 'power-saver',
    maxParticles: 30000,
    lodBias: 0.5,
    textureResolution: 64,
  },
};

// LOD levels based on camera distance
const LOD_LEVELS: LODLevel[] = [
  { distance: 0, particleMultiplier: 1.0, sizeMultiplier: 1.0 }, // Full detail
  { distance: 10, particleMultiplier: 0.75, sizeMultiplier: 1.2 }, // Medium
  { distance: 20, particleMultiplier: 0.5, sizeMultiplier: 1.5 }, // Low
  { distance: 40, particleMultiplier: 0.25, sizeMultiplier: 2.0 }, // Minimal
];

/**
 * GPU Memory Manager - Monitors and manages GPU memory usage
 */
class GPUMemoryManager {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private trackedResources: Map<string, { type: string; size: number; timestamp: number }> =
    new Map();
  private lastCleanup = 0;
  private cleanupInterval = 5000; // Check every 5 seconds

  initialize(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.gl = gl;
    // Note: debug info extension available via gl.getExtension('WEBGL_debug_renderer_info')
    // Note: WEBGL_memory_info is not standard but available in some browsers
  }

  /**
   * Get GPU memory information (estimates if extension not available)
   */
  getMemoryInfo(): GPUMemoryInfo {
    // Calculate from tracked resources
    let trackedSize = 0;
    this.trackedResources.forEach((resource) => {
      trackedSize += resource.size;
    });

    // Try to get actual GPU memory info (Chrome extension)
    const glAny = this.gl as WebGLRenderingContext & {
      getParameter(pname: number): number | null;
    };

    // Try WEBGL_memory_info extension (non-standard but available in some browsers)
    const memoryExt = this.gl?.getExtension('WEBGL_memory_info') as {
      GPU_MEMORY_INFO_TOTAL_AVAILABLE_MEMORY_NVX?: number;
      GPU_MEMORY_INFO_CURRENT_AVAILABLE_VIDMEM_NVX?: number;
    } | null;

    if (memoryExt) {
      try {
        const total = glAny.getParameter(memoryExt.GPU_MEMORY_INFO_TOTAL_AVAILABLE_MEMORY_NVX || 0);
        const available = glAny.getParameter(
          memoryExt.GPU_MEMORY_INFO_CURRENT_AVAILABLE_VIDMEM_NVX || 0
        );

        if (total && available) {
          const totalMB = (total as number) / 1024;
          const availableMB = (available as number) / 1024;
          const usedMB = totalMB - availableMB;

          return {
            totalMemoryMB: totalMB,
            usedMemoryMB: usedMB,
            availableMemoryMB: availableMB,
            percentUsed: (usedMB / totalMB) * 100,
          };
        }
      } catch {
        // Extension not available or error reading values
      }
    }

    // Fallback: estimate based on tracked resources
    const estimatedTotalMB = 1024; // Assume 1GB GPU memory
    const estimatedUsedMB = trackedSize / (1024 * 1024);

    return {
      totalMemoryMB: estimatedTotalMB,
      usedMemoryMB: estimatedUsedMB,
      availableMemoryMB: estimatedTotalMB - estimatedUsedMB,
      percentUsed: (estimatedUsedMB / estimatedTotalMB) * 100,
    };
  }

  /**
   * Track a GPU resource for memory management
   */
  trackResource(id: string, type: 'geometry' | 'material' | 'texture', sizeBytes: number): void {
    this.trackedResources.set(id, {
      type,
      size: sizeBytes,
      timestamp: Date.now(),
    });
  }

  /**
   * Untrack a disposed resource
   */
  untrackResource(id: string): void {
    this.trackedResources.delete(id);
  }

  /**
   * Calculate estimated size of a BufferGeometry
   */
  static calculateGeometrySize(geometry: THREE.BufferGeometry): number {
    let size = 0;
    const attributes = geometry.attributes;

    for (const key in attributes) {
      const attr = attributes[key] as THREE.BufferAttribute;
      if (attr.array) {
        size += attr.array.byteLength;
      }
    }

    if (geometry.index) {
      size += geometry.index.array.byteLength;
    }

    return size;
  }

  /**
   * Calculate estimated size of a texture
   */
  static calculateTextureSize(texture: THREE.Texture): number {
    const image = texture.image;
    if (!image) return 0;

    const width = image.width || 256;
    const height = image.height || 256;
    const bytesPerPixel = 4; // RGBA

    // Account for mipmaps (roughly 1.33x the base size)
    return width * height * bytesPerPixel * 1.33;
  }

  /**
   * Check if cleanup is needed based on memory pressure
   */
  shouldCleanup(thresholds: GPUMemoryThresholds): boolean {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return false;
    }

    const memInfo = this.getMemoryInfo();
    return memInfo.availableMemoryMB < thresholds.warning;
  }

  /**
   * Clean up old/unused resources
   */
  cleanup(maxAge: number = 30000): string[] {
    const now = Date.now();
    const disposed: string[] = [];

    this.trackedResources.forEach((resource, id) => {
      if (now - resource.timestamp > maxAge) {
        disposed.push(id);
        this.trackedResources.delete(id);
      }
    });

    this.lastCleanup = now;
    return disposed;
  }

  /**
   * Get current tracked resources summary
   */
  getResourceSummary(): { count: number; totalSizeMB: number; byType: Record<string, number> } {
    let totalSize = 0;
    const byType: Record<string, number> = {};

    this.trackedResources.forEach((resource) => {
      totalSize += resource.size;
      byType[resource.type] = (byType[resource.type] || 0) + resource.size;
    });

    return {
      count: this.trackedResources.size,
      totalSizeMB: totalSize / (1024 * 1024),
      byType,
    };
  }
}

// Singleton instance for memory management
const gpuMemoryManager = new GPUMemoryManager();

/**
 * Create a particle texture atlas for efficient rendering
 */
function createParticleTextureAtlas(resolution: number = 128): THREE.DataTexture {
  const size = resolution;
  const data = new Uint8Array(size * size * 4);

  // Create multiple particle styles in the atlas
  const halfSize = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Determine which quadrant (for different particle styles)
      const quadX = x < halfSize ? 0 : 1;
      const quadY = y < halfSize ? 0 : 1;

      // Local coordinates within quadrant
      const lx = ((x % halfSize) / halfSize) * 2 - 1;
      const ly = ((y % halfSize) / halfSize) * 2 - 1;
      const dist = Math.sqrt(lx * lx + ly * ly);

      let alpha = 0;
      let brightness = 255;

      if (quadX === 0 && quadY === 0) {
        // Soft glow particle
        alpha = Math.max(0, 1 - dist) * 255;
        brightness = 255;
      } else if (quadX === 1 && quadY === 0) {
        // Hard core particle
        alpha = dist < 0.5 ? 255 : Math.max(0, 1 - (dist - 0.5) * 2) * 255;
        brightness = dist < 0.3 ? 255 : 200;
      } else if (quadX === 0 && quadY === 1) {
        // Halo particle
        const ring = Math.abs(dist - 0.6);
        alpha = Math.max(0, 1 - ring * 3) * 255;
        brightness = 255;
      } else {
        // Dust particle
        alpha = Math.max(0, 1 - dist * dist) * 200;
        brightness = 220;
      }

      data[i] = brightness; // R
      data[i + 1] = brightness; // G
      data[i + 2] = brightness; // B
      data[i + 3] = alpha; // A
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  return texture;
}

/**
 * Hook to manage GPU memory monitoring
 */
function useGPUMemoryMonitoring(
  enabled: boolean,
  thresholds: GPUMemoryThresholds,
  onPressure: (level: 'normal' | 'warning' | 'critical') => void
) {
  const { gl } = useThree();
  const lastCheckRef = useRef(0);
  const checkInterval = 2000; // Check every 2 seconds

  useEffect(() => {
    if (enabled && gl) {
      gpuMemoryManager.initialize(gl.getContext() as WebGLRenderingContext);
    }
  }, [enabled, gl]);

  useFrame(() => {
    if (!enabled) return;

    const now = Date.now();
    if (now - lastCheckRef.current < checkInterval) return;
    lastCheckRef.current = now;

    const memInfo = gpuMemoryManager.getMemoryInfo();

    if (memInfo.availableMemoryMB < thresholds.critical) {
      onPressure('critical');
    } else if (memInfo.availableMemoryMB < thresholds.warning) {
      onPressure('warning');
    } else {
      onPressure('normal');
    }
  });

  return gpuMemoryManager;
}

/**
 * Calculate LOD level based on camera distance
 */
function calculateLOD(cameraDistance: number, lodBias: number): LODLevel {
  const adjustedDistance = cameraDistance / lodBias;

  for (let i = LOD_LEVELS.length - 1; i >= 0; i--) {
    if (adjustedDistance >= LOD_LEVELS[i].distance) {
      return LOD_LEVELS[i];
    }
  }

  return LOD_LEVELS[0];
}

/**
 * Single particle layer component with memory management
 */
function ParticleLayer({
  data,
  state,
  audioLevel,
  groupRef,
  textureAtlas: _textureAtlas,
  lodLevel,
  onDispose,
}: {
  data: ParticleLayerData;
  state: AtlasState;
  audioLevel: number;
  groupRef: React.RefObject<THREE.Group>;
  textureAtlas: THREE.DataTexture | null;
  lodLevel: LODLevel;
  onDispose?: () => void;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const resourceId = useRef(`layer-${data.config.name}-${Date.now()}`);

  // Create shader uniforms
  const uniforms = useMemo(() => {
    return createShaderUniforms();
  }, []);

  // Create shader material with proper disposal tracking
  const shaderMaterial = useMemo(() => {
    try {
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      materialRef.current = mat;

      // Track resource
      gpuMemoryManager.trackResource(
        `${resourceId.current}-material`,
        'material',
        1024 // Approximate shader material size
      );

      return mat;
    } catch (err) {
      console.error(`[ParticleLayer:${data.config.name}] ShaderMaterial creation failed:`, err);
      throw err;
    }
  }, [uniforms, data.config.name]);

  // Animation loop with LOD-aware rendering
  useFrame((_threeState, delta) => {
    if (!pointsRef.current) return;

    const stateParams = STATE_PARAMS[state];
    const stateColor = STATE_COLORS[state];

    // Update uniforms directly on the material
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uState.value = STATE_MAP[state];
    shaderMaterial.uniforms.uAudioLevel.value = audioLevel;
    shaderMaterial.uniforms.uSpeedMultiplier.value = stateParams.speedMultiplier;
    shaderMaterial.uniforms.uTurbulence.value = stateParams.turbulence;
    shaderMaterial.uniforms.uGlowIntensity.value =
      stateParams.glowIntensity * lodLevel.sizeMultiplier;
    shaderMaterial.uniforms.uStateColor.value.set(stateColor.r, stateColor.g, stateColor.b);
    shaderMaterial.uniforms.uColorMix.value = state === 'idle' ? 0 : 0.3;

    // Rotate the layer group
    if (groupRef.current) {
      const rotSpeed = data.config.rotationSpeed * stateParams.speedMultiplier;
      groupRef.current.rotation.y += delta * rotSpeed;
    }
  });

  // Create buffer geometry with attributes using useMemo for performance
  const geometry = useMemo(() => {
    try {
      // Apply LOD particle reduction
      const lodParticleCount = Math.floor(
        (data.positions.length / 3) * lodLevel.particleMultiplier
      );
      const stride = Math.ceil(data.positions.length / 3 / lodParticleCount);

      // Create reduced arrays based on LOD
      const reducedPositions = new Float32Array(lodParticleCount * 3);
      const reducedColors = new Float32Array(lodParticleCount * 3);
      const reducedSizes = new Float32Array(lodParticleCount);
      const reducedAlphas = new Float32Array(lodParticleCount);
      const reducedVelocities = new Float32Array(lodParticleCount * 3);

      for (
        let i = 0, j = 0;
        i < lodParticleCount && j * stride < data.positions.length / 3;
        i++, j++
      ) {
        const srcIdx = j * stride;

        reducedPositions[i * 3] = data.positions[srcIdx * 3];
        reducedPositions[i * 3 + 1] = data.positions[srcIdx * 3 + 1];
        reducedPositions[i * 3 + 2] = data.positions[srcIdx * 3 + 2];

        reducedColors[i * 3] = data.colors[srcIdx * 3];
        reducedColors[i * 3 + 1] = data.colors[srcIdx * 3 + 1];
        reducedColors[i * 3 + 2] = data.colors[srcIdx * 3 + 2];

        reducedSizes[i] = data.sizes[srcIdx] * lodLevel.sizeMultiplier;
        reducedAlphas[i] = data.alphas[srcIdx];

        reducedVelocities[i * 3] = data.velocities[srcIdx * 3];
        reducedVelocities[i * 3 + 1] = data.velocities[srcIdx * 3 + 1];
        reducedVelocities[i * 3 + 2] = data.velocities[srcIdx * 3 + 2];
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(reducedPositions, 3));
      geo.setAttribute('customColor', new THREE.BufferAttribute(reducedColors, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(reducedSizes, 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(reducedAlphas, 1));
      geo.setAttribute('velocity', new THREE.BufferAttribute(reducedVelocities, 3));

      geometryRef.current = geo;

      // Track resource
      const geoSize = GPUMemoryManager.calculateGeometrySize(geo);
      gpuMemoryManager.trackResource(`${resourceId.current}-geometry`, 'geometry', geoSize);

      return geo;
    } catch (err) {
      console.error(`[ParticleLayer:${data.config.name}] BufferGeometry creation failed:`, err);
      throw err;
    }
  }, [data, lodLevel]);

  // Cleanup on unmount - proper disposal of GPU resources
  useEffect(() => {
    const currentResourceId = resourceId.current;
    return () => {
      // Dispose geometry
      if (geometryRef.current) {
        geometryRef.current.dispose();
        gpuMemoryManager.untrackResource(`${currentResourceId}-geometry`);
      }

      // Dispose material
      if (materialRef.current) {
        materialRef.current.dispose();
        gpuMemoryManager.untrackResource(`${currentResourceId}-material`);
      }

      onDispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDispose]);

  // eslint-disable-next-line react/no-unknown-property
  return <points ref={pointsRef} geometry={geometry} material={shaderMaterial} />;
}

// ============================================================================
// PARTICLE TRAILS SYSTEM
// ============================================================================

/**
 * Trail vertex shader - renders trail segments using instanced geometry
 */
const trailVertexShader = /* glsl */ `
  attribute float trailIndex;      // Which segment in the trail (0 = newest, length-1 = oldest)
  attribute vec3 trailPosition;    // Historical position
  attribute vec3 trailColor;       // Color at this segment
  attribute float trailAlpha;      // Alpha at this segment

  uniform float uTime;
  uniform float uTrailLength;
  uniform float uTrailWidth;
  uniform float uFadeExponent;     // How quickly trail fades
  uniform int uTrailStyle;         // 0=solid, 1=dotted, 2=fading
  uniform float uStateSpeedMult;   // State-based speed multiplier

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTrailProgress;    // 0 at particle, 1 at trail end

  void main() {
    // Calculate trail progress (0 = newest, 1 = oldest)
    vTrailProgress = trailIndex / max(1.0, uTrailLength - 1.0);

    // Pass color to fragment shader
    vColor = trailColor;

    // Calculate alpha with fade effect based on trail style
    float baseAlpha = trailAlpha;

    if (uTrailStyle == 2) {
      // Fading style - exponential falloff
      baseAlpha *= pow(1.0 - vTrailProgress, uFadeExponent);
    } else if (uTrailStyle == 1) {
      // Dotted style - alternating visibility
      float dotPattern = step(0.5, fract(vTrailProgress * uTrailLength * 2.0));
      baseAlpha *= mix(0.3, 1.0, dotPattern);
    }
    // Solid style - no modification

    vAlpha = baseAlpha;

    // Position with slight offset based on trail index for depth separation
    vec3 pos = trailPosition;

    // Calculate point size based on trail progress (smaller towards end)
    float sizeFalloff = 1.0 - vTrailProgress * 0.7;
    gl_PointSize = uTrailWidth * sizeFalloff * 3.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Trail fragment shader - renders trail points with glow
 */
const trailFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uGlowIntensity;
  uniform int uTrailStyle;
  uniform bool uColorGradient;
  uniform vec3 uEndColor;         // Color at trail end for gradient

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTrailProgress;

  void main() {
    // Distance from center of point sprite
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Discard pixels outside radius
    if (dist > 0.5) discard;

    // Soft glow falloff
    float glow = exp(-dist * 4.0);

    // Apply color gradient along trail if enabled
    vec3 finalColor = vColor;
    if (uColorGradient) {
      finalColor = mix(vColor, uEndColor, vTrailProgress * 0.6);
    }

    // Add glow effect
    finalColor *= (1.0 + glow * uGlowIntensity * 0.5);

    // Calculate final alpha
    float alpha = glow * vAlpha;

    // Minimum alpha threshold
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/**
 * Trail history buffer for storing particle positions over time
 */
interface TrailHistoryBuffer {
  positions: Float32Array[]; // Ring buffer of position arrays
  colors: Float32Array[]; // Ring buffer of color arrays
  currentIndex: number; // Current write index in ring buffer
  maxLength: number; // Maximum trail length
}

/**
 * Create trail history buffer
 */
function createTrailHistoryBuffer(particleCount: number, maxLength: number): TrailHistoryBuffer {
  const positions: Float32Array[] = [];
  const colors: Float32Array[] = [];

  for (let i = 0; i < maxLength; i++) {
    positions.push(new Float32Array(particleCount * 3));
    colors.push(new Float32Array(particleCount * 3));
  }

  return {
    positions,
    colors,
    currentIndex: 0,
    maxLength,
  };
}

/**
 * Update trail history with current particle positions
 */
function updateTrailHistory(
  buffer: TrailHistoryBuffer,
  currentPositions: Float32Array,
  currentColors: Float32Array
): void {
  // Copy current positions to the current slot in the ring buffer
  buffer.positions[buffer.currentIndex].set(currentPositions);
  buffer.colors[buffer.currentIndex].set(currentColors);

  // Advance ring buffer index
  buffer.currentIndex = (buffer.currentIndex + 1) % buffer.maxLength;
}

/**
 * Get trail data for rendering (flattened for instanced rendering)
 */
function getTrailRenderData(
  buffer: TrailHistoryBuffer,
  trailLength: number,
  sampleRate: number = 1
): {
  positions: Float32Array;
  colors: Float32Array;
  indices: Float32Array;
  alphas: Float32Array;
} {
  const actualLength = Math.min(trailLength, buffer.maxLength);
  const particleCount = buffer.positions[0].length / 3;
  const sampledParticles = Math.floor(particleCount / sampleRate);
  const totalPoints = sampledParticles * actualLength;

  const positions = new Float32Array(totalPoints * 3);
  const colors = new Float32Array(totalPoints * 3);
  const indices = new Float32Array(totalPoints);
  const alphas = new Float32Array(totalPoints);

  let writeIdx = 0;

  for (let segIdx = 0; segIdx < actualLength; segIdx++) {
    // Get the correct buffer index (oldest to newest)
    const bufferIdx = (buffer.currentIndex - 1 - segIdx + buffer.maxLength) % buffer.maxLength;
    const segPositions = buffer.positions[bufferIdx];
    const segColors = buffer.colors[bufferIdx];

    for (let pIdx = 0; pIdx < particleCount; pIdx += sampleRate) {
      const srcIdx = pIdx * 3;
      const dstIdx = writeIdx * 3;

      positions[dstIdx] = segPositions[srcIdx];
      positions[dstIdx + 1] = segPositions[srcIdx + 1];
      positions[dstIdx + 2] = segPositions[srcIdx + 2];

      colors[dstIdx] = segColors[srcIdx];
      colors[dstIdx + 1] = segColors[srcIdx + 1];
      colors[dstIdx + 2] = segColors[srcIdx + 2];

      indices[writeIdx] = segIdx;
      alphas[writeIdx] = 1.0 - (segIdx / actualLength) * 0.5;

      writeIdx++;
    }
  }

  return { positions, colors, indices, alphas };
}

/**
 * State-responsive trail parameters
 */
const TRAIL_STATE_PARAMS: Record<
  AtlasState,
  { lengthMult: number; opacityMult: number; speedMult: number }
> = {
  idle: { lengthMult: 0.5, opacityMult: 0.6, speedMult: 0.3 },
  listening: { lengthMult: 0.8, opacityMult: 0.8, speedMult: 1.0 },
  thinking: { lengthMult: 1.5, opacityMult: 1.0, speedMult: 2.5 },
  speaking: { lengthMult: 1.2, opacityMult: 0.9, speedMult: 1.2 },
  error: { lengthMult: 0.3, opacityMult: 1.2, speedMult: 0.5 },
};

/**
 * Trail style to shader value
 */
const TRAIL_STYLE_MAP: Record<TrailStyle, number> = {
  solid: 0,
  dotted: 1,
  fading: 2,
};

/**
 * ParticleTrails component - renders motion trails for particles
 * Uses instanced geometry for performance optimization
 */
// @ts-expect-error Reserved for future particle trail feature
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ParticleTrails({
  config,
  particlePositions,
  particleColors,
  state,
  groupRef: _groupRef,
}: {
  config: ParticleTrailConfig;
  particlePositions: Float32Array;
  particleColors: Float32Array;
  state: AtlasState;
  groupRef: React.RefObject<THREE.Group>;
}) {
  const trailMeshRef = useRef<THREE.Points>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const historyBufferRef = useRef<TrailHistoryBuffer | null>(null);
  const frameCountRef = useRef(0);
  const resourceId = useRef(`trails-${Date.now()}`);

  // Initialize or update trail history buffer
  const particleCount = particlePositions.length / 3;
  const maxTrailLength = 20; // Maximum supported trail length

  // Create history buffer if needed
  useEffect(() => {
    if (
      !historyBufferRef.current ||
      historyBufferRef.current.positions[0].length !== particlePositions.length
    ) {
      historyBufferRef.current = createTrailHistoryBuffer(particleCount, maxTrailLength);
    }
  }, [particleCount, particlePositions.length]);

  // Create shader uniforms
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTrailLength: { value: config.length },
      uTrailWidth: { value: config.width },
      uFadeExponent: { value: 2.0 },
      uTrailStyle: { value: TRAIL_STYLE_MAP[config.style] },
      uStateSpeedMult: { value: 1.0 },
      uGlowIntensity: { value: 0.8 },
      uColorGradient: { value: config.colorGradient },
      uEndColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    }),
    [config.length, config.width, config.style, config.colorGradient]
  );

  // Create shader material
  const shaderMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    materialRef.current = mat;

    gpuMemoryManager.trackResource(`${resourceId.current}-material`, 'material', 1024);

    return mat;
  }, [uniforms]);

  // Create geometry (will be updated each frame)
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geometryRef.current = geo;
    return geo;
  }, []);

  // Animation loop - update trail history and render
  useFrame((_, delta) => {
    if (!historyBufferRef.current || !config.enabled) return;

    frameCountRef.current++;

    // Get state-responsive parameters
    const stateParams = config.stateResponsive
      ? TRAIL_STATE_PARAMS[state]
      : TRAIL_STATE_PARAMS.idle;

    // Update history every few frames for performance (but ensure smooth trails)
    const updateInterval = Math.max(1, Math.floor(3 / stateParams.speedMult));
    if (frameCountRef.current % updateInterval === 0) {
      updateTrailHistory(historyBufferRef.current, particlePositions, particleColors);
    }

    // Calculate effective trail length based on state
    const effectiveLength = Math.floor(config.length * stateParams.lengthMult);

    // Sample rate for performance (render fewer particles in trails)
    const sampleRate = Math.max(1, Math.floor(particleCount / 2000));

    // Get trail render data
    const trailData = getTrailRenderData(historyBufferRef.current, effectiveLength, sampleRate);

    // Update geometry attributes
    if (geometryRef.current && trailData.positions.length > 0) {
      const posAttr = geometryRef.current.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = geometryRef.current.getAttribute('trailColor') as THREE.BufferAttribute;
      const indexAttr = geometryRef.current.getAttribute('trailIndex') as THREE.BufferAttribute;
      const alphaAttr = geometryRef.current.getAttribute('trailAlpha') as THREE.BufferAttribute;

      // Check if we need to recreate attributes (size changed)
      if (!posAttr || posAttr.array.length !== trailData.positions.length) {
        geometryRef.current.setAttribute(
          'position',
          new THREE.BufferAttribute(trailData.positions, 3)
        );
        geometryRef.current.setAttribute(
          'trailColor',
          new THREE.BufferAttribute(trailData.colors, 3)
        );
        geometryRef.current.setAttribute(
          'trailIndex',
          new THREE.BufferAttribute(trailData.indices, 1)
        );
        geometryRef.current.setAttribute(
          'trailAlpha',
          new THREE.BufferAttribute(trailData.alphas, 1)
        );
      } else {
        // Update existing attributes
        (posAttr.array as Float32Array).set(trailData.positions);
        (colorAttr.array as Float32Array).set(trailData.colors);
        (indexAttr.array as Float32Array).set(trailData.indices);
        (alphaAttr.array as Float32Array).set(trailData.alphas);

        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        indexAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
      }
    }

    // Update uniforms
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uTrailLength.value = effectiveLength;
    shaderMaterial.uniforms.uStateSpeedMult.value = stateParams.speedMult;
    shaderMaterial.uniforms.uGlowIntensity.value = 0.8 * stateParams.opacityMult;

    // Update end color based on state
    const stateColor = STATE_COLORS[state];
    shaderMaterial.uniforms.uEndColor.value.set(
      stateColor.r * 0.5,
      stateColor.g * 0.5,
      stateColor.b * 0.5
    );
  });

  // Cleanup on unmount
  useEffect(() => {
    const currentResourceId = resourceId.current;
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        gpuMemoryManager.untrackResource(`${currentResourceId}-geometry`);
      }
      if (materialRef.current) {
        materialRef.current.dispose();
        gpuMemoryManager.untrackResource(`${currentResourceId}-material`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!config.enabled) return null;

  // eslint-disable-next-line react/no-unknown-property
  return <points ref={trailMeshRef} geometry={geometry} material={shaderMaterial} />;
}

/**
 * Generate layer data based on configuration
 */
function generateLayerData(config: LayerConfig): ParticleLayerData {
  const {
    particleCount,
    radius,
    variance,
    baseColor,
    colorVariance,
    minSize,
    maxSize,
    minAlpha,
    maxAlpha,
  } = config;

  // Generate sphere positions for all layers
  const positions = generateSpherePoints(particleCount, radius, variance);

  const colors = generateParticleColors(particleCount, baseColor, colorVariance);
  const sizes = generateParticleSizes(particleCount, minSize, maxSize);
  const alphas = generateParticleAlphas(particleCount, minAlpha, maxAlpha);

  // Generate random velocities for organic movement
  const velocities = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = 0.05 + Math.random() * 0.1;
    velocities[i * 3] = Math.sin(theta) * Math.cos(phi) * speed;
    velocities[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * speed;
    velocities[i * 3 + 2] = Math.cos(theta) * speed;
  }

  return { positions, colors, sizes, alphas, velocities, config };
}

/**
 * Atlas Particles - The 2-layer AI Core visualization with GPU memory management
 */
export function AtlasParticles({
  state = 'idle',
  audioLevel = 0,
  particleCount = 30000,
  performanceMode = 'balanced',
  enableMemoryMonitoring = true,
  memoryThresholds,
  onPerformanceChange,
  trailConfig: _trailConfig = DEFAULT_TRAIL_CONFIG,
}: AtlasParticlesProps) {
  // Refs for each layer group (for rotation)
  const nucleusGroupRef = useRef<THREE.Group>(null);
  const shellGroupRef = useRef<THREE.Group>(null);

  // Performance state
  const [memoryPressure, setMemoryPressure] = useState<'normal' | 'warning' | 'critical'>('normal');
  const [currentLOD, setCurrentLOD] = useState<LODLevel>(LOD_LEVELS[0]);

  // Get Three.js context for camera distance calculation
  const { camera } = useThree();

  // Texture atlas for efficient particle rendering
  const textureAtlas = useMemo(() => {
    const config = PERFORMANCE_CONFIGS[performanceMode];
    const texture = createParticleTextureAtlas(config.textureResolution);

    // Track texture resource
    gpuMemoryManager.trackResource(
      'texture-atlas',
      'texture',
      GPUMemoryManager.calculateTextureSize(texture)
    );

    return texture;
  }, [performanceMode]);

  // Merge memory thresholds with defaults
  const effectiveThresholds = useMemo<GPUMemoryThresholds>(
    () => ({
      ...DEFAULT_MEMORY_THRESHOLDS,
      ...memoryThresholds,
    }),
    [memoryThresholds]
  );

  // GPU memory monitoring hook
  useGPUMemoryMonitoring(
    enableMemoryMonitoring,
    effectiveThresholds,
    useCallback((level) => {
      setMemoryPressure(level);
    }, [])
  );

  // Calculate effective particle count based on performance mode and memory pressure
  const effectiveParticleCount = useMemo(() => {
    const config = PERFORMANCE_CONFIGS[performanceMode];
    let count = Math.min(particleCount, config.maxParticles);

    // Reduce particles under memory pressure
    if (memoryPressure === 'warning') {
      count = Math.floor(count * 0.7);
    } else if (memoryPressure === 'critical') {
      count = Math.floor(count * 0.4);
    }

    return count;
  }, [particleCount, performanceMode, memoryPressure]);

  // Update LOD based on camera distance
  useFrame(() => {
    const distance = camera.position.length();
    const config = PERFORMANCE_CONFIGS[performanceMode];
    const newLOD = calculateLOD(distance, config.lodBias);

    if (newLOD.distance !== currentLOD.distance) {
      setCurrentLOD(newLOD);
    }
  });

  // Notify about performance changes
  useEffect(() => {
    if (onPerformanceChange) {
      const level =
        memoryPressure === 'critical'
          ? 'minimal'
          : memoryPressure === 'warning'
            ? 'degraded'
            : 'normal';
      onPerformanceChange(level);
    }
  }, [memoryPressure, onPerformanceChange]);

  // Scale particle counts based on prop (ratio from DEFAULT_LAYERS - only nucleus and shell)
  const getScaledLayers = useCallback((): LayerConfig[] => {
    // Only use nucleus and shell layers
    const sphereLayers = DEFAULT_LAYERS.filter((l) => l.name === 'nucleus' || l.name === 'shell');
    const totalDefault = sphereLayers.reduce((sum, l) => sum + l.particleCount, 0);
    const scale = effectiveParticleCount / totalDefault;

    return sphereLayers.map((layer) => ({
      ...layer,
      particleCount: Math.max(500, Math.floor(layer.particleCount * scale)),
    }));
  }, [effectiveParticleCount]);

  // Generate layer data - memoized for performance
  const layers = useMemo(() => {
    const scaledLayers = getScaledLayers();
    return scaledLayers.map((config) => generateLayerData(config));
  }, [getScaledLayers]);

  // Find layers by name
  const nucleusData = layers.find((l) => l.config.name === 'nucleus')!;
  const shellData = layers.find((l) => l.config.name === 'shell')!;

  // Cleanup texture atlas on unmount
  useEffect(() => {
    return () => {
      textureAtlas.dispose();
      gpuMemoryManager.untrackResource('texture-atlas');
    };
  }, [textureAtlas]);

  // Log performance mode changes in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('[AtlasParticles] Performance config:', {
        mode: performanceMode,
        effectiveParticles: effectiveParticleCount,
        memoryPressure,
        lodLevel: currentLOD.distance,
        resourceSummary: gpuMemoryManager.getResourceSummary(),
      });
    }
  }, [performanceMode, effectiveParticleCount, memoryPressure, currentLOD]);

  return (
    <>
      {/* Inner Nucleus - Dense white/cyan core */}
      <group ref={nucleusGroupRef}>
        <ParticleLayer
          data={nucleusData}
          state={state}
          audioLevel={audioLevel}
          groupRef={nucleusGroupRef}
          textureAtlas={textureAtlas}
          lodLevel={currentLOD}
        />
      </group>

      {/* Outer Shell - Sparse golden particles */}
      <group ref={shellGroupRef}>
        <ParticleLayer
          data={shellData}
          state={state}
          audioLevel={audioLevel}
          groupRef={shellGroupRef}
          textureAtlas={textureAtlas}
          lodLevel={currentLOD}
        />
      </group>
    </>
  );
}

// Export memory manager for external monitoring
export { gpuMemoryManager, GPUMemoryManager };
export type { GPUMemoryInfo };

export default AtlasParticles;
