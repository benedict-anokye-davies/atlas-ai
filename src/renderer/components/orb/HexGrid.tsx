/**
 * HexGrid.tsx
 * 
 * MCU-style hexagonal grid overlay that floats around the orb.
 * Creates the iconic Tony Stark holographic interface look.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface HexGridProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  audioLevel?: number;
}

// Hex grid vertex shader
const hexVertexShader = `
  uniform float uTime;
  uniform float uAudioLevel;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  
  void main() {
    vUv = uv;
    vPosition = position;
    
    // Subtle breathing with audio
    float pulse = 1.0 + sin(uTime * 0.5) * 0.02 + uAudioLevel * 0.05;
    vec3 pos = position * pulse;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Hex grid fragment shader - creates hexagonal pattern
const hexFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  uniform float uAudioLevel;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  
  #define PI 3.14159265359
  
  // Hexagonal distance function
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);
  }
  
  vec4 hexCoords(vec2 uv) {
    vec2 r = vec2(1.0, 1.732);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = length(a) < length(b) ? a : b;
    
    float x = atan(gv.x, gv.y);
    float y = 0.5 - hexDist(gv);
    vec2 id = uv - gv;
    
    return vec4(gv.x, gv.y, id.x, id.y);
  }
  
  void main() {
    // Scale UVs for hex pattern
    vec2 uv = vPosition.xy * 2.0;
    
    // Animate rotation
    float angle = uTime * 0.1;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    uv = rot * uv;
    
    // Get hex coordinates
    vec4 hex = hexCoords(uv * 3.0);
    
    // Edge glow
    float edge = smoothstep(0.0, 0.1, hex.y);
    float line = 1.0 - smoothstep(0.02, 0.05, hex.y);
    
    // Traveling highlight based on distance from center
    float dist = length(hex.zw);
    float wave = sin(dist * 2.0 - uTime * 2.0) * 0.5 + 0.5;
    wave = pow(wave, 4.0);
    
    // Audio reactive pulse on random hexes
    float audioHighlight = 0.0;
    if (uAudioLevel > 0.1) {
      float randSeed = fract(sin(dot(hex.zw, vec2(12.9898, 78.233))) * 43758.5453);
      if (randSeed > 1.0 - uAudioLevel * 0.5) {
        audioHighlight = uAudioLevel * 0.5;
      }
    }
    
    // Distance fade for spherical appearance
    float sphereFade = 1.0 - smoothstep(0.0, 2.5, length(vPosition));
    
    // Combine effects
    float brightness = (line * 0.6 + wave * 0.3 + audioHighlight) * uIntensity * sphereFade;
    
    vec3 color = uColor;
    color += vec3(1.0, 0.95, 0.8) * wave * 0.2; // Brighter traveling wave
    color += uColor * audioHighlight * 2.0; // Audio highlight
    
    float alpha = brightness * 0.5;
    
    gl_FragColor = vec4(color, alpha);
  }
`;

export const HexGrid: React.FC<HexGridProps> = ({
  state: _state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  audioLevel = 0,
}) => {
  void _state; // Suppress unused warning - reserved for future state-based effects
  const meshRef = useRef<THREE.Mesh>(null);
  const mesh2Ref = useRef<THREE.Mesh>(null);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uAudioLevel: { value: audioLevel },
  }), []);
  
  const uniforms2 = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uAudioLevel: { value: audioLevel },
  }), []);
  
  // Animation
  useFrame(() => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    uniforms.uTime.value = time;
    uniforms.uIntensity.value = intensity;
    uniforms.uAudioLevel.value = audioLevel;
    uniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    
    uniforms2.uTime.value = time;
    uniforms2.uIntensity.value = intensity * 0.7;
    uniforms2.uAudioLevel.value = audioLevel;
    uniforms2.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    
    // Counter-rotate the two planes
    if (meshRef.current) {
      meshRef.current.rotation.z = time * 0.05;
      meshRef.current.rotation.x = Math.sin(time * 0.1) * 0.1;
    }
    if (mesh2Ref.current) {
      mesh2Ref.current.rotation.z = -time * 0.03;
      mesh2Ref.current.rotation.y = Math.cos(time * 0.08) * 0.1;
    }
  });
  
  if (!enabled) return null;
  
  return (
    <group>
      {/* Front hex grid */}
      <mesh ref={meshRef} position={[0, 0, 0.5]}>
        <planeGeometry args={[6, 6, 1, 1]} />
        <shaderMaterial
          vertexShader={hexVertexShader}
          fragmentShader={hexFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Back hex grid */}
      <mesh ref={mesh2Ref} position={[0, 0, -0.5]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[6, 6, 1, 1]} />
        <shaderMaterial
          vertexShader={hexVertexShader}
          fragmentShader={hexFragmentShader}
          uniforms={uniforms2}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export default HexGrid;
