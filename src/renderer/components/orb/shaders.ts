/**
 * Nova Desktop - Production GLSL Shaders for AI Core
 * High-quality vertex and fragment shaders with curl noise and glow effects
 */

import * as THREE from 'three';

/**
 * Vertex Shader
 * Features:
 * - Curl noise for organic swarming movement
 * - State-based animation speed
 * - Time-based orbital motion
 * - Size attenuation based on distance
 */
export const particleVertexShader = /* glsl */ `
  // Attributes
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  attribute vec3 velocity;
  
  // Varyings - passed to fragment shader
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDistance;
  
  // Uniforms
  uniform float uTime;
  uniform float uState; // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
  uniform float uAudioLevel;
  uniform float uBass; // Low frequency energy 0-1
  uniform float uTreble; // High frequency energy 0-1
  uniform float uPulse; // Rhythmic pulse wave 0-1
  uniform float uExpansion; // Scale multiplier for audio-reactive growth
  uniform float uSpeedMultiplier;
  uniform float uTurbulence;
  uniform float uGlowIntensity;
  uniform vec3 uStateColor;
  uniform float uColorMix; // 0-1 blend to state color
  uniform float uMorphProgress; // 0-1 morph between attractors
  
  //=============================================================================
  // NOISE FUNCTIONS
  //=============================================================================
  
  // Mod289 helper
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  
  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  
  // Permutation function
  vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
  }
  
  // Taylor inverse square root
  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }
  
  // 3D Simplex Noise
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    // First corner
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    // Permutations
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    // Gradients
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    // Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  // Curl Noise - creates divergence-free flow field
  vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    
    float n1 = snoise(p + vec3(e, 0, 0));
    float n2 = snoise(p - vec3(e, 0, 0));
    float n3 = snoise(p + vec3(0, e, 0));
    float n4 = snoise(p - vec3(0, e, 0));
    float n5 = snoise(p + vec3(0, 0, e));
    float n6 = snoise(p - vec3(0, 0, e));
    
    float x = (n4 - n3) - (n6 - n5);
    float y = (n6 - n5) - (n2 - n1);
    float z = (n2 - n1) - (n4 - n3);
    
    return normalize(vec3(x, y, z));
  }
  
  //=============================================================================
  // MAIN VERTEX SHADER
  //=============================================================================
  
  void main() {
    // Pass color with state blending
    vec3 blendedColor = mix(customColor, uStateColor, uColorMix * 0.5);
    vColor = blendedColor;
    vAlpha = alpha;

    // Base position
    vec3 pos = position;
    float dist = length(pos);

    // Apply curl noise displacement for organic movement
    float noiseTime = uTime * 0.3 * uSpeedMultiplier;
    vec3 noisePos = pos * 0.5 + noiseTime;
    vec3 curl = curlNoise(noisePos);

    // Turbulence intensity based on state and bass
    float turbulenceAmount = uTurbulence * (1.0 + uBass * 0.8);
    pos += curl * turbulenceAmount * 0.3;

    // Pulse wave propagates outward from center (synced with speech rhythm)
    float wave = sin(dist * 2.0 - uTime * 3.0 + uPulse * 6.28) * 0.5 + 0.5;
    float audioDisplace = uAudioLevel * wave * 0.3;

    // Breathing motion - subtle idle pulsing
    float breathe = sin(uTime * 1.5 * uSpeedMultiplier) * 0.05 + 1.0;

    // Combined expansion: breathing + audio + pulse wave
    float totalExpansion = breathe * uExpansion * (1.0 + audioDisplace);
    pos *= totalExpansion;

    // Calculate view position
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vDistance = -mvPosition.z;

    // Size with distance attenuation (reduced multiplier for smaller particles)
    float sizeAtten = size * (50.0 / vDistance);

    // Audio-reactive size pulse (treble affects outer shimmer)
    float sizePulse = 1.0 + uAudioLevel * 0.3 + uTreble * 0.2;

    // State-based size modifier
    float stateSize = 1.0;
    if (uState > 1.5 && uState < 2.5) { // thinking
      stateSize = 1.2 + sin(uTime * 8.0) * 0.15;
    } else if (uState > 2.5 && uState < 3.5) { // speaking
      stateSize = 1.1 + sin(uTime * 4.0 + uPulse * 10.0) * 0.2;
    }

    gl_PointSize = clamp(sizeAtten * sizePulse * stateSize, 0.5, 4.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Fragment Shader
 * Features:
 * - Soft circular falloff (not hard circles)
 * - Glowing core with halo effect
 * - State-based glow intensity
 * - Proper alpha blending for depth
 */
export const particleFragmentShader = /* glsl */ `
  precision highp float;
  
  // Varyings from vertex shader
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDistance;
  
  // Uniforms
  uniform float uGlowIntensity;
  uniform float uTime;
  uniform float uState;
  
  void main() {
    // Distance from center of point sprite
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Discard pixels outside radius for soft edges
    if (dist > 0.5) discard;
    
    // === CORE GLOW ===
    // Bright center that falls off sharply
    float core = exp(-dist * 6.0);
    
    // === OUTER GLOW / HALO ===
    // Softer falloff that extends further
    float glow = exp(-dist * 2.5) * 0.4;
    
    // === COMBINED INTENSITY ===
    float intensity = (core + glow) * uGlowIntensity;
    
    // === COLOR ENHANCEMENT ===
    // Brighten towards center (whiter core)
    vec3 finalColor = vColor;
    finalColor = mix(finalColor, vec3(1.0), core * 0.6); // White hot center
    
    // Add bloom-friendly brightness
    finalColor *= (1.0 + intensity * 0.5);
    
    // === ALPHA CALCULATION ===
    // Core is more opaque, glow fades out
    float alpha = (core + glow * 0.4) * vAlpha;
    
    // State-based alpha adjustment
    if (uState > 1.5 && uState < 2.5) { // thinking - more vibrant
      alpha *= 1.2;
    } else if (uState > 3.5) { // error - pulsing
      alpha *= 0.8 + sin(uTime * 5.0) * 0.3;
    }
    
    // Minimum alpha threshold for clean rendering
    if (alpha < 0.01) discard;
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/**
 * Post-processing bloom vertex shader
 * Simple pass-through for screen-space effects
 */
export const bloomVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Post-processing bloom fragment shader
 * Adds glow to bright areas
 */
export const bloomFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uBloomStrength;
  uniform float uBloomThreshold;
  
  varying vec2 vUv;
  
  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    
    // Calculate luminance
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    
    // Apply bloom to bright areas only
    float bloomFactor = smoothstep(uBloomThreshold, 1.0, brightness);
    vec3 bloom = color.rgb * bloomFactor * uBloomStrength;
    
    gl_FragColor = vec4(color.rgb + bloom, color.a);
  }
