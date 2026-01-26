/**
 * Atlas Desktop - Semantic Response Cache
 * Cache LLM responses by semantic similarity to reduce costs and latency
 *
 * Features:
 * - Embed queries using local/API embeddings
 * - Vector similarity search for cache hits
 * - Configurable similarity threshold
 * - TTL-based expiration
 * - Context-aware invalidation
 *
 * @module ml/semantic-cache
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SemanticCache');

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry {
  id: string;
  query: string;
  queryEmbedding: number[];
  response: string;
  context?: string;
  metadata: {
    model: string;
    temperature: number;
    tokens: number;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
    ttl: number;
  };
}

export interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgSimilarity: number;
  savedTokens: number;
  savedCost: number;
}

export interface CacheConfig {
  maxEntries: number;
  similarityThreshold: number;
  defaultTTL: number; // milliseconds
  embeddingDimensions: number;
  costPerToken: number;
}

export interface SemanticCacheEvents {
  'cache-hit': (query: string, similarity: number, entry: CacheEntry) => void;
  'cache-miss': (query: string) => void;
  'cache-store': (entry: CacheEntry) => void;
  'cache-evict': (entryId: string, reason: string) => void;
  'stats-updated': (stats: CacheStats) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Embedding Utilities
// ============================================================================

/**
 * Simple text embedding using TF-IDF-like approach
 * In production, replace with proper embedding model
 */
class SimpleEmbedder {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  /**
   * Hash a string to a dimension index
   */
  private hashToDimension(word: string): number {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      const char = word.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % this.dimensions;
  }

  /**
   * Generate embedding for text
   */
  embed(text: string): number[] {
    const embedding = new Array(this.dimensions).fill(0);
    const tokens = this.tokenize(text);
    const tokenCounts = new Map<string, number>();

    // Count token frequencies
    for (const token of tokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }

    // Build embedding
    for (const [token, count] of tokenCounts) {
      const dim = this.hashToDimension(token);
      const tf = count / tokens.length;
      const idf = this.idf.get(token) || Math.log(10); // Default IDF
      embedding[dim] += tf * idf;
    }

    // L2 normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Update IDF values from corpus
   */
  updateIDF(documents: string[]): void {
    const docFreq = new Map<string, number>();
    const N = documents.length;

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    for (const [token, df] of docFreq) {
      this.idf.set(token, Math.log(N / (1 + df)));
    }
  }
}

// ============================================================================
// Semantic Cache
// ============================================================================

export class SemanticCache extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private embedder: SimpleEmbedder;
  private config: CacheConfig;
  private stats: CacheStats;
  private storagePath: string;

  constructor(config?: Partial<CacheConfig>) {
    super();
    this.config = {
      maxEntries: 1000,
      similarityThreshold: 0.85,
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      embeddingDimensions: 384,
      costPerToken: 0.00001, // $0.01 per 1000 tokens
      ...config,
    };

    this.embedder = new SimpleEmbedder(this.config.embeddingDimensions);
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgSimilarity: 0,
      savedTokens: 0,
      savedCost: 0,
    };

    this.storagePath = path.join(app.getPath('userData'), 'semantic-cache.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadCache();
    this.startCleanupInterval();
    logger.info('SemanticCache initialized', {
      maxEntries: this.config.maxEntries,
      threshold: this.config.similarityThreshold,
    });
  }

