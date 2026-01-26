/**
 * Atlas Desktop - Memory Optimizer
 * Comprehensive memory optimization system for achieving <500MB memory usage target.
 *
 * Features:
 * - Object pooling for frequent allocations
 * - Memory pressure monitoring and response
 * - Lazy loading registry for modules
 * - Resource disposal tracking
 * - Cache size management
 * - Streaming utilities for large data
 * - React render optimization helpers
 *
 * Target: <500MB total memory usage
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { count, sleep } from '../../shared/utils';

const logger = createModuleLogger('MemoryOptimizer');

// -----------------------------------------------------------------------------
// Types and Interfaces
// -----------------------------------------------------------------------------

/**
 * Memory pressure levels
 */
export type MemoryPressureLevel = 'low' | 'moderate' | 'high' | 'critical';

/**
 * Memory snapshot
 */
export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  pressureLevel: MemoryPressureLevel;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  name: string;
  size: number;
  available: number;
  inUse: number;
  created: number;
  reused: number;
  reuseRate: number;
}

/**
 * Cache registry entry
 */
export interface CacheRegistryEntry {
  name: string;
  clear: () => void;
  getSize: () => number;
  priority: number; // Lower = cleared first
}

/**
 * Lazy module registry entry
 */
export interface LazyModuleEntry<T = unknown> {
  name: string;
  loader: () => Promise<T> | T;
  instance: T | null;
  loaded: boolean;
  loadTimeMs?: number;
}

/**
 * Disposable resource
 */
export interface Disposable {
  dispose: () => void | Promise<void>;
}

/**
 * Memory optimizer configuration
 */
export interface MemoryOptimizerConfig {
  /** Target memory in bytes (default: 500MB) */
  targetMemoryBytes: number;
  /** Memory check interval in ms (default: 30s) */
  checkIntervalMs: number;
  /** Enable automatic GC hints (default: true) */
  enableGCHints: boolean;
  /** Pressure thresholds as percentage of target */
  pressureThresholds: {
    moderate: number;
    high: number;
    critical: number;
  };
  /** Enable memory logging (default: true) */
  enableLogging: boolean;
}

/**
 * Memory optimizer events
 */
export interface MemoryOptimizerEvents {
  'pressure-change': (level: MemoryPressureLevel, snapshot: MemorySnapshot) => void;
  'cache-cleared': (cacheName: string, bytesSaved: number) => void;
  'gc-hint': () => void;
  'module-loaded': (moduleName: string, timeMs: number) => void;
  'resource-disposed': (resourceId: string) => void;
  'memory-warning': (message: string, snapshot: MemorySnapshot) => void;
}

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

const DEFAULT_CONFIG: MemoryOptimizerConfig = {
  targetMemoryBytes: 500 * 1024 * 1024, // 500MB
  checkIntervalMs: 30000, // 30 seconds
  enableGCHints: true,
  pressureThresholds: {
    moderate: 0.6, // 60% of target
    high: 0.8, // 80% of target
    critical: 0.95, // 95% of target
  },
  enableLogging: true,
};

// -----------------------------------------------------------------------------
// Object Pool Implementation
// -----------------------------------------------------------------------------

/**
 * Generic object pool for reducing allocation overhead
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;
  private maxSize: number;
  private stats = { created: 0, reused: 0 };

  constructor(
    factory: () => T,
    reset: (obj: T) => void = () => {},
    maxSize = 100
  ) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }

  /**
   * Acquire an object from the pool
   */
  acquire(): T {
    if (this.pool.length > 0) {
      this.stats.reused++;
      return this.pool.pop()!;
    }
    this.stats.created++;
    return this.factory();
  }

  /**
   * Release an object back to the pool
   */
  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
    // If pool is full, let GC handle the object
  }

  /**
   * Pre-warm the pool with objects
   */
  prewarm(count: number): void {
    const toCreate = Math.min(count, this.maxSize - this.pool.length);
    for (let i = 0; i < toCreate; i++) {
      this.pool.push(this.factory());
      this.stats.created++;
    }
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool.length = 0;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const total = this.stats.created + this.stats.reused;
    return {
      name: 'ObjectPool',
      size: this.maxSize,
      available: this.pool.length,
      inUse: this.stats.created - this.pool.length,
      created: this.stats.created,
      reused: this.stats.reused,
      reuseRate: total > 0 ? this.stats.reused / total : 0,
    };
  }
}

