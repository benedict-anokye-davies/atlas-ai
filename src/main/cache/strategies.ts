/**
 * Atlas Desktop - Cache Strategies
 * Multiple caching strategies for different use cases
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CacheStrategies');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Cache entry metadata
 */
export interface CacheEntryMeta {
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  accessedAt: number;
  /** Access count */
  accessCount: number;
  /** Time-to-live in milliseconds (0 = never expires) */
  ttl: number;
  /** Entry size in bytes (estimated) */
  size: number;
  /** Optional tags for categorization */
  tags?: string[];
}

/**
 * Cache entry with value and metadata
 */
export interface CacheEntry<T> {
  key: string;
  value: T;
  meta: CacheEntryMeta;
}

/**
 * Cache statistics
 */
export interface CacheStatistics {
  /** Total number of entries */
  entries: number;
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total estimated size in bytes */
  sizeBytes: number;
  /** Maximum capacity (entries) */
  maxEntries: number;
  /** Maximum size in bytes */
  maxSizeBytes: number;
  /** Number of evictions */
  evictions: number;
  /** Number of expirations */
  expirations: number;
}

/**
 * Cache events
 */
export interface CacheEvents<T> {
  hit: (key: string, value: T) => void;
  miss: (key: string) => void;
  set: (key: string, value: T) => void;
  delete: (key: string) => void;
  evict: (key: string, reason: 'size' | 'lru' | 'ttl') => void;
  clear: () => void;
}

/**
 * Base cache configuration
 */
export interface BaseCacheConfig {
  /** Maximum number of entries */
  maxEntries: number;
  /** Maximum size in bytes */
  maxSizeBytes: number;
  /** Default TTL in milliseconds (0 = never expires) */
  defaultTtlMs: number;
  /** Enable statistics tracking */
  enableStats: boolean;
}

/**
 * Default cache configuration
 */
const DEFAULT_CACHE_CONFIG: BaseCacheConfig = {
  maxEntries: 1000,
  maxSizeBytes: 100 * 1024 * 1024, // 100MB
  defaultTtlMs: 0, // Never expires
  enableStats: true,
};

// ============================================================================
// Abstract Base Cache
// ============================================================================

/**
 * Abstract base class for all cache implementations
 */
