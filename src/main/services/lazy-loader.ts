/**
 * Atlas Desktop - Lazy Module Loader
 *
 * Implements lazy loading for non-critical modules to improve startup time.
 * Defers loading of agent tools, memory system, and voice pipeline components
 * until they are actually needed or during idle time.
 *
 * Features:
 * - Priority-based module loading
 * - Idle-time preloading
 * - Module caching
 * - Load status tracking
 * - Startup time measurement
 *
 * @module services/lazy-loader
 */

import { EventEmitter } from 'events';
import { powerMonitor } from 'electron';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';

const logger = createModuleLogger('LazyLoader');
const perfTimer = new PerformanceTimer('LazyLoader');

/**
 * Module load priority levels
 * - critical: Required for startup, loaded immediately
 * - high: Needed soon after startup, loaded after initial render
 * - medium: Needed for first interaction, preloaded during idle
 * - low: Can wait until explicitly needed
 */
export type ModulePriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Module load status
 */
export type ModuleStatus = 'pending' | 'loading' | 'loaded' | 'failed';

/**
 * Module metadata
 */
export interface ModuleInfo {
  /** Module name for identification */
  name: string;
  /** Load priority */
  priority: ModulePriority;
  /** Current status */
  status: ModuleStatus;
  /** Load time in ms (if loaded) */
  loadTimeMs?: number;
  /** Error message (if failed) */
  error?: string;
  /** Module importer function */
  importer: () => Promise<unknown>;
  /** Dependencies (other module names that must be loaded first) */
  dependencies?: string[];
}

/**
 * Lazy loader configuration
 */
export interface LazyLoaderConfig {
  /** Enable idle-time preloading */
  enableIdlePreload: boolean;
  /** Minimum system idle time before preloading (seconds) */
  idleThresholdSeconds: number;
  /** Preload check interval (ms) */
  preloadIntervalMs: number;
  /** Maximum concurrent module loads */
  maxConcurrentLoads: number;
  /** Timeout for module load (ms) */
  loadTimeoutMs: number;
}

/**
 * Default lazy loader configuration
 */
const DEFAULT_CONFIG: LazyLoaderConfig = {
  enableIdlePreload: true,
  idleThresholdSeconds: 10,
  preloadIntervalMs: 5000,
  maxConcurrentLoads: 2,
  loadTimeoutMs: 30000,
};

/**
 * Lazy loader events
 */
export interface LazyLoaderEvents {
  /** Module started loading */
  'module-loading': (name: string) => void;
  /** Module loaded successfully */
  'module-loaded': (name: string, loadTimeMs: number) => void;
  /** Module failed to load */
  'module-failed': (name: string, error: Error) => void;
  /** All modules loaded */
  'all-loaded': (stats: LoadStats) => void;
  /** Preload started */
  'preload-start': () => void;
  /** Preload complete */
  'preload-complete': (loadedCount: number) => void;
}

/**
 * Load statistics
 */
export interface LoadStats {
  totalModules: number;
  loadedModules: number;
  failedModules: number;
  totalLoadTimeMs: number;
  averageLoadTimeMs: number;
  moduleStats: Record<string, { status: ModuleStatus; loadTimeMs?: number; error?: string }>;
}

/**
 * Lazy Module Loader
 *
 * Manages deferred loading of non-critical modules to improve startup time.
 * Supports priority-based loading, idle-time preloading, and dependency management.
 */
export class LazyLoader extends EventEmitter {
  private config: LazyLoaderConfig;
  private modules: Map<string, ModuleInfo> = new Map();
  private loadedModules: Map<string, unknown> = new Map();
  private preloadTimer: NodeJS.Timeout | null = null;
  private loadQueue: string[] = [];
  private activeLoads = 0;
  private startupTime = 0;

  constructor(config?: Partial<LazyLoaderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startupTime = performance.now();

    logger.info('LazyLoader initialized', {
      enableIdlePreload: this.config.enableIdlePreload,
      idleThreshold: this.config.idleThresholdSeconds,
    });
  }

  /**
   * Register a module for lazy loading
   */
  registerModule(
    name: string,
    importer: () => Promise<unknown>,
    options?: {
      priority?: ModulePriority;
      dependencies?: string[];
    }
  ): void {
    if (this.modules.has(name)) {
      logger.warn('Module already registered, skipping', { name });
      return;
    }

    const moduleInfo: ModuleInfo = {
      name,
      priority: options?.priority ?? 'medium',
      status: 'pending',
      importer,
      dependencies: options?.dependencies,
    };

    this.modules.set(name, moduleInfo);
    logger.debug('Module registered', { name, priority: moduleInfo.priority });
  }

