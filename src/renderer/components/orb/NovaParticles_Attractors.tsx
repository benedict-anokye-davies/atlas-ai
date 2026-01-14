/**
 * Nova Desktop - AI Core Particle System with Strange Attractor Morphing
 * Audio-reactive particle visualization that morphs between 5 attractors based on AI state
 *
 * States -> Attractors:
 * - idle: Lorenz (butterfly, calm)
 * - listening: Thomas (compact, attentive)
 * - thinking: Aizawa (dense, processing)
 * - speaking: Halvorsen (expansive, expressive)
 * - error: Arneodo (chaotic, agitated)
 */

import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  generateAttractorPoints,
  generateParticleSizes,
  generateParticleAlphas,
  generateParticleColors,
  morphPositions,
  STATE_COLORS,
  STATE_PARAMS,
} from './geometry';
import {
  getAttractor,
  STATE_TO_ATTRACTOR,
  ATTRACTOR_SETTINGS,
  type NovaState,
} from './attractors';
import { particleVertexShader, particleFragmentShader, createShaderUniforms } from './shaders';

interface NovaParticlesAttractorProps {
  state?: NovaState;
  audioLevel?: number;
  bass?: number;
  treble?: number;
  pulse?: number;
  particleCount?: number;
}

interface ParticleData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  velocities: Float32Array;
}

// State to numeric value for shader
const STATE_MAP: Record<NovaState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
};

/**
 * Generate particle data for a given attractor
 */
function generateParticleData(
  count: number,
  attractorName: keyof typeof ATTRACTOR_SETTINGS
): ParticleData {
  const attractorFn = getAttractor(attractorName);
  const settings = ATTRACTOR_SETTINGS[attractorName];

  // Generate positions along attractor path
  const positions = generateAttractorPoints(count, attractorFn, settings);

  // Generate colors based on attractor hue
  const hue = settings.baseHue;
  const baseColor = {
    r: Math.abs(Math.sin(hue * Math.PI * 2)),
    g: Math.abs(Math.sin((hue + 0.33) * Math.PI * 2)),
    b: Math.abs(Math.sin((hue + 0.67) * Math.PI * 2)),
  };
  const colors = generateParticleColors(count, baseColor, 0.2);

  // Generate sizes and alphas
  const sizes = generateParticleSizes(count, 0.8, 2.0);
  const alphas = generateParticleAlphas(count, 0.5, 1.0);

  // Generate velocities (for organic movement)
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = 0.05 + Math.random() * 0.1;
    velocities[i * 3] = Math.sin(theta) * Math.cos(phi) * speed;
    velocities[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * speed;
    velocities[i * 3 + 2] = Math.cos(theta) * speed;
  }

  return { positions, colors, sizes, alphas, velocities };
}

/**
 * Nova Particles with Attractor Morphing
 */
