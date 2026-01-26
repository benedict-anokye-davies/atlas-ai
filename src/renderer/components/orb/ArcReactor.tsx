/**
 * ArcReactor.tsx
 * 
 * Iron Man Arc Reactor inspired energy core effect.
 * Concentric rings with energy pulses and iconic blue-white glow.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface ArcReactorProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  audioLevel?: number;
}

// Arc reactor fragment shader
const arcReactorFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  uniform float uAudioLevel;
  
  varying vec2 vUv;
  
  #define PI 3.14159265359
  
  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    float angle = atan(center.y, center.x);
    
    // Concentric ring pattern
    float ring1 = abs(sin(dist * 30.0 - uTime * 2.0));
    ring1 = smoothstep(0.95, 1.0, ring1);
    
    float ring2 = abs(sin(dist * 20.0 + uTime * 1.5));
    ring2 = smoothstep(0.97, 1.0, ring2);
    
    // Main arc reactor rings at specific distances
    float mainRing1 = 1.0 - smoothstep(0.15, 0.16, abs(dist - 0.35));
    float mainRing2 = 1.0 - smoothstep(0.1, 0.11, abs(dist - 0.25));
    float mainRing3 = 1.0 - smoothstep(0.05, 0.06, abs(dist - 0.15));
    
    // Radial segments
    float segments = 12.0;
    float segmentAngle = mod(angle + PI, PI * 2.0 / segments);
    float segmentLine = 1.0 - smoothstep(0.01, 0.03, segmentAngle);
    segmentLine *= step(0.15, dist) * (1.0 - step(0.4, dist));
    
    // Rotating energy beam
    float rotAngle = mod(angle - uTime * 1.0, PI * 2.0);
    float energyBeam = smoothstep(0.3, 0.0, rotAngle) * step(0.1, dist) * (1.0 - step(0.4, dist));
    
    // Audio pulse
    float audioPulse = 1.0 + uAudioLevel * 0.5;
    float audioRing = 1.0 - smoothstep(0.02, 0.04, abs(dist - 0.3 * audioPulse));
    audioRing *= uAudioLevel;
    
    // Core glow
    float coreGlow = 1.0 - smoothstep(0.0, 0.2, dist);
    coreGlow = pow(coreGlow, 2.0);
    
    // Outer fade
    float outerFade = 1.0 - smoothstep(0.35, 0.5, dist);
    
    // Combine
    float brightness = (ring1 * 0.2 + ring2 * 0.15 + mainRing1 * 0.5 + mainRing2 * 0.6 + mainRing3 * 0.7);
    brightness += segmentLine * 0.3 + energyBeam * 0.4 + audioRing * 0.5;
    brightness += coreGlow * 0.8;
    brightness *= outerFade * uIntensity;
    
    // Color gradient - hot white core to theme color
    vec3 color = mix(vec3(1.0, 0.98, 0.95), uColor, dist * 2.0);
    color += uColor * energyBeam * 0.5;
    
    float alpha = clamp(brightness, 0.0, 1.0);
    
    gl_FragColor = vec4(color, alpha);
  }
`;

const arcReactorVertexShader = `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ArcReactor: React.FC<ArcReactorProps> = ({
  state: _state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  audioLevel = 0,
}) => {
  void _state; // Suppress unused warning - reserved for future state-based effects
  const meshRef = useRef<THREE.Mesh>(null);
  
  const uniforms = useMemo(() => ({
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
    
    // Subtle rotation
    if (meshRef.current) {
      meshRef.current.rotation.z = time * 0.1;
    }
  });
  
  if (!enabled) return null;
  
  return (
    <group>
      {/* Main reactor disk */}
      <mesh ref={meshRef} rotation={[0, 0, 0]}>
        <planeGeometry args={[3, 3]} />
        <shaderMaterial
          vertexShader={arcReactorVertexShader}
          fragmentShader={arcReactorFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Secondary disk at different angle */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.5, 2.5]} />
        <shaderMaterial
          vertexShader={arcReactorVertexShader}
          fragmentShader={arcReactorFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export default ArcReactor;
