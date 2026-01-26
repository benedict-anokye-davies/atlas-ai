/**
 * Atlas Desktop - Performance Module
 * Exports for startup profiling, memory optimization, and performance monitoring.
 */

// Startup Profiler
export {
  StartupProfiler,
  getStartupProfiler,
  shutdownStartupProfiler,
  measurePhase,
  measurePhaseAsync,
} from './startup-profiler';

export type {
  StartupPhase,
  PhaseRecord,
  ModuleLoadRecord,
  StartupMetric,
  PhaseTimingSummary,
  MemoryUsageSnapshot,
  ProfilerConfig,
  TimelineEvent,
} from './startup-profiler';

// Memory Optimizer
export {
  MemoryOptimizer,
  getMemoryOptimizer,
  shutdownMemoryOptimizer,
  ObjectPool,
  Float32ArrayPool,
  BufferPool,
  ChunkedProcessor,
  iterateChunked,
  createMemoryAwareDebounce,
  createThrottle,
  WeakCache,
} from './memory-optimizer';

export type {
  MemoryPressureLevel,
  MemorySnapshot,
  PoolStats,
  CacheRegistryEntry,
  LazyModuleEntry,
  Disposable,
  MemoryOptimizerConfig,
  MemoryOptimizerEvents,
} from './memory-optimizer';
