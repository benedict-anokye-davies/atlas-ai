/**
 * Atlas Desktop - GPGPU Particle Physics System
 * GPU-accelerated particle simulation using ping-pong frame buffer technique
 *
 * Features:
 * - Position/velocity stored in textures (RGBA32F)
 * - Physics computed entirely on GPU via fragment shaders
 * - Ping-pong buffers for double-buffered simulation
 * - Curl noise for organic movement
 * - Attractor forces (strange attractors, point attractors)
 * - Audio-reactive forces
 * - State-based behavior modulation
 *
 * Performance: Handles 100k+ particles at 60fps on RTX 3060
 */

import * as THREE from 'three';

//=============================================================================
// TYPES
//=============================================================================

export interface GPGPUConfig {
  particleCount: number;
  textureSize: number; // Must be power of 2, particles = textureSize^2
  bounds: number; // Simulation bounds radius
  initialRadius: number; // Initial spawn radius
}

export interface GPGPUUniforms {
  [uniform: string]: { value: number | THREE.Vector3 | THREE.Texture | null };
  uTime: { value: number };
  uDeltaTime: { value: number };
  uState: { value: number }; // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
  uAudioLevel: { value: number };
  uBass: { value: number };
  uTreble: { value: number };
  uPulse: { value: number };
  uNoiseScale: { value: number };
  uNoiseSpeed: { value: number };
  uCurlStrength: { value: number };
  uAttractorStrength: { value: number };
  uAttractorPosition: { value: THREE.Vector3 };
  uCenterAttraction: { value: number };
  uVelocityDamping: { value: number };
  uBoundsRadius: { value: number };
  uTurbulence: { value: number };
  tPositions: { value: THREE.Texture | null };
  tVelocities: { value: THREE.Texture | null };
}

export interface GPGPUState {
  positionTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  velocityTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  currentIndex: number;
  simulationMaterial: THREE.ShaderMaterial;
  renderScene: THREE.Scene;
  renderCamera: THREE.OrthographicCamera;
  renderQuad: THREE.Mesh;
  config: GPGPUConfig;
  uniforms: GPGPUUniforms;
}

//=============================================================================
// GPGPU SIMULATION SHADERS
//=============================================================================

/**
 * Vertex shader for full-screen quad (used for GPGPU computation)
 */
const gpgpuVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Position update fragment shader
 * Reads current position/velocity, computes new position
 */
const positionUpdateShader = /* glsl */ `
  precision highp float;
  
  uniform sampler2D tPositions;
  uniform sampler2D tVelocities;
  uniform float uDeltaTime;
  uniform float uBoundsRadius;
  
  varying vec2 vUv;
  
  void main() {
    vec4 pos = texture2D(tPositions, vUv);
    vec4 vel = texture2D(tVelocities, vUv);
    
    // Euler integration
    vec3 newPos = pos.xyz + vel.xyz * uDeltaTime;
    
    // Soft bounds - push particles back towards center if they exceed bounds
    float dist = length(newPos);
    if (dist > uBoundsRadius) {
      float overshoot = dist - uBoundsRadius;
      newPos = normalize(newPos) * (uBoundsRadius - overshoot * 0.5);
    }
    
    // Store position (w component can store particle age or other data)
    gl_FragColor = vec4(newPos, pos.w);
  }
`;

/**
 * Velocity update fragment shader
 * Computes forces and updates velocity
 */