export abstract class BaseCache<T> extends EventEmitter {
  protected config: BaseCacheConfig;
  protected stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  constructor(config?: Partial<BaseCacheConfig>) {
    super();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Get a value from cache
   */
  abstract get(key: string): T | undefined;

  /**
   * Set a value in cache
   */
  abstract set(key: string, value: T, ttlMs?: number): void;

  /**
   * Check if key exists
   */
  abstract has(key: string): boolean;

  /**
   * Delete a key
   */
  abstract delete(key: string): boolean;

  /**
   * Clear all entries
   */
  abstract clear(): void;

  /**
   * Get cache size (number of entries)
   */
  abstract size(): number;

  /**
   * Get all keys
   */
  abstract keys(): string[];

  /**
   * Get statistics
   */
  abstract getStats(): CacheStatistics;

  /**
   * Estimate size of a value in bytes
   */
  protected estimateSize(value: T): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateSize(item as T), 0);
    }
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1000; // Fallback estimate
      }
    }
    return 100; // Fallback
  }

  /**
   * Generate a hash key from string
   */
  protected hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  // Type-safe event emitter methods
  on<K extends keyof CacheEvents<T>>(event: K, listener: CacheEvents<T>[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof CacheEvents<T>>(event: K, listener: CacheEvents<T>[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof CacheEvents<T>>(
    event: K,
    ...args: Parameters<CacheEvents<T>[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// LRU Cache (Least Recently Used)
// ============================================================================

/**
 * LRU Cache implementation
 * Evicts least recently used entries when capacity is reached
 */
export class LRUCache<T> extends BaseCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private totalSize = 0;

  constructor(config?: Partial<BaseCacheConfig>) {
    super(config);
    logger.debug('LRU Cache initialized', {
      maxEntries: this.config.maxEntries,
      maxSizeBytes: this.config.maxSizeBytes,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.config.enableStats) this.stats.misses++;
      this.emit('miss', key);
      return undefined;
    }

    // Check TTL expiration
    if (entry.meta.ttl > 0 && Date.now() - entry.meta.createdAt > entry.meta.ttl) {
      this.delete(key);
      if (this.config.enableStats) {
        this.stats.misses++;
        this.stats.expirations++;
      }
      this.emit('evict', key, 'ttl');
      return undefined;
    }

    // Update access metadata (LRU touch)
    entry.meta.accessedAt = Date.now();
    entry.meta.accessCount++;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    if (this.config.enableStats) this.stats.hits++;
    this.emit('hit', key, entry.value);

    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const size = this.estimateSize(value);
    const ttl = ttlMs ?? this.config.defaultTtlMs;

    // Check if key exists (update)
    const existing = this.cache.get(key);
    if (existing) {
      this.totalSize -= existing.meta.size;
      this.cache.delete(key);
    }

    // Evict if needed
    this.evictIfNeeded(size);

    const entry: CacheEntry<T> = {
      key,
      value,
      meta: {
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 0,
        ttl,
        size,
      },
    };

    this.cache.set(key, entry);
    this.totalSize += size;

    this.emit('set', key, value);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (entry.meta.ttl > 0 && Date.now() - entry.meta.createdAt > entry.meta.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.totalSize -= entry.meta.size;
    this.cache.delete(key);
    this.emit('delete', key);

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
    this.emit('clear');
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  getStats(): CacheStatistics {
    const totalAccess = this.stats.hits + this.stats.misses;
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalAccess > 0 ? this.stats.hits / totalAccess : 0,
      sizeBytes: this.totalSize,
      maxEntries: this.config.maxEntries,
      maxSizeBytes: this.config.maxSizeBytes,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Evict entries to make room for new entry
   */
  private evictIfNeeded(neededSize: number): void {
    // Evict by count
    while (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.evictEntry(oldestKey, 'lru');
      } else {
        break;
      }
    }

    // Evict by size
    while (this.totalSize + neededSize > this.config.maxSizeBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.evictEntry(oldestKey, 'size');
      } else {
        break;
      }
    }
  }

  private evictEntry(key: string, reason: 'size' | 'lru' | 'ttl'): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalSize -= entry.meta.size;
      this.cache.delete(key);
      if (this.config.enableStats) this.stats.evictions++;
      this.emit('evict', key, reason);
    }
  }

  /**
   * Get entry metadata
   */
  getMeta(key: string): CacheEntryMeta | undefined {
    return this.cache.get(key)?.meta;
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.meta.ttl > 0 && now - entry.meta.createdAt > entry.meta.ttl) {
        this.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug('LRU cache pruned', { pruned });
    }

    return pruned;
  }
}

// ============================================================================
// TTL Cache (Time-To-Live)
// ============================================================================

/**
 * TTL-focused cache configuration
 */
export interface TTLCacheConfig extends BaseCacheConfig {
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs: number;
  /** Auto-start cleanup timer */
  autoCleanup: boolean;
}

const DEFAULT_TTL_CONFIG: TTLCacheConfig = {
  ...DEFAULT_CACHE_CONFIG,
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  cleanupIntervalMs: 60 * 1000, // 1 minute
  autoCleanup: true,
};

/**
 * TTL Cache implementation
 * Automatically expires entries after their TTL
 */
export class TTLCache<T> extends BaseCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private totalSize = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private ttlConfig: TTLCacheConfig;

  constructor(config?: Partial<TTLCacheConfig>) {
    super(config);
    this.ttlConfig = { ...DEFAULT_TTL_CONFIG, ...config };

    if (this.ttlConfig.autoCleanup) {
      this.startCleanup();
    }

    logger.debug('TTL Cache initialized', {
      defaultTtlMs: this.ttlConfig.defaultTtlMs,
      cleanupIntervalMs: this.ttlConfig.cleanupIntervalMs,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.config.enableStats) this.stats.misses++;
      this.emit('miss', key);
      return undefined;
    }

    // Check TTL expiration
    const now = Date.now();
    if (entry.meta.ttl > 0 && now - entry.meta.createdAt > entry.meta.ttl) {
      this.delete(key);
      if (this.config.enableStats) {
        this.stats.misses++;
        this.stats.expirations++;
      }
      this.emit('evict', key, 'ttl');
      return undefined;
    }

    // Update access metadata
    entry.meta.accessedAt = now;
    entry.meta.accessCount++;

    if (this.config.enableStats) this.stats.hits++;
    this.emit('hit', key, entry.value);

    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const size = this.estimateSize(value);
    const ttl = ttlMs ?? this.ttlConfig.defaultTtlMs;

    // Remove existing entry
    const existing = this.cache.get(key);
    if (existing) {
      this.totalSize -= existing.meta.size;
    }

    // Evict if needed
    while (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    while (this.totalSize + size > this.config.maxSizeBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      meta: {
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 0,
        ttl,
        size,
      },
    };

    this.cache.set(key, entry);
    this.totalSize += size;

    this.emit('set', key, value);
  }

  /**
   * Set with sliding expiration (resets TTL on access)
   */
  setSliding(key: string, value: T, ttlMs?: number): void {
    this.set(key, value, ttlMs);
    const entry = this.cache.get(key);
    if (entry) {
      // Mark as sliding by using negative accessCount
      entry.meta.accessCount = -1;
    }
  }

  /**
   * Touch an entry (reset its TTL if sliding)
   */
  touch(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // If sliding (accessCount was -1), reset creation time
    if (entry.meta.accessCount === -1) {
      entry.meta.createdAt = Date.now();
    }

    entry.meta.accessedAt = Date.now();
    return true;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.meta.ttl > 0 && Date.now() - entry.meta.createdAt > entry.meta.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.totalSize -= entry.meta.size;
    this.cache.delete(key);
    this.emit('delete', key);

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
    this.emit('clear');
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  getStats(): CacheStatistics {
    const totalAccess = this.stats.hits + this.stats.misses;
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalAccess > 0 ? this.stats.hits / totalAccess : 0,
      sizeBytes: this.totalSize,
      maxEntries: this.config.maxEntries,
      maxSizeBytes: this.config.maxSizeBytes,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Get remaining TTL for an entry
   */
  getRemainingTtl(key: string): number | undefined {
    const entry = this.cache.get(key);
    if (!entry || entry.meta.ttl === 0) return undefined;

    const elapsed = Date.now() - entry.meta.createdAt;
    const remaining = entry.meta.ttl - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Start automatic cleanup
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.ttlConfig.cleanupIntervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Run cleanup manually
   */
  cleanup(): number {
    let expired = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.meta.ttl > 0 && now - entry.meta.createdAt > entry.meta.ttl) {
        this.totalSize -= entry.meta.size;
        this.cache.delete(key);
        expired++;
        this.emit('evict', key, 'ttl');
      }
    }

    if (expired > 0) {
      if (this.config.enableStats) this.stats.expirations += expired;
      logger.debug('TTL cache cleanup', { expired });
    }

    return expired;
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.meta.createdAt < oldestTime) {
        oldestTime = entry.meta.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.totalSize -= entry.meta.size;
        this.cache.delete(oldestKey);
        if (this.config.enableStats) this.stats.evictions++;
        this.emit('evict', oldestKey, 'size');
      }
    }
  }

  /**
   * Shutdown the cache
   */
  shutdown(): void {
    this.stopCleanup();
    this.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Semantic Cache (for LLM responses)
// ============================================================================

/**
 * Semantic cache configuration
 */
export interface SemanticCacheConfig extends BaseCacheConfig {
  /** Similarity threshold (0-1) for cache hits */
  similarityThreshold: number;
  /** Maximum query length to consider */
  maxQueryLength: number;
  /** Enable fuzzy matching */
  enableFuzzyMatch: boolean;
}

const DEFAULT_SEMANTIC_CONFIG: SemanticCacheConfig = {
  ...DEFAULT_CACHE_CONFIG,
  similarityThreshold: 0.85,
  maxQueryLength: 500,
  enableFuzzyMatch: true,
};

/**
 * Semantic cache entry
 */
export interface SemanticCacheEntry<T> extends CacheEntry<T> {
  /** Normalized query */
  normalizedQuery: string;
  /** Query tokens for similarity matching */
  tokens: string[];
  /** Optional embedding vector */
  embedding?: number[];
}

/**
 * Semantic Cache for LLM responses
 * Matches similar queries to reuse cached responses
 */
export class SemanticCache<T> extends BaseCache<T> {
  private cache: Map<string, SemanticCacheEntry<T>> = new Map();
  private totalSize = 0;
  private semanticConfig: SemanticCacheConfig;

  constructor(config?: Partial<SemanticCacheConfig>) {
    super(config);
    this.semanticConfig = { ...DEFAULT_SEMANTIC_CONFIG, ...config };

    logger.debug('Semantic Cache initialized', {
      similarityThreshold: this.semanticConfig.similarityThreshold,
      enableFuzzyMatch: this.semanticConfig.enableFuzzyMatch,
    });
  }

  /**
   * Get by exact key
   */
  get(key: string): T | undefined {
    const normalizedKey = this.normalizeQuery(key);
    const hashKey = this.hashKey(normalizedKey);

    // Try exact match first
    const entry = this.cache.get(hashKey);
    if (entry && this.isValid(entry)) {
      entry.meta.accessedAt = Date.now();
      entry.meta.accessCount++;
      if (this.config.enableStats) this.stats.hits++;
      this.emit('hit', key, entry.value);
      return entry.value;
    }

    // Try fuzzy match
    if (this.semanticConfig.enableFuzzyMatch) {
      const match = this.findSimilar(normalizedKey);
      if (match) {
        match.meta.accessedAt = Date.now();
        match.meta.accessCount++;
        if (this.config.enableStats) this.stats.hits++;
        this.emit('hit', key, match.value);
        return match.value;
      }
    }

    if (this.config.enableStats) this.stats.misses++;
    this.emit('miss', key);
    return undefined;
  }

  /**
   * Get similar entry with similarity score
   */
  getSimilar(query: string): { value: T; similarity: number } | undefined {
    const normalized = this.normalizeQuery(query);
    const match = this.findSimilar(normalized);

    if (match) {
      const similarity = this.calculateSimilarity(normalized, match.normalizedQuery);
      return { value: match.value, similarity };
    }

    return undefined;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const normalizedQuery = this.normalizeQuery(key);
    const hashKey = this.hashKey(normalizedQuery);
    const size = this.estimateSize(value);
    const ttl = ttlMs ?? this.config.defaultTtlMs;

    // Remove existing
    const existing = this.cache.get(hashKey);
    if (existing) {
      this.totalSize -= existing.meta.size;
    }

    // Evict if needed
    this.evictIfNeeded(size);

    const entry: SemanticCacheEntry<T> = {
      key,
      value,
      normalizedQuery,
      tokens: this.tokenize(normalizedQuery),
      meta: {
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 0,
        ttl,
        size,
      },
    };

    this.cache.set(hashKey, entry);
    this.totalSize += size;

    this.emit('set', key, value);
  }

  /**
   * Set with embedding vector for better similarity matching
   */
  setWithEmbedding(key: string, value: T, embedding: number[], ttlMs?: number): void {
    this.set(key, value, ttlMs);
    const normalizedQuery = this.normalizeQuery(key);
    const hashKey = this.hashKey(normalizedQuery);
    const entry = this.cache.get(hashKey);
    if (entry) {
      entry.embedding = embedding;
    }
  }

  has(key: string): boolean {
    const normalizedKey = this.normalizeQuery(key);
    const hashKey = this.hashKey(normalizedKey);
    const entry = this.cache.get(hashKey);

    if (!entry) {
      if (this.semanticConfig.enableFuzzyMatch) {
        return this.findSimilar(normalizedKey) !== undefined;
      }
      return false;
    }

    return this.isValid(entry);
  }

  delete(key: string): boolean {
    const normalizedKey = this.normalizeQuery(key);
    const hashKey = this.hashKey(normalizedKey);
    const entry = this.cache.get(hashKey);

    if (!entry) return false;

    this.totalSize -= entry.meta.size;
    this.cache.delete(hashKey);
    this.emit('delete', key);

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
    this.emit('clear');
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.values()).map((e) => e.key);
  }

  getStats(): CacheStatistics {
    const totalAccess = this.stats.hits + this.stats.misses;
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalAccess > 0 ? this.stats.hits / totalAccess : 0,
      sizeBytes: this.totalSize,
      maxEntries: this.config.maxEntries,
      maxSizeBytes: this.config.maxSizeBytes,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Normalize query for comparison
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s?!.,]/g, '')
      .slice(0, this.semanticConfig.maxQueryLength);
  }

  /**
   * Tokenize query into words
   */
  private tokenize(query: string): string[] {
    return query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => w.toLowerCase());
  }

  /**
   * Find similar cached entry
   */
  private findSimilar(normalizedQuery: string): SemanticCacheEntry<T> | undefined {
    let bestMatch: SemanticCacheEntry<T> | undefined;
    let bestSimilarity = 0;

    for (const entry of this.cache.values()) {
      if (!this.isValid(entry)) continue;

      const similarity = this.calculateSimilarity(normalizedQuery, entry.normalizedQuery);

      if (similarity > bestSimilarity && similarity >= this.semanticConfig.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate similarity between two queries
   */
  private calculateSimilarity(query1: string, query2: string): number {
    // Jaccard similarity on tokens
    const tokens1 = new Set(this.tokenize(query1));
    const tokens2 = new Set(this.tokenize(query2));

    const intersection = new Set([...tokens1].filter((x) => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    if (union.size === 0) return 0;

    return intersection.size / union.size;
  }

  /**
   * Check if entry is still valid (not expired)
   */
  private isValid(entry: SemanticCacheEntry<T>): boolean {
    if (entry.meta.ttl === 0) return true;
    return Date.now() - entry.meta.createdAt <= entry.meta.ttl;
  }

  /**
   * Evict entries to make room
   */
  private evictIfNeeded(neededSize: number): void {
    // Sort by access time (LRU-style)
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].meta.accessedAt - b[1].meta.accessedAt
    );

    while (
      (this.cache.size >= this.config.maxEntries ||
        this.totalSize + neededSize > this.config.maxSizeBytes) &&
      entries.length > 0
    ) {
      const [key, entry] = entries.shift()!;
      this.totalSize -= entry.meta.size;
      this.cache.delete(key);
      if (this.config.enableStats) this.stats.evictions++;
      this.emit('evict', key, 'lru');
    }
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.meta.ttl > 0 && now - entry.meta.createdAt > entry.meta.ttl) {
        this.totalSize -= entry.meta.size;
        this.cache.delete(key);
        pruned++;
        if (this.config.enableStats) this.stats.expirations++;
      }
    }

    if (pruned > 0) {
      logger.debug('Semantic cache pruned', { pruned });
    }

    return pruned;
  }
}

// ============================================================================
// File System Cache
// ============================================================================

/**
 * File system cache configuration
 */
export interface FileSystemCacheConfig extends BaseCacheConfig {
  /** Base directory for cache files */
  cacheDir: string;
  /** File extension for cache files */
  extension: string;
  /** Compress cache files */
  compress: boolean;
}

const DEFAULT_FS_CONFIG: FileSystemCacheConfig = {
  ...DEFAULT_CACHE_CONFIG,
  cacheDir: path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.atlas',
    'cache',
    'files'
  ),
  extension: '.cache',
  compress: false,
};

