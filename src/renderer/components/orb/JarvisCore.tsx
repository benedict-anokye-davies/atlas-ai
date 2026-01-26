/**
 * JarvisCore.tsx
 * 
 * MCU-style holographic core - the glowing golden/orange energy center
 * with intense inner glow, particles, and energy effects.
 * Inspired by Tony Stark's JARVIS and Arc Reactor visualizations.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface JarvisCoreProps {
  state: AtlasState;
  intensity: number;
  audioLevel?: number;
  enabled?: boolean;
}

// Core glow vertex shader
const coreVertexShader = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uAudioLevel;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normal;
    
    // Pulsing effect
    float pulse = 1.0 + sin(uTime * 2.0) * 0.03 * uPulse;
    pulse += uAudioLevel * 0.1;
    
    vec3 pos = position * pulse;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Core glow fragment shader - creates the intense golden/orange glow
const coreFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPulse;
  uniform vec3 uCoreColor;
  uniform vec3 uGlowColor;
  uniform float uAudioLevel;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  // Noise functions for organic feel
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }
  
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  
  void main() {
    // Distance from center for glow falloff
    float dist = length(vPosition);
    
    // Core intensity - hollow ring effect (brighter at edges)
    float coreGlow = smoothstep(0.3, 0.7, dist) * (1.0 - smoothstep(0.7, 1.0, dist));
    coreGlow = pow(coreGlow, 0.8);
    
    // Add rim highlight for hollow look
    float rimGlow = smoothstep(0.6, 0.95, dist) * (1.0 - smoothstep(0.95, 1.0, dist));
    rimGlow = pow(rimGlow, 1.2) * 1.5;
    coreGlow = max(coreGlow, rimGlow);
    
    // Outer glow falloff - softer
    float outerGlow = 1.0 - smoothstep(0.4, 1.0, dist);
    outerGlow = pow(outerGlow, 2.5);
    
    // Energy fluctuation
    float energyNoise = noise(vPosition.xy * 3.0 + uTime * 0.5);
    float energyPulse = sin(uTime * 3.0 + dist * 5.0) * 0.15 + 0.85;
    energyPulse += energyNoise * 0.1;
    
    // Hot spots - random bright areas
    float hotSpots = noise(vPosition.xy * 8.0 + uTime * 2.0);
    hotSpots = pow(hotSpots, 4.0) * 0.5;
    
    // Audio reactivity
    float audioBoost = 1.0 + uAudioLevel * 0.3;
    
    // Color mixing - hot white center fading to gold/orange
    vec3 hotWhite = vec3(1.0, 0.98, 0.9);
    vec3 coreCol = mix(uGlowColor, hotWhite, coreGlow * 0.7);
    coreCol = mix(coreCol, uCoreColor, outerGlow * 0.5);
    
    // Add hot spots
    coreCol += hotWhite * hotSpots * coreGlow;
    
    // Final intensity - more transparent for hollow look
    float alpha = (coreGlow * 0.6 + outerGlow * 0.25) * uIntensity * energyPulse * audioBoost;
    alpha = clamp(alpha, 0.0, 0.85); // Cap alpha for transparency
    
    // Boost brightness at edges for hollow effect
    coreCol *= 1.0 + rimGlow * 0.8;
    
    gl_FragColor = vec4(coreCol, alpha);
  }
`;

// Outer haze shader for atmospheric glow
const hazeVertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  void main() {
    vPosition = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const hazeFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  uniform float uAudioLevel;
  
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  void main() {
    // Fresnel-like edge glow for hollow ring effect
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);
    
    // Soft radial falloff
    float dist = length(vPosition);
    float fade = 1.0 - smoothstep(0.5, 1.5, dist);
    
    // Strong pulsing when audio is active
    float pulse = sin(uTime * 2.0) * 0.15 + 0.85;
    float audioPulse = 1.0 + uAudioLevel * 0.5; // Strong audio reaction
    pulse *= audioPulse;
    
    // Create hollow ring effect in haze too
    float ring = smoothstep(0.4, 0.7, dist) * (1.0 - smoothstep(0.9, 1.0, dist));
    
    float alpha = (fresnel * 0.6 + ring * 0.4) * fade * uIntensity * 0.35 * pulse;
    
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export const JarvisCore: React.FC<JarvisCoreProps> = ({
  state,
  intensity,
  audioLevel = 0,
  enabled = true,
}) => {
  const coreRef = useRef<THREE.Mesh>(null);
  const hazeRef = useRef<THREE.Mesh>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);
  
  // State-based colors
  const colors = useMemo(() => {
    const stateColors: Record<AtlasState, { core: THREE.Color; glow: THREE.Color }> = {
      idle: { 
        core: new THREE.Color(1.0, 0.76, 0.15),  // Golden amber
        glow: new THREE.Color(1.0, 0.55, 0.0)    // Orange
      },
      listening: { 
        core: new THREE.Color(0.2, 0.85, 1.0),   // Electric blue
        glow: new THREE.Color(0.0, 0.6, 1.0)
      },
      thinking: { 
        core: new THREE.Color(1.0, 0.7, 0.2),    // Bright amber
        glow: new THREE.Color(1.0, 0.5, 0.0)
      },
      speaking: { 
        core: new THREE.Color(1.0, 0.84, 0.4),   // Warm gold
        glow: new THREE.Color(1.0, 0.65, 0.1)
      },
      error: { 
        core: new THREE.Color(1.0, 0.3, 0.15),   // Red-orange
        glow: new THREE.Color(1.0, 0.1, 0.0)
      },
    };
    return stateColors[state];
  }, [state]);
  
  // Uniforms
  const coreUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uPulse: { value: 1.0 },
    uCoreColor: { value: colors.core },
    uGlowColor: { value: colors.glow },
    uAudioLevel: { value: audioLevel },
  }), []);
  
  const hazeUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: colors.glow },
    uAudioLevel: { value: audioLevel },
  }), []);
  
  // Animation
  useFrame((_, delta) => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    coreUniforms.uTime.value = time;
    coreUniforms.uIntensity.value = intensity;
    coreUniforms.uAudioLevel.value = audioLevel;
    coreUniforms.uCoreColor.value.copy(colors.core);
    coreUniforms.uGlowColor.value.copy(colors.glow);
    
    hazeUniforms.uTime.value = time;
    hazeUniforms.uIntensity.value = intensity;
    hazeUniforms.uColor.value.copy(colors.glow);
    hazeUniforms.uAudioLevel.value = audioLevel;
    
    // Rotate core slowly
    if (coreRef.current) {
      coreRef.current.rotation.y += delta * 0.1;
    }
  });
  
  if (!enabled) return null;
  
  // Calculate pulsation for listening state
  const pulseFactor = state === 'listening' ? 1.0 + audioLevel * 0.5 : 1.0;
  const innerScale = 0.35 * pulseFactor; // Smaller, more hollow
  const coreScale = 0.7 * pulseFactor;   // Medium size core ring
  const hazeScale = 1.4;                  // Atmospheric glow
  
  return (
    <group>
      {/* Inner bright point - very small hot core */}
      <mesh ref={innerGlowRef} scale={innerScale}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color={new THREE.Color(1.0, 0.98, 0.95)}
          transparent
          opacity={0.7 * intensity * pulseFactor}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Main core shell - hollow ring effect */}
      <mesh ref={coreRef} scale={coreScale}>
        <sphereGeometry args={[1, 48, 48]} />
        <shaderMaterial
          vertexShader={coreVertexShader}
          fragmentShader={coreFragmentShader}
          uniforms={coreUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Outer atmospheric haze - softer glow */}
      <mesh ref={hazeRef} scale={hazeScale}>
        <sphereGeometry args={[1, 24, 24]} />
        <shaderMaterial
          vertexShader={hazeVertexShader}
          fragmentShader={hazeFragmentShader}
          uniforms={hazeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
};

export default JarvisCore;