  /**
   * Register common Atlas modules with their priorities
   */
  registerAtlasModules(): void {
    // NOTE: agent-tools and agent modules are NOT registered here because:
    // 1. The voice pipeline already loads them via initializeAgent()
    // 2. Dynamic imports of these modules fail in bundled code due to path resolution issues
    // 3. The modules are successfully loaded when needed by voice pipeline startup

    // Memory system - deferred until after initial response
    this.registerModule(
      'memory',
      async () => {
        const { getMemoryManager } = await import('../memory');
        return getMemoryManager();
      },
      { priority: 'medium' }
    );

    // LLM tools definitions - deferred until first LLM call
    this.registerModule(
      'llm-tools',
      async () => {
        const { getVoiceToolDefinitions } = await import('../agent/llm-tools');
        return getVoiceToolDefinitions();
      },
      { priority: 'medium' }
    );

    // Git tools - deferred until explicitly needed
    this.registerModule(
      'git-tools',
      async () => {
        const { getGitTools } = await import('../agent/tools/git');
        return getGitTools();
      },
      { priority: 'low' }
    );

    // Browser tools - deferred until explicitly needed
    this.registerModule(
      'browser-tools',
      async () => {
        const { getBrowserTools } = await import('../agent/tools/browser');
        return getBrowserTools();
      },
      { priority: 'low' }
    );

    // Terminal tools - deferred until explicitly needed
    this.registerModule(
      'terminal-tools',
      async () => {
        const { getTerminalTools } = await import('../agent/tools/terminal');
        return getTerminalTools();
      },
      { priority: 'low' }
    );

    // Search tools - deferred until explicitly needed
    this.registerModule(
      'search-tools',
      async () => {
        const { getSearchTools } = await import('../agent/tools/search');
        return getSearchTools();
      },
      { priority: 'low' }
    );

    // Vector store - deferred until memory system needs it
    this.registerModule(
      'vector-store',
      async () => {
        const { LanceDBVectorStore } = await import('../memory/vector-store/lancedb');
        return LanceDBVectorStore;
      },
      { priority: 'low', dependencies: ['memory'] }
    );

    // Context builder - deferred until conversation needs context
    this.registerModule(
      'context-builder',
      async () => {
        const { ContextBuilder } = await import('../memory/context-builder');
        return ContextBuilder;
      },
      { priority: 'low', dependencies: ['memory'] }
    );

    // Semantic chunker - deferred until memory storage
    this.registerModule(
      'semantic-chunker',
      async () => {
        const { SemanticChunker } = await import('../memory/semantic-chunker');
        return SemanticChunker;
      },
      { priority: 'low', dependencies: ['memory'] }
    );

    // Audit logger - deferred until first security event
    this.registerModule(
      'audit-logger',
      async () => {
        const { getAuditLogger } = await import('../security/audit-logger');
        return getAuditLogger();
      },
      { priority: 'low' }
    );

    // Input validator - deferred until first input validation
    this.registerModule(
      'input-validator',
      async () => {
        const { getInputValidator } = await import('../security/input-validator');
        return getInputValidator();
      },
      { priority: 'medium' }
    );

    // Cost tracker - deferred until first LLM call
    this.registerModule(
      'cost-tracker',
      async () => {
        const { getCostTracker } = await import('../utils/cost-tracker');
        return getCostTracker();
      },
      { priority: 'low' }
    );

    // Performance profiler - deferred until needed
    this.registerModule(
      'performance-profiler',
      async () => {
        const { getProfiler } = await import('../utils/performance-profiler');
        return getProfiler();
      },
      { priority: 'low' }
    );

    logger.info('Atlas modules registered', { count: this.modules.size });
  }

  /**
   * Load a module by name
   * Returns cached module if already loaded
   */
  async load<T = unknown>(name: string): Promise<T> {
    // Return cached module if already loaded
    if (this.loadedModules.has(name)) {
      return this.loadedModules.get(name) as T;
    }

    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) {
      throw new Error(`Module not registered: ${name}`);
    }

    // If already loading, wait for it
    if (moduleInfo.status === 'loading') {
      return new Promise((resolve, reject) => {
        const checkLoaded = () => {
          if (moduleInfo.status === 'loaded') {
            resolve(this.loadedModules.get(name) as T);
          } else if (moduleInfo.status === 'failed') {
            reject(new Error(moduleInfo.error || 'Module load failed'));
          } else {
            setTimeout(checkLoaded, 50);
          }
        };
        checkLoaded();
      });
    }

    // Load dependencies first
    if (moduleInfo.dependencies) {
      for (const dep of moduleInfo.dependencies) {
        if (!this.loadedModules.has(dep)) {
          await this.load(dep);
        }
      }
    }

