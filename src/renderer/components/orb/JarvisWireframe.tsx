/**
 * JarvisWireframe.tsx
 * 
 * MCU-style holographic wireframe shell that surrounds the Atlas orb.
 * Features rotating icosahedron geometry with edge highlighting,
 * scan lines, and responsive animation to state changes.
 * 
 * Updated: Enhanced golden glow with brighter edges and vertices
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface JarvisWireframeProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  scale?: number;
  rotationSpeed?: number;
  audioLevel?: number;
}

// Enhanced wireframe vertex shader with vertex glow
const wireframeVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPulse;
  uniform float uAudioLevel;
  
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vEdgeFactor;
  
  void main() {
    vPosition = position;
    vNormal = normal;
    
    // Breathing animation
    float breathe = sin(uTime * 0.8) * 0.03 * uIntensity;
    breathe += uAudioLevel * 0.05;
    vec3 displaced = position * (1.0 + breathe);
    
    // Pulse expansion
    displaced *= 1.0 + uPulse * 0.15;
    
    // Calculate edge factor for glow
    vEdgeFactor = 1.0 - abs(dot(normalize(cameraPosition - position), normal));
    
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPos.xyz;
    
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const wireframeFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uScanLineSpeed;
  uniform float uFlicker;
  
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vEdgeFactor;
  
  void main() {
    // Enhanced edge glow - brighter
    float edgeGlow = pow(vEdgeFactor, 1.5) * 1.2;
    
    // Vertical scan line
    float scanLine = sin(vPosition.y * 15.0 - uTime * uScanLineSpeed) * 0.5 + 0.5;
    scanLine = pow(scanLine, 6.0) * 0.4;
    
    // Energy pulse rings
    float dist = length(vPosition);
    float energyRing = sin(dist * 8.0 - uTime * 2.0) * 0.5 + 0.5;
    energyRing = pow(energyRing, 8.0) * 0.3;
    
    // Holographic flicker (subtle)
    float flicker = 1.0 - uFlicker * (sin(uTime * 25.0) * 0.5 + 0.5) * 0.05;
    
    // Combine
    float alpha = (edgeGlow + scanLine + energyRing) * uIntensity * uOpacity * flicker;
    alpha = clamp(alpha, 0.0, 1.0);
    
    // Brighter color with golden core
    vec3 finalColor = uColor * 1.2;
    finalColor += vec3(1.0, 0.9, 0.7) * edgeGlow * 0.3; // Hot edges
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// Enhanced edge shader with brighter traveling lights
const edgeVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPulse;
  
  attribute float aEdgeProgress;
  
  varying float vLinePos;
  varying float vEdgeProgress;
  
  void main() {
    vLinePos = position.y;
    vEdgeProgress = position.x; // Use x as edge progress
    
    // Pulse effect
    vec3 pos = position * (1.0 + uPulse * 0.15);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const edgeFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  
  varying float vLinePos;
  varying float vEdgeProgress;
  
  void main() {
    // Multiple traveling lights
    float travel1 = sin(vLinePos * 8.0 - uTime * 4.0) * 0.5 + 0.5;
    float travel2 = sin(vLinePos * 12.0 + uTime * 3.0) * 0.5 + 0.5;
    float travel = max(pow(travel1, 3.0), pow(travel2, 4.0));
    
    // Pulse
    float pulse = sin(uTime * 2.5) * 0.15 + 0.85;
    
    // Base brightness higher
    float brightness = 0.7 + travel * 0.5;
    float alpha = brightness * uIntensity * uOpacity * pulse;
    
    // Bright golden edges
    vec3 finalColor = uColor * (1.0 + travel * 0.4);
    finalColor += vec3(1.0, 0.95, 0.8) * travel * 0.2; // White highlights
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const JarvisWireframe: React.FC<JarvisWireframeProps> = ({
  state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 }, // Default JARVIS gold
  scale = 1.8,
  rotationSpeed = 0.1,
  audioLevel = 0,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  
  // State-based parameters
  const stateParams = useMemo(() => {
    const params: Record<AtlasState, { 
      scanSpeed: number; 
      flicker: number; 
      opacity: number;
      rotSpeed: number;
    }> = {
      idle: { scanSpeed: 1.0, flicker: 0.0, opacity: 0.4, rotSpeed: 0.1 },
      listening: { scanSpeed: 3.0, flicker: 0.1, opacity: 0.7, rotSpeed: 0.3 },
      thinking: { scanSpeed: 5.0, flicker: 0.3, opacity: 0.9, rotSpeed: 0.5 },
      speaking: { scanSpeed: 2.0, flicker: 0.05, opacity: 0.8, rotSpeed: 0.2 },
      error: { scanSpeed: 8.0, flicker: 0.5, opacity: 1.0, rotSpeed: 0.8 },
    };
    return params[state];
  }, [state]);
  
  // Shader uniforms
  const wireframeUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uIntensity: { value: intensity },
    uOpacity: { value: stateParams.opacity },
    uPulse: { value: 0 },
    uScanLineSpeed: { value: stateParams.scanSpeed },
    uFlicker: { value: stateParams.flicker },
    uAudioLevel: { value: audioLevel },
  }), [themeColor, intensity, stateParams]);
  
  const edgeUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uIntensity: { value: intensity },
    uOpacity: { value: stateParams.opacity },
  }), [themeColor, intensity, stateParams]);
  
  // Update uniforms when props change
  useEffect(() => {
    wireframeUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    edgeUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
  }, [themeColor, wireframeUniforms, edgeUniforms]);
  
  useEffect(() => {
    wireframeUniforms.uIntensity.value = intensity;
    wireframeUniforms.uOpacity.value = stateParams.opacity;
    wireframeUniforms.uScanLineSpeed.value = stateParams.scanSpeed;
    wireframeUniforms.uFlicker.value = stateParams.flicker;
    
    edgeUniforms.uIntensity.value = intensity;
    edgeUniforms.uOpacity.value = stateParams.opacity;
    
    // Trigger pulse on state change
    wireframeUniforms.uPulse.value = 1.0;
  }, [state, intensity, stateParams, wireframeUniforms, edgeUniforms]);
  
  // Create geometries
  const icosahedronGeometry = useMemo(() => {
    return new THREE.IcosahedronGeometry(1, 1); // Detail level 1 for visible edges
  }, []);
  
  const edgesGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(icosahedronGeometry, 15);
  }, [icosahedronGeometry]);
  
  // Holographic ring geometries
  const ringGeometry = useMemo(() => {
    return new THREE.TorusGeometry(1.1, 0.01, 8, 64);
  }, []);
  
  // Animation loop
  useFrame((_, delta) => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    // Update time uniforms
    wireframeUniforms.uTime.value = time;
    edgeUniforms.uTime.value = time;
    wireframeUniforms.uAudioLevel.value = audioLevel;
    
    // Audio-reactive pulsation - expand on sound
    const audioPulse = audioLevel * 0.3;
    const scalePulse = 1.0 + audioPulse;
    
    // Decay pulse
    wireframeUniforms.uPulse.value *= 0.95;
    wireframeUniforms.uPulse.value = Math.max(wireframeUniforms.uPulse.value, audioPulse);
    
    // Rotate wireframe
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * stateParams.rotSpeed * rotationSpeed;
      meshRef.current.scale.setScalar(scalePulse);
      meshRef.current.rotation.x += delta * stateParams.rotSpeed * rotationSpeed * 0.3;
    }
    
    if (edgesRef.current) {
      edgesRef.current.rotation.y += delta * stateParams.rotSpeed * rotationSpeed;
      edgesRef.current.rotation.x += delta * stateParams.rotSpeed * rotationSpeed * 0.3;
      edgesRef.current.scale.setScalar(scalePulse);
    }
    
    // Counter-rotate rings for dynamic effect
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z += delta * 0.5;
      innerRingRef.current.rotation.x = Math.sin(time * 0.3) * 0.2;
    }
    
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= delta * 0.3;
      outerRingRef.current.rotation.y = Math.cos(time * 0.2) * 0.3;
    }
  });
  
  if (!enabled) return null;
  
  return (
    <group scale={scale}>
      {/* Main wireframe shell */}
      <mesh ref={meshRef} geometry={icosahedronGeometry}>
        <shaderMaterial
          vertexShader={wireframeVertexShader}
          fragmentShader={wireframeFragmentShader}
          uniforms={wireframeUniforms}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Edge highlights */}
      <lineSegments ref={edgesRef} geometry={edgesGeometry}>
        <shaderMaterial
          vertexShader={edgeVertexShader}
          fragmentShader={edgeFragmentShader}
          uniforms={edgeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      
      {/* Inner rotating ring */}
      <mesh ref={innerRingRef} geometry={ringGeometry}>
        <meshBasicMaterial
          color={new THREE.Color(themeColor.r, themeColor.g, themeColor.b)}
          transparent
          opacity={0.5 * intensity}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Outer rotating ring */}
      <mesh ref={outerRingRef} geometry={ringGeometry} scale={1.3}>
        <meshBasicMaterial
          color={new THREE.Color(themeColor.r, themeColor.g, themeColor.b)}
          transparent
          opacity={0.3 * intensity}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};

export default JarvisWireframe;