  private async loadCache(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        if (data.entries) {
          for (const entry of data.entries) {
            this.cache.set(entry.id, entry);
          }
        }
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }
        this.stats.totalEntries = this.cache.size;
      }
    } catch (error) {
      logger.warn('Failed to load cache', { error });
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await fs.writeJson(
        this.storagePath,
        {
          entries: Array.from(this.cache.values()),
          stats: this.stats,
          savedAt: Date.now(),
        },
        { spaces: 2 }
      );
    } catch (error) {
      logger.error('Failed to save cache', { error });
    }
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // Every hour
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Generate unique ID for cache entry
   */
  private generateId(): string {
    return `cache_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Look up cached response for a query
   */
  async lookup(query: string, context?: string): Promise<{ hit: boolean; response?: string; similarity?: number; entry?: CacheEntry }> {
    const queryEmbedding = this.embedder.embed(query);
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    const now = Date.now();

    for (const entry of this.cache.values()) {
      // Check TTL
      if (now - entry.metadata.createdAt > entry.metadata.ttl) {
        continue;
      }

      // Check context match if provided
      if (context && entry.context && entry.context !== context) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryEmbedding, entry.queryEmbedding);

      if (similarity > bestSimilarity && similarity >= this.config.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      // Update access stats
      bestMatch.metadata.lastAccessedAt = now;
      bestMatch.metadata.accessCount++;

      // Update global stats
      this.stats.hits++;
      this.stats.savedTokens += bestMatch.metadata.tokens;
      this.stats.savedCost += bestMatch.metadata.tokens * this.config.costPerToken;
      this.updateHitRate();

      this.emit('cache-hit', query, bestSimilarity, bestMatch);
      logger.debug('Cache hit', {
        query: query.substring(0, 50),
        similarity: bestSimilarity.toFixed(3),
      });

      return {
        hit: true,
        response: bestMatch.response,
        similarity: bestSimilarity,
        entry: bestMatch,
      };
    }

    this.stats.misses++;
    this.updateHitRate();
    this.emit('cache-miss', query);

    return { hit: false };
  }

  /**
   * Store a response in the cache
   */
  async store(
    query: string,
    response: string,
    options: {
      context?: string;
      model?: string;
      temperature?: number;
      tokens?: number;
      ttl?: number;
    } = {}
  ): Promise<CacheEntry> {
    // Check capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    const queryEmbedding = this.embedder.embed(query);
    const entry: CacheEntry = {
      id: this.generateId(),
      query,
      queryEmbedding,
      response,
      context: options.context,
      metadata: {
        model: options.model || 'unknown',
        temperature: options.temperature || 0.7,
        tokens: options.tokens || this.estimateTokens(response),
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        ttl: options.ttl || this.config.defaultTTL,
      },
    };

    this.cache.set(entry.id, entry);
    this.stats.totalEntries = this.cache.size;

    this.emit('cache-store', entry);
    this.emit('stats-updated', this.stats);

    // Debounced save
    this.debouncedSave();

    logger.debug('Cached response', {
      id: entry.id,
      queryLength: query.length,
      responseLength: response.length,
    });

    return entry;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldest: CacheEntry | null = null;
    let oldestTime = Date.now();

    for (const entry of this.cache.values()) {
      if (entry.metadata.lastAccessedAt < oldestTime) {
        oldestTime = entry.metadata.lastAccessedAt;
        oldest = entry;
      }
    }

    if (oldest) {
      this.cache.delete(oldest.id);
      this.emit('cache-evict', oldest.id, 'lru');
      logger.debug('Evicted LRU entry', { id: oldest.id });
    }
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    this.emit('stats-updated', this.stats);
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this.cache) {
      if (now - entry.metadata.createdAt > entry.metadata.ttl) {
        this.cache.delete(id);
        this.emit('cache-evict', id, 'expired');
        removed++;
      }
    }

    this.stats.totalEntries = this.cache.size;

    if (removed > 0) {
      logger.info('Cleaned up expired entries', { removed });
      this.saveCache();
    }

    return removed;
  }

  /**
   * Invalidate entries matching context
   */
  invalidateByContext(context: string): number {
    let invalidated = 0;

    for (const [id, entry] of this.cache) {
      if (entry.context === context) {
        this.cache.delete(id);
        this.emit('cache-evict', id, 'context-invalidation');
        invalidated++;
      }
    }

    this.stats.totalEntries = this.cache.size;

    if (invalidated > 0) {
      this.saveCache();
    }

    return invalidated;
  }

  /**
   * Invalidate entries similar to query
   */
  invalidateSimilar(query: string, threshold = 0.9): number {
    const queryEmbedding = this.embedder.embed(query);
    let invalidated = 0;

    for (const [id, entry] of this.cache) {
      const similarity = this.cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (similarity >= threshold) {
        this.cache.delete(id);
        this.emit('cache-evict', id, 'similar-invalidation');
        invalidated++;
      }
    }

    this.stats.totalEntries = this.cache.size;

    return invalidated;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private saveTimeout: NodeJS.Timeout | null = null;

  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveCache();
    }, 5000);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache size
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgSimilarity: 0,
      savedTokens: 0,
      savedCost: 0,
    };
    this.saveCache();
    logger.info('Cache cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Cache config updated', { config: this.config });
  }

  /**
   * Get all entries (for debugging)
   */
  getAllEntries(): CacheEntry[] {
    return Array.from(this.cache.values());
  }
}

// ============================================================================
// Singleton
// ============================================================================

let semanticCache: SemanticCache | null = null;

export function getSemanticCache(): SemanticCache {
  if (!semanticCache) {
    semanticCache = new SemanticCache();
  }
  return semanticCache;
}