export function NovaParticlesAttractors({
  state = 'idle',
  audioLevel = 0,
  bass = 0,
  treble = 0,
  pulse = 0,
  particleCount = 8000,
}: NovaParticlesAttractorProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometryRef = useRef<THREE.BufferGeometry>(null);

  // Track current and target attractors
  const currentAttractorRef = useRef<keyof typeof ATTRACTOR_SETTINGS>('lorenz');
  const previousStateRef = useRef<NovaState>(state);
  const morphProgressRef = useRef(1.0); // 1.0 = fully morphed
  const morphDurationRef = useRef(1200); // ms

  // Store particle data for morphing
  const currentDataRef = useRef<ParticleData | null>(null);
  const targetDataRef = useRef<ParticleData | null>(null);
  const morphStartTimeRef = useRef(0);

  // Create shader uniforms
  const uniforms = useMemo(() => {
    console.log('[NovaParticlesAttractors] Creating uniforms');
    return createShaderUniforms();
  }, []);

  // Create shader material
  const shaderMaterial = useMemo(() => {
    console.log('[NovaParticlesAttractors] Creating ShaderMaterial');
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [uniforms]);

  // Initialize particle data
  useEffect(() => {
    console.log('[NovaParticlesAttractors] Initializing with particleCount:', particleCount);
    const initialAttractor = STATE_TO_ATTRACTOR[state];
    const data = generateParticleData(particleCount, initialAttractor);
    currentDataRef.current = data;
    currentAttractorRef.current = initialAttractor;
    morphProgressRef.current = 1.0;

    // Create geometry
    if (!geometryRef.current) {
      const geo = new THREE.BufferGeometry();
      geometryRef.current = geo;
    }

    const geo = geometryRef.current;
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('customColor', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(data.sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(data.alphas, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(data.velocities, 3));

    console.log('[NovaParticlesAttractors] Geometry initialized');
  }, [particleCount, state]);

  // Handle state transitions with morphing
  useEffect(() => {
    if (previousStateRef.current === state) return;

    const targetAttractor = STATE_TO_ATTRACTOR[state];

    // Only morph if attractor actually changes
    if (targetAttractor !== currentAttractorRef.current) {
      console.log(
        `[NovaParticlesAttractors] State change: ${previousStateRef.current} -> ${state}`,
        `Morphing: ${currentAttractorRef.current} -> ${targetAttractor}`
      );

      // Generate target particle data
      targetDataRef.current = generateParticleData(particleCount, targetAttractor);

      // Start morph animation
      morphProgressRef.current = 0;
      morphStartTimeRef.current = Date.now();
      morphDurationRef.current = 1200; // 1.2 seconds
    }

    previousStateRef.current = state;
  }, [state, particleCount]);

  // Animation loop
  useFrame((_, delta) => {
    if (!pointsRef.current || !geometryRef.current || !currentDataRef.current) return;

    const stateParams = STATE_PARAMS[state];
    const stateColor = STATE_COLORS[state];

    // Update uniforms
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uState.value = STATE_MAP[state];
    shaderMaterial.uniforms.uAudioLevel.value = audioLevel;
    shaderMaterial.uniforms.uBass.value = bass;
    shaderMaterial.uniforms.uTreble.value = treble;
    shaderMaterial.uniforms.uPulse.value = pulse;
    shaderMaterial.uniforms.uExpansion.value = 1.0 + audioLevel * 0.15;
    shaderMaterial.uniforms.uSpeedMultiplier.value = stateParams.speedMultiplier;
    shaderMaterial.uniforms.uTurbulence.value = stateParams.turbulence;
    shaderMaterial.uniforms.uGlowIntensity.value = stateParams.glowIntensity;
    shaderMaterial.uniforms.uStateColor.value.set(stateColor.r, stateColor.g, stateColor.b);
    shaderMaterial.uniforms.uColorMix.value = state === 'idle' ? 0 : 0.3;

    // Handle morphing animation
    if (morphProgressRef.current < 1.0 && targetDataRef.current) {
      const elapsed = Date.now() - morphStartTimeRef.current;
      morphProgressRef.current = Math.min(1.0, elapsed / morphDurationRef.current);

      // Morph positions
      const morphedPositions = morphPositions(
        currentDataRef.current.positions,
        targetDataRef.current.positions,
        morphProgressRef.current
      );

      // Update geometry
      geometryRef.current.attributes.position.array = morphedPositions;
      geometryRef.current.attributes.position.needsUpdate = true;

      // Update uniforms
      shaderMaterial.uniforms.uMorphProgress.value = morphProgressRef.current;

      // When morph completes, swap data
      if (morphProgressRef.current >= 1.0) {
        console.log(
          `[NovaParticlesAttractors] Morph complete to ${STATE_TO_ATTRACTOR[state]}`
        );
        currentDataRef.current = targetDataRef.current;
        currentAttractorRef.current = STATE_TO_ATTRACTOR[state];
        targetDataRef.current = null;
      }
    } else {
      shaderMaterial.uniforms.uMorphProgress.value = 1.0;
    }

    // Rotate the particle system
    pointsRef.current.rotation.y += delta * 0.1 * stateParams.speedMultiplier;
  });

  return (
    <points ref={pointsRef} material={shaderMaterial}>
      <bufferGeometry ref={geometryRef} />
    </points>
  );
}

export default NovaParticlesAttractors;
