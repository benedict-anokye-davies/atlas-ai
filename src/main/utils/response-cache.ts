/**
 * Atlas Desktop - Response Cache
 * Caches LLM responses for offline use and reduced API costs
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('ResponseCache');

/**
 * Cached response entry
 */
export interface CacheEntry {
  query: string;
  response: string;
  timestamp: number;
  hitCount: number;
  provider: string;
  model?: string;
  tokens?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntry: number | null;
  newestEntry: number | null;
  totalSize: number;
}

/**
 * Cache configuration
 */
export interface ResponseCacheConfig {
  /** Time-to-live in milliseconds (default: 24 hours) */
  ttlMs: number;
  /** Maximum number of cached entries (default: 1000) */
  maxEntries: number;
  /** Minimum query length to cache (default: 10) */
  minQueryLength: number;
  /** Maximum query length to consider (default: 500) */
  maxQueryLength: number;
  /** Enable disk persistence (default: true) */
  persistToDisk: boolean;
  /** Cache file path */
  cachePath: string;
  /** Enable cache (default: true) */
  enabled: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ResponseCacheConfig = {
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  maxEntries: 1000,
  minQueryLength: 10,
  maxQueryLength: 500,
  persistToDisk: true,
  cachePath: path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.atlas',
    'cache',
    'responses.json'
  ),
  enabled: true,
};

/**
 * ResponseCache - Caches LLM responses for offline use
 *
 * Features:
 * - In-memory cache with TTL expiration
 * - Disk persistence for offline access
 * - Query normalization for better hit rates
 * - Automatic cleanup of expired entries
 * - Statistics tracking
 */
