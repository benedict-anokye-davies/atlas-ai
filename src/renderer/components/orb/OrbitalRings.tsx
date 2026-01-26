/**
 * OrbitalRings.tsx
 * 
 * MCU-style orbital rings that rotate around the core.
 * Multiple rings at different angles with traveling light effects.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface OrbitalRingsProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  audioLevel?: number;
}

// Ring shader with traveling light
const ringVertexShader = `
  uniform float uTime;
  uniform float uSpeed;
  
  varying vec2 vUv;
  varying float vAngle;
  
  void main() {
    vUv = uv;
    
    // Calculate angle for traveling light effect
    vAngle = atan(position.y, position.x);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform vec3 uColor;
  uniform float uTravelSpeed;
  
  varying vec2 vUv;
  varying float vAngle;
  
  #define PI 3.14159265359
  
  void main() {
    // Normalize angle to 0-1
    float angle = (vAngle + PI) / (2.0 * PI);
    
    // Traveling light effect - multiple lights
    float travel1 = fract(angle - uTime * uTravelSpeed);
    float travel2 = fract(angle - uTime * uTravelSpeed * 0.7 + 0.33);
    float travel3 = fract(angle - uTime * uTravelSpeed * 1.3 + 0.66);
    
    // Bright spot with trail
    float light1 = smoothstep(0.15, 0.0, travel1) * 0.8;
    float light2 = smoothstep(0.1, 0.0, travel2) * 0.5;
    float light3 = smoothstep(0.08, 0.0, travel3) * 0.4;
    
    // Base ring glow
    float baseGlow = 0.15;
    
    // Combine
    float brightness = baseGlow + light1 + light2 + light3;
    brightness *= uIntensity;
    
    // Subtle pulse
    brightness *= 0.9 + sin(uTime * 2.0) * 0.1;
    
    vec3 finalColor = uColor * (1.0 + brightness * 0.3);
    
    gl_FragColor = vec4(finalColor, brightness);
  }
`;

export const OrbitalRings: React.FC<OrbitalRingsProps> = ({
  state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  audioLevel = 0,
}) => {
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);
  
  // State-based parameters
  const stateParams = useMemo(() => {
    const params: Record<AtlasState, { speed: number; travelSpeed: number }> = {
      idle: { speed: 0.2, travelSpeed: 0.15 },
      listening: { speed: 0.5, travelSpeed: 0.3 },
      thinking: { speed: 0.8, travelSpeed: 0.5 },
      speaking: { speed: 0.4, travelSpeed: 0.25 },
      error: { speed: 1.2, travelSpeed: 0.8 },
    };
    return params[state];
  }, [state]);
  
  // Ring uniforms
  const createRingUniforms = () => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uSpeed: { value: stateParams.speed },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uTravelSpeed: { value: stateParams.travelSpeed },
  });
  
  const ring1Uniforms = useMemo(createRingUniforms, []);
  const ring2Uniforms = useMemo(createRingUniforms, []);
  const ring3Uniforms = useMemo(createRingUniforms, []);
  
  // Ring geometry - thin torus
  const ringGeometry = useMemo(() => {
    return new THREE.TorusGeometry(2.2, 0.015, 8, 128);
  }, []);
  
  // Animation
  useFrame((_, delta) => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    // Update uniforms
    const audioPulse = 1.0 + audioLevel * 0.2; // Expand on sound
    const audioIntensity = intensity * (1.0 + audioLevel * 0.3);
    
    [ring1Uniforms, ring2Uniforms, ring3Uniforms].forEach(uniforms => {
      uniforms.uTime.value = time;
      uniforms.uIntensity.value = audioIntensity;
      uniforms.uSpeed.value = stateParams.speed * audioPulse;
      uniforms.uTravelSpeed.value = stateParams.travelSpeed * audioPulse;
      uniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    });
    
    // Rotate rings with audio-reactive speed
    const speedMult = 1.0 + audioLevel * 0.5;
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * stateParams.speed * 0.3 * speedMult;
      ring1Ref.current.scale.setScalar(audioPulse);
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z -= delta * stateParams.speed * 0.2 * speedMult;
      ring2Ref.current.rotation.x += delta * stateParams.speed * 0.1 * speedMult;
      ring2Ref.current.scale.setScalar(1.15 * audioPulse);
    }
    if (ring3Ref.current) {
      ring3Ref.current.rotation.z += delta * stateParams.speed * 0.15 * speedMult;
      ring3Ref.current.rotation.y -= delta * stateParams.speed * 0.1 * speedMult;
      ring3Ref.current.scale.setScalar(0.9 * audioPulse);
    }
  });
  
  if (!enabled) return null;
  
  return (
    <group>
      {/* Primary ring - horizontal */}
      <mesh 
        ref={ring1Ref} 
        geometry={ringGeometry}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <shaderMaterial
          vertexShader={ringVertexShader}
          fragmentShader={ringFragmentShader}
          uniforms={ring1Uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Second ring - tilted */}
      <mesh 
        ref={ring2Ref} 
        geometry={ringGeometry}
        rotation={[Math.PI / 2 + 0.4, 0.3, 0]}
        scale={1.15}
      >
        <shaderMaterial
          vertexShader={ringVertexShader}
          fragmentShader={ringFragmentShader}
          uniforms={ring2Uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Third ring - opposite tilt */}
      <mesh 
        ref={ring3Ref} 
        geometry={ringGeometry}
        rotation={[Math.PI / 2 - 0.3, -0.4, 0.2]}
        scale={0.9}
      >
        <shaderMaterial
          vertexShader={ringVertexShader}
          fragmentShader={ringFragmentShader}
          uniforms={ring3Uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export default OrbitalRings;
