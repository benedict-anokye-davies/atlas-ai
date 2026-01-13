/**
 * Nova Desktop - Orb Components
 * Exports for the strange attractor visualization system
 */

// Core visualization
export { NovaParticles } from './NovaParticles';
export type { NovaState } from './NovaParticles';

// Main wrapper component
export { NovaOrb } from './NovaOrb';

// Math and utilities
export { aizawa, lorenz, thomas, halvorsen, ATTRACTOR_SETTINGS, STATE_COLORS } from './attractors';
export type { AttractorFunction, AttractorSettings, StateColors } from './attractors';

// Shaders
export {
  particleVertexShader,
  particleFragmentShader,
  bloomVertexShader,
  bloomFragmentShader,
} from './shaders';
