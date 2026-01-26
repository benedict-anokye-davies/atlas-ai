/**
 * Atlas Desktop - Enhanced GPGPU Particle System Component
 * React Three Fiber component using GPU-accelerated particle physics
 *
 * Features:
 * - 100k+ particles at 60fps via GPGPU simulation
 * - GPU-based particle trails with history texture
 * - Multiple trail styles (fading, energy, plasma)
 * - Audio-reactive particle behavior
 * - State-responsive animations
 * - HDR bloom support
 * - Adaptive quality based on GPU capability
 *
 * Optimized for RTX 3060 (6GB VRAM) and similar GPUs
 */

import { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  GPGPUParticleSystem,
  gpgpuParticleVertexShader,
  gpgpuParticleFragmentShader,
} from './gpgpu';
import {
  GPUTrailHistory,
  createTrailGeometry,
  createTrailUniforms,
  createTrailMaterial,
  TRAIL_STATE_PARAMS,
  DEFAULT_TRAIL_CONFIG,
  type TrailConfig,
} from './trail-system';
import { STATE_COLORS, STATE_PARAMS, type AtlasState } from './geometry';
import { HolographicRings } from './HolographicRings';

//=============================================================================
// TYPES
//=============================================================================

export type { AtlasState };

export interface EnhancedParticleConfig {
  particleCount: number;
  enableTrails: boolean;
  trailConfig: TrailConfig;
  performanceMode: 'ultra' | 'high' | 'balanced' | 'power-saver';
  enableHDR: boolean;
  enableAdaptiveQuality: boolean;
}

interface EnhancedAtlasParticlesProps {
  state?: AtlasState;
  audioLevel?: number;
  bass?: number;
  treble?: number;
  pulse?: number;
  config?: Partial<EnhancedParticleConfig>;
  onPerformanceChange?: (fps: number, particleCount: number) => void;
}

// State to numeric value for shader
const STATE_MAP: Record<AtlasState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
};

// Performance configurations
const PERFORMANCE_CONFIGS = {
  ultra: {
    particleCount: 150000,
    trailLength: 20,
    trailSampleRate: 1,
  },
  high: {
    particleCount: 100000,
    trailLength: 15,
    trailSampleRate: 2,
  },
  balanced: {
    particleCount: 60000,
    trailLength: 10,
    trailSampleRate: 3,
  },
  'power-saver': {
    particleCount: 30000,
    trailLength: 6,
    trailSampleRate: 4,
  },
};

//=============================================================================
// PARTICLE GEOMETRY CREATION
//=============================================================================

/**
 * Create particle geometry for GPGPU rendering
 * Positions are read from GPGPU texture, so we just need indices and attributes
 */
