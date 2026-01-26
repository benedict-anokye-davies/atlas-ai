/* eslint-disable no-console */
/**
 * Atlas Desktop - Shader Manager
 * Comprehensive shader management system with hot-reload, compilation error handling,
 * and state-responsive shader variations.
 *
 * Features:
 * - Shader compilation with error handling and reporting
 * - Hot-reload support for development
 * - State-responsive shader parameter management
 * - Custom shader effect composition
 * - Performance monitoring
 * - Shader caching and optimization
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

//=============================================================================
// TYPES AND INTERFACES
//=============================================================================

/** Atlas state types for shader variations */
export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/** Shader compilation result */
export interface ShaderCompilationResult {
  success: boolean;
  program?: WebGLProgram;
  vertexShader?: WebGLShader;
  fragmentShader?: WebGLShader;
  errors: ShaderError[];
  warnings: string[];
  compilationTime: number;
}

/** Shader error details */
export interface ShaderError {
  type: 'vertex' | 'fragment' | 'link';
  line?: number;
  message: string;
  source?: string;
}

/** Shader uniform definition */
export interface UniformDefinition {
  type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat3' | 'mat4' | 'sampler2D';
  value:
    | number
    | number[]
    | THREE.Texture
    | THREE.Matrix3
    | THREE.Matrix4
    | THREE.Vector2
    | THREE.Vector3
    | THREE.Vector4;
  min?: number;
  max?: number;
  description?: string;
}

/** Shader effect configuration */
export interface ShaderEffectConfig {
  id: string;
  name: string;
  enabled: boolean;
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, UniformDefinition>;
  blending?: THREE.Blending;
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  side?: THREE.Side;
  priority?: number;
}

/** State-specific shader parameters */
export interface StateShaderParams {
  glowIntensity: number;
  glowRadius: number;
  noiseStrength: number;
  noiseSpeed: number;
  distortionAmount: number;
  colorMix: number;
  pulseFrequency: number;
  turbulence: number;
}

/** Shader manager context value */
export interface ShaderManagerContextValue {
  // Shader compilation
  compileShader: (source: string, type: 'vertex' | 'fragment') => ShaderCompilationResult;
  compileProgram: (vertexSource: string, fragmentSource: string) => ShaderCompilationResult;

  // Shader management
  registerEffect: (config: ShaderEffectConfig) => void;
  unregisterEffect: (id: string) => void;
  setEffectEnabled: (id: string, enabled: boolean) => void;
  getEffect: (id: string) => ShaderEffectConfig | undefined;
  getAllEffects: () => ShaderEffectConfig[];

  // Uniform management
  setUniform: (effectId: string, uniformName: string, value: UniformDefinition['value']) => void;
  getUniform: (effectId: string, uniformName: string) => UniformDefinition | undefined;
  updateUniforms: (effectId: string, uniforms: Record<string, UniformDefinition['value']>) => void;

  // State management
  currentState: AtlasState;
  setCurrentState: (state: AtlasState) => void;
  getStateParams: (state: AtlasState) => StateShaderParams;

  // Performance
  getCompilationStats: () => CompilationStats;

  // Hot reload
  hotReload: (
    effectId: string,
    vertexShader?: string,
    fragmentShader?: string
  ) => ShaderCompilationResult;

  // Materials
  materials: Map<string, THREE.ShaderMaterial>;
  getMaterial: (effectId: string) => THREE.ShaderMaterial | undefined;
}

/** Compilation statistics */
export interface CompilationStats {
  totalCompilations: number;
  successfulCompilations: number;
  failedCompilations: number;
  averageCompilationTime: number;
  lastCompilationTime: number;
  cachedShaders: number;
}

//=============================================================================
// DEFAULT STATE SHADER PARAMETERS
//=============================================================================