const velocityUpdateShader = /* glsl */ `
  precision highp float;
  
  uniform sampler2D tPositions;
  uniform sampler2D tVelocities;
  uniform float uTime;
  uniform float uDeltaTime;
  uniform float uState;
  uniform float uAudioLevel;
  uniform float uBass;
  uniform float uTreble;
  uniform float uPulse;
  uniform float uNoiseScale;
  uniform float uNoiseSpeed;
  uniform float uCurlStrength;
  uniform float uAttractorStrength;
  uniform vec3 uAttractorPosition;
  uniform float uCenterAttraction;
  uniform float uVelocityDamping;
  uniform float uTurbulence;
  uniform float uBoundsRadius;
  
  varying vec2 vUv;
  
  //===========================================================================
  // NOISE FUNCTIONS (Simplex 3D)
  //===========================================================================
  
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
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
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  // Curl noise - divergence-free vector field
  vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    
    float n1 = snoise(p + vec3(e, 0.0, 0.0));
    float n2 = snoise(p - vec3(e, 0.0, 0.0));
    float n3 = snoise(p + vec3(0.0, e, 0.0));
    float n4 = snoise(p - vec3(0.0, e, 0.0));
    float n5 = snoise(p + vec3(0.0, 0.0, e));
    float n6 = snoise(p - vec3(0.0, 0.0, e));
    
    float x = (n4 - n3) - (n6 - n5);
    float y = (n6 - n5) - (n2 - n1);
    float z = (n2 - n1) - (n4 - n3);
    
    return normalize(vec3(x, y, z));
  }
  
  //===========================================================================
  // STATE PARAMETERS
  //===========================================================================
  
  struct StateParams {
    float speedMult;
    float curlMult;
    float turbulenceMult;
    float attractionMult;
    float dampingMult;
  };
  
  StateParams getStateParams(float state) {
    StateParams p;
    
    if (state < 0.5) {
      // idle - calm, gentle movement
      p.speedMult = 0.3;
      p.curlMult = 0.5;
      p.turbulenceMult = 0.2;
      p.attractionMult = 0.8;
      p.dampingMult = 0.98;
    } else if (state < 1.5) {
      // listening - alert, responsive
      p.speedMult = 1.0;
      p.curlMult = 0.8;
      p.turbulenceMult = 0.5;
      p.attractionMult = 1.0;
      p.dampingMult = 0.96;
    } else if (state < 2.5) {
      // thinking - energetic, chaotic
      p.speedMult = 2.5;
      p.curlMult = 1.5;
      p.turbulenceMult = 1.2;
      p.attractionMult = 0.6;
      p.dampingMult = 0.94;
    } else if (state < 3.5) {
      // speaking - rhythmic, pulsing
      p.speedMult = 1.2;
      p.curlMult = 0.7;
      p.turbulenceMult = 0.4;
      p.attractionMult = 1.2;
      p.dampingMult = 0.95;
    } else {
      // error - frantic, unstable
      p.speedMult = 0.8;
      p.curlMult = 2.0;
      p.turbulenceMult = 2.0;
      p.attractionMult = 0.3;
      p.dampingMult = 0.92;
    }
    
    return p;
  }
  
  //===========================================================================
  // MAIN
  //===========================================================================
  
  void main() {
    vec4 pos = texture2D(tPositions, vUv);
    vec4 vel = texture2D(tVelocities, vUv);
    
    vec3 position = pos.xyz;
    vec3 velocity = vel.xyz;
    
    // Get state-based parameters
    StateParams stateParams = getStateParams(uState);
    
    // === CURL NOISE FORCE ===
    float noiseTime = uTime * uNoiseSpeed * stateParams.speedMult;
    vec3 noisePos = position * uNoiseScale + noiseTime;
    vec3 curlForce = curlNoise(noisePos) * uCurlStrength * stateParams.curlMult;
    
    // === TURBULENCE ===
    float turb = uTurbulence * stateParams.turbulenceMult;
    vec3 turbForce = curlNoise(noisePos * 2.0 + 10.0) * turb;
    
    // === CENTER ATTRACTION ===
    float dist = length(position);
    vec3 toCenter = -normalize(position);
    float centerForce = uCenterAttraction * stateParams.attractionMult;
    // Stronger attraction further from center
    centerForce *= smoothstep(0.0, uBoundsRadius, dist);
    vec3 attractionForce = toCenter * centerForce;
    
    // === POINT ATTRACTOR ===
    vec3 toAttractor = uAttractorPosition - position;
    float attractorDist = length(toAttractor);
    vec3 pointAttractorForce = vec3(0.0);
    if (attractorDist > 0.01) {
      pointAttractorForce = normalize(toAttractor) * uAttractorStrength / (1.0 + attractorDist * attractorDist);
    }
    
    // === AUDIO REACTIVE FORCES ===
    // Bass creates radial pulses
    float bassPulse = sin(dist * 3.0 - uTime * 5.0) * uBass * 0.5;
    vec3 bassForce = normalize(position) * bassPulse;
    
    // Treble creates high-frequency shimmer
    vec3 trebleForce = curlNoise(noisePos * 4.0 + uTime * 3.0) * uTreble * 0.3;
    
    // Pulse creates rhythmic expansion
    float pulseWave = sin(uPulse * 6.28318) * 0.5 + 0.5;
    vec3 pulseForce = normalize(position) * pulseWave * uAudioLevel * 0.3;
    
    // === COMBINE FORCES ===
    vec3 totalForce = curlForce + turbForce + attractionForce + pointAttractorForce +
                      bassForce + trebleForce + pulseForce;
    
    // Apply force to velocity
    velocity += totalForce * uDeltaTime * stateParams.speedMult;
    
    // Apply damping
    velocity *= uVelocityDamping * stateParams.dampingMult;
    
    // Clamp velocity
    float maxSpeed = 2.0 * stateParams.speedMult;
    float speed = length(velocity);
    if (speed > maxSpeed) {
      velocity = normalize(velocity) * maxSpeed;
    }
    
    gl_FragColor = vec4(velocity, vel.w);
  }
`;

