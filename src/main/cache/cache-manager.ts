/**
 * Atlas Desktop - Cache Manager
 * Central cache management with multiple specialized caches
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import {
  LRUCache,
  TTLCache,
  SemanticCache,
  FileSystemCache,
  MemoryAwareCache,
  CacheStatistics,
  BaseCacheConfig,
  SemanticCacheConfig,
  FileSystemCacheConfig,
  MemoryAwareCacheConfig,
  TTLCacheConfig,
} from './strategies';

const logger = createModuleLogger('CacheManager');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Cache types available in the manager
 */
export type CacheType = 'llm' | 'embedding' | 'file' | 'config' | 'general';

/**
 * Cache manager configuration
 */
export interface CacheManagerConfig {
  /** Base directory for persistent caches */
  baseDir: string;
  /** Enable all caches */
  enabled: boolean;
  /** LLM response cache config */
  llm: Partial<SemanticCacheConfig> & {
    enabled: boolean;
  };
  /** Embedding cache config */
  embedding: Partial<BaseCacheConfig> & {
    enabled: boolean;
  };
  /** File system cache config */
  file: Partial<FileSystemCacheConfig> & {
    enabled: boolean;
  };
  /** Config cache config */
  config: Partial<TTLCacheConfig> & {
    enabled: boolean;
  };
  /** General purpose cache config */
  general: Partial<MemoryAwareCacheConfig> & {
    enabled: boolean;
  };
  /** Global statistics collection */
  collectStats: boolean;
  /** Statistics collection interval (ms) */
  statsIntervalMs: number;
}

/**
 * Default cache manager configuration
 */