export class ResponseCache extends EventEmitter {
  private cache = new Map<string, CacheEntry>();
  private config: ResponseCacheConfig;
  private stats = { hits: 0, misses: 0 };
  private saveTimeout: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<ResponseCacheConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.persistToDisk) {
      this.loadFromDisk();
    }

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60 * 60 * 1000); // Every hour

    logger.info('ResponseCache initialized', {
      ttlMs: this.config.ttlMs,
      maxEntries: this.config.maxEntries,
      persistToDisk: this.config.persistToDisk,
    });
  }

  /**
   * Generate cache key from query
   */
  private generateKey(query: string): string {
    const normalized = this.normalizeQuery(query);
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Normalize query for better cache hit rates
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s?!.,]/g, '')
      .slice(0, this.config.maxQueryLength);
  }

  /**
   * Check if query is cacheable
   */
  private isCacheable(query: string): boolean {
    if (!this.config.enabled) return false;

    const normalized = this.normalizeQuery(query);

    // Too short
    if (normalized.length < this.config.minQueryLength) {
      return false;
    }

    // Skip queries that seem time-sensitive
    const timePatterns = [
      /what time/i,
      /current date/i,
      /today/i,
      /now/i,
      /weather/i,
      /latest/i,
      /breaking/i,
      /recent/i,
    ];

    for (const pattern of timePatterns) {
      if (pattern.test(query)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get cached response if available
   */
  get(query: string): CacheEntry | null {
    if (!this.config.enabled) return null;

    const key = this.generateKey(query);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      this.scheduleSave();
      return null;
    }

    // Update hit count
    entry.hitCount++;
    this.stats.hits++;

    logger.debug('Cache hit', { key: key.slice(0, 8), hitCount: entry.hitCount });
    this.emit('cache-hit', entry);

    return entry;
  }

  /**
   * Store response in cache
   */
  set(query: string, response: string, provider: string, model?: string, tokens?: number): void {
    if (!this.isCacheable(query)) {
      return;
    }

    const key = this.generateKey(query);

    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const entry: CacheEntry = {
      query: this.normalizeQuery(query),
      response,
      timestamp: Date.now(),
      hitCount: 0,
      provider,
      model,
      tokens,
    };

    this.cache.set(key, entry);
    this.scheduleSave();

    logger.debug('Cache set', { key: key.slice(0, 8), provider });
    this.emit('cache-set', entry);
  }

  /**
   * Check if a cached response exists
   */
  has(query: string): boolean {
    const key = this.generateKey(query);
    const entry = this.cache.get(key);

    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a cached entry
   */
  delete(query: string): boolean {
    const key = this.generateKey(query);
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.scheduleSave();
    }
    return deleted;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
    this.scheduleSave();
    logger.info('Cache cleared');
    this.emit('cache-cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map((e) => e.timestamp);

    return {
      totalEntries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? this.stats.hits / (this.stats.hits + this.stats.misses)
        : 0,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
      totalSize: this.estimateSize(),
    };
  }

  /**
   * Estimate cache size in bytes
   */
  private estimateSize(): number {
    let size = 0;
    for (const entry of this.cache.values()) {
      size += entry.query.length + entry.response.length + 100; // 100 for metadata
    }
    return size;
  }

  /**
   * Evict oldest entries to make room
   */
  private evictOldest(): void {
    // Find entries to evict (LRU-style: oldest with lowest hit count)
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      // Sort by hit count first (ascending), then timestamp (ascending)
      if (a[1].hitCount !== b[1].hitCount) {
        return a[1].hitCount - b[1].hitCount;
      }
      return a[1].timestamp - b[1].timestamp;
    });

    // Evict bottom 10%
    const evictCount = Math.max(1, Math.floor(this.cache.size * 0.1));
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }

    logger.debug('Evicted entries', { count: evictCount });
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.scheduleSave();
      logger.debug('Cleaned expired entries', { count: cleaned });
    }
  }

  /**
   * Schedule save to disk (debounced)
   */
  private scheduleSave(): void {
    if (!this.config.persistToDisk) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveToDisk();
    }, 5000); // Debounce 5 seconds
  }

  /**
   * Save cache to disk
   */
  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.config.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = JSON.stringify(Array.from(this.cache.entries()), null, 2);
      fs.writeFileSync(this.config.cachePath, data, 'utf8');

      logger.debug('Cache saved to disk', {
        path: this.config.cachePath,
        entries: this.cache.size,
      });
    } catch (error) {
      logger.error('Failed to save cache to disk', { error });
    }
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.config.cachePath)) {
        logger.debug('No cache file found, starting fresh');
        return;
      }

      const data = fs.readFileSync(this.config.cachePath, 'utf8');
      const entries: [string, CacheEntry][] = JSON.parse(data);

      const now = Date.now();
      let loaded = 0;
      let expired = 0;

      for (const [key, entry] of entries) {
        // Skip expired entries
        if (now - entry.timestamp > this.config.ttlMs) {
          expired++;
          continue;
        }
        this.cache.set(key, entry);
        loaded++;
      }

      logger.info('Cache loaded from disk', { loaded, expired });
    } catch (error) {
      logger.error('Failed to load cache from disk', { error });
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ResponseCacheConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Cache config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ResponseCacheConfig {
    return { ...this.config };
  }

  /**
   * Enable or disable caching
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info('Cache enabled status changed', { enabled });
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Final save
    if (this.config.persistToDisk) {
      this.saveToDisk();
    }

    this.removeAllListeners();
    logger.info('ResponseCache shutdown complete');
  }
}

// Singleton instance
let responseCache: ResponseCache | null = null;

/**
 * Get the singleton ResponseCache instance
 */
export function getResponseCache(config?: Partial<ResponseCacheConfig>): ResponseCache {
  if (!responseCache) {
    responseCache = new ResponseCache(config);
  }
  return responseCache;
}

/**
 * Shutdown the response cache
 */
export function shutdownResponseCache(): void {
  if (responseCache) {
    responseCache.shutdown();
    responseCache = null;
    logger.info('ResponseCache shutdown complete');
  }
}
