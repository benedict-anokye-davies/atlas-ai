/**
 * Atlas Desktop - Enhanced Particle Trail System
 * High-performance GPU-accelerated particle trails with multiple styles
 *
 * Features:
 * - Ring buffer texture for trail history (GPU memory efficient)
 * - Multiple trail styles: solid, fading, dotted, energy, plasma
 * - State-responsive trail behavior
 * - Audio-reactive trail intensity
 * - Color gradient along trail length
 * - Configurable length, width, and fade
 *
 * Performance: Uses instanced rendering for 100k+ particle trails
 */

import * as THREE from 'three';

//=============================================================================
// TYPES
//=============================================================================

export type TrailStyle = 'solid' | 'fading' | 'dotted' | 'energy' | 'plasma';

export interface TrailConfig {
  enabled: boolean;
  length: number; // Number of trail segments (1-30)
  width: number; // Base trail width (0.5-3.0)
  opacity: number; // Base opacity (0-1)
  style: TrailStyle;
  colorGradient: boolean; // Enable color shift along trail
  stateResponsive: boolean; // Respond to Atlas state changes
  audioReactive: boolean; // React to audio input
  fadeExponent: number; // How quickly trail fades (1.0-4.0)
}

export interface TrailUniforms {
  [uniform: string]: { value: number | boolean | THREE.Vector3 | THREE.Texture | null };
  uTime: { value: number };
  uTrailLength: { value: number };
  uTrailWidth: { value: number };
  uFadeExponent: { value: number };
  uTrailStyle: { value: number };
  uOpacity: { value: number };
  uGlowIntensity: { value: number };
  uColorGradient: { value: boolean };
  uStartColor: { value: THREE.Vector3 };
  uEndColor: { value: THREE.Vector3 };
  uAudioLevel: { value: number };
  uState: { value: number };
  tTrailHistory: { value: THREE.Texture | null };
  uHistorySize: { value: number };
  uCurrentFrame: { value: number };
  uTextureSize: { value: number };
}

export const DEFAULT_TRAIL_CONFIG: TrailConfig = {
  enabled: true,
  length: 15,
  width: 2.0,
  opacity: 0.8,
  style: 'energy',
  colorGradient: true,
  stateResponsive: true,
  audioReactive: true,
  fadeExponent: 1.5,
};

//=============================================================================
// TRAIL STYLE PARAMETERS
//=============================================================================

export const TRAIL_STYLE_MAP: Record<TrailStyle, number> = {
  solid: 0,
  fading: 1,
  dotted: 2,
  energy: 3,
  plasma: 4,
};

// State-responsive trail parameters
export const TRAIL_STATE_PARAMS: Record<
  string,
  { lengthMult: number; opacityMult: number; speedMult: number; widthMult: number }
> = {
  idle: { lengthMult: 0.8, opacityMult: 0.7, speedMult: 0.4, widthMult: 1.0 },
  listening: { lengthMult: 1.0, opacityMult: 0.9, speedMult: 1.0, widthMult: 1.2 },
  thinking: { lengthMult: 1.8, opacityMult: 1.0, speedMult: 2.5, widthMult: 1.5 },
  speaking: { lengthMult: 1.4, opacityMult: 0.9, speedMult: 1.2, widthMult: 1.3 },
  error: { lengthMult: 0.5, opacityMult: 1.2, speedMult: 0.5, widthMult: 1.8 },
};

//=============================================================================
// GPU TRAIL HISTORY SYSTEM
//=============================================================================

/**
 * GPU-based trail history using render-to-texture
 * Stores position history in a texture atlas for efficient GPU access
 */
export class GPUTrailHistory {
  private renderer: THREE.WebGLRenderer;
  private historyTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private currentIndex: number = 0;
  private maxFrames: number;
  private _textureSize: number;

