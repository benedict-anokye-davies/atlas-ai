/**
 * HologramEffects.tsx
 * 
 * MCU-style holographic post-processing effects including:
 * - Scan lines (horizontal sweep)
 * - Chromatic aberration (RGB offset)
 * - Holographic flicker
 * - Interference patterns
 * - Data stream overlays
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface HologramEffectsProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
}

// Full-screen quad shader for holographic overlay
const hologramVertexShader = `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const hologramFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  uniform float uScanLineIntensity;
  uniform float uFlickerIntensity;
  uniform float uNoiseIntensity;
  uniform vec2 uResolution;
  
  varying vec2 vUv;
  
  // Simple noise function
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  
  void main() {
    vec2 uv = vUv;
    vec2 pixelCoord = uv * uResolution;
    
    // Initialize output
    float alpha = 0.0;
    vec3 color = uColor;
    
    // === SCAN LINES ===
    // Horizontal scan lines (classic CRT effect)
    float scanLine = sin(pixelCoord.y * 2.0) * 0.5 + 0.5;
    scanLine = pow(scanLine, 8.0);
    
    // Traveling scan line (vertical sweep)
    float sweep = mod(uTime * 0.5, 2.0) - 0.5;
    float travelScan = 1.0 - smoothstep(0.0, 0.05, abs(uv.y - sweep));
    
    alpha += (scanLine * 0.03 + travelScan * 0.1) * uScanLineIntensity;
    
    // === HOLOGRAPHIC FLICKER ===
    float flicker = 1.0;
    flicker *= 1.0 - uFlickerIntensity * 0.1 * step(0.97, hash(vec2(uTime * 10.0, 0.0)));
    flicker *= 1.0 - uFlickerIntensity * 0.05 * (sin(uTime * 60.0) * 0.5 + 0.5);
    
    // === INTERFERENCE PATTERNS ===
    float interference = sin(uv.x * 100.0 + uTime * 2.0) * sin(uv.y * 80.0 - uTime);
    interference = interference * 0.5 + 0.5;
    interference = pow(interference, 4.0);
    alpha += interference * 0.02 * uNoiseIntensity;
    
    // === NOISE / STATIC ===
    float staticNoise = hash(pixelCoord + uTime * 100.0);
    staticNoise = step(0.98, staticNoise);
    alpha += staticNoise * 0.1 * uNoiseIntensity;
    
    // === EDGE GLOW (vignette inverse) ===
    vec2 center = uv - 0.5;
    float dist = length(center);
    float edgeGlow = smoothstep(0.3, 0.7, dist);
    alpha += edgeGlow * 0.02;
    
    // === DATA STREAM LINES ===
    // Vertical data lines that occasionally appear
    float dataLine = step(0.995, sin(uv.x * 50.0 + uTime * 0.5));
    dataLine *= step(0.5, sin(uTime * 3.0 + uv.x * 20.0)); // Intermittent
    float dataScroll = mod(uv.y + uTime * 2.0, 1.0);
    dataLine *= smoothstep(0.0, 0.1, dataScroll) * smoothstep(1.0, 0.9, dataScroll);
    alpha += dataLine * 0.1;
    
    // === HEX GRID OVERLAY ===
    vec2 hexUv = uv * 20.0;
    float hexPattern = sin(hexUv.x * 1.732) * sin(hexUv.y);
    hexPattern = step(0.9, hexPattern);
    alpha += hexPattern * 0.01 * (sin(uTime * 0.5) * 0.5 + 0.5);
    
    // Apply flicker to final alpha
    alpha *= flicker;
    
    // Scale by intensity
    alpha *= uIntensity * 0.5;
    
    // Chromatic shift on edges
    color.r += edgeGlow * 0.1;
    color.b -= edgeGlow * 0.05;
    
    gl_FragColor = vec4(color, alpha);
  }
`;

export const HologramEffects: React.FC<HologramEffectsProps> = ({
  state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  
  // State-based parameters
  const stateParams = useMemo(() => {
    const params: Record<AtlasState, { 
      scanLineIntensity: number;
      flickerIntensity: number;
      noiseIntensity: number;
    }> = {
      idle: { scanLineIntensity: 0.3, flickerIntensity: 0.1, noiseIntensity: 0.2 },
      listening: { scanLineIntensity: 0.5, flickerIntensity: 0.2, noiseIntensity: 0.3 },
      thinking: { scanLineIntensity: 0.8, flickerIntensity: 0.4, noiseIntensity: 0.6 },
      speaking: { scanLineIntensity: 0.4, flickerIntensity: 0.15, noiseIntensity: 0.25 },
      error: { scanLineIntensity: 1.0, flickerIntensity: 0.8, noiseIntensity: 1.0 },
    };
    return params[state];
  }, [state]);
  
  // Shader uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uScanLineIntensity: { value: stateParams.scanLineIntensity },
    uFlickerIntensity: { value: stateParams.flickerIntensity },
    uNoiseIntensity: { value: stateParams.noiseIntensity },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
  }), [themeColor, intensity, stateParams, size]);
  
  // Update uniforms when props change
  useEffect(() => {
    uniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
  }, [themeColor, uniforms]);
  
  useEffect(() => {
    uniforms.uIntensity.value = intensity;
    uniforms.uScanLineIntensity.value = stateParams.scanLineIntensity;
    uniforms.uFlickerIntensity.value = stateParams.flickerIntensity;
    uniforms.uNoiseIntensity.value = stateParams.noiseIntensity;
  }, [intensity, stateParams, uniforms]);
  
  useEffect(() => {
    uniforms.uResolution.value.set(size.width, size.height);
  }, [size, uniforms]);
  
  // Animation loop
  useFrame(() => {
    if (!enabled) return;
    uniforms.uTime.value = performance.now() * 0.001;
  });
  
  if (!enabled) return null;
  
  return (
    <mesh ref={meshRef} position={[0, 0, 2]}>
      <planeGeometry args={[10, 10]} />
      <shaderMaterial
        vertexShader={hologramVertexShader}
        fragmentShader={hologramFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

/**
 * Floating data particles that stream around the orb
 * Creates the effect of data being processed
 */