/**
 * Typed array pool for audio buffers
 */
export class Float32ArrayPool {
  private pools: Map<number, Float32Array[]> = new Map();
  private maxPoolSize: number;
  private stats = { created: 0, reused: 0 };

  constructor(maxPoolSize = 50) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Acquire a Float32Array of specified length
   */
  acquire(length: number): Float32Array {
    const pool = this.pools.get(length);
    if (pool && pool.length > 0) {
      this.stats.reused++;
      return pool.pop()!;
    }
    this.stats.created++;
    return new Float32Array(length);
  }

  /**
   * Release a Float32Array back to the pool
   */
  release(array: Float32Array): void {
    const length = array.length;
    let pool = this.pools.get(length);
    if (!pool) {
      pool = [];
      this.pools.set(length, pool);
    }
    if (pool.length < this.maxPoolSize) {
      // Zero out the array for reuse
      array.fill(0);
      pool.push(array);
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
  }

  /**
   * Get total size of pooled arrays
   */
  getTotalBytes(): number {
    let total = 0;
    for (const [length, pool] of this.pools) {
      total += length * 4 * pool.length; // Float32 = 4 bytes
    }
    return total;
  }

  /**
   * Get pool statistics
   */
  getStats(): { sizes: Map<number, number>; created: number; reused: number; reuseRate: number } {
    const sizes = new Map<number, number>();
    for (const [length, pool] of this.pools) {
      sizes.set(length, pool.length);
    }
    const total = this.stats.created + this.stats.reused;
    return {
      sizes,
      created: this.stats.created,
      reused: this.stats.reused,
      reuseRate: total > 0 ? this.stats.reused / total : 0,
    };
  }
}

/**
 * Buffer pool for Node.js Buffers
 */
export class BufferPool {
  private pools: Map<number, Buffer[]> = new Map();
  private maxPoolSize: number;
  private stats = { created: 0, reused: 0 };

  constructor(maxPoolSize = 50) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Acquire a Buffer of specified size
   */
  acquire(size: number): Buffer {
    const pool = this.pools.get(size);
    if (pool && pool.length > 0) {
      this.stats.reused++;
      return pool.pop()!;
    }
    this.stats.created++;
    return Buffer.alloc(size);
  }

  /**
   * Release a Buffer back to the pool
   */
  release(buffer: Buffer): void {
    const size = buffer.length;
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }
    if (pool.length < this.maxPoolSize) {
      buffer.fill(0);
      pool.push(buffer);
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
  }

  /**
   * Get total size of pooled buffers
   */
  getTotalBytes(): number {
    let total = 0;
    for (const [size, pool] of this.pools) {
      total += size * pool.length;
    }
    return total;
  }
}

// -----------------------------------------------------------------------------
// Streaming Utilities
// -----------------------------------------------------------------------------

/**
 * Chunked data processor for large datasets
 */
export class ChunkedProcessor<T, R> {
  private chunkSize: number;
  private delayBetweenChunks: number;

  constructor(chunkSize = 1000, delayBetweenChunks = 0) {
    this.chunkSize = chunkSize;
    this.delayBetweenChunks = delayBetweenChunks;
  }

  /**
   * Process data in chunks to avoid blocking and memory spikes
   */
  async processChunked(
    data: T[],
    processor: (chunk: T[], chunkIndex: number) => Promise<R[]> | R[]
  ): Promise<R[]> {
    const results: R[] = [];
    const totalChunks = Math.ceil(data.length / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, data.length);
      const chunk = data.slice(start, end);

      const chunkResults = await processor(chunk, i);
      results.push(...chunkResults);

      // Allow GC and other operations between chunks
      if (this.delayBetweenChunks > 0 && i < totalChunks - 1) {
        await sleep(this.delayBetweenChunks);
      }
    }

    return results;
  }

  /**
   * Process stream-like data with backpressure
   */
  async *processStream<I, O>(
    source: AsyncIterable<I>,
    transform: (item: I) => Promise<O> | O
  ): AsyncGenerator<O> {
    for await (const item of source) {
      yield await transform(item);
    }
  }
}