/**
 * File System Cache
 * Persists cache to disk for static resources
 */
export class FileSystemCache<T> extends BaseCache<T> {
  private memoryCache: Map<string, CacheEntry<T>> = new Map();
  private fsConfig: FileSystemCacheConfig;
  private totalSize = 0;
  private indexFile: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config?: Partial<FileSystemCacheConfig>) {
    super(config);
    this.fsConfig = { ...DEFAULT_FS_CONFIG, ...config };
    this.indexFile = path.join(this.fsConfig.cacheDir, 'index.json');

    this.ensureCacheDir();
    this.loadIndex();

    logger.debug('FileSystem Cache initialized', {
      cacheDir: this.fsConfig.cacheDir,
    });
  }

  get(key: string): T | undefined {
    // Check memory cache first
    const memEntry = this.memoryCache.get(key);
    if (memEntry && this.isValid(memEntry)) {
      memEntry.meta.accessedAt = Date.now();
      memEntry.meta.accessCount++;
      if (this.config.enableStats) this.stats.hits++;
      this.emit('hit', key, memEntry.value);
      return memEntry.value;
    }

    // Try loading from disk
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const entry: CacheEntry<T> = JSON.parse(data);

        if (this.isValid(entry)) {
          entry.meta.accessedAt = Date.now();
          entry.meta.accessCount++;
          this.memoryCache.set(key, entry);
          if (this.config.enableStats) this.stats.hits++;
          this.emit('hit', key, entry.value);
          return entry.value;
        } else {
          // Expired, clean up
          this.delete(key);
        }
      }
    } catch (error) {
      logger.debug('Failed to load from disk cache', { key, error: (error as Error).message });
    }

    if (this.config.enableStats) this.stats.misses++;
    this.emit('miss', key);
    return undefined;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const size = this.estimateSize(value);
    const ttl = ttlMs ?? this.config.defaultTtlMs;

    // Remove existing
    if (this.memoryCache.has(key)) {
      const existing = this.memoryCache.get(key)!;
      this.totalSize -= existing.meta.size;
    }

    // Evict if needed
    this.evictIfNeeded(size);

    const entry: CacheEntry<T> = {
      key,
      value,
      meta: {
        createdAt: Date.now(),
        accessedAt: Date.now(),
        accessCount: 0,
        ttl,
        size,
      },
    };

    this.memoryCache.set(key, entry);
    this.totalSize += size;

    // Persist to disk (debounced)
    this.scheduleSave(key, entry);

    this.emit('set', key, value);
  }

  has(key: string): boolean {
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      return this.isValid(entry);
    }

    const filePath = this.getFilePath(key);
    return fs.existsSync(filePath);
  }

  delete(key: string): boolean {
    const entry = this.memoryCache.get(key);
    if (entry) {
      this.totalSize -= entry.meta.size;
    }

    this.memoryCache.delete(key);

    // Delete from disk
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.debug('Failed to delete from disk cache', { key });
    }

    this.saveIndex();
    this.emit('delete', key);

    return true;
  }

  clear(): void {
    this.memoryCache.clear();
    this.totalSize = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };

    // Clear disk cache
    try {
      const files = fs.readdirSync(this.fsConfig.cacheDir);
      for (const file of files) {
        if (file.endsWith(this.fsConfig.extension) || file === 'index.json') {
          fs.unlinkSync(path.join(this.fsConfig.cacheDir, file));
        }
      }
    } catch (error) {
      logger.warn('Failed to clear disk cache', { error: (error as Error).message });
    }

    this.emit('clear');
  }

  size(): number {
    return this.memoryCache.size;
  }

  keys(): string[] {
    return Array.from(this.memoryCache.keys());
  }

  getStats(): CacheStatistics {
    const totalAccess = this.stats.hits + this.stats.misses;
    return {
      entries: this.memoryCache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalAccess > 0 ? this.stats.hits / totalAccess : 0,
      sizeBytes: this.totalSize,
      maxEntries: this.config.maxEntries,
      maxSizeBytes: this.config.maxSizeBytes,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.fsConfig.cacheDir)) {
      fs.mkdirSync(this.fsConfig.cacheDir, { recursive: true });
    }
  }

  /**
   * Get file path for a key
   */
  private getFilePath(key: string): string {
    const hash = this.hashKey(key);
    return path.join(this.fsConfig.cacheDir, `${hash}${this.fsConfig.extension}`);
  }

  /**
   * Check if entry is valid
   */
  private isValid(entry: CacheEntry<T>): boolean {
    if (entry.meta.ttl === 0) return true;
    return Date.now() - entry.meta.createdAt <= entry.meta.ttl;
  }

  /**
   * Evict entries if needed
   */
  private evictIfNeeded(neededSize: number): void {
    const entries = Array.from(this.memoryCache.entries()).sort(
      (a, b) => a[1].meta.accessedAt - b[1].meta.accessedAt
    );

    while (
      (this.memoryCache.size >= this.config.maxEntries ||
        this.totalSize + neededSize > this.config.maxSizeBytes) &&
      entries.length > 0
    ) {
      const [key, entry] = entries.shift()!;
      this.totalSize -= entry.meta.size;
      this.memoryCache.delete(key);
      if (this.config.enableStats) this.stats.evictions++;
      this.emit('evict', key, 'lru');
    }
  }

  /**
   * Schedule save to disk (debounced)
   */
  private scheduleSave(key: string, entry: CacheEntry<T>): void {
    // Save entry immediately
    try {
      const filePath = this.getFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      logger.warn('Failed to save to disk cache', { key, error: (error as Error).message });
    }

    // Debounce index save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveIndex();
    }, 5000);
  }

  /**
   * Save cache index
   */
  private saveIndex(): void {
    try {
      const index = Array.from(this.memoryCache.keys());
      fs.writeFileSync(this.indexFile, JSON.stringify(index), 'utf8');
    } catch (error) {
      logger.warn('Failed to save cache index', { error: (error as Error).message });
    }
  }

  /**
   * Load cache index
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexFile)) {
        const data = fs.readFileSync(this.indexFile, 'utf8');
        const keys: string[] = JSON.parse(data);

        // Pre-load metadata (not values)
        for (const key of keys.slice(0, 100)) {
          // Limit initial load
          try {
            const filePath = this.getFilePath(key);
            if (fs.existsSync(filePath)) {
              const data = fs.readFileSync(filePath, 'utf8');
              const entry: CacheEntry<T> = JSON.parse(data);
              if (this.isValid(entry)) {
                this.memoryCache.set(key, entry);
                this.totalSize += entry.meta.size;
              }
            }
          } catch {
            // Skip invalid entries
          }
        }

        logger.debug('Loaded cache index', { entries: this.memoryCache.size });
      }
    } catch (error) {
      logger.debug('Failed to load cache index', { error: (error as Error).message });
    }
  }

  /**
   * Cleanup expired entries on disk
   */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    try {
      const files = fs.readdirSync(this.fsConfig.cacheDir);

      for (const file of files) {
        if (!file.endsWith(this.fsConfig.extension)) continue;

        const filePath = path.join(this.fsConfig.cacheDir, file);

        try {
          const data = fs.readFileSync(filePath, 'utf8');
          const entry: CacheEntry<T> = JSON.parse(data);

          if (entry.meta.ttl > 0 && now - entry.meta.createdAt > entry.meta.ttl) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // Delete corrupted files
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup disk cache', { error: (error as Error).message });
    }

    if (cleaned > 0) {
      logger.debug('Disk cache cleaned', { cleaned });
    }

    return cleaned;
  }

  /**
   * Shutdown the cache
   */
  shutdown(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveIndex();
    this.removeAllListeners();
  }
}