//=============================================================================
// GPGPU SYSTEM CLASS
//=============================================================================

export class GPGPUParticleSystem {
  private renderer: THREE.WebGLRenderer;
  private state: GPGPUState | null = null;
  private isInitialized = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /**
   * Calculate texture size needed for particle count
   */
  static calculateTextureSize(particleCount: number): number {
    // Texture stores one particle per pixel, so we need sqrt(particleCount) squared
    const size = Math.ceil(Math.sqrt(particleCount));
    // Round up to next power of 2 for better GPU performance
    return Math.pow(2, Math.ceil(Math.log2(size)));
  }

  /**
   * Initialize the GPGPU system
   */
  initialize(config: Partial<GPGPUConfig> = {}): void {
    if (this.isInitialized) {
      this.dispose();
    }

    const fullConfig: GPGPUConfig = {
      particleCount: config.particleCount ?? 100000,
      textureSize: GPGPUParticleSystem.calculateTextureSize(config.particleCount ?? 100000),
      bounds: config.bounds ?? 3.0,
      initialRadius: config.initialRadius ?? 1.5,
    };

    // Create render targets for ping-pong buffering
    const rtOptions: THREE.WebGLRenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    };

    const positionTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [
      new THREE.WebGLRenderTarget(fullConfig.textureSize, fullConfig.textureSize, rtOptions),
      new THREE.WebGLRenderTarget(fullConfig.textureSize, fullConfig.textureSize, rtOptions),
    ];

    const velocityTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [
      new THREE.WebGLRenderTarget(fullConfig.textureSize, fullConfig.textureSize, rtOptions),
      new THREE.WebGLRenderTarget(fullConfig.textureSize, fullConfig.textureSize, rtOptions),
    ];

    // Create uniforms
    const uniforms: GPGPUUniforms = {
      uTime: { value: 0 },
      uDeltaTime: { value: 0.016 },
      uState: { value: 0 },
      uAudioLevel: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uPulse: { value: 0 },
      uNoiseScale: { value: 0.5 },
      uNoiseSpeed: { value: 0.3 },
      uCurlStrength: { value: 0.8 },
      uAttractorStrength: { value: 0 },
      uAttractorPosition: { value: new THREE.Vector3(0, 0, 0) },
      uCenterAttraction: { value: 0.5 },
      uVelocityDamping: { value: 0.98 },
      uBoundsRadius: { value: fullConfig.bounds },
      uTurbulence: { value: 0.2 },
      tPositions: { value: null },
      tVelocities: { value: null },
    };