function createGPGPUParticleGeometry(
  particleCount: number,
  _textureSize: number
): {
  geometry: THREE.BufferGeometry;
  colors: Float32Array;
  alphas: Float32Array;
} {
  const positions = new Float32Array(particleCount * 3); // Dummy positions
  const particleIndices = new Float32Array(particleCount);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const alphas = new Float32Array(particleCount);

  // Two-layer color distribution (nucleus + shell)
  const nucleusRatio = 0.4; // 40% of particles in nucleus
  const nucleusCount = Math.floor(particleCount * nucleusRatio);

  for (let i = 0; i < particleCount; i++) {
    particleIndices[i] = i;

    if (i < nucleusCount) {
      // Nucleus - bright cyan/white
      colors[i * 3 + 0] = 0.8 + Math.random() * 0.2; // R
      colors[i * 3 + 1] = 0.95 + Math.random() * 0.05; // G
      colors[i * 3 + 2] = 1.0; // B
      sizes[i] = 0.02 + Math.random() * 0.03;
      alphas[i] = 0.7 + Math.random() * 0.3;
    } else {
      // Shell - golden/amber
      colors[i * 3 + 0] = 1.0; // R
      colors[i * 3 + 1] = 0.7 + Math.random() * 0.3; // G
      colors[i * 3 + 2] = Math.random() * 0.3; // B
      sizes[i] = 0.03 + Math.random() * 0.04;
      alphas[i] = 0.4 + Math.random() * 0.4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('particleIndex', new THREE.BufferAttribute(particleIndices, 1));
  geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

  // Set draw range
  geometry.setDrawRange(0, particleCount);

  return { geometry, colors, alphas };
}

//=============================================================================
// MAIN COMPONENT
//=============================================================================

export function EnhancedAtlasParticles({
  state = 'idle',
  audioLevel = 0,
  bass = 0,
  treble = 0,
  pulse = 0,
  config: userConfig,
  onPerformanceChange,
}: EnhancedAtlasParticlesProps) {
  // Three.js context
  const { gl } = useThree();

  // Refs
  const gpgpuRef = useRef<GPGPUParticleSystem | null>(null);
  const trailHistoryRef = useRef<GPUTrailHistory | null>(null);
  const particlePointsRef = useRef<THREE.Points | null>(null);
  const trailPointsRef = useRef<THREE.Points | null>(null);
  const frameCountRef = useRef(0);
  const fpsRef = useRef(60);
  const lastTimeRef = useRef(performance.now());

  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentPerformanceMode, setCurrentPerformanceMode] = useState<
    'ultra' | 'high' | 'balanced' | 'power-saver'
  >(userConfig?.performanceMode ?? 'high');

  // Merge config with defaults
  const config = useMemo<EnhancedParticleConfig>(() => {
    const perfConfig = PERFORMANCE_CONFIGS[userConfig?.performanceMode ?? 'high'];
    return {
      particleCount: userConfig?.particleCount ?? perfConfig.particleCount,
      enableTrails: userConfig?.enableTrails ?? true,
      trailConfig: { ...DEFAULT_TRAIL_CONFIG, ...userConfig?.trailConfig },
      performanceMode: userConfig?.performanceMode ?? 'high',
      enableHDR: userConfig?.enableHDR ?? true,
      enableAdaptiveQuality: userConfig?.enableAdaptiveQuality ?? true,
    };
  }, [userConfig]);

  // Calculate texture size for particle count
  const textureSize = useMemo(
    () => GPGPUParticleSystem.calculateTextureSize(config.particleCount),
    [config.particleCount]
  );

  // Initialize GPGPU system
  useEffect(() => {
    if (!gl) return;

    // Create GPGPU particle system
    const gpgpu = new GPGPUParticleSystem(gl);
    gpgpu.initialize({
      particleCount: textureSize * textureSize, // Must be square of texture size
      bounds: 3.0,
      initialRadius: 1.5,
    });
    gpgpuRef.current = gpgpu;

    // Create trail history system if trails enabled
    if (config.enableTrails) {
      const trailHistory = new GPUTrailHistory(
        gl,
        textureSize,
        config.trailConfig.length + 5 // Extra frames for buffer
      );
      trailHistoryRef.current = trailHistory;
    }

    setIsInitialized(true);

    return () => {
      gpgpu.dispose();
      trailHistoryRef.current?.dispose();
      gpgpuRef.current = null;
      trailHistoryRef.current = null;
      setIsInitialized(false);
    };
  }, [gl, textureSize, config.enableTrails, config.trailConfig.length]);

  // Create particle geometry and materials
  const { particleGeometry, particleMaterial, colors, alphas } = useMemo(() => {
    const particleCount = textureSize * textureSize;
    const { geometry, colors: c, alphas: a } = createGPGPUParticleGeometry(particleCount, textureSize);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tPositions: { value: null },
        uTextureSize: { value: textureSize },
        uTime: { value: 0 },
        uState: { value: 0 },
        uAudioLevel: { value: 0 },
        uGlowIntensity: { value: 0.8 },
        uStateColor: { value: new THREE.Vector3(0.0, 0.83, 1.0) },
        uColorMix: { value: 0 },
      },
      vertexShader: gpgpuParticleVertexShader,
      fragmentShader: gpgpuParticleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return { particleGeometry: geometry, particleMaterial: material, colors: c, alphas: a };
  }, [textureSize]);

  // Create trail geometry and materials
  const { trailGeometry, trailMaterial, trailUniforms } = useMemo(() => {
    if (!config.enableTrails) {
      return { trailGeometry: null, trailMaterial: null, trailUniforms: null };
    }

    const particleCount = textureSize * textureSize;
    const perfConfig = PERFORMANCE_CONFIGS[currentPerformanceMode];

    // Sample particles for trails (not all particles need trails)
    const trailParticleCount = Math.floor(particleCount / perfConfig.trailSampleRate);

    // Create sampled color/alpha arrays
    const sampledColors = new Float32Array(trailParticleCount * 3);
    const sampledAlphas = new Float32Array(trailParticleCount);

    for (let i = 0; i < trailParticleCount; i++) {
      const srcIdx = i * perfConfig.trailSampleRate;
      sampledColors[i * 3 + 0] = colors[srcIdx * 3 + 0];
      sampledColors[i * 3 + 1] = colors[srcIdx * 3 + 1];
      sampledColors[i * 3 + 2] = colors[srcIdx * 3 + 2];
      sampledAlphas[i] = alphas[srcIdx];
    }

    const geometry = createTrailGeometry(
      trailParticleCount,
      config.trailConfig.length,
      sampledColors,
      sampledAlphas
    );

    const uniforms = createTrailUniforms(config.trailConfig);
    uniforms.uTextureSize.value = textureSize;
    uniforms.uHistorySize.value = config.trailConfig.length + 5;

    const material = createTrailMaterial(uniforms);

    return { trailGeometry: geometry, trailMaterial: material, trailUniforms: uniforms };
  }, [config.enableTrails, config.trailConfig, textureSize, colors, alphas, currentPerformanceMode]);

  // Adaptive quality adjustment
  const adjustQuality = useCallback(() => {
    if (!config.enableAdaptiveQuality) return;

    const fps = fpsRef.current;
    let newMode = currentPerformanceMode;

    if (fps < 30 && currentPerformanceMode !== 'power-saver') {
      // Degrade quality
      if (currentPerformanceMode === 'ultra') newMode = 'high';
      else if (currentPerformanceMode === 'high') newMode = 'balanced';
      else if (currentPerformanceMode === 'balanced') newMode = 'power-saver';
    } else if (fps > 55 && currentPerformanceMode !== 'ultra') {
      // Improve quality
      if (currentPerformanceMode === 'power-saver') newMode = 'balanced';
      else if (currentPerformanceMode === 'balanced') newMode = 'high';
      else if (currentPerformanceMode === 'high') newMode = 'ultra';
    }

    if (newMode !== currentPerformanceMode) {
      setCurrentPerformanceMode(newMode);
    }
  }, [config.enableAdaptiveQuality, currentPerformanceMode]);

  // Animation loop
  useFrame((_, delta) => {
    if (!isInitialized || !gpgpuRef.current) return;

    frameCountRef.current++;
    const gpgpu = gpgpuRef.current;

    // Calculate FPS
    const now = performance.now();
    if (now - lastTimeRef.current > 1000) {
      fpsRef.current = Math.round(1000 / (now - lastTimeRef.current) * frameCountRef.current);
      frameCountRef.current = 0;
      lastTimeRef.current = now;

      // Adaptive quality check every second
      adjustQuality();

      // Notify parent of performance
      if (onPerformanceChange) {
        onPerformanceChange(fpsRef.current, gpgpu.getParticleCount());
      }
    }

    // Get state parameters
    const stateParams = STATE_PARAMS[state];
    const stateColor = STATE_COLORS[state];

    // Update GPGPU uniforms
    gpgpu.setUniforms({
      uState: STATE_MAP[state],
      uAudioLevel: audioLevel,
      uBass: bass,
      uTreble: treble,
      uPulse: pulse,
      uCurlStrength: 0.6 + audioLevel * 0.4,
      uTurbulence: stateParams.turbulence + bass * 0.3,
      uCenterAttraction: state === 'error' ? 0.2 : 0.5 + treble * 0.2,
    });

    // Run GPGPU simulation
    gpgpu.update(delta * stateParams.speedMultiplier);

    // Update particle material uniforms
    const positionTexture = gpgpu.getPositionTexture();
    if (particleMaterial && positionTexture) {
      particleMaterial.uniforms.tPositions.value = positionTexture;
      particleMaterial.uniforms.uTime.value += delta;
      particleMaterial.uniforms.uState.value = STATE_MAP[state];
      particleMaterial.uniforms.uAudioLevel.value = audioLevel;
      particleMaterial.uniforms.uGlowIntensity.value = stateParams.glowIntensity;
      particleMaterial.uniforms.uStateColor.value.set(stateColor.r, stateColor.g, stateColor.b);
      particleMaterial.uniforms.uColorMix.value = state === 'idle' ? 0 : 0.3;
    }

    // Update trail history
    if (config.enableTrails && trailHistoryRef.current && positionTexture) {
      // Update trail history with current positions
      if (frameCountRef.current % 2 === 0) { // Update every other frame for performance
        trailHistoryRef.current.update(positionTexture);
      }

      // Update trail uniforms
      if (trailUniforms) {
        const trailStateParams = config.trailConfig.stateResponsive
          ? TRAIL_STATE_PARAMS[state]
          : TRAIL_STATE_PARAMS.idle;

        trailUniforms.tTrailHistory.value = trailHistoryRef.current.getTexture();
        trailUniforms.uTime.value += delta;
        trailUniforms.uState.value = STATE_MAP[state];
        trailUniforms.uAudioLevel.value = config.trailConfig.audioReactive ? audioLevel : 0;
        trailUniforms.uTrailLength.value = Math.floor(
          config.trailConfig.length * trailStateParams.lengthMult
        );
        trailUniforms.uTrailWidth.value = config.trailConfig.width * trailStateParams.widthMult;
        trailUniforms.uOpacity.value = config.trailConfig.opacity * trailStateParams.opacityMult;
        trailUniforms.uGlowIntensity.value = stateParams.glowIntensity;
        trailUniforms.uStartColor.value.set(stateColor.r, stateColor.g, stateColor.b);
      }
    }
  });

  // Cleanup
  useEffect(() => {
    return () => {
      particleGeometry?.dispose();
      particleMaterial?.dispose();
      trailGeometry?.dispose();
      trailMaterial?.dispose();
    };
  }, [particleGeometry, particleMaterial, trailGeometry, trailMaterial]);

  if (!isInitialized) return null;

  return (
    <group>
      {/* Holographic Rings */}
      <HolographicRings state={state} audioLevel={audioLevel} />

      {/* Main particles */}
      <points
        ref={particlePointsRef}
        geometry={particleGeometry}
        material={particleMaterial}
        frustumCulled={false}
      />

      {/* Particle trails */}
      {config.enableTrails && trailGeometry && trailMaterial && (
        <points
          ref={trailPointsRef}
          geometry={trailGeometry}
          material={trailMaterial}
          frustumCulled={false}
        />
      )}
    </group>
  );
}

//=============================================================================
// EXPORTS
//=============================================================================

export { DEFAULT_TRAIL_CONFIG, PERFORMANCE_CONFIGS };
export default EnhancedAtlasParticles;