`;

/**
 * Shader uniform types for TypeScript
 */
export interface ParticleShaderUniforms {
  [uniform: string]: { value: number | THREE.Vector3 };
  uTime: { value: number };
  uState: { value: number }; // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
  uAudioLevel: { value: number };
  uBass: { value: number };
  uTreble: { value: number };
  uPulse: { value: number };
  uExpansion: { value: number };
  uSpeedMultiplier: { value: number };
  uTurbulence: { value: number };
  uGlowIntensity: { value: number };
  uStateColor: { value: THREE.Vector3 };
  uColorMix: { value: number };
  uMorphProgress: { value: number };
}

/**
 * Create default shader uniforms
 */
export function createShaderUniforms(): ParticleShaderUniforms {
  return {
    uTime: { value: 0 },
    uState: { value: 0 },
    uAudioLevel: { value: 0 },
    uBass: { value: 0 },
    uTreble: { value: 0 },
    uPulse: { value: 0 },
    uExpansion: { value: 1.0 },
    uSpeedMultiplier: { value: 0.3 },
    uTurbulence: { value: 0 },
    uGlowIntensity: { value: 0.8 },
    uStateColor: { value: new THREE.Vector3(0.0, 0.83, 1.0) }, // Cyan
    uColorMix: { value: 0 },
    uMorphProgress: { value: 0 },
  };
}