/**
 * Create an async iterator from large array without loading all into memory
 */
export async function* iterateChunked<T>(
  data: T[],
  chunkSize = 100
): AsyncGenerator<T[]> {
  for (let i = 0; i < data.length; i += chunkSize) {
    yield data.slice(i, i + chunkSize);
  }
}

// -----------------------------------------------------------------------------
// Memory Optimizer
// -----------------------------------------------------------------------------

/**
 * MemoryOptimizer - Central memory management system
 */
export class MemoryOptimizer extends EventEmitter {
  private config: MemoryOptimizerConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private cacheRegistry: Map<string, CacheRegistryEntry> = new Map();
  private lazyModules: Map<string, LazyModuleEntry> = new Map();
  private disposables: Map<string, Disposable> = new Map();
  private lastPressureLevel: MemoryPressureLevel = 'low';
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 100;

  // Global pools
  private float32Pool: Float32ArrayPool;
  private bufferPool: BufferPool;

  constructor(config?: Partial<MemoryOptimizerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.float32Pool = new Float32ArrayPool();
    this.bufferPool = new BufferPool();

    if (this.config.enableLogging) {
      logger.info('MemoryOptimizer initialized', {
        targetMB: this.config.targetMemoryBytes / 1024 / 1024,
        checkIntervalMs: this.config.checkIntervalMs,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Memory Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Start memory monitoring
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, this.config.checkIntervalMs);

    // Initial check
    this.checkMemory();

    if (this.config.enableLogging) {
      logger.info('Memory monitoring started');
    }
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.config.enableLogging) {
      logger.info('Memory monitoring stopped');
    }
  }

  /**
   * Get current memory snapshot
   */
  getSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const pressureLevel = this.calculatePressureLevel(mem.heapUsed);

    return {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
      arrayBuffers: mem.arrayBuffers,
      pressureLevel,
    };
  }

  /**
   * Calculate memory pressure level
   */
  private calculatePressureLevel(heapUsed: number): MemoryPressureLevel {
    const ratio = heapUsed / this.config.targetMemoryBytes;

    if (ratio >= this.config.pressureThresholds.critical) return 'critical';
    if (ratio >= this.config.pressureThresholds.high) return 'high';
    if (ratio >= this.config.pressureThresholds.moderate) return 'moderate';
    return 'low';
  }

  /**
   * Check memory and respond to pressure
   */
  private checkMemory(): void {
    const snapshot = this.getSnapshot();

    // Store snapshot
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Handle pressure level changes
    if (snapshot.pressureLevel !== this.lastPressureLevel) {
      this.lastPressureLevel = snapshot.pressureLevel;
      this.emit('pressure-change', snapshot.pressureLevel, snapshot);

      if (this.config.enableLogging) {
        logger.info('Memory pressure changed', {
          level: snapshot.pressureLevel,
          heapMB: (snapshot.heapUsed / 1024 / 1024).toFixed(1),
          targetMB: (this.config.targetMemoryBytes / 1024 / 1024).toFixed(0),
        });
      }
    }

    // Respond to high pressure
    if (snapshot.pressureLevel === 'critical') {
      this.respondToCriticalPressure(snapshot);
    } else if (snapshot.pressureLevel === 'high') {
      this.respondToHighPressure(snapshot);
    }
  }

  /**
   * Respond to critical memory pressure
   */
  private respondToCriticalPressure(snapshot: MemorySnapshot): void {
    if (this.config.enableLogging) {
      logger.warn('Critical memory pressure - clearing all caches', {
        heapMB: (snapshot.heapUsed / 1024 / 1024).toFixed(1),
      });
    }

    this.emit('memory-warning', 'Critical memory pressure detected', snapshot);

    // Clear all caches by priority
    this.clearCachesByPriority(Infinity);

    // Clear object pools
    this.float32Pool.clear();
    this.bufferPool.clear();

    // Request GC
    this.requestGC();
  }

  /**
   * Respond to high memory pressure
   */
  private respondToHighPressure(snapshot: MemorySnapshot): void {
    if (this.config.enableLogging) {
      logger.info('High memory pressure - clearing low-priority caches', {
        heapMB: (snapshot.heapUsed / 1024 / 1024).toFixed(1),
      });
    }

    // Clear only low-priority caches
    this.clearCachesByPriority(5);

    // Hint for GC
    this.requestGC();
  }

