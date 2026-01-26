/**
 * Atlas Desktop - Orb Components
 * Exports for the AI Core particle visualization system
 */

// Core visualization
export { AtlasParticles, gpuMemoryManager, GPUMemoryManager } from './AtlasParticles';
export { AtlasParticlesAttractors } from './AtlasParticles_Attractors';
export type {
  AtlasState,
  GPUMemoryInfo,
  GPUMemoryThresholds,
  PerformanceConfig,
  LODLevel
} from './AtlasParticles';

// Enhanced GPGPU Particles (100k+ particles with trails)
export {
  EnhancedAtlasParticles,
  DEFAULT_TRAIL_CONFIG,
  PERFORMANCE_CONFIGS,
} from './EnhancedAtlasParticles';
export type {
  EnhancedParticleConfig,
} from './EnhancedAtlasParticles';
export type { TrailConfig } from './trail-system';

// GPGPU Particle System
export {
  GPGPUParticleSystem,
  gpgpuParticleVertexShader,
  gpgpuParticleFragmentShader,
} from './gpgpu';
export type {
  GPGPUConfig,
  GPGPUUniforms,
  GPGPUState,
} from './gpgpu';

// Particle Trail System
export {
  GPUTrailHistory,
  createTrailGeometry,
  createTrailUniforms,
  createTrailMaterial,
  TRAIL_STYLE_MAP,
  TRAIL_STATE_PARAMS,
  trailVertexShader,
  trailFragmentShader,
} from './trail-system';
export type {
  TrailStyle,
  TrailUniforms,
} from './trail-system';

// Demo Component
export { EnhancedOrbDemo } from './EnhancedOrbDemo';

// Main wrapper component
export { AtlasOrb } from './AtlasOrb';
export { AtlasOrbAttractor } from './AtlasOrbAttractor';

// Geometry generation utilities
export {
  generateSpherePoints,
  generateRingPoints,
  generateParticleSizes,
  generateParticleAlphas,
  generateParticleColors,
  rotatePointsX,
  rotatePointsZ,
  DEFAULT_LAYERS,
  STATE_COLORS,
  STATE_PARAMS,
} from './geometry';
export type { LayerConfig } from './geometry';

// Strange attractor support
export {
  aizawa,
  lorenz,
  thomas,
  halvorsen,
  arneodo,
  ATTRACTOR_SETTINGS,
  STATE_TO_ATTRACTOR,
  getAttractor,
} from './attractors';
export type { AttractorFunction, AttractorSettings, StateColors, AtlasState as AtlasStateAttractor } from './attractors';

// Shaders
export {
  particleVertexShader,
  particleFragmentShader,
  bloomVertexShader,
  bloomFragmentShader,
  createShaderUniforms,
} from './shaders';
export type { ParticleShaderUniforms } from './shaders';

// Shader Manager - Advanced shader management with hot-reload
export {
  ShaderManagerProvider,
  useShaderManager,
  ShaderTimeUpdater,
  ShaderErrorDisplay,
  GLOW_VERTEX_SHADER,
  GLOW_FRAGMENT_SHADER,
  NOISE_VERTEX_SHADER,
  NOISE_FRAGMENT_SHADER,
} from './ShaderManager';
export type {
  AtlasState as ShaderAtlasState,
  ShaderCompilationResult,
  ShaderError,
  UniformDefinition,
  ShaderEffectConfig,
  StateShaderParams,
  ShaderManagerContextValue,
  CompilationStats,
} from './ShaderManager';

// 3D Background effects
export { Background3D } from './Background3D';
export type { Background3DProps, BackgroundTheme, BackgroundQuality } from './Background3D';

// JARVIS-style effects
export { JarvisWireframe } from './JarvisWireframe';
export type { JarvisWireframeProps } from './JarvisWireframe';

export { JarvisCore } from './JarvisCore';
export type { JarvisCoreProps } from './JarvisCore';

export { OrbitalRings } from './OrbitalRings';
export type { OrbitalRingsProps } from './OrbitalRings';

export { EnergyTendrils } from './EnergyTendrils';
export type { EnergyTendrilsProps } from './EnergyTendrils';

export { NeuralConnections } from './NeuralConnections';
export type { NeuralConnectionsProps } from './NeuralConnections';

export { HologramEffects, DataStream } from './HologramEffects';
export type { HologramEffectsProps, DataStreamProps } from './HologramEffects';

export { HexGrid } from './HexGrid';
export type { HexGridProps } from './HexGrid';

export { ArcReactor } from './ArcReactor';
export type { ArcReactorProps } from './ArcReactor';

// Ambient/Screensaver mode
export {
  AmbientMode,
  useIdleDetection,
  useAmbientMode,
  THEME_COLORS as AMBIENT_THEME_COLORS,
  DEFAULT_CONFIG as AMBIENT_DEFAULT_CONFIG,
} from './AmbientMode';
export type {
  AmbientTheme,
  ClockFormat,
  AmbientModeConfig,
  AmbientModeProps,
  UseIdleDetectionOptions,
  UseAmbientModeOptions,
  ThemeColors as AmbientThemeColors,
} from './AmbientMode';
