/**
 * EnergyTendrils.tsx
 * 
 * Energy tendrils/filaments that emanate from the core.
 * Creates the organic, plasma-like effect seen in MCU holograms.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface EnergyTendrilsProps {
  state: AtlasState;
  intensity: number;
  audioLevel?: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  tendrilCount?: number;
}

// Tendril vertex shader
const tendrilVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAudioLevel;
  
  attribute float aOffset;
  attribute float aSpeed;
  
  varying float vAlpha;
  varying float vProgress;
  
  void main() {
    vProgress = position.y; // 0 at base, 1 at tip
    
    // Wave motion
    float wave = sin(uTime * aSpeed + aOffset * 6.28) * 0.3;
    wave *= vProgress; // More movement at tips
    
    // Audio reactivity
    float audioWave = uAudioLevel * sin(uTime * 5.0 + aOffset * 3.14) * 0.2;
    
    vec3 pos = position;
    pos.x += wave + audioWave;
    pos.z += cos(uTime * aSpeed * 0.7 + aOffset * 3.14) * 0.2 * vProgress;
    
    // Fade out at tips
    vAlpha = 1.0 - pow(vProgress, 2.0);
    vAlpha *= uIntensity;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const tendrilFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  
  varying float vAlpha;
  varying float vProgress;
  
  void main() {
    // Core is brighter
    float coreBrightness = 1.0 - vProgress * 0.5;
    
    // Traveling energy pulse
    float pulse = sin(vProgress * 10.0 - uTime * 3.0) * 0.3 + 0.7;
    
    vec3 color = uColor * coreBrightness * pulse;
    color += vec3(1.0, 0.95, 0.8) * (1.0 - vProgress) * 0.3; // Hot white at base
    
    float alpha = vAlpha * pulse;
    
    gl_FragColor = vec4(color, alpha);
  }
`;

// Floating particle vertex shader
const particleVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  
  attribute float aScale;
  attribute float aOffset;
  
  varying float vAlpha;
  
  void main() {
    // Orbit around core
    float angle = uTime * 0.5 + aOffset * 6.28;
    float radius = 2.0 + sin(uTime + aOffset * 3.14) * 0.5;
    
    vec3 pos = position;
    pos.x += cos(angle) * radius * 0.3;
    pos.z += sin(angle) * radius * 0.3;
    pos.y += sin(uTime * 0.7 + aOffset * 6.28) * 0.5;
    
    // Distance fade
    float dist = length(pos);
    vAlpha = (1.0 - smoothstep(1.0, 3.5, dist)) * uIntensity;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aScale * (300.0 / -mvPosition.z) * uIntensity;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  
  varying float vAlpha;
  
  void main() {
    // Circular particle with soft edge
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    alpha *= vAlpha;
    
    // Twinkle
    float twinkle = sin(uTime * 3.0 + gl_PointCoord.x * 10.0) * 0.2 + 0.8;
    
    vec3 color = uColor * twinkle;
    
    gl_FragColor = vec4(color, alpha * twinkle);
  }
`;

export const EnergyTendrils: React.FC<EnergyTendrilsProps> = ({
  state,
  intensity,
  audioLevel = 0,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  tendrilCount = 12,
}) => {
  const tendrilsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  
  // State-based parameters
  const stateParams = useMemo(() => {
    const params: Record<AtlasState, { speed: number; length: number }> = {
      idle: { speed: 1.0, length: 1.5 },
      listening: { speed: 1.5, length: 2.0 },
      thinking: { speed: 2.5, length: 2.5 },
      speaking: { speed: 1.2, length: 1.8 },
      error: { speed: 3.0, length: 2.0 },
    };
    return params[state];
  }, [state]);
  
  // Create tendril geometries
  const tendrilGeometries = useMemo(() => {
    const geometries: THREE.BufferGeometry[] = [];
    
    for (let i = 0; i < tendrilCount; i++) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          0.5,
          (Math.random() - 0.5) * 0.5
        ),
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.0,
          1.0,
          (Math.random() - 0.5) * 1.0
        ),
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          1.5,
          (Math.random() - 0.5) * 1.5
        ),
      ]);
      
      const geometry = new THREE.TubeGeometry(curve, 32, 0.02, 8, false);
      
      // Add custom attributes
      const vertexCount = geometry.attributes.position.count;
      const offsets = new Float32Array(vertexCount);
      const speeds = new Float32Array(vertexCount);
      
      for (let j = 0; j < vertexCount; j++) {
        offsets[j] = i / tendrilCount;
        speeds[j] = 0.5 + Math.random() * 1.5;
      }
      
      geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
      geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
      
      geometries.push(geometry);
    }
    
    return geometries;
  }, [tendrilCount]);
  
  // Create floating particles
  const particleGeometry = useMemo(() => {
    const count = 100;
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const offsets = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      // Random position in sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.5 + Math.random() * 1.5;
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      
      scales[i] = 0.5 + Math.random() * 1.5;
      offsets[i] = Math.random();
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    
    return geometry;
  }, []);
  
  // Uniforms
  const tendrilUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uAudioLevel: { value: audioLevel },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
  }), []);
  
  const particleUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
  }), []);
  
  // Animation
  useFrame(() => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    tendrilUniforms.uTime.value = time * stateParams.speed;
    tendrilUniforms.uIntensity.value = intensity;
    tendrilUniforms.uAudioLevel.value = audioLevel;
    tendrilUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    
    particleUniforms.uTime.value = time;
    particleUniforms.uIntensity.value = intensity;
    particleUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    
    // Rotate tendrils group slowly
    if (tendrilsRef.current) {
      tendrilsRef.current.rotation.y += 0.002;
    }
  });
  
  if (!enabled) return null;
  
  return (
    <group>
      {/* Tendrils */}
      <group ref={tendrilsRef}>
        {tendrilGeometries.map((geometry, index) => (
          <mesh
            key={index}
            geometry={geometry}
            rotation={[0, (index / tendrilCount) * Math.PI * 2, 0]}
            scale={[1, stateParams.length, 1]}
          >
            <shaderMaterial
              vertexShader={tendrilVertexShader}
              fragmentShader={tendrilFragmentShader}
              uniforms={tendrilUniforms}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
      
      {/* Floating particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <shaderMaterial
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={particleUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
};

export default EnergyTendrils;