  /**
   * Request garbage collection (if available)
   */
  private requestGC(): void {
    if (!this.config.enableGCHints) return;

    // V8 exposes global.gc when run with --expose-gc flag
    if (typeof global.gc === 'function') {
      global.gc();
      this.emit('gc-hint');

      if (this.config.enableLogging) {
        logger.debug('GC requested');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cache Registry
  // ---------------------------------------------------------------------------

  /**
   * Register a cache for memory management
   */
  registerCache(entry: CacheRegistryEntry): void {
    this.cacheRegistry.set(entry.name, entry);

    if (this.config.enableLogging) {
      logger.debug('Cache registered', { name: entry.name, priority: entry.priority });
    }
  }

  /**
   * Unregister a cache
   */
  unregisterCache(name: string): void {
    this.cacheRegistry.delete(name);
  }

  /**
   * Clear caches by priority (lower priority cleared first)
   */
  clearCachesByPriority(maxPriority: number): void {
    const sorted = Array.from(this.cacheRegistry.values())
      .filter(c => c.priority <= maxPriority)
      .sort((a, b) => a.priority - b.priority);

    for (const cache of sorted) {
      const sizeBefore = cache.getSize();
      cache.clear();
      const sizeAfter = cache.getSize();
      const bytesSaved = sizeBefore - sizeAfter;

      this.emit('cache-cleared', cache.name, bytesSaved);

      if (this.config.enableLogging && bytesSaved > 0) {
        logger.debug('Cache cleared', {
          name: cache.name,
          bytesSaved,
          savedMB: (bytesSaved / 1024 / 1024).toFixed(2),
        });
      }
    }
  }

  /**
   * Get total cache size
   */
  getTotalCacheSize(): number {
    let total = 0;
    for (const cache of this.cacheRegistry.values()) {
      total += cache.getSize();
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // Lazy Loading
  // ---------------------------------------------------------------------------

  /**
   * Register a module for lazy loading
   */
  registerLazyModule<T>(name: string, loader: () => Promise<T> | T): void {
    this.lazyModules.set(name, {
      name,
      loader: loader as () => Promise<unknown> | unknown,
      instance: null,
      loaded: false,
    });
  }

  /**
   * Get a lazily loaded module
   */
  async getLazyModule<T>(name: string): Promise<T> {
    const entry = this.lazyModules.get(name) as LazyModuleEntry<T> | undefined;
    if (!entry) {
      throw new Error(`Lazy module '${name}' not registered`);
    }

    if (!entry.loaded) {
      const startTime = performance.now();
      entry.instance = await entry.loader();
      entry.loaded = true;
      entry.loadTimeMs = performance.now() - startTime;

      this.emit('module-loaded', name, entry.loadTimeMs);

      if (this.config.enableLogging) {
        logger.debug('Lazy module loaded', {
          name,
          loadTimeMs: entry.loadTimeMs.toFixed(2),
        });
      }
    }

    return entry.instance as T;
  }

  /**
   * Check if a lazy module is loaded
   */
  isModuleLoaded(name: string): boolean {
    const entry = this.lazyModules.get(name);
    return entry?.loaded ?? false;
  }

  /**
   * Unload a lazy module to free memory
   */
  unloadModule(name: string): void {
    const entry = this.lazyModules.get(name);
    if (entry && entry.loaded) {
      entry.instance = null;
      entry.loaded = false;
      entry.loadTimeMs = undefined;

      if (this.config.enableLogging) {
        logger.debug('Lazy module unloaded', { name });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Resource Disposal
  // ---------------------------------------------------------------------------

  /**
   * Register a disposable resource
   */
  registerDisposable(id: string, disposable: Disposable): void {
    this.disposables.set(id, disposable);
  }

  /**
   * Unregister and dispose a resource
   */
  async disposeResource(id: string): Promise<void> {
    const disposable = this.disposables.get(id);
    if (disposable) {
      await disposable.dispose();
      this.disposables.delete(id);
      this.emit('resource-disposed', id);

      if (this.config.enableLogging) {
        logger.debug('Resource disposed', { id });
      }
    }
  }

  /**
   * Dispose all registered resources
   */
  async disposeAll(): Promise<void> {
    const ids = Array.from(this.disposables.keys());
    await Promise.all(ids.map(id => this.disposeResource(id)));
  }

  // ---------------------------------------------------------------------------
  // Object Pools Access
  // ---------------------------------------------------------------------------

  /**
   * Get Float32Array pool
   */
  getFloat32Pool(): Float32ArrayPool {
    return this.float32Pool;
  }

  /**
   * Get Buffer pool
   */
  getBufferPool(): BufferPool {
    return this.bufferPool;
  }

  // ---------------------------------------------------------------------------
  // Statistics and Reporting
  // ---------------------------------------------------------------------------

  /**
   * Get memory statistics
   */
  getStats(): {
    current: MemorySnapshot;
    history: MemorySnapshot[];
    pools: {
      float32: ReturnType<Float32ArrayPool['getStats']>;
      float32Bytes: number;
      bufferBytes: number;
    };
    caches: {
      count: number;
      totalSize: number;
      entries: Array<{ name: string; size: number; priority: number }>;
    };
    lazyModules: {
      total: number;
      loaded: number;
      entries: Array<{ name: string; loaded: boolean; loadTimeMs?: number }>;
    };
    disposables: number;
  } {
    const current = this.getSnapshot();

    const cacheEntries = Array.from(this.cacheRegistry.values()).map(c => ({
      name: c.name,
      size: c.getSize(),
      priority: c.priority,
    }));

    const moduleEntries = Array.from(this.lazyModules.values()).map(m => ({
      name: m.name,
      loaded: m.loaded,
      loadTimeMs: m.loadTimeMs,
    }));

    return {
      current,
      history: [...this.snapshots],
      pools: {
        float32: this.float32Pool.getStats(),
        float32Bytes: this.float32Pool.getTotalBytes(),
        bufferBytes: this.bufferPool.getTotalBytes(),
      },
      caches: {
        count: this.cacheRegistry.size,
        totalSize: this.getTotalCacheSize(),
        entries: cacheEntries,
      },
      lazyModules: {
        total: this.lazyModules.size,
        loaded: count(moduleEntries, m => m.loaded),
        entries: moduleEntries,
      },
      disposables: this.disposables.size,
    };
  }

  /**
   * Get formatted memory report
   */
  getReport(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('Atlas Memory Report');
    lines.push('='.repeat(60));
    lines.push('');

    // Current memory
    lines.push('Current Memory Usage:');
    lines.push(`  Heap Used:    ${(stats.current.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    lines.push(`  Heap Total:   ${(stats.current.heapTotal / 1024 / 1024).toFixed(1)} MB`);
    lines.push(`  RSS:          ${(stats.current.rss / 1024 / 1024).toFixed(1)} MB`);
    lines.push(`  External:     ${(stats.current.external / 1024 / 1024).toFixed(1)} MB`);
    lines.push(`  Pressure:     ${stats.current.pressureLevel}`);
    lines.push(`  Target:       ${(this.config.targetMemoryBytes / 1024 / 1024).toFixed(0)} MB`);
    lines.push('');

    // Object pools
    lines.push('Object Pools:');
    lines.push(`  Float32 Pool: ${(stats.pools.float32Bytes / 1024).toFixed(1)} KB`);
    lines.push(`    Reuse Rate: ${(stats.pools.float32.reuseRate * 100).toFixed(1)}%`);
    lines.push(`  Buffer Pool:  ${(stats.pools.bufferBytes / 1024).toFixed(1)} KB`);
    lines.push('');

    // Caches
    lines.push('Registered Caches:');
    for (const cache of stats.caches.entries) {
      lines.push(`  ${cache.name}: ${(cache.size / 1024).toFixed(1)} KB (priority: ${cache.priority})`);
    }
    lines.push(`  Total: ${(stats.caches.totalSize / 1024 / 1024).toFixed(2)} MB`);
    lines.push('');

    // Lazy modules
    lines.push('Lazy Modules:');
    lines.push(`  Loaded: ${stats.lazyModules.loaded}/${stats.lazyModules.total}`);
    for (const mod of stats.lazyModules.entries.filter(m => m.loaded)) {
      lines.push(`  - ${mod.name} (${mod.loadTimeMs?.toFixed(0)}ms)`);
    }
    lines.push('');

    // Disposables
    lines.push(`Tracked Disposables: ${stats.disposables}`);
    lines.push('');

    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Check if memory usage is within target
   */
  isWithinTarget(): boolean {
    const snapshot = this.getSnapshot();
    return snapshot.heapUsed < this.config.targetMemoryBytes;
  }

  /**
   * Get percentage of target memory used
   */
  getUsagePercentage(): number {
    const snapshot = this.getSnapshot();
    return (snapshot.heapUsed / this.config.targetMemoryBytes) * 100;
  }

  // ---------------------------------------------------------------------------
  // Type-safe Event Emitter
  // ---------------------------------------------------------------------------

  on<K extends keyof MemoryOptimizerEvents>(event: K, listener: MemoryOptimizerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof MemoryOptimizerEvents>(event: K, listener: MemoryOptimizerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof MemoryOptimizerEvents>(
    event: K,
    ...args: Parameters<MemoryOptimizerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Shutdown the memory optimizer
   */
  async shutdown(): Promise<void> {
    this.stop();

    // Dispose all resources
    await this.disposeAll();

    // Clear pools
    this.float32Pool.clear();
    this.bufferPool.clear();

    // Clear registries
    this.cacheRegistry.clear();
    this.lazyModules.clear();

    this.removeAllListeners();

    if (this.config.enableLogging) {
      logger.info('MemoryOptimizer shutdown complete');
    }
  }
}

// -----------------------------------------------------------------------------
// React Optimization Helpers (for renderer process)
// -----------------------------------------------------------------------------

/**
 * Create a debounced function with memory awareness
 */
export function createMemoryAwareDebounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number,
  maxPending = 10
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingCalls = 0;

  return (...args: Parameters<T>): void => {
    pendingCalls++;

    // If too many pending calls, execute immediately to prevent memory buildup
    if (pendingCalls > maxPending) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingCalls = 0;
      fn(...args);
      return;
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      pendingCalls = 0;
      timeoutId = null;
      fn(...args);
    }, wait);
  };
}

/**
 * Create a throttled function
 */
export function createThrottle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let lastArgs: Parameters<T> | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>): void => {
    const now = Date.now();

    if (now - lastRun >= limit) {
      lastRun = now;
      fn(...args);
    } else {
      lastArgs = args;

      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          lastRun = Date.now();
          timeoutId = null;
          if (lastArgs) {
            fn(...lastArgs);
            lastArgs = null;
          }
        }, limit - (now - lastRun));
      }
    }
  };
}

/**
 * WeakRef-based cache for objects that can be garbage collected
 */
export class WeakCache<K extends object, V> {
  private cache = new Map<K, WeakRef<V & object>>();
  private finalizationRegistry: FinalizationRegistry<K>;

  constructor() {
    this.finalizationRegistry = new FinalizationRegistry((key) => {
      this.cache.delete(key);
    });
  }

  set(key: K, value: V & object): void {
    const ref = new WeakRef(value);
    this.cache.set(key, ref);
    this.finalizationRegistry.register(value, key, ref);
  }

  get(key: K): V | undefined {
    const ref = this.cache.get(key);
    return ref?.deref();
  }

  has(key: K): boolean {
    const ref = this.cache.get(key);
    return ref?.deref() !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// -----------------------------------------------------------------------------
// Singleton Instance
// -----------------------------------------------------------------------------

let memoryOptimizerInstance: MemoryOptimizer | null = null;

/**
 * Get the singleton MemoryOptimizer instance
 */
export function getMemoryOptimizer(config?: Partial<MemoryOptimizerConfig>): MemoryOptimizer {
  if (!memoryOptimizerInstance) {
    memoryOptimizerInstance = new MemoryOptimizer(config);
  }
  return memoryOptimizerInstance;
}

/**
 * Shutdown the memory optimizer
 */
export async function shutdownMemoryOptimizer(): Promise<void> {
  if (memoryOptimizerInstance) {
    await memoryOptimizerInstance.shutdown();
    memoryOptimizerInstance = null;
    logger.info('MemoryOptimizer singleton shutdown');
  }
}

export default MemoryOptimizer;