    // Load the module
    return this.loadModule<T>(name);
  }

  /**
   * Internal module loading with timing and error handling
   */
  private async loadModule<T>(name: string): Promise<T> {
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) {
      throw new Error(`Module not registered: ${name}`);
    }

    moduleInfo.status = 'loading';
    this.emit('module-loading', name);

    const startTime = performance.now();
    perfTimer.start(`load:${name}`);

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Module load timeout')), this.config.loadTimeoutMs);
      });

      // Race between module load and timeout
      const result = await Promise.race([moduleInfo.importer(), timeoutPromise]);

      const loadTimeMs = performance.now() - startTime;
      perfTimer.end(`load:${name}`);

      moduleInfo.status = 'loaded';
      moduleInfo.loadTimeMs = loadTimeMs;
      this.loadedModules.set(name, result);

      logger.info('Module loaded', { name, loadTimeMs: loadTimeMs.toFixed(2) });
      this.emit('module-loaded', name, loadTimeMs);

      // Check if all modules are loaded
      this.checkAllLoaded();

      return result as T;
    } catch (error) {
      perfTimer.end(`load:${name}`);
      moduleInfo.status = 'failed';
      moduleInfo.error = (error as Error).message;

      logger.error('Module load failed', { name, error: moduleInfo.error });
      this.emit('module-failed', name, error as Error);

      throw error;
    }
  }

  /**
   * Check if all registered modules are loaded
   */
  private checkAllLoaded(): void {
    const stats = this.getStats();
    if (stats.loadedModules + stats.failedModules === stats.totalModules) {
      this.emit('all-loaded', stats);
      logger.info('All modules loaded', {
        loaded: stats.loadedModules,
        failed: stats.failedModules,
        totalTimeMs: stats.totalLoadTimeMs.toFixed(2),
      });
    }
  }

  /**
   * Load all modules of a specific priority or higher
   */
  async loadByPriority(maxPriority: ModulePriority): Promise<void> {
    const priorities: ModulePriority[] = ['critical', 'high', 'medium', 'low'];
    const maxIndex = priorities.indexOf(maxPriority);

    const modulesToLoad = Array.from(this.modules.entries())
      .filter(([_, info]) => {
        const priorityIndex = priorities.indexOf(info.priority);
        return priorityIndex <= maxIndex && info.status === 'pending';
      })
      .sort((a, b) => {
        return priorities.indexOf(a[1].priority) - priorities.indexOf(b[1].priority);
      })
      .map(([name]) => name);

    logger.info('Loading modules by priority', { maxPriority, count: modulesToLoad.length });

    for (const name of modulesToLoad) {
      try {
        await this.load(name);
      } catch (error) {
        // Continue loading other modules even if one fails
        logger.warn('Module load failed, continuing', { name, error: (error as Error).message });
      }
    }
  }

  /**
   * Start idle-time preloading
   * Loads medium and low priority modules when system is idle
   */
  startIdlePreload(): void {
    if (!this.config.enableIdlePreload) {
      logger.debug('Idle preload disabled');
      return;
    }

    if (this.preloadTimer) {
      return;
    }

    this.preloadTimer = setInterval(() => {
      this.checkAndPreload();
    }, this.config.preloadIntervalMs);

    // Also listen for system resume events
    powerMonitor.on('resume', () => {
      // Wait for system to stabilize after resume
      setTimeout(() => this.checkAndPreload(), 3000);
    });

    logger.info('Idle preload started', { intervalMs: this.config.preloadIntervalMs });
  }

  /**
   * Stop idle-time preloading
   */
  stopIdlePreload(): void {
    if (this.preloadTimer) {
      clearInterval(this.preloadTimer);
      this.preloadTimer = null;
      logger.debug('Idle preload stopped');
    }
  }

  /**
   * Check system idle time and preload if appropriate
   */
  private async checkAndPreload(): Promise<void> {
    const idleTime = powerMonitor.getSystemIdleTime();

    if (idleTime < this.config.idleThresholdSeconds) {
      return;
    }

    // Find pending medium/low priority modules
    const pendingModules = Array.from(this.modules.entries())
      .filter(([_, info]) => info.status === 'pending' && ['medium', 'low'].includes(info.priority))
      .sort((a, b) => {
        // Load medium priority first
        if (a[1].priority === 'medium' && b[1].priority === 'low') return -1;
        if (a[1].priority === 'low' && b[1].priority === 'medium') return 1;
        return 0;
      });

    if (pendingModules.length === 0) {
      return;
    }

    logger.debug('Starting idle preload', { idleTime, pendingCount: pendingModules.length });
    this.emit('preload-start');

    let loadedCount = 0;
    const maxToLoad = Math.min(this.config.maxConcurrentLoads, pendingModules.length);

    for (let i = 0; i < maxToLoad; i++) {
      const [name] = pendingModules[i];
      try {
        await this.load(name);
        loadedCount++;
      } catch (error) {
        // Don't block preloading on failures
        logger.debug('Preload module failed', { name, error: (error as Error).message });
      }

      // Check if user became active
      const currentIdleTime = powerMonitor.getSystemIdleTime();
      if (currentIdleTime < this.config.idleThresholdSeconds) {
        logger.debug('User became active, pausing preload');
        break;
      }
    }

    this.emit('preload-complete', loadedCount);
    logger.debug('Idle preload batch complete', { loadedCount });
  }

  /**
   * Get module load statistics
   */
  getStats(): LoadStats {
    const moduleStats: Record<
      string,
      { status: ModuleStatus; loadTimeMs?: number; error?: string }
    > = {};
    let totalLoadTimeMs = 0;
    let loadedCount = 0;
    let failedCount = 0;

    for (const [name, info] of this.modules) {
      moduleStats[name] = {
        status: info.status,
        loadTimeMs: info.loadTimeMs,
        error: info.error,
      };

      if (info.status === 'loaded' && info.loadTimeMs) {
        totalLoadTimeMs += info.loadTimeMs;
        loadedCount++;
      } else if (info.status === 'failed') {
        failedCount++;
      }
    }

    return {
      totalModules: this.modules.size,
      loadedModules: loadedCount,
      failedModules: failedCount,
      totalLoadTimeMs,
      averageLoadTimeMs: loadedCount > 0 ? totalLoadTimeMs / loadedCount : 0,
      moduleStats,
    };
  }

  /**
   * Get startup time improvement estimate
   * Compares deferred vs immediate loading
   */
  getStartupImprovement(): {
    actualStartupMs: number;
    deferredLoadMs: number;
    estimatedSavingsMs: number;
    savingsPercent: number;
  } {
    const stats = this.getStats();
    const actualStartupMs = performance.now() - this.startupTime;

    // Total time if all modules were loaded at startup
    const hypotheticalTotal = actualStartupMs + stats.totalLoadTimeMs;

    return {
      actualStartupMs: Math.round(actualStartupMs),
      deferredLoadMs: Math.round(stats.totalLoadTimeMs),
      estimatedSavingsMs: Math.round(stats.totalLoadTimeMs),
      savingsPercent:
        hypotheticalTotal > 0 ? Math.round((stats.totalLoadTimeMs / hypotheticalTotal) * 100) : 0,
    };
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedModules.has(name);
  }

  /**
   * Get module status
   */
  getModuleStatus(name: string): ModuleStatus | undefined {
    return this.modules.get(name)?.status;
  }

  /**
   * Get loaded module (throws if not loaded)
   */
  get<T = unknown>(name: string): T {
    if (!this.loadedModules.has(name)) {
      throw new Error(`Module not loaded: ${name}. Call load() first.`);
    }
    return this.loadedModules.get(name) as T;
  }

  /**
   * Get loaded module or undefined
   */
  getIfLoaded<T = unknown>(name: string): T | undefined {
    return this.loadedModules.get(name) as T | undefined;
  }

  /**
   * Preload specific modules immediately (bypassing idle check)
   */
  async preloadNow(moduleNames: string[]): Promise<void> {
    logger.info('Preloading modules immediately', { count: moduleNames.length });

    const loadPromises = moduleNames.map(async (name) => {
      try {
        await this.load(name);
      } catch (error) {
        logger.warn('Preload failed', { name, error: (error as Error).message });
      }
    });

    await Promise.allSettled(loadPromises);
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    this.stopIdlePreload();
    this.loadedModules.clear();
    this.modules.clear();
    this.removeAllListeners();
    logger.info('LazyLoader shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof LazyLoaderEvents>(event: K, listener: LazyLoaderEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof LazyLoaderEvents>(event: K, listener: LazyLoaderEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof LazyLoaderEvents>(
    event: K,
    ...args: Parameters<LazyLoaderEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let lazyLoader: LazyLoader | null = null;

/**
 * Get or create the lazy loader instance
 */
export function getLazyLoader(config?: Partial<LazyLoaderConfig>): LazyLoader {
  if (!lazyLoader) {
    lazyLoader = new LazyLoader(config);
  }
  return lazyLoader;
}

/**
 * Shutdown the lazy loader
 */
export function shutdownLazyLoader(): void {
  if (lazyLoader) {
    lazyLoader.shutdown();
    lazyLoader = null;
  }
}

/**
 * Convenience function to load a module
 * Automatically gets the singleton and loads the module
 */
export async function loadModule<T = unknown>(name: string): Promise<T> {
  const loader = getLazyLoader();
  return loader.load<T>(name);
}

/**
 * Initialize lazy loading for Atlas
 * Registers all modules and starts idle preloading
 */
export function initializeLazyLoading(config?: Partial<LazyLoaderConfig>): LazyLoader {
  const loader = getLazyLoader(config);
  loader.registerAtlasModules();
  loader.startIdlePreload();
  return loader;
}

export default LazyLoader;
