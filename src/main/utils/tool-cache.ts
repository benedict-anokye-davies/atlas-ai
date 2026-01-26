/**
 * Tool Result Cache
 *
 * Caches expensive tool execution results to reduce latency
 * and API costs for repeated queries.
 *
 * Features:
 * - TTL-based expiration
 * - Per-tool cache configuration
 * - LRU eviction when cache is full
 * - Statistics tracking
 */

import { createModuleLogger } from './logger';

const logger = createModuleLogger('ToolCache');

// =============================================================================
// Types
// =============================================================================

interface CacheEntry<T = unknown> {
  result: T;
  timestamp: number;
  hits: number;
  tool: string;
  argsHash: string;
}

interface CacheConfig {
  /** Maximum number of entries in cache */
  maxEntries: number;
  /** Default TTL in milliseconds */
  defaultTTL: number;
  /** Per-tool TTL overrides */
  toolTTLs: Record<string, number>;
  /** Tools that should never be cached */
  neverCache: string[];
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 500,
  defaultTTL: 60000, // 1 minute
  toolTTLs: {
    // File operations - short TTL as files change
    read_file: 30000, // 30 seconds
    list_directory: 60000, // 1 minute
    search_files: 120000, // 2 minutes
    grep_search: 60000,
    semantic_code_search: 300000, // 5 minutes
    
    // Git operations - medium TTL
    git_status: 30000,
    git_diff: 30000,
    git_log: 120000,
    
    // System info - longer TTL
    get_system_info: 300000, // 5 minutes
    
    // Web/API calls - respect rate limits
    web_search: 600000, // 10 minutes
    fetch_url: 300000, // 5 minutes
    
    // Trading data - short TTL as prices change
    get_my_trading_status: 15000, // 15 seconds
    get_my_positions: 15000,
    get_market_data: 10000, // 10 seconds
    
    // Memory operations - medium TTL
    search_memory: 120000,
    get_memory_stats: 60000,
  },
  neverCache: [
    // Commands that modify state
    'execute_command',
    'write_file',
    'delete_file',
    'git_commit',
    'git_push',
    'send_message',
    'send_email',
    // Trading actions
    'open_position',
    'close_position',
    'place_order',
    'cancel_order',
    // Real-time data
    'get_live_price',
    'stream_data',
  ],
};

// =============================================================================
// Tool Cache Class
// =============================================================================

export class ToolCache {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    hitRate: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ToolCache initialized', {
      maxEntries: this.config.maxEntries,
      defaultTTL: this.config.defaultTTL,
      neverCacheTools: this.config.neverCache.length,
    });
  }

  /**
   * Generate a cache key from tool name and arguments
   */
  private generateKey(tool: string, args: Record<string, unknown>): string {
    const argsHash = this.hashArgs(args);
    return `${tool}:${argsHash}`;
  }

  /**
   * Hash arguments for cache key
   */
  private hashArgs(args: Record<string, unknown>): string {
    // Sort keys for consistent hashing
    const sorted = Object.keys(args)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = args[key];
          return acc;
        },
        {} as Record<string, unknown>
      );
    return JSON.stringify(sorted);
  }

  /**
   * Get TTL for a specific tool
   */
  private getTTL(tool: string): number {
    return this.config.toolTTLs[tool] ?? this.config.defaultTTL;
  }

  /**
   * Check if a tool should be cached
   */
  private shouldCache(tool: string): boolean {
    return !this.config.neverCache.includes(tool);
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.config.maxEntries) return;

    // Find least recently used entries (by timestamp + low hits)
    const entries = Array.from(this.cache.entries())
      .map(([key, entry]) => ({
        key,
        score: entry.timestamp + entry.hits * 1000, // Hits add time bonus
      }))
      .sort((a, b) => a.score - b.score);

    // Evict bottom 10%
    const toEvict = Math.ceil(this.config.maxEntries * 0.1);
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      this.cache.delete(entries[i].key);
      this.stats.evictions++;
    }

    logger.debug('Cache eviction', { evicted: toEvict, newSize: this.cache.size });
  }

  /**
   * Get cached result if available and not expired
   */
  get<T>(tool: string, args: Record<string, unknown>): T | null {
    if (!this.shouldCache(tool)) {
      return null;
    }

    const key = this.generateKey(tool, args);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    const ttl = this.getTTL(tool);
    const age = Date.now() - entry.timestamp;

    if (age > ttl) {
      // Expired
      this.cache.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Cache hit
    entry.hits++;
    this.stats.hits++;
    this.updateHitRate();

    logger.debug('Cache hit', {
      tool,
      age: Math.round(age / 1000) + 's',
      hits: entry.hits,
    });

    return entry.result as T;
  }

  /**
   * Store a result in cache
   */
  set<T>(tool: string, args: Record<string, unknown>, result: T): void {
    if (!this.shouldCache(tool)) {
      return;
    }

    this.evictIfNeeded();

    const key = this.generateKey(tool, args);
    const argsHash = this.hashArgs(args);

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hits: 0,
      tool,
      argsHash,
    });

    this.stats.size = this.cache.size;

    logger.debug('Cache set', {
      tool,
      ttl: this.getTTL(tool),
      cacheSize: this.cache.size,
    });
  }

  /**
   * Check if a cached result exists and is valid
   */
  has(tool: string, args: Record<string, unknown>): boolean {
    return this.get(tool, args) !== null;
  }

  /**
   * Invalidate cache entries for a specific tool
   */
  invalidateTool(tool: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.tool === tool) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.size = this.cache.size;
    logger.info('Invalidated cache entries', { tool, count });
    return count;
  }

  /**
   * Invalidate all cache entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const [key] of this.cache.entries()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
    logger.info('Cache cleared');
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Update TTL for a specific tool
   */
  setToolTTL(tool: string, ttl: number): void {
    this.config.toolTTLs[tool] = ttl;
  }

  /**
   * Add a tool to the never-cache list
   */
  addNeverCache(tool: string): void {
    if (!this.config.neverCache.includes(tool)) {
      this.config.neverCache.push(tool);
      this.invalidateTool(tool);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let toolCacheInstance: ToolCache | null = null;

export function getToolCache(): ToolCache {
  if (!toolCacheInstance) {
    toolCacheInstance = new ToolCache();
  }
  return toolCacheInstance;
}

export function createToolCache(config?: Partial<CacheConfig>): ToolCache {
  toolCacheInstance = new ToolCache(config);
  return toolCacheInstance;
}

export function shutdownToolCache(): void {
  if (toolCacheInstance) {
    toolCacheInstance.clear();
    toolCacheInstance = null;
  }
}