const DEFAULT_STATE_PARAMS: Record<AtlasState, StateShaderParams> = {
  idle: {
    glowIntensity: 0.8,
    glowRadius: 2.0,
    noiseStrength: 0.1,
    noiseSpeed: 0.3,
    distortionAmount: 0.0,
    colorMix: 0.0,
    pulseFrequency: 1.5,
    turbulence: 0.0,
  },
  listening: {
    glowIntensity: 1.0,
    glowRadius: 3.0,
    noiseStrength: 0.2,
    noiseSpeed: 0.5,
    distortionAmount: 0.1,
    colorMix: 0.3,
    pulseFrequency: 2.0,
    turbulence: 0.1,
  },
  thinking: {
    glowIntensity: 1.5,
    glowRadius: 4.0,
    noiseStrength: 0.5,
    noiseSpeed: 1.5,
    distortionAmount: 0.3,
    colorMix: 0.5,
    pulseFrequency: 6.0,
    turbulence: 0.3,
  },
  speaking: {
    glowIntensity: 1.2,
    glowRadius: 3.5,
    noiseStrength: 0.3,
    noiseSpeed: 1.0,
    distortionAmount: 0.15,
    colorMix: 0.4,
    pulseFrequency: 3.0,
    turbulence: 0.05,
  },
  error: {
    glowIntensity: 2.0,
    glowRadius: 5.0,
    noiseStrength: 0.8,
    noiseSpeed: 2.0,
    distortionAmount: 0.5,
    colorMix: 0.8,
    pulseFrequency: 8.0,
    turbulence: 0.6,
  },
};

//=============================================================================
// BUILT-IN SHADERS
//=============================================================================

/** Glow effect vertex shader */
export const GLOW_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Glow effect fragment shader */
export const GLOW_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uGlowIntensity;
  uniform float uGlowRadius;
  uniform vec3 uGlowColor;
  uniform float uPulseFrequency;
  uniform sampler2D tDiffuse;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec4 texColor = texture2D(tDiffuse, vUv);

    // Pulsing glow based on time and frequency
    float pulse = sin(uTime * uPulseFrequency) * 0.5 + 0.5;
    float glowFactor = uGlowIntensity * (0.8 + pulse * 0.4);

    // Edge glow based on view angle
    float edgeFactor = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
    edgeFactor = pow(edgeFactor, uGlowRadius);

    // Combine glow with original color
    vec3 glow = uGlowColor * edgeFactor * glowFactor;
    vec3 finalColor = texColor.rgb + glow;

    // Soft tone mapping
    finalColor = finalColor / (finalColor + vec3(1.0));

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

/** Noise distortion vertex shader */
export const NOISE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 position;
  attribute vec2 uv;
  attribute vec3 normal;

  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  uniform float uTime;
  uniform float uNoiseStrength;
  uniform float uNoiseSpeed;
  uniform float uTurbulence;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDistortion;

  // Simplex noise functions
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

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
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    // Calculate noise-based displacement
    float time = uTime * uNoiseSpeed;
    vec3 noisePos = position + time;

    float noise1 = snoise(noisePos * 0.5);
    float noise2 = snoise(noisePos * 1.0 + 10.0) * 0.5;
    float noise3 = snoise(noisePos * 2.0 + 20.0) * 0.25;

    float totalNoise = (noise1 + noise2 + noise3) * uNoiseStrength;
    totalNoise += snoise(noisePos * 4.0) * uTurbulence * 0.1;

    vDistortion = totalNoise;

    // Apply displacement along normal
    vec3 displaced = position + normal * totalNoise;

    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(displaced, 1.0);
  }
`;

/** Noise distortion fragment shader */
export const NOISE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uBaseColor;
  uniform vec3 uDistortionColor;
  uniform float uColorMix;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDistortion;

  void main() {
    // Mix colors based on distortion amount
    float mixFactor = abs(vDistortion) * uColorMix;
    vec3 color = mix(uBaseColor, uDistortionColor, mixFactor);

    // Add subtle shading based on normal
    float shade = dot(vNormal, normalize(vec3(0.5, 1.0, 0.3))) * 0.5 + 0.5;
    color *= shade;

    gl_FragColor = vec4(color, 1.0);
  }
`;

//=============================================================================
// SHADER COMPILER UTILITIES
//=============================================================================

/**
 * Parse shader compilation errors from WebGL
 */
