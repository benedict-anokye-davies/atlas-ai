/**
 * Atlas Desktop - 3D Background Effects Component
 * Immersive animated backgrounds with parallax and multiple themes
 *
 * Features:
 * - Multiple background themes (nebula, stars, cosmic, minimal)
 * - Subtle parallax effect on mouse movement
 * - Performance-conscious rendering with LOD
 * - Smooth transitions between themes
 * - Disable option for low-end hardware
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// =============================================================================
// TYPES AND CONSTANTS
// =============================================================================

/** Available background themes */
export type BackgroundTheme = 'nebula' | 'stars' | 'cosmic' | 'minimal' | 'none';

/** Quality levels for performance scaling */
export type BackgroundQuality = 'low' | 'medium' | 'high';

/** Props for Background3D component */
export interface Background3DProps {
  /** Background theme (default: 'nebula') */
  theme?: BackgroundTheme;
  /** Enable/disable background (default: true) */
  enabled?: boolean;
  /** Quality level for performance (default: 'medium') */
  quality?: BackgroundQuality;
  /** Enable parallax on mouse movement (default: true) */
  enableParallax?: boolean;
  /** Parallax intensity 0-1 (default: 0.3) */
  parallaxIntensity?: number;
  /** Opacity 0-1 (default: 0.6) */
  opacity?: number;
  /** Animation speed multiplier (default: 1.0) */
  speed?: number;
  /** Atlas state for reactive effects */
  atlasState?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  /** Audio level for reactive effects 0-1 */
  audioLevel?: number;
}

/** Particle counts for each quality level */
const QUALITY_PARTICLES: Record<BackgroundQuality, number> = {
  low: 500,
  medium: 1500,
  high: 4000,
};

/** Theme color palettes */
const THEME_COLORS: Record<
  BackgroundTheme,
  { primary: THREE.Color; secondary: THREE.Color; accent: THREE.Color }
> = {
  nebula: {
    primary: new THREE.Color(0x1a0a2e), // Deep purple
    secondary: new THREE.Color(0x0d4d7a), // Teal blue
    accent: new THREE.Color(0x00d4ff), // Cyan (matches orb)
  },
  stars: {
    primary: new THREE.Color(0x0a0a15), // Near black
    secondary: new THREE.Color(0x1a1a2e), // Dark blue
    accent: new THREE.Color(0xffffff), // White
  },
  cosmic: {
    primary: new THREE.Color(0x1a0520), // Deep magenta
    secondary: new THREE.Color(0x0a1a3d), // Dark blue
    accent: new THREE.Color(0xffd700), // Gold (matches shell)
  },
  minimal: {
    primary: new THREE.Color(0x050508), // Almost black
    secondary: new THREE.Color(0x0a0a10), // Slightly lighter
    accent: new THREE.Color(0x00d4ff), // Cyan
  },
  none: {
    primary: new THREE.Color(0x000000),
    secondary: new THREE.Color(0x000000),
    accent: new THREE.Color(0x000000),
  },
};

/** State-based color modulations */
const STATE_COLOR_SHIFT: Record<string, { hue: number; saturation: number; brightness: number }> = {
  idle: { hue: 0, saturation: 0, brightness: 0 },
  listening: { hue: 0.02, saturation: 0.1, brightness: 0.1 },
  thinking: { hue: 0.05, saturation: 0.15, brightness: 0.15 },
  speaking: { hue: 0, saturation: 0.05, brightness: 0.2 },
  error: { hue: -0.1, saturation: 0.2, brightness: -0.1 },
};

// =============================================================================
// SHADERS
// =============================================================================

