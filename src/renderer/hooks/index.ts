/**
 * Nova Desktop - Hooks
 * Exports for renderer hooks
 */

export { useNovaState } from './useNovaState';
export { useAudioAnalysis, useGlobalAudioAnalysis } from './useAudioAnalysis';
export type { AudioFeatures } from './useAudioAnalysis';
export {
  usePerformanceMonitor,
  getPerformanceRating,
  getSuggestedParticleCount,
} from './usePerformanceMonitor';
export type { PerformanceMetrics } from './usePerformanceMonitor';
export { useAdaptiveParticles } from './useAdaptiveParticles';
export type { AdaptiveParticlesOptions, AdaptiveParticlesResult } from './useAdaptiveParticles';