const DEFAULT_CONFIG: CacheManagerConfig = {
  baseDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas', 'cache'),
  enabled: true,
  llm: {
    enabled: true,
    maxEntries: 500,
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    similarityThreshold: 0.85,
  },
  embedding: {
    enabled: true,
    maxEntries: 10000,
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
    defaultTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  file: {
    enabled: true,
    maxEntries: 200,
    maxSizeBytes: 200 * 1024 * 1024, // 200MB
    defaultTtlMs: 0, // Never expires
  },
  config: {
    enabled: true,
    maxEntries: 100,
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    defaultTtlMs: 5 * 60 * 1000, // 5 minutes
    cleanupIntervalMs: 60 * 1000, // 1 minute
  },
  general: {
    enabled: true,
    maxEntries: 1000,
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    defaultTtlMs: 30 * 60 * 1000, // 30 minutes
    targetMemoryUsage: 0.7,
  },
  collectStats: true,
  statsIntervalMs: 60 * 1000, // 1 minute
};

/**
 * Aggregated cache statistics
 */
export interface AggregatedCacheStats {
  timestamp: number;
  totalEntries: number;
  totalSizeBytes: number;
  totalHits: number;
  totalMisses: number;
  overallHitRate: number;
  caches: Record<CacheType, CacheStatistics | null>;
  memoryUsage: {
    heapUsedMB: number;
    heapTotalMB: number;
    rss: number;
  };
}

/**
 * Cache manager events
 */
export interface CacheManagerEvents {
  'stats-collected': (stats: AggregatedCacheStats) => void;
  'cache-error': (cache: CacheType, error: Error) => void;
  'memory-pressure': (heapUsage: number) => void;
  shutdown: () => void;
}

/**
 * LLM cache entry with response metadata
 */
export interface LLMCacheEntry {
  response: string;
  provider: string;
  model?: string;
  tokens?: number;
  finishReason?: string;
}

/**
 * Embedding cache entry
 */
export interface EmbeddingCacheEntry {
  vector: number[];
  provider: string;
  dimensions: number;
}

// ============================================================================
// Cache Manager
// ============================================================================

/**
 * CacheManager - Central hub for all application caching
 *
 * Features:
 * - Multiple specialized caches (LLM, embedding, file, config, general)
 * - Unified API for cache operations
 * - Aggregated statistics
 * - Memory-aware automatic eviction
 * - Persistent file caching
 * - Semantic matching for LLM responses
 */
export class CacheManager extends EventEmitter {
  private config: CacheManagerConfig;
  private llmCache: SemanticCache<LLMCacheEntry> | null = null;
  private embeddingCache: LRUCache<EmbeddingCacheEntry> | null = null;
  private fileCache: FileSystemCache<Buffer | string> | null = null;
  private configCache: TTLCache<unknown> | null = null;
  private generalCache: MemoryAwareCache<unknown> | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private initialized = false;
  private statsHistory: AggregatedCacheStats[] = [];

  constructor(config?: Partial<CacheManagerConfig>) {
    super();
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
    logger.info('CacheManager created', { enabled: this.config.enabled });
  }

  /**
   * Deep merge configuration
   */
  private mergeConfig(
    defaults: CacheManagerConfig,
    overrides?: Partial<CacheManagerConfig>
  ): CacheManagerConfig {
    if (!overrides) return defaults;

    return {
      ...defaults,
      ...overrides,
      llm: { ...defaults.llm, ...overrides.llm },
      embedding: { ...defaults.embedding, ...overrides.embedding },
      file: { ...defaults.file, ...overrides.file },
      config: { ...defaults.config, ...overrides.config },
      general: { ...defaults.general, ...overrides.general },
    };
  }

  /**
   * Initialize all caches
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('CacheManager already initialized');
      return;
    }

    if (!this.config.enabled) {
      logger.info('CacheManager disabled');
      return;
    }

    logger.info('Initializing CacheManager');

    // Initialize LLM response cache
    if (this.config.llm.enabled) {
      this.llmCache = new SemanticCache<LLMCacheEntry>({
        maxEntries: this.config.llm.maxEntries,
        maxSizeBytes: this.config.llm.maxSizeBytes,
        defaultTtlMs: this.config.llm.defaultTtlMs,
        similarityThreshold: this.config.llm.similarityThreshold,
        enableStats: this.config.collectStats,
      });
      logger.debug('LLM cache initialized');
    }

    // Initialize embedding cache
    if (this.config.embedding.enabled) {
      this.embeddingCache = new LRUCache<EmbeddingCacheEntry>({
        maxEntries: this.config.embedding.maxEntries,
        maxSizeBytes: this.config.embedding.maxSizeBytes,
        defaultTtlMs: this.config.embedding.defaultTtlMs,
        enableStats: this.config.collectStats,
      });
      logger.debug('Embedding cache initialized');
    }

    // Initialize file system cache
    if (this.config.file.enabled) {
      this.fileCache = new FileSystemCache<Buffer | string>({
        maxEntries: this.config.file.maxEntries,
        maxSizeBytes: this.config.file.maxSizeBytes,
        defaultTtlMs: this.config.file.defaultTtlMs,
        cacheDir: path.join(this.config.baseDir, 'files'),
        enableStats: this.config.collectStats,
      });
      logger.debug('File cache initialized');
    }

    // Initialize config cache
    if (this.config.config.enabled) {
      this.configCache = new TTLCache<unknown>({
        maxEntries: this.config.config.maxEntries,
        maxSizeBytes: this.config.config.maxSizeBytes,
        defaultTtlMs: this.config.config.defaultTtlMs,
        cleanupIntervalMs: this.config.config.cleanupIntervalMs,
        enableStats: this.config.collectStats,
      });
      logger.debug('Config cache initialized');
    }

    // Initialize general cache
    if (this.config.general.enabled) {
      this.generalCache = new MemoryAwareCache<unknown>({
        maxEntries: this.config.general.maxEntries,
        maxSizeBytes: this.config.general.maxSizeBytes,
        defaultTtlMs: this.config.general.defaultTtlMs,
        targetMemoryUsage: this.config.general.targetMemoryUsage,
        enableStats: this.config.collectStats,
      });
      logger.debug('General cache initialized');
    }

    // Start statistics collection
    if (this.config.collectStats) {
      this.startStatsCollection();
    }

    this.initialized = true;
    logger.info('CacheManager initialized successfully');
  }

  // ============================================================================
  // LLM Response Cache
  // ============================================================================

  /**
   * Get cached LLM response
   */
  getLLMResponse(query: string): LLMCacheEntry | undefined {
    if (!this.llmCache) return undefined;

    try {
      return this.llmCache.get(query);
    } catch (error) {
      logger.warn('LLM cache get error', { error: (error as Error).message });
      this.emit('cache-error', 'llm', error as Error);
      return undefined;
    }
  }

  /**
   * Get similar LLM response with similarity score
   */
  getSimilarLLMResponse(query: string): { entry: LLMCacheEntry; similarity: number } | undefined {
    if (!this.llmCache) return undefined;

    try {
      const result = this.llmCache.getSimilar(query);
      if (result) {
        return { entry: result.value, similarity: result.similarity };
      }
      return undefined;
    } catch (error) {
      logger.warn('LLM cache similarity search error', { error: (error as Error).message });
      return undefined;
    }
  }

  /**
   * Cache LLM response
   */
  setLLMResponse(
    query: string,
    response: string,
    metadata: Omit<LLMCacheEntry, 'response'>,
    ttlMs?: number
  ): void {
    if (!this.llmCache) return;

    try {
      this.llmCache.set(
        query,
        {
          response,
          ...metadata,
        },
        ttlMs
      );
    } catch (error) {
      logger.warn('LLM cache set error', { error: (error as Error).message });
      this.emit('cache-error', 'llm', error as Error);
    }
  }

  /**
   * Cache LLM response with embedding for better similarity matching
   */
  setLLMResponseWithEmbedding(
    query: string,
    response: string,
    embedding: number[],
    metadata: Omit<LLMCacheEntry, 'response'>,
    ttlMs?: number
  ): void {
    if (!this.llmCache) return;

    try {
      this.llmCache.setWithEmbedding(
        query,
        {
          response,
          ...metadata,
        },
        embedding,
        ttlMs
      );
    } catch (error) {
      logger.warn('LLM cache set with embedding error', { error: (error as Error).message });
      this.emit('cache-error', 'llm', error as Error);
    }
  }

  /**
   * Check if LLM response is cached
   */
  hasLLMResponse(query: string): boolean {
    if (!this.llmCache) return false;
    return this.llmCache.has(query);
  }

  /**
   * Delete cached LLM response
   */
  deleteLLMResponse(query: string): boolean {
    if (!this.llmCache) return false;
    return this.llmCache.delete(query);
  }

  // ============================================================================
  // Embedding Cache
  // ============================================================================

  /**
   * Get cached embedding
   */
  getEmbedding(text: string): EmbeddingCacheEntry | undefined {
    if (!this.embeddingCache) return undefined;

    try {
      return this.embeddingCache.get(text);
    } catch (error) {
      logger.warn('Embedding cache get error', { error: (error as Error).message });
      this.emit('cache-error', 'embedding', error as Error);
      return undefined;
    }
  }

  /**
   * Cache embedding
   */
  setEmbedding(text: string, entry: EmbeddingCacheEntry, ttlMs?: number): void {
    if (!this.embeddingCache) return;

    try {
      this.embeddingCache.set(text, entry, ttlMs);
    } catch (error) {
      logger.warn('Embedding cache set error', { error: (error as Error).message });
      this.emit('cache-error', 'embedding', error as Error);
    }
  }

  /**
   * Check if embedding is cached
   */
  hasEmbedding(text: string): boolean {
    if (!this.embeddingCache) return false;
    return this.embeddingCache.has(text);
  }

  /**
   * Delete cached embedding
   */
  deleteEmbedding(text: string): boolean {
    if (!this.embeddingCache) return false;
    return this.embeddingCache.delete(text);
  }

  /**
   * Get embedding vector directly
   */
  getEmbeddingVector(text: string): number[] | undefined {
    const entry = this.getEmbedding(text);
    return entry?.vector;
  }

  // ============================================================================
  // File System Cache
  // ============================================================================

  /**
   * Get cached file content
   */
  getFile(key: string): Buffer | string | undefined {
    if (!this.fileCache) return undefined;

    try {
      return this.fileCache.get(key);
    } catch (error) {
      logger.warn('File cache get error', { error: (error as Error).message });
      this.emit('cache-error', 'file', error as Error);
      return undefined;
    }
  }

  /**
   * Cache file content
   */
  setFile(key: string, content: Buffer | string, ttlMs?: number): void {
    if (!this.fileCache) return;

    try {
      this.fileCache.set(key, content, ttlMs);
    } catch (error) {
      logger.warn('File cache set error', { error: (error as Error).message });
      this.emit('cache-error', 'file', error as Error);
    }
  }

  /**
   * Check if file is cached
   */
  hasFile(key: string): boolean {
    if (!this.fileCache) return false;
    return this.fileCache.has(key);
  }

  /**
   * Delete cached file
   */
  deleteFile(key: string): boolean {
    if (!this.fileCache) return false;
    return this.fileCache.delete(key);
  }

  // ============================================================================
  // Config Cache
  // ============================================================================

  /**
   * Get cached config value
   */
  getConfig<T>(key: string): T | undefined {
    if (!this.configCache) return undefined;

    try {
      return this.configCache.get(key) as T | undefined;
    } catch (error) {
      logger.warn('Config cache get error', { error: (error as Error).message });
      this.emit('cache-error', 'config', error as Error);
      return undefined;
    }
  }

  /**
   * Cache config value
   */
  setConfig<T>(key: string, value: T, ttlMs?: number): void {
    if (!this.configCache) return;

    try {
      this.configCache.set(key, value, ttlMs);
    } catch (error) {
      logger.warn('Config cache set error', { error: (error as Error).message });
      this.emit('cache-error', 'config', error as Error);
    }
  }

  /**
   * Check if config is cached
   */
  hasConfig(key: string): boolean {
    if (!this.configCache) return false;
    return this.configCache.has(key);
  }

  /**
   * Delete cached config
   */
  deleteConfig(key: string): boolean {
    if (!this.configCache) return false;
    return this.configCache.delete(key);
  }

  /**
   * Get or compute config value
   */
  async getOrComputeConfig<T>(
    key: string,
    compute: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.getConfig<T>(key);
    if (cached !== undefined) return cached;

    const value = await compute();
    this.setConfig(key, value, ttlMs);
    return value;
  }

  // ============================================================================
  // General Purpose Cache
  // ============================================================================

  /**
   * Get cached value from general cache
   */
  get<T>(key: string): T | undefined {
    if (!this.generalCache) return undefined;

    try {
      return this.generalCache.get(key) as T | undefined;
    } catch (error) {
      logger.warn('General cache get error', { error: (error as Error).message });
      this.emit('cache-error', 'general', error as Error);
      return undefined;
    }
  }

  /**
   * Cache value in general cache
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    if (!this.generalCache) return;

    try {
      this.generalCache.set(key, value, ttlMs);
    } catch (error) {
      logger.warn('General cache set error', { error: (error as Error).message });
      this.emit('cache-error', 'general', error as Error);
    }
  }

  /**
   * Check if key exists in general cache
   */
  has(key: string): boolean {
    if (!this.generalCache) return false;
    return this.generalCache.has(key);
  }

  /**
   * Delete from general cache
   */
  delete(key: string): boolean {
    if (!this.generalCache) return false;
    return this.generalCache.delete(key);
  }

  /**
   * Get or compute value
   */
  async getOrCompute<T>(key: string, compute: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Clear a specific cache
   */
  clearCache(type: CacheType): void {
    switch (type) {
      case 'llm':
        this.llmCache?.clear();
        break;
      case 'embedding':
        this.embeddingCache?.clear();
        break;
      case 'file':
        this.fileCache?.clear();
        break;
      case 'config':
        this.configCache?.clear();
        break;
      case 'general':
        this.generalCache?.clear();
        break;
    }
    logger.info('Cache cleared', { type });
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.llmCache?.clear();
    this.embeddingCache?.clear();
    this.fileCache?.clear();
    this.configCache?.clear();
    this.generalCache?.clear();
    logger.info('All caches cleared');
  }

  /**
   * Get statistics for a specific cache
   */
  getCacheStats(type: CacheType): CacheStatistics | null {
    switch (type) {
      case 'llm':
        return this.llmCache?.getStats() ?? null;
      case 'embedding':
        return this.embeddingCache?.getStats() ?? null;
      case 'file':
        return this.fileCache?.getStats() ?? null;
      case 'config':
        return this.configCache?.getStats() ?? null;
      case 'general':
        return this.generalCache?.getStats() ?? null;
      default:
        return null;
    }
  }

  /**
   * Get aggregated statistics for all caches
   */
  getAggregatedStats(): AggregatedCacheStats {
    const caches: Record<CacheType, CacheStatistics | null> = {
      llm: this.getCacheStats('llm'),
      embedding: this.getCacheStats('embedding'),
      file: this.getCacheStats('file'),
      config: this.getCacheStats('config'),
      general: this.getCacheStats('general'),
    };

    let totalEntries = 0;
    let totalSizeBytes = 0;
    let totalHits = 0;
    let totalMisses = 0;

    for (const stats of Object.values(caches)) {
      if (stats) {
        totalEntries += stats.entries;
        totalSizeBytes += stats.sizeBytes;
        totalHits += stats.hits;
        totalMisses += stats.misses;
      }
    }

    const totalAccess = totalHits + totalMisses;
    const memUsage = process.memoryUsage();

    return {
      timestamp: Date.now(),
      totalEntries,
      totalSizeBytes,
      totalHits,
      totalMisses,
      overallHitRate: totalAccess > 0 ? totalHits / totalAccess : 0,
      caches,
      memoryUsage: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
    };
  }

  /**
   * Get statistics history
   */
  getStatsHistory(): AggregatedCacheStats[] {
    return [...this.statsHistory];
  }

  /**
   * Start statistics collection
   */
  private startStatsCollection(): void {
    if (this.statsInterval) return;

    this.statsInterval = setInterval(() => {
      const stats = this.getAggregatedStats();
      this.statsHistory.push(stats);

      // Keep only last 60 entries (1 hour if collecting every minute)
      if (this.statsHistory.length > 60) {
        this.statsHistory = this.statsHistory.slice(-60);
      }

      this.emit('stats-collected', stats);

      // Check for memory pressure
      const memRatio = stats.memoryUsage.heapUsedMB / stats.memoryUsage.heapTotalMB;
      if (memRatio > 0.85) {
        this.emit('memory-pressure', memRatio);
        logger.warn('Memory pressure detected', {
          heapUsedMB: stats.memoryUsage.heapUsedMB,
          ratio: memRatio.toFixed(2),
        });
      }
    }, this.config.statsIntervalMs);

    logger.debug('Stats collection started', { intervalMs: this.config.statsIntervalMs });
  }

  /**
   * Stop statistics collection
   */
  private stopStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Prune all caches (remove expired entries)
   */
  pruneAll(): { [key in CacheType]?: number } {
    const results: { [key in CacheType]?: number } = {};

    if (this.llmCache) {
      results.llm = this.llmCache.prune();
    }
    if (this.embeddingCache) {
      results.embedding = this.embeddingCache.prune();
    }
    if (this.fileCache) {
      results.file = this.fileCache.cleanup();
    }
    if (this.configCache) {
      results.config = this.configCache.cleanup();
    }
    // Memory-aware cache doesn't need manual pruning

    const totalPruned = Object.values(results).reduce((sum, n) => sum + (n || 0), 0);
    if (totalPruned > 0) {
      logger.info('Caches pruned', { results, totalPruned });
    }

    return results;
  }

  /**
   * Check if cache manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if cache manager is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfiguration(): CacheManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires re-initialization)
   */
  async updateConfiguration(config: Partial<CacheManagerConfig>): Promise<void> {
    this.config = this.mergeConfig(this.config, config);
    logger.info('Configuration updated', { config });

    // Re-initialize if already initialized
    if (this.initialized) {
      await this.shutdown();
      this.initialized = false;
      await this.initialize();
    }
  }

  /**
   * Shutdown the cache manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down CacheManager');

    this.stopStatsCollection();

    // Shutdown individual caches
    if (this.configCache) {
      this.configCache.shutdown();
      this.configCache = null;
    }

    if (this.fileCache) {
      this.fileCache.shutdown();
      this.fileCache = null;
    }

    if (this.generalCache) {
      this.generalCache.shutdown();
      this.generalCache = null;
    }

    // Clear remaining caches
    this.llmCache?.clear();
    this.llmCache = null;

    this.embeddingCache?.clear();
    this.embeddingCache = null;

    this.statsHistory = [];
    this.initialized = false;

    this.emit('shutdown');
    this.removeAllListeners();

    logger.info('CacheManager shutdown complete');
  }

  // Type-safe event emitter methods
  on<K extends keyof CacheManagerEvents>(event: K, listener: CacheManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof CacheManagerEvents>(event: K, listener: CacheManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof CacheManagerEvents>(
    event: K,
    ...args: Parameters<CacheManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let cacheManagerInstance: CacheManager | null = null;

/**
 * Get the singleton CacheManager instance
 */
export async function getCacheManager(
  config?: Partial<CacheManagerConfig>
): Promise<CacheManager> {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager(config);
    await cacheManagerInstance.initialize();
  }
  return cacheManagerInstance;
}

/**
 * Shutdown the cache manager instance
 */
export async function shutdownCacheManager(): Promise<void> {
  if (cacheManagerInstance) {
    await cacheManagerInstance.shutdown();
    cacheManagerInstance = null;
    logger.info('CacheManager instance shutdown');
  }
}

/**
 * Get cache manager if already initialized (synchronous)
 */
export function getCacheManagerSync(): CacheManager | null {
  return cacheManagerInstance;
}

export default CacheManager;