function parseShaderErrors(
  gl: WebGLRenderingContext,
  shader: WebGLShader,
  source: string,
  type: 'vertex' | 'fragment'
): ShaderError[] {
  const log = gl.getShaderInfoLog(shader);
  if (!log) return [];

  const errors: ShaderError[] = [];
  const lines = log.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Try to parse line number from error message
    // Format varies by GPU vendor: "ERROR: 0:42:" or "ERROR: line 42:"
    const lineMatch = line.match(/(?:ERROR|WARNING):\s*(?:\d+:)?(\d+):/i);
    const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

    // Get the source line if we have a line number
    const sourceLines = source.split('\n');
    const sourceLine =
      lineNumber && lineNumber > 0 && lineNumber <= sourceLines.length
        ? sourceLines[lineNumber - 1].trim()
        : undefined;

    errors.push({
      type,
      line: lineNumber,
      message: line.trim(),
      source: sourceLine,
    });
  }

  return errors;
}

/**
 * Parse program link errors
 */
function parseLinkErrors(gl: WebGLRenderingContext, program: WebGLProgram): ShaderError[] {
  const log = gl.getProgramInfoLog(program);
  if (!log) return [];

  return log
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => ({
      type: 'link' as const,
      message: line.trim(),
    }));
}

//=============================================================================
// SHADER MANAGER CONTEXT
//=============================================================================

const ShaderManagerContext = createContext<ShaderManagerContextValue | null>(null);

/**
 * Hook to access shader manager
 */
export function useShaderManager(): ShaderManagerContextValue {
  const context = useContext(ShaderManagerContext);
  if (!context) {
    throw new Error('useShaderManager must be used within ShaderManagerProvider');
  }
  return context;
}

//=============================================================================
// SHADER MANAGER PROVIDER COMPONENT
//=============================================================================

interface ShaderManagerProviderProps {
  children: React.ReactNode;
  initialState?: AtlasState;
  onCompilationError?: (errors: ShaderError[]) => void;
  enableHotReload?: boolean;
}

/**
 * ShaderManagerProvider - Provides shader management capabilities to child components
 */