export interface DataStreamProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  particleCount?: number;
}

const dataStreamVertexShader = `
  attribute float particleIndex;
  attribute float particleSpeed;
  attribute float particlePhase;
  
  uniform float uTime;
  uniform float uIntensity;
  uniform float uRadius;
  
  varying float vAlpha;
  varying float vIndex;
  
  void main() {
    vIndex = particleIndex;
    
    // Spiral motion around orb
    float angle = particleIndex * 6.28318 * 0.1 + uTime * particleSpeed;
    float height = mod(particlePhase + uTime * particleSpeed * 0.5, 2.0) - 1.0;
    float radius = uRadius * (0.8 + sin(particleIndex * 3.0) * 0.3);
    
    vec3 pos = vec3(
      cos(angle) * radius,
      height * 2.0,
      sin(angle) * radius
    );
    
    // Fade based on height (fade at top and bottom)
    vAlpha = 1.0 - abs(height);
    vAlpha *= uIntensity;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 3.0 * uIntensity * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const dataStreamFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  
  varying float vAlpha;
  varying float vIndex;
  
  void main() {
    // Circular point
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    
    // Blinking effect
    float blink = sin(uTime * 5.0 + vIndex * 10.0) * 0.5 + 0.5;
    blink = step(0.3, blink);
    
    float alpha = glow * vAlpha * blink;
    
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export const DataStream: React.FC<DataStreamProps> = ({
  state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  particleCount = 100,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  
  // State-based speed
  const speed = useMemo(() => {
    const speeds: Record<AtlasState, number> = {
      idle: 0.5,
      listening: 1.0,
      thinking: 2.0,
      speaking: 1.5,
      error: 3.0,
    };
    return speeds[state];
  }, [state]);
  
  // Create geometry
  const geometry = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const indices = new Float32Array(particleCount);
    const speeds = new Float32Array(particleCount);
    const phases = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      indices[i] = i;
      speeds[i] = 0.5 + Math.random() * 1.5;
      phases[i] = Math.random() * 2.0;
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('particleIndex', new THREE.BufferAttribute(indices, 1));
    geo.setAttribute('particleSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('particlePhase', new THREE.BufferAttribute(phases, 1));
    
    return geo;
  }, [particleCount]);
  
  // Shader uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uRadius: { value: 1.5 },
  }), [themeColor, intensity]);
  
  // Update uniforms
  useEffect(() => {
    uniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    uniforms.uIntensity.value = intensity;
  }, [themeColor, intensity, uniforms]);
  
  // Animation
  useFrame(() => {
    if (!enabled) return;
    uniforms.uTime.value = performance.now() * 0.001 * speed;
  });
  
  if (!enabled) return null;
  
  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        vertexShader={dataStreamVertexShader}
        fragmentShader={dataStreamFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

export default HologramEffects;
