/**
 * Nova Desktop - Orb Components
 * Exports for the AI Core particle visualization system
 */

// Core visualization
export { NovaParticles } from './NovaParticles';
export { NovaParticlesAttractors } from './NovaParticles_Attractors';
export type { NovaState } from './NovaParticles';

// Main wrapper component
export { NovaOrb } from './NovaOrb';
export { NovaOrbAttractor } from './NovaOrbAttractor';

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
export type { AttractorFunction, AttractorSettings, StateColors, NovaState as NovaStateAttractor } from './attractors';

// Shaders
export {
  particleVertexShader,
  particleFragmentShader,
  bloomVertexShader,
  bloomFragmentShader,
  createShaderUniforms,
} from './shaders';
export type { ParticleShaderUniforms } from './shaders';