  /** Get the texture size used for trail history */
  get textureSize(): number {
    return this._textureSize;
  }
  private copyMaterial: THREE.ShaderMaterial;
  private copyScene: THREE.Scene;
  private copyCamera: THREE.OrthographicCamera;
  private frameCount: number = 0;
  private isInitialized: boolean = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    particleTextureSize: number,
    maxTrailFrames: number = 30
  ) {
    this.renderer = renderer;
    this._textureSize = particleTextureSize;
    this.maxFrames = maxTrailFrames;

    // Create render targets for ping-pong buffering
    // Each texture stores: [particleTextureSize x (particleTextureSize * maxFrames)]
    // This is a vertical stack of position snapshots
    const rtOptions: THREE.WebGLRenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    };

    const height = particleTextureSize * maxTrailFrames;

    this.historyTextures = [
      new THREE.WebGLRenderTarget(particleTextureSize, height, rtOptions),
      new THREE.WebGLRenderTarget(particleTextureSize, height, rtOptions),
    ];

    // Create copy material for shifting history
    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tNewPositions: { value: null },
        uTextureSize: { value: particleTextureSize },
        uMaxFrames: { value: maxTrailFrames },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        
        uniform sampler2D tSource;
        uniform sampler2D tNewPositions;
        uniform float uTextureSize;
        uniform float uMaxFrames;
        
        varying vec2 vUv;
        
        void main() {
          // Calculate which frame this pixel belongs to
          float frameHeight = 1.0 / uMaxFrames;
          float frameIndex = floor(vUv.y / frameHeight);
          float localV = fract(vUv.y / frameHeight) * frameHeight;
          
          if (frameIndex < 0.5) {
            // Frame 0: Write new positions
            vec2 newUv = vec2(vUv.x, localV * uMaxFrames);
            gl_FragColor = texture2D(tNewPositions, newUv);
          } else {
            // Other frames: Shift from previous frame
            float prevFrameV = (frameIndex - 1.0) * frameHeight + localV;
            gl_FragColor = texture2D(tSource, vec2(vUv.x, prevFrameV));
          }
        }
      `,
    });

    // Create copy scene
    this.copyScene = new THREE.Scene();
    this.copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial);
    this.copyScene.add(copyQuad);

    this.isInitialized = true;
  }

  /**
   * Update trail history with new position data
   */
  update(positionTexture: THREE.Texture): void {
    if (!this.isInitialized) return;

    const readIndex = this.currentIndex;
    const writeIndex = 1 - this.currentIndex;

    // Set uniforms
    this.copyMaterial.uniforms.tSource.value = this.historyTextures[readIndex].texture;
    this.copyMaterial.uniforms.tNewPositions.value = positionTexture;

    // Render to write buffer (shifts all history down and adds new frame)
    this.renderer.setRenderTarget(this.historyTextures[writeIndex]);
    this.renderer.render(this.copyScene, this.copyCamera);
    this.renderer.setRenderTarget(null);

    // Swap buffers
    this.currentIndex = writeIndex;
    this.frameCount++;
  }

  /**
   * Get current trail history texture
   */
  getTexture(): THREE.Texture {
    return this.historyTextures[this.currentIndex].texture;
  }

  /**
   * Get the number of frames stored
   */
  getFrameCount(): number {
    return Math.min(this.frameCount, this.maxFrames);
  }

  /**
   * Get max frames
   */
  getMaxFrames(): number {
    return this.maxFrames;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.historyTextures.forEach((rt) => rt.dispose());
    this.copyMaterial.dispose();
    this.isInitialized = false;
  }
}

//=============================================================================
// TRAIL RENDERING SHADERS
//=============================================================================

/**
 * Trail vertex shader - reads from trail history texture
 */
export const trailVertexShader = /* glsl */ `
  attribute float particleIndex;
  attribute float trailSegment; // 0 = current, 1 = previous frame, etc.
  attribute vec3 baseColor;
  attribute float baseAlpha;
  
  uniform sampler2D tTrailHistory;
  uniform float uTextureSize;
  uniform float uHistorySize; // Max trail frames
  uniform float uTrailLength; // Active trail length
  uniform float uTrailWidth;
  uniform float uTime;
  uniform float uState;
  uniform float uAudioLevel;
  uniform float uOpacity;
  uniform int uTrailStyle;
  uniform float uFadeExponent;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vProgress; // 0 at particle, 1 at trail end
  varying float vSegment;
  
  void main() {
    // Calculate UV for this particle at this trail segment
    float idx = particleIndex;
    float u = (mod(idx, uTextureSize) + 0.5) / uTextureSize;
    
    // V coordinate includes trail segment offset
    float particleV = (floor(idx / uTextureSize) + 0.5) / uTextureSize;
    float segmentOffset = trailSegment / uHistorySize;
    float v = segmentOffset + particleV / uHistorySize;
    
    // Read position from trail history
    vec4 posData = texture2D(tTrailHistory, vec2(u, v));
    vec3 pos = posData.xyz;
    
    // Calculate trail progress (0 = newest, 1 = oldest)
    vProgress = trailSegment / max(1.0, uTrailLength - 1.0);
    vSegment = trailSegment;
    
    // Pass color
    vColor = baseColor;
    
    // Calculate alpha with style-based effects
    float segmentAlpha = baseAlpha * uOpacity;
    
    if (uTrailStyle == 1) {
      // Fading - exponential falloff
      segmentAlpha *= pow(1.0 - vProgress, uFadeExponent);
    } else if (uTrailStyle == 2) {
      // Dotted - alternating visibility
      float dotPattern = step(0.5, fract(vProgress * uTrailLength * 2.0));
      segmentAlpha *= mix(0.2, 1.0, dotPattern);
    } else if (uTrailStyle == 3) {
      // Energy - pulsing glow
      float pulse = sin(vProgress * 10.0 - uTime * 5.0) * 0.3 + 0.7;
      segmentAlpha *= pulse * (1.0 - vProgress * 0.7);
    } else if (uTrailStyle == 4) {
      // Plasma - color-shifting waves
      float wave = sin(vProgress * 8.0 + uTime * 3.0) * 0.4 + 0.6;
      segmentAlpha *= wave;
    }
    // Style 0 (solid) - no modification
    
    // Audio reactive boost
    segmentAlpha *= 1.0 + uAudioLevel * 0.3 * (1.0 - vProgress);
    
    vAlpha = segmentAlpha;
    
    // Calculate point size
    float sizeFalloff = 1.0 - vProgress * 0.6;
    float baseSize = uTrailWidth * sizeFalloff;
    
    // State-based size modification
    if (uState > 1.5 && uState < 2.5) {
      // Thinking - sharper trails
      baseSize *= 0.8 + sin(uTime * 8.0 + vProgress * 4.0) * 0.2;
    } else if (uState > 2.5 && uState < 3.5) {
      // Speaking - pulsing
      baseSize *= 1.0 + uAudioLevel * 0.5;
    }
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = baseSize * (40.0 / max(-mvPosition.z, 0.1));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Trail fragment shader
 */
export const trailFragmentShader = /* glsl */ `
  precision highp float;
  
  uniform float uGlowIntensity;
  uniform float uTime;
  uniform int uTrailStyle;
  uniform bool uColorGradient;
  uniform vec3 uStartColor;
  uniform vec3 uEndColor;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vProgress;
  varying float vSegment;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Soft glow based on style
    float glow;
    if (uTrailStyle == 3) {
      // Energy - sharper glow
      glow = exp(-dist * 5.0);
    } else if (uTrailStyle == 4) {
      // Plasma - soft, diffuse
      glow = exp(-dist * 2.0);
    } else {
      // Default glow
      glow = exp(-dist * 4.0);
    }
    
    // Calculate final color
    vec3 finalColor = vColor;
    
    if (uColorGradient) {
      // Blend from start to end color along trail
      finalColor = mix(uStartColor, uEndColor, vProgress * 0.7);
    }
    
    // Style-specific color effects
    if (uTrailStyle == 4) {
      // Plasma - hue shift along trail
      float hueShift = sin(vProgress * 6.28318 + uTime * 2.0) * 0.2;
      finalColor.r += hueShift;
      finalColor.b -= hueShift;
    }
    
    // Add glow
    finalColor *= (1.0 + glow * uGlowIntensity * 0.5);
    
    // Calculate alpha
    float alpha = glow * vAlpha;
    
    if (alpha < 0.005) discard;
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

//=============================================================================
// TRAIL GEOMETRY GENERATOR
//=============================================================================

/**
 * Create instanced geometry for trail rendering
 * Each particle has multiple trail segments
 */
export function createTrailGeometry(
  particleCount: number,
  maxTrailLength: number,
  baseColors: Float32Array,
  baseAlphas: Float32Array
): THREE.BufferGeometry {
  const totalPoints = particleCount * maxTrailLength;

  // Allocate arrays
  const particleIndices = new Float32Array(totalPoints);
  const trailSegments = new Float32Array(totalPoints);
  const colors = new Float32Array(totalPoints * 3);
  const alphas = new Float32Array(totalPoints);

  // Fill arrays
  let writeIdx = 0;
  for (let p = 0; p < particleCount; p++) {
    for (let s = 0; s < maxTrailLength; s++) {
      particleIndices[writeIdx] = p;
      trailSegments[writeIdx] = s;

      // Copy base color for this particle
      colors[writeIdx * 3 + 0] = baseColors[p * 3 + 0];
      colors[writeIdx * 3 + 1] = baseColors[p * 3 + 1];
      colors[writeIdx * 3 + 2] = baseColors[p * 3 + 2];

      // Copy base alpha
      alphas[writeIdx] = baseAlphas[p];

      writeIdx++;
    }
  }

  const geometry = new THREE.BufferGeometry();

  // Use dummy position attribute (actual position comes from texture)
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(totalPoints * 3), 3)
  );
  geometry.setAttribute('particleIndex', new THREE.BufferAttribute(particleIndices, 1));
  geometry.setAttribute('trailSegment', new THREE.BufferAttribute(trailSegments, 1));
  geometry.setAttribute('baseColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('baseAlpha', new THREE.BufferAttribute(alphas, 1));

  return geometry;
}

/**
 * Create trail uniforms
 */
export function createTrailUniforms(config: TrailConfig): TrailUniforms {
  return {
    uTime: { value: 0 },
    uTrailLength: { value: config.length },
    uTrailWidth: { value: config.width },
    uFadeExponent: { value: config.fadeExponent },
    uTrailStyle: { value: TRAIL_STYLE_MAP[config.style] },
    uOpacity: { value: config.opacity },
    uGlowIntensity: { value: 0.8 },
    uColorGradient: { value: config.colorGradient },
    uStartColor: { value: new THREE.Vector3(0.0, 0.83, 1.0) }, // Cyan
    uEndColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, // Gray
    uAudioLevel: { value: 0 },
    uState: { value: 0 },
    tTrailHistory: { value: null },
    uHistorySize: { value: 30 },
    uCurrentFrame: { value: 0 },
    uTextureSize: { value: 256 },
  };
}

/**
 * Create trail material
 */
export function createTrailMaterial(uniforms: TrailUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

export default {
  GPUTrailHistory,
  createTrailGeometry,
  createTrailUniforms,
  createTrailMaterial,
  TRAIL_STYLE_MAP,
  TRAIL_STATE_PARAMS,
  DEFAULT_TRAIL_CONFIG,
};