/** Vertex shader for background particles */
const backgroundVertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  attribute float twinklePhase;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;

  uniform float uTime;
  uniform float uParallaxX;
  uniform float uParallaxY;
  uniform float uSpeed;
  uniform float uAudioLevel;

  void main() {
    vColor = customColor;
    vAlpha = alpha;
    vTwinkle = twinklePhase;

    // Base position with parallax offset
    vec3 pos = position;
    pos.x += uParallaxX * (position.z * 0.1);
    pos.y += uParallaxY * (position.z * 0.1);

    // Subtle drift animation
    float drift = sin(uTime * 0.2 * uSpeed + position.x * 0.5) * 0.3;
    pos.y += drift;
    pos.x += cos(uTime * 0.15 * uSpeed + position.y * 0.3) * 0.2;

    // Audio-reactive pulse (very subtle for background)
    float pulse = 1.0 + uAudioLevel * 0.05;
    pos *= pulse;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    // Size attenuation
    float sizeAtten = size * (300.0 / -mvPosition.z);

    // Twinkle effect
    float twinkle = sin(uTime * 2.0 + twinklePhase * 6.28) * 0.3 + 0.7;
    sizeAtten *= twinkle;

    gl_PointSize = clamp(sizeAtten, 0.5, 8.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/** Fragment shader for background particles */
const backgroundFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;

  uniform float uTime;
  uniform float uOpacity;

  void main() {
    // Soft circular falloff
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    if (dist > 0.5) discard;

    // Soft glow
    float glow = exp(-dist * 4.0);

    // Color with subtle variation
    vec3 finalColor = vColor;
    finalColor *= glow;

    // Alpha with twinkle
    float alpha = glow * vAlpha * uOpacity;
    alpha *= 0.5 + vTwinkle * 0.5;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/** Vertex shader for nebula clouds */
const nebulaVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Fragment shader for nebula clouds */
const nebulaFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vPosition;

  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform vec3 uAccentColor;
  uniform float uAudioLevel;

  // Simplex noise functions
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractal Brownian Motion
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
      value += amplitude * snoise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float t = uTime * 0.1 * uSpeed;

    // Multiple noise layers for depth
    float n1 = fbm(uv * 1.5 + t * 0.3);
    float n2 = fbm(uv * 3.0 - t * 0.2);
    float n3 = fbm(uv * 0.8 + vec2(t * 0.1, -t * 0.15));

    // Combine noise layers
    float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
    noise = noise * 0.5 + 0.5; // Normalize to 0-1

    // Color gradient based on noise
    vec3 color = mix(uPrimaryColor, uSecondaryColor, noise);
    color = mix(color, uAccentColor, pow(noise, 3.0) * 0.3);

    // Audio reactivity (subtle glow)
    color += uAccentColor * uAudioLevel * 0.1;

    // Radial fade
    float radialFade = 1.0 - smoothstep(0.3, 1.2, length(uv));

    // Final alpha
    float alpha = noise * radialFade * uOpacity * 0.4;

    gl_FragColor = vec4(color, alpha);
  }
`;

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

/**
 * Star field particle layer
 */
function StarField({
  count,
  theme,
  parallaxX,
  parallaxY,
  speed,
  opacity,
  audioLevel,
}: {
  count: number;
  theme: BackgroundTheme;
  parallaxX: number;
  parallaxY: number;
  speed: number;
  opacity: number;
  audioLevel: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const colors = THEME_COLORS[theme];

  // Generate particle data
  const { positions, particleColors, sizes, alphas, twinklePhases } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const particleColors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const twinklePhases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Distribute in a sphere around the scene
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 15 + Math.random() * 35; // 15-50 units away

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = -radius * Math.cos(phi); // Behind camera

      // Color variation between primary and accent
      const colorMix = Math.random();
      const baseColor = colorMix < 0.7 ? colors.secondary : colors.accent;
      const variation = 0.1 + Math.random() * 0.2;

      particleColors[i * 3] = baseColor.r * (1 + (Math.random() - 0.5) * variation);
      particleColors[i * 3 + 1] = baseColor.g * (1 + (Math.random() - 0.5) * variation);
      particleColors[i * 3 + 2] = baseColor.b * (1 + (Math.random() - 0.5) * variation);

      // Size variation (smaller in background)
      sizes[i] = 0.5 + Math.random() * 2.0;

      // Alpha variation
      alphas[i] = 0.3 + Math.random() * 0.7;

      // Twinkle phase
      twinklePhases[i] = Math.random();
    }

    return { positions, particleColors, sizes, alphas, twinklePhases };
  }, [count, colors]);

  // Create uniforms
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uParallaxX: { value: 0 },
      uParallaxY: { value: 0 },
      uSpeed: { value: speed },
      uOpacity: { value: opacity },
      uAudioLevel: { value: 0 },
    }),
    [speed, opacity]
  );

  // Create shader material
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [uniforms]);

  // Create geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('customColor', new THREE.BufferAttribute(particleColors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('twinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
    return geo;
  }, [positions, particleColors, sizes, alphas, twinklePhases]);

  // Animation loop
  useFrame((_, delta) => {
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uParallaxX.value = parallaxX;
    shaderMaterial.uniforms.uParallaxY.value = parallaxY;
    shaderMaterial.uniforms.uAudioLevel.value = audioLevel;
  });

  // eslint-disable-next-line react/no-unknown-property
  return <points ref={pointsRef} geometry={geometry} material={shaderMaterial} />;
}

/**
 * Nebula cloud plane
 */
function NebulaCloud({
  theme,
  opacity,
  speed,
  audioLevel,
}: {
  theme: BackgroundTheme;
  opacity: number;
  speed: number;
  audioLevel: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const colors = THEME_COLORS[theme];

  // Create uniforms
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
      uPrimaryColor: { value: colors.primary },
      uSecondaryColor: { value: colors.secondary },
      uAccentColor: { value: colors.accent },
      uAudioLevel: { value: 0 },
    }),
    [opacity, speed, colors]
  );

  // Create shader material
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [uniforms]);

  // Animation loop
  useFrame((_, delta) => {
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uAudioLevel.value = audioLevel;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -25]} material={shaderMaterial}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <planeGeometry args={[80, 80, 1, 1]} />
    </mesh>
  );
}

/**
 * Cosmic dust particles (distant, slow-moving)
 */
function CosmicDust({
  count,
  theme,
  parallaxX,
  parallaxY,
  speed,
  opacity,
}: {
  count: number;
  theme: BackgroundTheme;
  parallaxX: number;
  parallaxY: number;
  speed: number;
  opacity: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const colors = THEME_COLORS[theme];

  // Generate dust particles (very sparse, very distant)
  const { positions, particleColors, sizes, alphas, twinklePhases } = useMemo(() => {
    const dustCount = Math.floor(count * 0.3); // Fewer dust particles
    const positions = new Float32Array(dustCount * 3);
    const particleColors = new Float32Array(dustCount * 3);
    const sizes = new Float32Array(dustCount);
    const alphas = new Float32Array(dustCount);
    const twinklePhases = new Float32Array(dustCount);

    for (let i = 0; i < dustCount; i++) {
      // Very spread out
      positions[i * 3] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 2] = -20 - Math.random() * 40; // Behind

      // Muted colors (dusty)
      const dustColor = colors.secondary.clone().lerp(colors.primary, 0.5);
      particleColors[i * 3] = dustColor.r * (0.5 + Math.random() * 0.3);
      particleColors[i * 3 + 1] = dustColor.g * (0.5 + Math.random() * 0.3);
      particleColors[i * 3 + 2] = dustColor.b * (0.5 + Math.random() * 0.3);

      // Tiny particles
      sizes[i] = 0.3 + Math.random() * 0.7;

      // Very faint
      alphas[i] = 0.1 + Math.random() * 0.3;

      twinklePhases[i] = Math.random();
    }

    return { positions, particleColors, sizes, alphas, twinklePhases };
  }, [count, colors]);

  // Create uniforms
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uParallaxX: { value: 0 },
      uParallaxY: { value: 0 },
      uSpeed: { value: speed * 0.3 }, // Slower than stars
      uOpacity: { value: opacity * 0.5 }, // More transparent
      uAudioLevel: { value: 0 },
    }),
    [speed, opacity]
  );

  // Create shader material
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [uniforms]);

  // Create geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('customColor', new THREE.BufferAttribute(particleColors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('twinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
    return geo;
  }, [positions, particleColors, sizes, alphas, twinklePhases]);

  // Animation loop
  useFrame((_, delta) => {
    shaderMaterial.uniforms.uTime.value += delta;
    shaderMaterial.uniforms.uParallaxX.value = parallaxX * 0.5; // Less parallax
    shaderMaterial.uniforms.uParallaxY.value = parallaxY * 0.5;
  });

  // eslint-disable-next-line react/no-unknown-property
  return <points ref={pointsRef} geometry={geometry} material={shaderMaterial} />;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Background3D - Immersive 3D background effects for the orb view
 *
 * Provides subtle animated backgrounds that complement the main orb visualization
 * without being distracting. Supports multiple themes and performance scaling.
 */
export function Background3D({
  theme = 'nebula',
  enabled = true,
  quality = 'medium',
  enableParallax = true,
  parallaxIntensity = 0.3,
  opacity = 0.6,
  speed = 1.0,
  atlasState = 'idle',
  audioLevel = 0,
}: Background3DProps) {
  // Mouse position for parallax
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const targetParallax = useRef({ x: 0, y: 0 });
  const currentParallax = useRef({ x: 0, y: 0 });

  // Get three.js context
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { size: _size } = useThree();

  // Track mouse for parallax
  useEffect(() => {
    if (!enableParallax) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Normalize to -1 to 1
      const x = ((e.clientX / window.innerWidth) * 2 - 1) * parallaxIntensity;
      const y = ((e.clientY / window.innerHeight) * 2 - 1) * parallaxIntensity;
      targetParallax.current = { x, y };
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [enableParallax, parallaxIntensity]);

  // Smooth parallax interpolation
  useFrame(() => {
    if (!enableParallax) return;

    // Lerp towards target
    currentParallax.current.x += (targetParallax.current.x - currentParallax.current.x) * 0.05;
    currentParallax.current.y += (targetParallax.current.y - currentParallax.current.y) * 0.05;

    setMousePos({
      x: currentParallax.current.x,
      y: currentParallax.current.y,
    });
  });

  // Get state-based color modulation
  const stateShift = STATE_COLOR_SHIFT[atlasState] || STATE_COLOR_SHIFT.idle;

  // Modulated opacity based on state
  const effectiveOpacity = useMemo(() => {
    return Math.max(0, Math.min(1, opacity + stateShift.brightness * 0.2));
  }, [opacity, stateShift.brightness]);

  // Particle count based on quality
  const particleCount = QUALITY_PARTICLES[quality];

  // Don't render if disabled or theme is 'none'
  if (!enabled || theme === 'none') {
    return null;
  }

  return (
    <group>
      {/* Nebula cloud layer (for nebula and cosmic themes) */}
      {(theme === 'nebula' || theme === 'cosmic') && (
        <NebulaCloud
          theme={theme}
          opacity={effectiveOpacity * 0.5}
          speed={speed}
          audioLevel={audioLevel}
        />
      )}

      {/* Star field (all themes except minimal) */}
      {theme !== 'minimal' && (
        <StarField
          count={particleCount}
          theme={theme}
          parallaxX={mousePos.x}
          parallaxY={mousePos.y}
          speed={speed}
          opacity={effectiveOpacity}
          audioLevel={audioLevel}
        />
      )}

      {/* Cosmic dust (for cosmic and nebula themes) */}
      {(theme === 'cosmic' || theme === 'nebula') && quality !== 'low' && (
        <CosmicDust
          count={particleCount}
          theme={theme}
          parallaxX={mousePos.x}
          parallaxY={mousePos.y}
          speed={speed}
          opacity={effectiveOpacity}
        />
      )}

      {/* Minimal theme: just a few accent particles */}
      {theme === 'minimal' && (
        <StarField
          count={Math.floor(particleCount * 0.2)}
          theme={theme}
          parallaxX={mousePos.x}
          parallaxY={mousePos.y}
          speed={speed * 0.5}
          opacity={effectiveOpacity * 0.4}
          audioLevel={audioLevel}
        />
      )}
    </group>
  );
}

export default Background3D;