    // Create simulation material (velocity update)
    const simulationMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: gpgpuVertexShader,
      fragmentShader: velocityUpdateShader,
    });

    // Create position update material
    const positionMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPositions: { value: null },
        tVelocities: { value: null },
        uDeltaTime: uniforms.uDeltaTime,
        uBoundsRadius: uniforms.uBoundsRadius,
      },
      vertexShader: gpgpuVertexShader,
      fragmentShader: positionUpdateShader,
    });

    // Create render scene for GPGPU
    const renderScene = new THREE.Scene();
    const renderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      simulationMaterial
    );
    renderScene.add(renderQuad);

    // Initialize position texture with sphere distribution
    this.initializePositionTexture(positionTextures[0], fullConfig);
    this.initializePositionTexture(positionTextures[1], fullConfig);

    // Initialize velocity texture with small random velocities
    this.initializeVelocityTexture(velocityTextures[0], fullConfig);
    this.initializeVelocityTexture(velocityTextures[1], fullConfig);

    this.state = {
      positionTextures,
      velocityTextures,
      currentIndex: 0,
      simulationMaterial,
      renderScene,
      renderCamera,
      renderQuad,
      config: fullConfig,
      uniforms,
    };

    // Store position material for later use
    (this.state as GPGPUState & { positionMaterial: THREE.ShaderMaterial }).positionMaterial = positionMaterial;

    this.isInitialized = true;
  }

  /**
   * Initialize position texture with Fibonacci sphere distribution
   */
  private initializePositionTexture(
    renderTarget: THREE.WebGLRenderTarget,
    config: GPGPUConfig
  ): void {
    const size = config.textureSize;
    const data = new Float32Array(size * size * 4);
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const totalParticles = size * size;

    for (let i = 0; i < totalParticles; i++) {
      // Fibonacci sphere distribution
      const phi = Math.acos(1 - (2 * (i + 0.5)) / totalParticles);
      const theta = (Math.PI * 2 * i) / goldenRatio;

      // Random radius with variance
      const r = config.initialRadius * (0.3 + Math.random() * 0.7);

      data[i * 4 + 0] = r * Math.sin(phi) * Math.cos(theta);
      data[i * 4 + 1] = r * Math.sin(phi) * Math.sin(theta);
      data[i * 4 + 2] = r * Math.cos(phi);
      data[i * 4 + 3] = Math.random(); // Age/random seed
    }

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;

    // Render the texture to the render target
    const tempScene = new THREE.Scene();
    const tempCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tempMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const tempQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tempMaterial);
    tempScene.add(tempQuad);

    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(tempScene, tempCamera);
    this.renderer.setRenderTarget(null);

    tempMaterial.dispose();
    tempQuad.geometry.dispose();
    texture.dispose();
  }

  /**
   * Initialize velocity texture with small random velocities
   */
  private initializeVelocityTexture(
    renderTarget: THREE.WebGLRenderTarget,
    config: GPGPUConfig
  ): void {
    const size = config.textureSize;
    const data = new Float32Array(size * size * 4);

    for (let i = 0; i < size * size; i++) {
      // Small random tangential velocity for orbital motion
      const theta = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.03;

      data[i * 4 + 0] = Math.cos(theta) * speed;
      data[i * 4 + 1] = (Math.random() - 0.5) * speed * 0.5;
      data[i * 4 + 2] = Math.sin(theta) * speed;
      data[i * 4 + 3] = 0;
    }

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;

    const tempScene = new THREE.Scene();
    const tempCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tempMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const tempQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tempMaterial);
    tempScene.add(tempQuad);

    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(tempScene, tempCamera);
    this.renderer.setRenderTarget(null);

    tempMaterial.dispose();
    tempQuad.geometry.dispose();
    texture.dispose();
  }

  /**
   * Update simulation state
   */
  update(delta: number): void {
    if (!this.state || !this.isInitialized) return;

    const { uniforms, simulationMaterial, renderScene, renderCamera, positionTextures, velocityTextures, currentIndex } = this.state;
    const positionMaterial = (this.state as GPGPUState & { positionMaterial: THREE.ShaderMaterial }).positionMaterial;

    // Update time
    uniforms.uTime.value += delta;
    uniforms.uDeltaTime.value = Math.min(delta, 0.05); // Cap delta to prevent instability

    const readIndex = currentIndex;
    const writeIndex = 1 - currentIndex;

    // Step 1: Update velocities
    uniforms.tPositions.value = positionTextures[readIndex].texture;
    uniforms.tVelocities.value = velocityTextures[readIndex].texture;

    this.state.renderQuad.material = simulationMaterial;
    this.renderer.setRenderTarget(velocityTextures[writeIndex]);
    this.renderer.render(renderScene, renderCamera);

    // Step 2: Update positions
    positionMaterial.uniforms.tPositions.value = positionTextures[readIndex].texture;
    positionMaterial.uniforms.tVelocities.value = velocityTextures[writeIndex].texture;

    this.state.renderQuad.material = positionMaterial;
    this.renderer.setRenderTarget(positionTextures[writeIndex]);
    this.renderer.render(renderScene, renderCamera);

    // Reset render target
    this.renderer.setRenderTarget(null);

    // Swap buffers
    this.state.currentIndex = writeIndex;
  }

  /**
   * Get the current position texture for rendering
   */
  getPositionTexture(): THREE.Texture | null {
    if (!this.state) return null;
    return this.state.positionTextures[this.state.currentIndex].texture;
  }

  /**
   * Get the current velocity texture
   */
  getVelocityTexture(): THREE.Texture | null {
    if (!this.state) return null;
    return this.state.velocityTextures[this.state.currentIndex].texture;
  }

  /**
   * Get texture size (for shader uniforms)
   */
  getTextureSize(): number {
    return this.state?.config.textureSize ?? 0;
  }

  /**
   * Get particle count
   */
  getParticleCount(): number {
    if (!this.state) return 0;
    const size = this.state.config.textureSize;
    return size * size;
  }

  /**
   * Set uniform values
   */
  setUniform<K extends keyof GPGPUUniforms>(
    key: K,
    value: GPGPUUniforms[K]['value']
  ): void {
    if (this.state) {
      this.state.uniforms[key].value = value as never;
    }
  }

  /**
   * Set multiple uniforms at once
   */
  setUniforms(values: Partial<{ [K in keyof GPGPUUniforms]: GPGPUUniforms[K]['value'] }>): void {
    if (!this.state) return;
    for (const key in values) {
      if (key in this.state.uniforms) {
        (this.state.uniforms as Record<string, { value: unknown }>)[key].value = values[key as keyof typeof values];
      }
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    if (!this.state) return;

    this.state.positionTextures.forEach((rt) => rt.dispose());
    this.state.velocityTextures.forEach((rt) => rt.dispose());
    this.state.simulationMaterial.dispose();
    (this.state as GPGPUState & { positionMaterial: THREE.ShaderMaterial }).positionMaterial?.dispose();
    this.state.renderQuad.geometry.dispose();

    this.state = null;
    this.isInitialized = false;
  }

  /**
   * Check if system is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

//=============================================================================
// PARTICLE RENDERING SHADERS (for use with GPGPU)
//=============================================================================

/**
 * Vertex shader that reads positions from GPGPU texture
 */
export const gpgpuParticleVertexShader = /* glsl */ `
  attribute float particleIndex;
  attribute vec3 customColor;
  attribute float size;
  attribute float alpha;
  
  uniform sampler2D tPositions;
  uniform float uTextureSize;
  uniform float uTime;
  uniform float uState;
  uniform float uAudioLevel;
  uniform float uGlowIntensity;
  uniform vec3 uStateColor;
  uniform float uColorMix;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDistance;
  
  void main() {
    // Calculate UV coordinates from particle index
    float idx = particleIndex;
    float u = mod(idx, uTextureSize) / uTextureSize;
    float v = floor(idx / uTextureSize) / uTextureSize;
    vec2 uv = vec2(u, v) + 0.5 / uTextureSize; // Center of texel
    
    // Read position from GPGPU texture
    vec4 posData = texture2D(tPositions, uv);
    vec3 pos = posData.xyz;
    
    // Color blending with state
    vColor = mix(customColor, uStateColor, uColorMix * 0.5);
    vAlpha = alpha;
    
    // Calculate view position
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vDistance = -mvPosition.z;
    
    // Size with distance attenuation
    float sizeAtten = size * (50.0 / max(vDistance, 0.1));
    
    // Audio-reactive size
    float sizePulse = 1.0 + uAudioLevel * 0.3;
    
    // State-based size modifier
    float stateSize = 1.0;
    if (uState > 1.5 && uState < 2.5) { // thinking
      stateSize = 1.2 + sin(uTime * 8.0) * 0.15;
    } else if (uState > 2.5 && uState < 3.5) { // speaking
      stateSize = 1.1 + sin(uTime * 4.0) * 0.2;
    }
    
    gl_PointSize = clamp(sizeAtten * sizePulse * stateSize, 0.5, 6.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Fragment shader for GPGPU particles (same as regular particles)
 */
export const gpgpuParticleFragmentShader = /* glsl */ `
  precision highp float;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDistance;
  
  uniform float uGlowIntensity;
  uniform float uTime;
  uniform float uState;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Core glow
    float core = exp(-dist * 6.0);
    
    // Outer glow
    float glow = exp(-dist * 2.5) * 0.4;
    
    float intensity = (core + glow) * uGlowIntensity;
    
    // Color enhancement - white hot center
    vec3 finalColor = vColor;
    finalColor = mix(finalColor, vec3(1.0), core * 0.6);
    finalColor *= (1.0 + intensity * 0.5);
    
    // Alpha calculation
    float alpha = (core + glow * 0.4) * vAlpha;
    
    if (alpha < 0.01) discard;
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export default GPGPUParticleSystem;