// ============================================================================
// Memory-Aware Cache
// ============================================================================

/**
 * Memory-aware cache configuration
 */
export interface MemoryAwareCacheConfig extends BaseCacheConfig {
  /** Target memory usage (0-1 of available) */
  targetMemoryUsage: number;
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** Minimum entries to keep */
  minEntries: number;
}

const DEFAULT_MEMORY_CONFIG: MemoryAwareCacheConfig = {
  ...DEFAULT_CACHE_CONFIG,
  targetMemoryUsage: 0.7, // 70% of available memory
  checkIntervalMs: 30000, // 30 seconds
  minEntries: 100,
};

/**
 * Memory-Aware Cache
 * Automatically adjusts size based on available memory
 */
export class MemoryAwareCache<T> extends LRUCache<T> {
  private memoryConfig: MemoryAwareCacheConfig;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<MemoryAwareCacheConfig>) {
    super(config);
    this.memoryConfig = { ...DEFAULT_MEMORY_CONFIG, ...config };

    this.startMemoryMonitoring();

    logger.debug('Memory-Aware Cache initialized', {
      targetMemoryUsage: this.memoryConfig.targetMemoryUsage,
    });
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.checkInterval = setInterval(() => {
      this.adjustForMemory();
    }, this.memoryConfig.checkIntervalMs);
  }

  /**
   * Adjust cache size based on memory pressure
   */
  private adjustForMemory(): void {
    const memUsage = process.memoryUsage();
    const heapUsed = memUsage.heapUsed;
    const heapTotal = memUsage.heapTotal;
    const usageRatio = heapUsed / heapTotal;

    if (usageRatio > this.memoryConfig.targetMemoryUsage) {
      // Under memory pressure - reduce cache
      const reductionFactor = this.memoryConfig.targetMemoryUsage / usageRatio;
      const targetSize = Math.max(
        Math.floor(this.size() * reductionFactor),
        this.memoryConfig.minEntries
      );

      let evicted = 0;
      while (this.size() > targetSize) {
        const keys = this.keys();
        if (keys.length > 0) {
          this.delete(keys[0]);
          evicted++;
        } else {
          break;
        }
      }

      if (evicted > 0) {
        logger.info('Memory pressure detected, evicted entries', {
          evicted,
          heapUsedMB: Math.round(heapUsed / 1024 / 1024),
          usageRatio: usageRatio.toFixed(2),
        });
      }
    }
  }

  /**
   * Get memory status
   */
  getMemoryStatus(): {
    heapUsedMB: number;
    heapTotalMB: number;
    usageRatio: number;
    cacheSize: number;
  } {
    const memUsage = process.memoryUsage();
    return {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      usageRatio: memUsage.heapUsed / memUsage.heapTotal,
      cacheSize: this.size(),
    };
  }

  /**
   * Shutdown the cache
   */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.clear();
    this.removeAllListeners();
  }
}

export default {
  LRUCache,
  TTLCache,
  SemanticCache,
  FileSystemCache,
  MemoryAwareCache,
};
