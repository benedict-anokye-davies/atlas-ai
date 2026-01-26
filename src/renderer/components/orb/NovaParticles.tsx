/* eslint-disable no-console */
/**
 * Atlas Desktop - AI Core Particle System
 * Production-quality 2-layer particle visualization with bloom effects
 *
 * Layers:
 * 1. Inner Nucleus - Dense, bright white/cyan particles
 * 2. Outer Shell - Sparse, golden/amber particles
 */

import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
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

// Type definitions
export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface AtlasParticlesProps {
  state?: AtlasState;
  audioLevel?: number;
  particleCount?: number;
}

interface ParticleLayerData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  velocities: Float32Array;
  config: LayerConfig;
}

// State to numeric value for shader
const STATE_MAP: Record<AtlasState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
};

/**
 * Single particle layer component
 */
function ParticleLayer({
  data,
  state,
  audioLevel,
  groupRef,
}: {
  data: ParticleLayerData;
  state: AtlasState;
  audioLevel: number;
  groupRef: React.RefObject<THREE.Group>;
}) {
  const pointsRef = useRef<THREE.Points>(null);

  // Create shader uniforms
  const uniforms = useMemo(() => {
    console.log(`[ParticleLayer:${data.config.name}] Creating uniforms`);
    return createShaderUniforms();
  }, [data.config.name]);

  // Create shader material
  const shaderMaterial = useMemo(() => {
    console.log(`[ParticleLayer:${data.config.name}] Creating ShaderMaterial`);
    try {
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      console.log(`[ParticleLayer:${data.config.name}] ShaderMaterial created successfully`);
      return mat;
    } catch (err) {
      console.error(`[ParticleLayer:${data.config.name}] ShaderMaterial creation failed:`, err);
      throw err;
    }
  }, [uniforms, data.config.name]);

  // Animation loop
  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    const stateParams = STATE_PARAMS[state];
    const stateColor = STATE_COLORS[state];

    // Update uniforms directly on the material
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uState.value = STATE_MAP[state];
    shaderMaterial.uniforms.uAudioLevel.value = audioLevel;
    shaderMaterial.uniforms.uSpeedMultiplier.value = stateParams.speedMultiplier;
    shaderMaterial.uniforms.uTurbulence.value = stateParams.turbulence;
    shaderMaterial.uniforms.uGlowIntensity.value = stateParams.glowIntensity;
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
    console.log(
      `[ParticleLayer:${data.config.name}] Creating BufferGeometry with ${data.positions.length / 3} particles`
    );
    try {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('customColor', new THREE.BufferAttribute(data.colors, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(data.sizes, 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(data.alphas, 1));
      geo.setAttribute('velocity', new THREE.BufferAttribute(data.velocities, 3));
      console.log(`[ParticleLayer:${data.config.name}] BufferGeometry created successfully`);
      return geo;
    } catch (err) {
      console.error(`[ParticleLayer:${data.config.name}] BufferGeometry creation failed:`, err);
      throw err;
    }
  }, [data]);

  // Log when component mounts
  useEffect(() => {
    console.log(
      `[ParticleLayer:${data.config.name}] Component mounted, pointsRef:`,
      pointsRef.current
    );
    return () => {
      console.log(`[ParticleLayer:${data.config.name}] Component unmounting`);
    };
  }, [data.config.name]);

  // eslint-disable-next-line react/no-unknown-property
  return <points ref={pointsRef} geometry={geometry} material={shaderMaterial} />;
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
 * Atlas Particles - The 2-layer AI Core visualization
 */
export function AtlasParticles({
  state = 'idle',
  audioLevel = 0,
  particleCount = 30000,
}: AtlasParticlesProps) {
  // Refs for each layer group (for rotation)
  const nucleusGroupRef = useRef<THREE.Group>(null);
  const shellGroupRef = useRef<THREE.Group>(null);

  console.log('[AtlasParticles] Rendering with particleCount:', particleCount);

  // Scale particle counts based on prop (ratio from DEFAULT_LAYERS - only nucleus and shell)
  const getScaledLayers = useCallback((): LayerConfig[] => {
    // Only use nucleus and shell layers
    const sphereLayers = DEFAULT_LAYERS.filter((l) => l.name === 'nucleus' || l.name === 'shell');
    const totalDefault = sphereLayers.reduce((sum, l) => sum + l.particleCount, 0);
    const scale = particleCount / totalDefault;

    return sphereLayers.map((layer) => ({
      ...layer,
      particleCount: Math.max(1000, Math.floor(layer.particleCount * scale)),
    }));
  }, [particleCount]);

  // Generate layer data - memoized for performance
  const layers = useMemo(() => {
    console.log('[AtlasParticles] Generating layer data...');
    const scaledLayers = getScaledLayers();
    const result = scaledLayers.map((config) => {
      console.log(
        `[AtlasParticles] Generating layer: ${config.name} with ${config.particleCount} particles`
      );
      return generateLayerData(config);
    });
    console.log(
      '[AtlasParticles] All layers generated:',
      result.map((l) => l.config.name)
    );
    return result;
  }, [getScaledLayers]);

  // Find layers by name
  const nucleusData = layers.find((l) => l.config.name === 'nucleus')!;
  const shellData = layers.find((l) => l.config.name === 'shell')!;

  // Log mount
  useEffect(() => {
    console.log('[AtlasParticles] Component mounted');
    return () => console.log('[AtlasParticles] Component unmounting');
  }, []);

  return (
    <>
      {/* Inner Nucleus - Dense white/cyan core */}
      <group ref={nucleusGroupRef}>
        <ParticleLayer
          data={nucleusData}
          state={state}
          audioLevel={audioLevel}
          groupRef={nucleusGroupRef}
        />
      </group>

      {/* Outer Shell - Sparse golden particles */}
      <group ref={shellGroupRef}>
        <ParticleLayer
          data={shellData}
          state={state}
          audioLevel={audioLevel}
          groupRef={shellGroupRef}
        />
      </group>
    </>
  );
}

export default AtlasParticles;
