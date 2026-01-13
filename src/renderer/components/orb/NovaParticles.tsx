/**
 * Nova Desktop - Strange Attractor Particle System
 * The visual core of Nova - a flowing particle cloud that responds to AI state
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { aizawa, STATE_COLORS, ATTRACTOR_SETTINGS } from './attractors';
import { particleVertexShader, particleFragmentShader } from './shaders';

export type NovaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface ParticleData {
  x: number;
  y: number;
  z: number;
  baseSize: number;
}

interface NovaParticlesProps {
  state?: NovaState;
  audioLevel?: number;
  particleCount?: number;
}

/**
 * Nova Particles - The flowing strange attractor visualization
 */
export function NovaParticles({
  state = 'idle',
  audioLevel = 0,
  particleCount = 35000,
}: NovaParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const particleDataRef = useRef<ParticleData[]>([]);

  // Animation state refs
  const targetColorsRef = useRef<THREE.Color[]>([]);
  const currentStateRef = useRef<NovaState>(state);
  const transitionProgressRef = useRef(0);

  // Settings for Aizawa attractor
  const settings = ATTRACTOR_SETTINGS.aizawa;

  // Initialize particle positions along the attractor
  const { positions, colors, sizes, alphas } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const alphas = new Float32Array(particleCount);

    const stateColor = STATE_COLORS[state];
    particleDataRef.current = [];
    targetColorsRef.current = [];

    for (let i = 0; i < particleCount; i++) {
      // Start with random positions
      let x = (Math.random() - 0.5) * 2;
      let y = (Math.random() - 0.5) * 2;
      let z = (Math.random() - 0.5) * 2;

      // Iterate to get particles onto the attractor path
      const steps = Math.floor(Math.random() * 500) + 100;
      for (let j = 0; j < steps; j++) {
        const [dx, dy, dz] = aizawa(x, y, z);
        x += dx * settings.dt;
        y += dy * settings.dt;
        z += dz * settings.dt;
      }

      // Store particle data
      particleDataRef.current.push({
        x,
        y,
        z,
        baseSize: 1.5 + Math.random() * 2.0,
      });

      // Set initial position
      positions[i * 3] = (x + settings.offset[0]) * settings.scale;
      positions[i * 3 + 1] = (y + settings.offset[1]) * settings.scale;
      positions[i * 3 + 2] = (z + settings.offset[2]) * settings.scale;

      // Generate color with variation
      const hue = (stateColor.hue + (Math.random() - 0.5) * stateColor.hueRange) % 1;
      const sat = stateColor.saturation + (Math.random() - 0.5) * 0.2;
      const light = stateColor.lightness + (Math.random() - 0.5) * 0.2;

      const color = new THREE.Color().setHSL(hue, sat, light);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      targetColorsRef.current.push(color.clone());

      // Size and alpha
      sizes[i] = particleDataRef.current[i].baseSize;
      alphas[i] = 0.6 + Math.random() * 0.4;
    }

    return { positions, colors, sizes, alphas };
    // We intentionally only initialize once with particleCount
    // State changes are handled in useEffect, not by recreating particles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particleCount]);

  // Handle state changes
  useEffect(() => {
    if (state !== currentStateRef.current) {
      currentStateRef.current = state;
      transitionProgressRef.current = 0;

      // Generate new target colors for transition
      const stateColor = STATE_COLORS[state];
      for (let i = 0; i < particleCount; i++) {
        const hue = (stateColor.hue + (Math.random() - 0.5) * stateColor.hueRange) % 1;
        const sat = stateColor.saturation + (Math.random() - 0.5) * 0.2;
        const light = stateColor.lightness + (Math.random() - 0.5) * 0.2;
        targetColorsRef.current[i].setHSL(hue, sat, light);
      }
    }
  }, [state, particleCount]);

  // Animation loop
  useFrame((_, delta) => {
    if (!pointsRef.current || !materialRef.current) return;

    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const colors = pointsRef.current.geometry.attributes.customColor.array as Float32Array;
    const sizes = pointsRef.current.geometry.attributes.size.array as Float32Array;
    const particles = particleDataRef.current;

    // State-based animation parameters
    let speed = 1.0;
    let turbulence = 0;
    let sizeMultiplier = 1.0;
    let pulseSpeed = 0;

    switch (state) {
      case 'idle':
        speed = 0.6;
        turbulence = 0;
        break;
      case 'listening':
        speed = 1.0 + audioLevel * 0.5;
        turbulence = audioLevel * 0.3;
        sizeMultiplier = 1.0 + audioLevel * 0.3;
        break;
      case 'thinking':
        speed = 2.5;
        turbulence = 0.5;
        pulseSpeed = 8;
        break;
      case 'speaking':
        speed = 1.2;
        turbulence = 0.1;
        pulseSpeed = 4 + audioLevel * 4;
        sizeMultiplier = 1.0 + audioLevel * 0.5;
        break;
      case 'error':
        speed = 0.3;
        turbulence = 0.8;
        break;
    }

    // Update shader uniforms
    materialRef.current.uniforms.uTime.value += delta;
    materialRef.current.uniforms.uTurbulence.value +=
      (turbulence - materialRef.current.uniforms.uTurbulence.value) * 0.1;
    materialRef.current.uniforms.uGlow.value =
      state === 'thinking' ? 1.5 : state === 'speaking' ? 1.2 : 0.8;

    // Color transition
    if (transitionProgressRef.current < 1) {
      transitionProgressRef.current += delta * 2; // 0.5 second transition
      transitionProgressRef.current = Math.min(transitionProgressRef.current, 1);
    }

    const time = materialRef.current.uniforms.uTime.value;

    // Update each particle
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Evolve particle along attractor
      const [dx, dy, dz] = aizawa(p.x, p.y, p.z);
      p.x += dx * settings.dt * speed;
      p.y += dy * settings.dt * speed;
      p.z += dz * settings.dt * speed;

      // Check for divergence and reset if needed
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      if (dist > 50 || isNaN(dist)) {
        p.x = (Math.random() - 0.5) * 2;
        p.y = (Math.random() - 0.5) * 2;
        p.z = (Math.random() - 0.5) * 2;
      }

      // Update position
      positions[i * 3] = (p.x + settings.offset[0]) * settings.scale;
      positions[i * 3 + 1] = (p.y + settings.offset[1]) * settings.scale;
      positions[i * 3 + 2] = (p.z + settings.offset[2]) * settings.scale;

      // Interpolate colors during transition
      if (transitionProgressRef.current < 1) {
        const targetColor = targetColorsRef.current[i];
        const currentR = colors[i * 3];
        const currentG = colors[i * 3 + 1];
        const currentB = colors[i * 3 + 2];

        const ease = transitionProgressRef.current;
        colors[i * 3] = currentR + (targetColor.r - currentR) * ease * 0.1;
        colors[i * 3 + 1] = currentG + (targetColor.g - currentG) * ease * 0.1;
        colors[i * 3 + 2] = currentB + (targetColor.b - currentB) * ease * 0.1;
      }

      // Pulse size for speaking/thinking states
      if (pulseSpeed > 0) {
        const pulse = Math.sin(time * pulseSpeed + i * 0.01) * 0.3 + 1.0;
        sizes[i] = p.baseSize * sizeMultiplier * pulse;
      } else {
        sizes[i] = p.baseSize * sizeMultiplier;
      }
    }

    // Mark attributes for update
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
    pointsRef.current.geometry.attributes.customColor.needsUpdate = true;
    pointsRef.current.geometry.attributes.size.needsUpdate = true;
  });

  // Create shader material
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1.0 },
        uTurbulence: { value: 0 },
        uGlow: { value: 0.8 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-customColor"
          count={particleCount}
          array={colors}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={particleCount}
          array={sizes}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-alpha"
          count={particleCount}
          array={alphas}
          itemSize={1}
        />
      </bufferGeometry>
      <primitive object={shaderMaterial} ref={materialRef} attach="material" />
    </points>
  );
}

export default NovaParticles;
