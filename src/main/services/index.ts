/**
 * Atlas Desktop - Services Index
 *
 * Central exports for all service modules
 */

export {
  WarmupManager,
  getWarmupManager,
  shutdownWarmupManager,
  type WarmupManagerConfig,
  type WarmupManagerEvents,
  type ConnectionStatus,
  DEFAULT_WARMUP_CONFIG,
} from './warmup-manager';

export {
  LazyLoader,
  getLazyLoader,
  shutdownLazyLoader,
  loadModule,
  initializeLazyLoading,
  type LazyLoaderConfig,
  type LazyLoaderEvents,
  type ModulePriority,
  type ModuleStatus,
  type ModuleInfo,
  type LoadStats,
} from './lazy-loader';