export function ShaderManagerProvider({
  children,
  initialState = 'idle',
  onCompilationError,
  enableHotReload = process.env.NODE_ENV === 'development',
}: ShaderManagerProviderProps) {
  const { gl } = useThree();

  // State
  const [currentState, setCurrentState] = useState<AtlasState>(initialState);
  const [effects, setEffects] = useState<Map<string, ShaderEffectConfig>>(new Map());
  const [materials, setMaterials] = useState<Map<string, THREE.ShaderMaterial>>(new Map());

  // Refs for mutable state
  const statsRef = useRef<CompilationStats>({
    totalCompilations: 0,
    successfulCompilations: 0,
    failedCompilations: 0,
    averageCompilationTime: 0,
    lastCompilationTime: 0,
    cachedShaders: 0,
  });
  const shaderCacheRef = useRef<Map<string, WebGLShader>>(new Map());

  /**
   * Compile a single shader (vertex or fragment)
   */
  const compileShader = useCallback(
    (source: string, type: 'vertex' | 'fragment'): ShaderCompilationResult => {
      const startTime = performance.now();
      const glContext = gl.getContext() as WebGLRenderingContext;

      // Check cache
      const cacheKey = `${type}:${source}`;
      const cached = shaderCacheRef.current.get(cacheKey);
      if (cached) {
        return {
          success: true,
          vertexShader: type === 'vertex' ? cached : undefined,
          fragmentShader: type === 'fragment' ? cached : undefined,
          errors: [],
          warnings: [],
          compilationTime: 0,
        };
      }

      // Create shader
      const shaderType = type === 'vertex' ? glContext.VERTEX_SHADER : glContext.FRAGMENT_SHADER;
      const shader = glContext.createShader(shaderType);

      if (!shader) {
        return {
          success: false,
          errors: [{ type, message: 'Failed to create shader object' }],
          warnings: [],
          compilationTime: performance.now() - startTime,
        };
      }

      // Compile shader
      glContext.shaderSource(shader, source);
      glContext.compileShader(shader);

      const success = glContext.getShaderParameter(shader, glContext.COMPILE_STATUS);
      const compilationTime = performance.now() - startTime;

      // Update stats
      statsRef.current.totalCompilations++;
      statsRef.current.lastCompilationTime = compilationTime;
      statsRef.current.averageCompilationTime =
        (statsRef.current.averageCompilationTime * (statsRef.current.totalCompilations - 1) +
          compilationTime) /
        statsRef.current.totalCompilations;

      if (success) {
        statsRef.current.successfulCompilations++;
        shaderCacheRef.current.set(cacheKey, shader);
        statsRef.current.cachedShaders = shaderCacheRef.current.size;

        return {
          success: true,
          vertexShader: type === 'vertex' ? shader : undefined,
          fragmentShader: type === 'fragment' ? shader : undefined,
          errors: [],
          warnings: [],
          compilationTime,
        };
      }

      // Compilation failed
      statsRef.current.failedCompilations++;
      const errors = parseShaderErrors(glContext, shader, source, type);

      if (onCompilationError) {
        onCompilationError(errors);
      }

      glContext.deleteShader(shader);

      return {
        success: false,
        errors,
        warnings: [],
        compilationTime,
      };
    },
    [gl, onCompilationError]
  );

  /**
   * Compile a complete shader program
   */
  const compileProgram = useCallback(
    (vertexSource: string, fragmentSource: string): ShaderCompilationResult => {
      const startTime = performance.now();

      // Compile vertex shader
      const vertexResult = compileShader(vertexSource, 'vertex');
      if (!vertexResult.success) {
        return vertexResult;
      }

      // Compile fragment shader
      const fragmentResult = compileShader(fragmentSource, 'fragment');
      if (!fragmentResult.success) {
        return fragmentResult;
      }

      const glContext = gl.getContext() as WebGLRenderingContext;

      // Create and link program
      const program = glContext.createProgram();
      if (!program) {
        return {
          success: false,
          errors: [{ type: 'link', message: 'Failed to create program object' }],
          warnings: [],
          compilationTime: performance.now() - startTime,
        };
      }

      glContext.attachShader(program, vertexResult.vertexShader!);
      glContext.attachShader(program, fragmentResult.fragmentShader!);
      glContext.linkProgram(program);

      const success = glContext.getProgramParameter(program, glContext.LINK_STATUS);
      const compilationTime = performance.now() - startTime;

      if (success) {
        return {
          success: true,
          program,
          vertexShader: vertexResult.vertexShader,
          fragmentShader: fragmentResult.fragmentShader,
          errors: [],
          warnings: [],
          compilationTime,
        };
      }

      // Link failed
      const errors = parseLinkErrors(glContext, program);
      if (onCompilationError) {
        onCompilationError(errors);
      }

      glContext.deleteProgram(program);

      return {
        success: false,
        errors,
        warnings: [],
        compilationTime,
      };
    },
    [gl, compileShader, onCompilationError]
  );

  /**
   * Register a new shader effect
   */
  const registerEffect = useCallback(
    (config: ShaderEffectConfig) => {
      console.log(`[ShaderManager] Registering effect: ${config.id}`);

      // Validate compilation first
      const result = compileProgram(config.vertexShader, config.fragmentShader);
      if (!result.success) {
        console.error(`[ShaderManager] Failed to compile effect ${config.id}:`, result.errors);
        return;
      }

      // Create THREE.js uniforms
      const threeUniforms: Record<string, THREE.IUniform> = {};
      for (const [name, def] of Object.entries(config.uniforms)) {
        threeUniforms[name] = { value: def.value };
      }

      // Create shader material
      const material = new THREE.ShaderMaterial({
        uniforms: threeUniforms,
        vertexShader: config.vertexShader,
        fragmentShader: config.fragmentShader,
        transparent: config.transparent ?? true,
        blending: config.blending ?? THREE.NormalBlending,
        depthWrite: config.depthWrite ?? false,
        depthTest: config.depthTest ?? true,
        side: config.side ?? THREE.FrontSide,
      });

      setEffects((prev) => new Map(prev).set(config.id, config));
      setMaterials((prev) => new Map(prev).set(config.id, material));
    },
    [compileProgram]
  );

  /**
   * Unregister a shader effect
   */
  const unregisterEffect = useCallback((id: string) => {
    console.log(`[ShaderManager] Unregistering effect: ${id}`);

    setMaterials((prev) => {
      const material = prev.get(id);
      if (material) {
        material.dispose();
      }
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    setEffects((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Enable or disable an effect
   */
  const setEffectEnabled = useCallback((id: string, enabled: boolean) => {
    setEffects((prev) => {
      const effect = prev.get(id);
      if (!effect) return prev;

      const next = new Map(prev);
      next.set(id, { ...effect, enabled });
      return next;
    });
  }, []);

  /**
   * Get a specific effect configuration
   */
  const getEffect = useCallback(
    (id: string): ShaderEffectConfig | undefined => {
      return effects.get(id);
    },
    [effects]
  );

  /**
   * Get all registered effects
   */
  const getAllEffects = useCallback((): ShaderEffectConfig[] => {
    return Array.from(effects.values());
  }, [effects]);

  /**
   * Set a single uniform value
   */
  const setUniform = useCallback(
    (effectId: string, uniformName: string, value: UniformDefinition['value']) => {
      const material = materials.get(effectId);
      if (!material) {
        console.warn(`[ShaderManager] Effect ${effectId} not found`);
        return;
      }

      if (material.uniforms[uniformName]) {
        material.uniforms[uniformName].value = value;
        material.uniformsNeedUpdate = true;
      }
    },
    [materials]
  );

  /**
   * Get a uniform definition
   */
  const getUniform = useCallback(
    (effectId: string, uniformName: string): UniformDefinition | undefined => {
      const effect = effects.get(effectId);
      return effect?.uniforms[uniformName];
    },
    [effects]
  );

  /**
   * Update multiple uniforms at once
   */
  const updateUniforms = useCallback(
    (effectId: string, uniforms: Record<string, UniformDefinition['value']>) => {
      const material = materials.get(effectId);
      if (!material) return;

      for (const [name, value] of Object.entries(uniforms)) {
        if (material.uniforms[name]) {
          material.uniforms[name].value = value;
        }
      }
      material.uniformsNeedUpdate = true;
    },
    [materials]
  );

  /**
   * Get state-specific shader parameters
   */
  const getStateParams = useCallback((state: AtlasState): StateShaderParams => {
    return DEFAULT_STATE_PARAMS[state];
  }, []);

  /**
   * Get compilation statistics
   */
  const getCompilationStats = useCallback((): CompilationStats => {
    return { ...statsRef.current };
  }, []);

  /**
   * Hot reload a shader effect
   */
  const hotReload = useCallback(
    (effectId: string, vertexShader?: string, fragmentShader?: string): ShaderCompilationResult => {
      if (!enableHotReload) {
        return {
          success: false,
          errors: [{ type: 'link', message: 'Hot reload is disabled' }],
          warnings: [],
          compilationTime: 0,
        };
      }

      const effect = effects.get(effectId);
      if (!effect) {
        return {
          success: false,
          errors: [{ type: 'link', message: `Effect ${effectId} not found` }],
          warnings: [],
          compilationTime: 0,
        };
      }

      const newVertex = vertexShader || effect.vertexShader;
      const newFragment = fragmentShader || effect.fragmentShader;

      // Validate new shaders
      const result = compileProgram(newVertex, newFragment);
      if (!result.success) {
        console.error(`[ShaderManager] Hot reload failed for ${effectId}:`, result.errors);
        return result;
      }

      // Update effect and material
      const material = materials.get(effectId);
      if (material) {
        material.vertexShader = newVertex;
        material.fragmentShader = newFragment;
        material.needsUpdate = true;
      }

      setEffects((prev) =>
        new Map(prev).set(effectId, {
          ...effect,
          vertexShader: newVertex,
          fragmentShader: newFragment,
        })
      );

      console.log(`[ShaderManager] Hot reloaded effect: ${effectId}`);
      return result;
    },
    [enableHotReload, effects, materials, compileProgram]
  );

  /**
   * Get a material for an effect
   */
  const getMaterial = useCallback(
    (effectId: string): THREE.ShaderMaterial | undefined => {
      return materials.get(effectId);
    },
    [materials]
  );

  // Update uniforms based on state changes
  useEffect(() => {
    const stateParams = getStateParams(currentState);

    materials.forEach((material) => {
      // Update common state-related uniforms
      if (material.uniforms.uGlowIntensity) {
        material.uniforms.uGlowIntensity.value = stateParams.glowIntensity;
      }
      if (material.uniforms.uGlowRadius) {
        material.uniforms.uGlowRadius.value = stateParams.glowRadius;
      }
      if (material.uniforms.uNoiseStrength) {
        material.uniforms.uNoiseStrength.value = stateParams.noiseStrength;
      }
      if (material.uniforms.uNoiseSpeed) {
        material.uniforms.uNoiseSpeed.value = stateParams.noiseSpeed;
      }
      if (material.uniforms.uTurbulence) {
        material.uniforms.uTurbulence.value = stateParams.turbulence;
      }
      if (material.uniforms.uColorMix) {
        material.uniforms.uColorMix.value = stateParams.colorMix;
      }
      if (material.uniforms.uPulseFrequency) {
        material.uniforms.uPulseFrequency.value = stateParams.pulseFrequency;
      }

      material.uniformsNeedUpdate = true;
    });
  }, [currentState, materials, getStateParams]);

  // Context value
  const contextValue = useMemo<ShaderManagerContextValue>(
    () => ({
      compileShader,
      compileProgram,
      registerEffect,
      unregisterEffect,
      setEffectEnabled,
      getEffect,
      getAllEffects,
      setUniform,
      getUniform,
      updateUniforms,
      currentState,
      setCurrentState,
      getStateParams,
      getCompilationStats,
      hotReload,
      materials,
      getMaterial,
    }),
    [
      compileShader,
      compileProgram,
      registerEffect,
      unregisterEffect,
      setEffectEnabled,
      getEffect,
      getAllEffects,
      setUniform,
      getUniform,
      updateUniforms,
      currentState,
      getStateParams,
      getCompilationStats,
      hotReload,
      materials,
      getMaterial,
    ]
  );

  return (
    <ShaderManagerContext.Provider value={contextValue}>{children}</ShaderManagerContext.Provider>
  );
}

//=============================================================================
// SHADER TIME UNIFORM UPDATER
//=============================================================================

interface ShaderTimeUpdaterProps {
  effectIds?: string[];
}

/**
 * Component that updates time uniforms for shader animations
 */
export function ShaderTimeUpdater({ effectIds }: ShaderTimeUpdaterProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { materials, getAllEffects: _getAllEffects } = useShaderManager();

  useFrame((_, delta) => {
    const targetEffects = effectIds
      ? effectIds.map((id) => materials.get(id)).filter(Boolean)
      : Array.from(materials.values());

    for (const material of targetEffects) {
      if (material && material.uniforms.uTime) {
        material.uniforms.uTime.value += delta;
        material.uniformsNeedUpdate = true;
      }
    }
  });

  return null;
}

//=============================================================================
// SHADER ERROR DISPLAY COMPONENT
//=============================================================================

interface ShaderErrorDisplayProps {
  errors: ShaderError[];
  onDismiss?: () => void;
}

/**
 * Component to display shader compilation errors
 */
export function ShaderErrorDisplay({ errors, onDismiss }: ShaderErrorDisplayProps) {
  if (errors.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        maxWidth: 500,
        background: 'rgba(255, 50, 50, 0.95)',
        color: 'white',
        padding: 16,
        borderRadius: 8,
        fontFamily: 'monospace',
        fontSize: 12,
        zIndex: 9999,
        maxHeight: 300,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <strong>Shader Compilation Errors ({errors.length})</strong>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            X
          </button>
        )}
      </div>
      {errors.map((error, index) => (
        <div
          key={index}
          style={{
            marginBottom: 8,
            padding: 8,
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 4,
          }}
        >
          <div style={{ color: '#ffcc00', marginBottom: 4 }}>
            [{error.type.toUpperCase()}]{error.line && ` Line ${error.line}`}
          </div>
          <div>{error.message}</div>
          {error.source && (
            <div
              style={{ marginTop: 4, color: '#aaa', borderLeft: '2px solid #666', paddingLeft: 8 }}
            >
              {error.source}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

//=============================================================================
// EXPORTS
//=============================================================================

export default ShaderManagerProvider;
