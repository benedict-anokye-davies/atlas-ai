/**
 * Atlas Desktop - Hooks
 * Exports for renderer hooks
 */

export { useAtlasState } from './useAtlasState';
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
export { useGPUCapabilities, getAdaptiveParticleCount } from './useGPUCapabilities';
export type {
  UseGPUCapabilitiesOptions,
  UseGPUCapabilitiesResult,
  GPUCapabilities,
  GPUInfo,
  GPURenderingConfig,
  GPUTier,
  GPUVendor,
} from './useGPUCapabilities';
export { useCommands } from './useCommands';

// Keyboard shortcuts hooks
export { useShortcuts, usePushToTalk } from './useShortcuts';
export type {
  ShortcutAction,
  ShortcutDefinition,
  ShortcutHandler,
  UseShortcutsOptions,
  UseShortcutsReturn,
} from './useShortcuts';

// Focus management hooks (Session 039-A)
export {
  useFocusTrap,
  useFocusRestore,
  useFocusOnMount,
  useRovingTabIndex,
  useEscapeKey,
  useArrowNavigation,
  useModalFocus,
} from './useFocusManagement';
export type { RovingDirection } from './useFocusManagement';

// Task Framework hooks (T2 Phase 0)
export { useTaskState } from './useTaskState';
export type {
  Task,
  TaskStep,
  TaskProgressEvent,
  TaskCompletionEvent,
  TaskQueueStats,
  TaskStateResult,
  CreateTaskOptions,
} from './useTaskState';
